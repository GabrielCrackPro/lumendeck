import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": r("./src"),
      "@shared": r("./src/shared"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "chrome110",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      input: {
        "main-app": r("./main-app.html"),
        wallpaper: r("./wallpaper.html"),
        placement: r("./placement.html"),
        sticker: r("./sticker.html"),
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
