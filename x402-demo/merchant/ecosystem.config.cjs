module.exports = {
  apps: [{
    name: "maat-x402-merchant",
    cwd: "/opt/maat-x402-merchant",
    script: "./node_modules/tsx/dist/cli.mjs",
    interpreter: "node",
    args: "server.ts",
    env: { NODE_ENV: "production" },
    max_memory_restart: "256M",
    time: true
  }]
};
