import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { injectThemeTokens } from "./src/shared/themeTokens";

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

/**
 * Write the theme blocks from src/shared/palette.ts into the dashboard
 * stylesheet, replacing its `/* theme-tokens *\/` marker.
 *
 * The accent readability maths resolves the same declarations, so a panel
 * background and the contrast decision made about it cannot disagree — which
 * they did, as two unrelated sets of literals, until both came from here.
 *
 * Scoped to index.css by name on purpose: the transform asserts the marker is
 * present exactly once, which would be a false alarm on the vendored
 * @fontsource sheets it imports.
 */
function themeTokens(): Plugin {
  return {
    name: "lumendeck-theme-tokens",
    // `pre` is load-bearing, not a style choice. @tailwindcss/vite also
    // registers as `pre`, and its processor strips comments and inlines
    // @imports on the way past — so a normal-order plugin sees a stylesheet
    // with the marker already deleted. Among `pre` plugins Vite keeps array
    // order, which is why this one is listed first.
    enforce: "pre" as const,
    transform(code, id) {
      // A dev-time id can carry a query (`index.css?direct`); the file part is
      // what identifies the stylesheet.
      const file = id.split("?")[0];
      if (!file.endsWith("index.css")) return null;
      return { code: injectThemeTokens(code), map: null };
    },
  };
}

const host = process.env.TAURI_DEV_HOST;
// App version from the Tauri config, injected as a compile-time global.
const appVersion = JSON.parse(
  readFileSync(r("./src-tauri/tauri.conf.json"), "utf8"),
).version;
// "dev" during `pnpm dev` / `pnpm app:dev`, "release" for bundled builds.
const buildMode = process.env.TAURI_ENV_DEBUG ? "dev" : "release";

export default defineConfig({
  // themeTokens before tailwindcss: both register as `pre`, and Vite preserves
  // array order among them, so this one sees the stylesheet before the Tailwind
  // processor has stripped the marker comment out of it.
  plugins: [react(), themeTokens(), tailwindcss()],
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
