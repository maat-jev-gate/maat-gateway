import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const appDir = "/opt/maat-x402-merchant";
const service = "maat-x402-merchant";
const caddyTemplate = join(root, "deploy/caddy/merchant.caddy.template");

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

const env = parseEnv(await readFile(join(root, ".env"), "utf8"));
for (const key of ["DEPLOY_HOST", "DEPLOY_DOMAIN", "MERCHANT_PAY_TO", "FACILITATOR_URL"]) {
  if (!env[key]) throw new Error(`Missing ${key} in .env`);
}

const host = env.DEPLOY_HOST;
const domain = env.DEPLOY_DOMAIN;
const port = Number(env.PORT ?? 8790);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PORT must be a valid user-space port");

async function ssh(script) {
  return command("ssh", [host, script.trim()]);
}

console.log(`Checking and deploying ${service} to ${host}...`);
await command("npm", ["run", "typecheck"]);

const tempDir = await mkdtemp(join(tmpdir(), "maat-x402-merchant-deploy-"));
try {
  const caddyFile = join(tempDir, `${domain}.caddy`);
  const caddyConfig = (await readFile(caddyTemplate, "utf8"))
    .replaceAll("__DOMAIN__", domain)
    .replaceAll("__PORT__", String(port));
  await writeFile(caddyFile, caddyConfig);

  const productionEnv = [
    `PORT=${port}`,
    `VENDOR_BASE_URL=https://${domain}`,
    `FACILITATOR_URL=${env.FACILITATOR_URL}`,
    `FACILITATOR_AUTH_TOKEN=${env.FACILITATOR_AUTH_TOKEN ?? ""}`,
    `MERCHANT_PAY_TO=${env.MERCHANT_PAY_TO}`,
    "DEMO_ALLOW_UNSIGNED_PAYMENT=false"
  ].join("\n") + "\n";
  const envPath = join(tempDir, ".env");
  await writeFile(envPath, productionEnv, { mode: 0o600 });

  await ssh(`
set -eu
APP_DIR=${appDir}
BACKUP_DIR="$APP_DIR/.deploy-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$APP_DIR" "$BACKUP_DIR" /etc/caddy/backups
if [ -f "$APP_DIR/.env" ]; then cp "$APP_DIR/.env" "$BACKUP_DIR/.env"; fi
if [ -f /etc/caddy/sites/${domain}.caddy ]; then cp /etc/caddy/sites/${domain}.caddy "$BACKUP_DIR/${domain}.caddy"; fi
`);

  await command("rsync", ["-az", "--delete", `${join(root, "public")}/`, `${host}:${appDir}/public/`]);
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
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log(`Published ${domain} through Caddy -> 127.0.0.1:${port}`);
console.log(`Public check: https://${domain}/health`);
