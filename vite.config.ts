import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The source revision this bundle was built from.
 *
 * The version cannot do this job: every build between two releases carries the
 * same number, so "0.2.7" does not distinguish a shipped installer from a local
 * build of the same version. The dirty flag is the part that matters most here,
 * because this project's development pattern is a long-running uncommitted
 * working tree — a bare SHA would report the same commit for all of it.
 *
 * `undefined` outside a git checkout. The app then shows the version alone,
 * which is what it would have shown before.
 */
function buildIdentity(): string | undefined {
  const git = (args: string[]) => {
    try {
      return execFileSync("git", args, {
        cwd: fileURLToPath(new URL(".", import.meta.url)),
        encoding: "utf8",
        // A build must not hang waiting on a credential prompt or a pager.
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

const host = process.env.TAURI_DEV_HOST;
// App version from the Tauri config, injected as a compile-time global.
const appVersion = JSON.parse(
  readFileSync(r("./src-tauri/tauri.conf.json"), "utf8"),
).version;
// "dev" during `pnpm dev` / `pnpm app:dev`, "release" for bundled builds.
const buildMode = process.env.TAURI_ENV_DEBUG ? "dev" : "release";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD_MODE__: JSON.stringify(buildMode),
    // `undefined` rather than a placeholder string, so "no git here" is
    // distinguishable from a real revision.
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
    // `scripts/` earns its place here once a script holds a rule worth pinning
    // down — the version-drift comparison is one, and it encodes a judgement
    // call about the release pipeline that a future reader will question.
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
