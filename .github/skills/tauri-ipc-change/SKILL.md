---
name: tauri-ipc-change
description: Use when adding or changing behavior that crosses the LumenDeck React/Tauri IPC boundary.
---

# LumenDeck IPC changes

Follow the existing cross-boundary recipe in [`docs/development.md`](../../../docs/development.md#adding-an-ipc-command) and ownership map in [`docs/architecture.md`](../../../docs/architecture.md#ipc). Read both [`frontend-react-tailwind`](../../../skills/frontend-react-tailwind/SKILL.md) and [`tauri-rust-backend`](../../../skills/tauri-rust-backend/SKILL.md).

Trace the full path before editing:

1. Implement the Rust command in `src-tauri/src/ipc.rs` and register it in `src-tauri/src/lib.rs`.
2. Add or update the typed wrapper in `src/main-app/ipc.ts`; dashboard components must call that wrapper rather than Tauri `invoke`.
3. Update `src/shared/types.ts` if the serialized payload changes. Preserve Rust/TypeScript field naming and serialization contracts.
4. Add focused tests for decisions and edge cases at the owning layer.

Return errors using the repository's existing `Result<T, String>` and `error::err_str` conventions. Run the frontend and Rust checks that cover the change; use `node scripts/verify.mjs --no-build` when integration breadth warrants it. Preserve unrelated work and report exactly what was verified.
