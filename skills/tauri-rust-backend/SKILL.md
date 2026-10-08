---
name: tauri-rust-backend
description: Implement or review LumenDeck's Tauri 2 and Rust backend, including Windows APIs, IPC, startup, configuration, logging, media, workers, and tests. Use when changing src-tauri or frontend-backend contracts.
---

# Tauri and Rust backend work

Use this skill for `src-tauri/` implementation and backend-owned behavior. For
changes crossing the webview boundary, also read
[`frontend-react-tailwind`](../frontend-react-tailwind/SKILL.md) and
[`docs/architecture.md`](../../docs/architecture.md).

## Trace ownership and constraints

- This app targets Windows only. Follow the existing `#[cfg(windows)]`, Tauri,
  Win32, and named-thread structure; do not add speculative portable layers.
- Locate the owning module before editing: `config.rs` defines schema and
  migrations, `config_store.rs` persists and updates it, `config_watch.rs`
  reloads external edits, and `ipc.rs` owns Tauri commands. Events are in
  `events.rs`; the frontend command wrappers are in `src/main-app/ipc.ts`.
- Keep Rust as the behavior owner for OS integration and filesystem operations.
  Preserve typed command results, existing error conversion, and frontend/Rust
  serialization names.
- For a new or changed IPC command, update its Rust implementation and
  registration, the typed TypeScript wrapper, shared types when needed, and
  focused tests. Follow [`development.md`'s IPC recipe](../../docs/development.md#adding-an-ipc-command).

## Protect load-bearing behavior

- Never run `cargo fmt`; this repository is intentionally not rustfmt-clean.
  Format the touched code by hand to match adjacent code.
- Keep `Config::default()` (serde fallback when stored fields are absent)
  distinct from `config_store::first_run_defaults()` (new-install config).
  Preserve migrations and tests when changing schema or defaults.
- Convert errors crossing IPC or thread boundaries to `String` with the local
  `error::err_str` convention.
- Log transitions, not polling state; do not log secrets. One module owns each
  transition log line, and `panic.rs` owns panic reporting.
- Treat startup ordering, WebView2 flags, media protocol/range behavior, and
  window-state flags as compatibility contracts, not cleanup opportunities.

## Tests and verification

Add or update focused Rust tests near the behavior, then run:

```bash
cd src-tauri && cargo test
```

For IPC or full-stack changes, also run the corresponding frontend tests and
`node scripts/verify.mjs` (or `node scripts/verify.mjs --no-build` when the
production bundle is not relevant). Report platform-specific checks that cannot
run in the current environment; a passing unit suite does not replace a Windows
Tauri shell smoke test where one is needed.

## Related decision records

Before changing `src-tauri/src/lib.rs` or `src-tauri/src/main.rs`, read
[`rust-startup-logging`](../rust-startup-logging/SKILL.md). For other modules,
keep broader rationale in focused documentation and short local invariants in
source; public API documentation, compiler directives, tests, and safety
comments stay close to code.
