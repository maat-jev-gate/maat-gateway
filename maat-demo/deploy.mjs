import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const host = process.env.DEPLOY_HOST;
const domain = process.env.DEPLOY_DOMAIN;
const appDir = process.env.REMOTE_APP_DIR;

async function command(file, args) {
  const { stdout, stderr } = await run(file, args, { cwd: root, maxBuffer: 2 * 1024 * 1024 });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

if (!host || !/^[a-z0-9][a-z0-9._@-]*$/i.test(host)) throw new Error("DEPLOY_HOST must be an SSH host.");
if (!domain || !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(domain)) throw new Error("DEPLOY_DOMAIN must be a hostname.");
if (!appDir || !/^\/[a-zA-Z0-9/_-]+$/.test(appDir)) throw new Error("REMOTE_APP_DIR must be an absolute app path.");

const template = await readFile(join(root, "deploy/caddy/site.caddy.template"), "utf8");
const site = template.replaceAll("__DOMAIN__", domain).replaceAll("__APP_DIR__", appDir);
const temporary = await mkdtemp(join(tmpdir(), "maat-demo-deploy-"));

try {
  await writeFile(join(temporary, "site.caddy"), site);
  await command("npm", ["run", "build"]);
  await command("ssh", [host, `mkdir -p '${appDir}/.incoming/dist' '${appDir}/.deploy-backups'`]);
  await command("rsync", ["-az", "--delete", `${join(root, "dist")}/`, `${host}:${appDir}/.incoming/dist/`]);
  await command("rsync", ["-az", join(temporary, "site.caddy"), join(root, "deploy/activate.sh"), `${host}:${appDir}/.incoming/`]);
  await command("ssh", [host, `sh '${appDir}/.incoming/activate.sh' '${appDir}' '${domain}'`]);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
