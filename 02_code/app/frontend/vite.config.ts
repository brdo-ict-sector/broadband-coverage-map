import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app always calls the API at the same-origin path "/api". In production
// Caddy proxies that to the api container; in dev this proxy forwards it to the
// locally running API (the compose stack publishes it on :8000).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
