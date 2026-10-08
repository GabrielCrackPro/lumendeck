---
name: tauri-backend
description: Use for LumenDeck Rust, Tauri, Win32, configuration, logging, media, worker-thread, or backend behavior changes.
---

# LumenDeck Tauri backend work

Use the repository's [`tauri-rust-backend` guide](../../../skills/tauri-rust-backend/SKILL.md) as the source of truth. Before changing startup or logging paths in `src-tauri/src/lib.rs` or `src-tauri/src/main.rs`, also read [`rust-startup-logging`](../../../skills/rust-startup-logging/SKILL.md). Read [`docs/architecture.md`](../../../docs/architecture.md) when the change crosses webviews or backend ownership boundaries.

Preserve the Windows-only architecture and existing module ownership. For IPC changes, update the Rust implementation and registration, typed frontend wrapper, shared type if needed, and focused tests. Do not run `cargo fmt`; this repository is intentionally not rustfmt-clean.
