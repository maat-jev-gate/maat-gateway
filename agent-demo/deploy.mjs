/*
 * File description: Build and publish the static Maat Agent demo over SSH with rsync and Caddy.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const localEnvPath = join(root, ".env");
const caddyFile = join(root, "deploy/caddy/site.caddy");

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
  const domain = env.DEPLOY_DOMAIN;
  const appDir = env.REMOTE_APP_DIR || "/opt/maat-agent-demo";
  if (!host) throw new Error("Missing DEPLOY_HOST in .env.");
  if (!/^[a-z0-9][a-z0-9._@-]*$/i.test(host)) throw new Error("DEPLOY_HOST must be an SSH host or user@host.");
  if (!domain || !/^[a-z0-9.-]+$/i.test(domain)) throw new Error("DEPLOY_DOMAIN must be a hostname.");
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(appDir)) throw new Error("REMOTE_APP_DIR must be an absolute path without shell characters.");
  const caddyConfig = await readFile(caddyFile, "utf8");
  if (!caddyConfig.trimStart().startsWith(`${domain} {`)) throw new Error("deploy/caddy/site.caddy must use DEPLOY_DOMAIN as its site address.");
  if (!caddyConfig.includes(`root * ${appDir}/dist`)) throw new Error("deploy/caddy/site.caddy must serve REMOTE_APP_DIR/dist.");
  if (args.has("--validate")) {
    await command("npm", ["run", "typecheck"]);
    await command("npm", ["run", "build"]);
    console.log(`Deployment configuration is valid for ${domain} on ${host}.`);
    return;
  }

  await command("npm", ["run", "build"]);
  const ssh = (script) => command("ssh", [host, script.trim()]);
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
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
curl -fsS -H 'Host: ${domain}' http://127.0.0.1/ >/dev/null
echo 'remote Agent site is ready'
`);
  console.log(`Published https://${domain}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
