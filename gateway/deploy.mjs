/*
 * File description: Build and deploy Maat Gateway over SSH with PM2 and Caddy.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const appDir = "/opt/maat-gateway";
const service = "maat-gateway";
const caddyFile = join(root, "deploy/caddy/site.caddy");

function parseEnv(text) {
  return Object.fromEntries(
    text.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, "")]] : [];
    }),
  );
}

async function command(file, args, options = {}) {
  const result = await run(file, args, { cwd: root, maxBuffer: 2 * 1024 * 1024, ...options });
  if (result.stdout?.trim()) process.stdout.write(result.stdout);
  if (result.stderr?.trim()) process.stderr.write(result.stderr);
  return result;
}

const env = parseEnv(await readFile(join(root, ".env"), "utf8"));
if (!env.DEPLOY_HOST) throw new Error("Missing DEPLOY_HOST in .env");
if (!env.DEPLOY_DOMAIN || !/^[a-z0-9.-]+$/i.test(env.DEPLOY_DOMAIN))
  throw new Error("DEPLOY_DOMAIN must be a hostname");

const host = env.DEPLOY_HOST;
if (!/^[a-z0-9][a-z0-9._@-]*$/i.test(host))
  throw new Error("DEPLOY_HOST must be an SSH host or user@host");
const domain = env.DEPLOY_DOMAIN;
const port = Number(env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("PORT must be a valid user-space port");
const caddyConfig = await readFile(caddyFile, "utf8");
if (!caddyConfig.trimStart().startsWith(`${domain} {`))
  throw new Error("deploy/caddy/site.caddy must use DEPLOY_DOMAIN as its site address");
if (!caddyConfig.includes(`reverse_proxy 127.0.0.1:${port}`))
  throw new Error("deploy/caddy/site.caddy must proxy to PORT");

async function ssh(script) {
  return command("ssh", [host, script.trim()]);
}

console.log(`Checking and deploying ${service} to ${host}...`);
await command("npm", ["run", "typecheck"]);
await command("npm", ["run", "build"]);

await ssh(`
set -eu
APP_DIR=${appDir}
BACKUP_DIR="$APP_DIR/.deploy-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$APP_DIR/dist" "$APP_DIR/server" "$BACKUP_DIR" /etc/caddy/backups
if [ -f "$APP_DIR/.env" ]; then cp "$APP_DIR/.env" "$BACKUP_DIR/.env"; fi
if [ -f /etc/caddy/sites/${domain}.caddy ]; then cp /etc/caddy/sites/${domain}.caddy "$BACKUP_DIR/${domain}.caddy"; fi
`);

await command("rsync", ["-az", "--delete", `${join(root, "dist")}/`, `${host}:${appDir}/dist/`]);
await command("rsync", [
  "-az",
  "server.ts",
  "package.json",
  "package-lock.json",
  "ecosystem.config.cjs",
  `${host}:${appDir}/`,
]);
await command("rsync", ["-az", "server/", `${host}:${appDir}/server/`]);
await command("rsync", ["-az", ".env", `${host}:${appDir}/.env`]);
await command("rsync", ["-az", caddyFile, `${host}:/etc/caddy/sites/${domain}.caddy`]);

await ssh(`
set -eu
cd ${appDir}
chmod 600 .env
npm ci --omit=dev
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
ready=0
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:${port}/health >/dev/null; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "${service} did not become ready" >&2
  pm2 logs ${service} --lines 40 --nostream >&2 || true
  exit 1
fi
pm2 describe ${service} >/dev/null
echo "remote deployment ready"
`);

console.log(`Published ${domain} through Caddy -> 127.0.0.1:${port}`);
console.log(`Public check: https://${domain}/health`);
