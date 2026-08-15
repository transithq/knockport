import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@knockport/core": path.resolve(__dirname, "../../packages/core/src"),
      "@knockport/format": path.resolve(__dirname, "../../packages/format/src"),
      "@knockport/transport": path.resolve(__dirname, "../../packages/transport/src"),
      "@knockport/storage": path.resolve(__dirname, "../../packages/storage/src"),
      "@knockport/engine": path.resolve(__dirname, "../../packages/engine/src"),
      "@knockport/ui": path.resolve(__dirname, "../../packages/ui/src"),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
