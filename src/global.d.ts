/// <reference types="vite/client" />

/** Injected by Vite's `define` (see vite.config.ts) from tauri.conf.json. */
declare const __APP_VERSION__: string;

/** "dev" in dev-server builds, "release" in bundled builds. */
declare const __APP_BUILD_MODE__: "dev" | "release";
