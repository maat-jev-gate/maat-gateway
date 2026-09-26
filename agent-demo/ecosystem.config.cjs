module.exports = {
  apps: [
    {
      name: "maat-agent-demo",
      cwd: "/opt/maat-agent-demo",
      script: "./node_modules/tsx/dist/cli.mjs",
      interpreter: "node",
      args: "server.ts",
      env: { NODE_ENV: "production" },
      max_memory_restart: "128M",
      time: true,
    },
  ],
};
