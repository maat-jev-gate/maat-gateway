import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      "/merchant": "http://127.0.0.1:8790",
      "/health": "http://127.0.0.1:8790",
      "/api": "http://127.0.0.1:8790",
    },
  },
});
