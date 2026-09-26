const { readFileSync } = require("node:fs");

const match = readFileSync("/opt/maat-swap-guard/.env", "utf8").match(/^PORT=(\d+)$/m);
const port = Number(match?.[1] ?? 8795);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PORT must be a valid user-space port.");

module.exports = {
  apps: [{
    name: "maat-swap-guard",
    cwd: "/opt/maat-swap-guard",
    script: "./node_modules/next/dist/bin/next",
    interpreter: "node",
    args: "start -H 127.0.0.1",
    env: { NODE_ENV: "production", PORT: String(port) },
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    max_memory_restart: "512M",
    time: true,
  }],
};
