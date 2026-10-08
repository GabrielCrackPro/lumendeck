import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { injectThemeTokens } from "./src/shared/themeTokens";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

function buildIdentity(): string | undefined {
  const git = (args: string[]) => {
    try {
      return execFileSync("git", args, {
        cwd: fileURLToPath(new URL(".", import.meta.url)),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }).trim();
    } catch {
      return "";
    }
  };
  const sha = git(["rev-parse", "--short", "HEAD"]);
  if (!sha) return undefined;
  return git(["status", "--porcelain"]) ? `${sha}-dirty` : sha;
}

function themeTokens(): Plugin {
  return {
    name: "lumendeck-theme-tokens",
    enforce: "pre" as const,
    transform(code, id) {
      const file = id.split("?")[0];
      if (!file.endsWith("index.css")) return null;
      return { code: injectThemeTokens(code), map: null };
    },
  };
}

const host = process.env.TAURI_DEV_HOST;
const appVersion = JSON.parse(
  readFileSync(r("./src-tauri/tauri.conf.json"), "utf8"),
).version;
const buildMode = process.env.TAURI_ENV_DEBUG ? "dev" : "release";

export default defineConfig({
  plugins: [react(), themeTokens(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD_MODE__: JSON.stringify(buildMode),
    __APP_BUILD_ID__: JSON.stringify(buildIdentity()),
  },
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
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
