/*
 * File description: Define the production PM2 process for Maat Gateway.
 */
module.exports = {
  apps: [{
    name: "maat-gateway",
    cwd: "/opt/maat-gateway",
    script: "./node_modules/tsx/dist/cli.mjs",
    interpreter: "node",
    args: "server.ts",
    env: { NODE_ENV: "production" },
    max_memory_restart: "256M",
    time: true,
  }],
};
