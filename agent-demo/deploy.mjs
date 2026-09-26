/*
 * File description: Build and publish the static Maat Agent demo over SSH with rsync and Caddy.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const localEnvPath = join(root, ".env");
const caddyTemplate = join(root, "deploy/caddy/agent-demo.caddy.template");

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, "")]] : [];
  }));
}

async function command(file, commandArgs, options = {}) {
  const result = await run(file, commandArgs, { cwd: root, maxBuffer: 2 * 1024 * 1024, ...options });
  if (result.stdout?.trim()) process.stdout.write(result.stdout);
  if (result.stderr?.trim()) process.stderr.write(result.stderr);
  return result;
}

async function main() {
  let env;
  try { env = parseEnv(await readFile(localEnvPath, "utf8")); }
  catch { throw new Error(`Missing ${localEnvPath}. Copy .env.example to .env before publishing.`); }
  const host = env.DEPLOY_HOST;
  const domain = env.DEPLOY_DOMAIN || "agent.maat-jev-gate.online";
  const appDir = env.REMOTE_APP_DIR || "/opt/maat-agent-demo";
  if (!host) throw new Error("Missing DEPLOY_HOST in .env.");
  if (!domain || !/^[a-z0-9.-]+$/i.test(domain)) throw new Error("DEPLOY_DOMAIN must be a hostname.");
  if (!appDir.startsWith("/")) throw new Error("REMOTE_APP_DIR must be an absolute path.");
  if (args.has("--validate")) {
    await command("npm", ["run", "typecheck"]);
    await command("npm", ["run", "build"]);
    console.log(`Deployment configuration is valid for ${domain} on ${host}.`);
    return;
  }

  await command("npm", ["run", "build"]);
  const caddyConfig = (await readFile(caddyTemplate, "utf8")).replaceAll("__DOMAIN__", domain).replaceAll("/opt/maat-agent-demo", appDir);
  const tempDir = await mkdtemp(join(tmpdir(), "maat-agent-demo-deploy-"));
  const caddyFile = join(tempDir, `${domain}.caddy`);
  await writeFile(caddyFile, caddyConfig);
  const ssh = (script) => command("ssh", [host, script.trim()]);
  try {
    await ssh(`
set -eu
APP_DIR='${appDir}'
DOMAIN='${domain}'
BACKUP_DIR="$APP_DIR/.deploy-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$APP_DIR/dist" "$BACKUP_DIR" /etc/caddy/backups
if [ -f /etc/caddy/sites/$DOMAIN.caddy ]; then cp /etc/caddy/sites/$DOMAIN.caddy "$BACKUP_DIR/$DOMAIN.caddy"; fi
`);
    await command("rsync", ["-az", "--delete", `${join(root, "dist")}/`, `${host}:${appDir}/dist/`]);
    await command("rsync", ["-az", caddyFile, `${host}:/etc/caddy/sites/${domain}.caddy`]);
    await ssh(`
set -eu
caddy fmt --overwrite /etc/caddy/sites/'${domain}'.caddy
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
curl -fsS -H 'Host: ${domain}' http://127.0.0.1/ >/dev/null
echo 'remote Agent site is ready'
`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
  console.log(`Published https://${domain}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
