/*
 * File description: Build and deploy the Maat World Demo over SSH with PM2 and Caddy.
 * Reference: docs/Maat project plan.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const appDir = "/opt/maat-world-demo";
const service = "maat-world-demo";
const port = 8791;
const caddyTemplate = join(root, "deploy/caddy/maat-world-demo.caddy.template");

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, "")]] : [];
  }));
}

async function command(file, args, options = {}) {
  const result = await run(file, args, { cwd: root, maxBuffer: 2 * 1024 * 1024, ...options });
  if (result.stdout?.trim()) process.stdout.write(result.stdout);
  if (result.stderr?.trim()) process.stderr.write(result.stderr);
  return result;
}

async function ssh(script) {
  return command("ssh", [host, script.trim()]);
}

const localEnvPath = join(root, ".env");
const env = parseEnv(await readFile(localEnvPath, "utf8"));
for (const key of ["DEPLOY_HOST", "DEPLOY_DOMAIN", "WORLD_ISSUER", "WORLD_CLIENT_ID", "WORLD_CLIENT_SECRET", "WORLD_REDIRECT_URI"]) {
  if (!env[key]) throw new Error(`Missing ${key} in .env`);
}
const host = env.DEPLOY_HOST;
const domain = env.DEPLOY_DOMAIN;
const callback = new URL(env.WORLD_REDIRECT_URI);
if (callback.protocol !== "https:" || callback.hostname !== domain || callback.pathname !== "/auth/world/callback") {
  throw new Error(`WORLD_REDIRECT_URI must be https://${domain}/auth/world/callback`);
}

console.log(`Building ${service} for ${host}...`);
await command("npm", ["run", "build"]);

const tempDir = await mkdtemp(join(tmpdir(), "maat-world-demo-deploy-"));
try {
  const caddyFile = join(tempDir, `${domain}.caddy`);
  const caddyConfig = (await readFile(caddyTemplate, "utf8")).replaceAll("__DOMAIN__", domain);
  await writeFile(caddyFile, caddyConfig);
  const productionEnv = [
    `WORLD_ISSUER=${env.WORLD_ISSUER}`,
    `WORLD_CLIENT_ID=${env.WORLD_CLIENT_ID}`,
    `WORLD_CLIENT_SECRET=${env.WORLD_CLIENT_SECRET}`,
    `WORLD_REDIRECT_URI=${env.WORLD_REDIRECT_URI}`,
    `PORT=${port}`,
  ].join("\n") + "\n";
  const envPath = join(tempDir, ".env");
  await writeFile(envPath, productionEnv, { mode: 0o600 });

  await ssh(`
set -eu
APP_DIR=${appDir}
BACKUP_DIR="$APP_DIR/.deploy-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$APP_DIR/dist" "$BACKUP_DIR" /etc/caddy/backups
if [ -f "$APP_DIR/.env" ]; then cp "$APP_DIR/.env" "$BACKUP_DIR/.env"; fi
if [ -f /etc/caddy/sites/${domain}.caddy ]; then cp /etc/caddy/sites/${domain}.caddy "$BACKUP_DIR/${domain}.caddy"; fi
`);

  console.log("Syncing dist/ with rsync...");
  await command("rsync", ["-az", "--delete", `${join(root, "dist")}/`, `${host}:${appDir}/dist/`]);
  await command("rsync", ["-az", "server.ts", "package.json", "package-lock.json", "ecosystem.config.cjs", `${host}:${appDir}/`]);
  await command("rsync", ["-az", envPath, `${host}:${appDir}/.env`]);
  await command("rsync", ["-az", caddyFile, `${host}:/etc/caddy/sites/${domain}.caddy`]);

  await ssh(`
set -eu
cd ${appDir}
chmod 600 .env
npm ci --omit=dev
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
caddy fmt --overwrite /etc/caddy/sites/${domain}.caddy
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
ready=0
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:${port}/api/config >/dev/null; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "maat-world-demo did not become ready" >&2
  pm2 logs ${service} --lines 40 --nostream >&2 || true
  exit 1
fi
pm2 describe ${service} >/dev/null
echo "remote deployment ready"
`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log(`Published ${domain} through Caddy -> 127.0.0.1:${port}`);
