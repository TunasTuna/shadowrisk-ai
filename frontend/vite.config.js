import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Allow tunnel hostnames (e.g. https://xxxx.trycloudflare.com) through Vite's host check
    allowedHosts: true,
    // Proxy API calls to the local FastAPI backend so a single tunnel
    // serves both the UI and the API.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
