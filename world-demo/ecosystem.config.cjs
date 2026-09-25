/*
 * File description: Define the production PM2 process for the Maat World Demo.
 */
module.exports = {
  apps: [{
    name: "maat-world-demo",
    cwd: "/opt/maat-world-demo",
    script: "./node_modules/tsx/dist/cli.mjs",
    interpreter: "node",
    args: "server.ts",
    env: { NODE_ENV: "production" },
    max_memory_restart: "256M",
    time: true,
  }],
};
