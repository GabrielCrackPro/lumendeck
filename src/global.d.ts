/// <reference types="vite/client" />

/** Injected by Vite's `define` (see vite.config.ts) from tauri.conf.json. */
declare const __APP_VERSION__: string;

/** "dev" in dev-server builds, "release" in bundled builds. */
declare const __APP_BUILD_MODE__: "dev" | "release";

/**
 * The git revision this bundle was built from, with `-dirty` when the working
 * tree had uncommitted changes. `undefined` outside a git checkout.
 *
 * The backend reports the same identity from its build stamp, so the two can be
 * compared rather than assumed to agree.
 */
declare const __APP_BUILD_ID__: string | undefined;
