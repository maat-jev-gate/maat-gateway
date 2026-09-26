import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const appDir = "/opt/maat-swap-guard";

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, "")]] : [];
  }));
}

async function command(file, args) {
  const result = await run(file, args, { cwd: root, maxBuffer: 2 * 1024 * 1024 });
  if (result.stdout?.trim()) process.stdout.write(result.stdout);
  if (result.stderr?.trim()) process.stderr.write(result.stderr);
}

const env = parseEnv(await readFile(join(root, ".env"), "utf8"));
if (!env.DEPLOY_HOST || !/^[a-z0-9][a-z0-9._@-]*$/i.test(env.DEPLOY_HOST)) throw new Error("DEPLOY_HOST must be an SSH host or user@host.");
if (!env.DEPLOY_DOMAIN || !/^[a-z0-9.-]+$/i.test(env.DEPLOY_DOMAIN)) throw new Error("DEPLOY_DOMAIN must be a hostname.");
const port = Number(env.PORT ?? 8795);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PORT must be a valid user-space port.");

await command("npm", ["run", "typecheck"]);
await command("npm", ["run", "build"]);

const directory = await mkdtemp(join(tmpdir(), "maat-swap-guard-"));
try {
  const caddy = join(directory, "site.caddy");
  await writeFile(caddy, `${env.DEPLOY_DOMAIN} {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:${port}\n}\n`);
  await command("ssh", [env.DEPLOY_HOST, `mkdir -p ${appDir}/deploy`]);
  await command("rsync", ["-az", "--delete", ".next/", `${env.DEPLOY_HOST}:${appDir}/.next/`]);
  await command("rsync", ["-az", "package.json", "package-lock.json", "ecosystem.config.cjs", ".env", `${env.DEPLOY_HOST}:${appDir}/`]);
  await command("rsync", ["-az", "deploy/remote.sh", `${env.DEPLOY_HOST}:${appDir}/deploy/remote.sh`]);
  await command("rsync", ["-az", caddy, `${env.DEPLOY_HOST}:${appDir}/deploy/site.caddy.next`]);
  await command("ssh", [env.DEPLOY_HOST, `bash ${appDir}/deploy/remote.sh ${env.DEPLOY_DOMAIN} ${port}`]);
} finally {
  await rm(directory, { recursive: true, force: true });
}
