---
name: change-verification
description: Use when selecting, running, or reporting validation for a LumenDeck code change.
---

# LumenDeck change verification

Read the validation and platform notes in [`AGENTS.md`](../../../AGENTS.md) and the repository's [`development testing guide`](../../../docs/development.md#testing).

Choose the narrowest checks that cover the change:

- Frontend behavior: `npx vitest run <focused-test-file>` and `npx tsc --noEmit`.
- Rust behavior: from `src-tauri`, run `cargo test` (do not run `cargo fmt`).
- User-visible copy: run `node scripts/i18n-check.mjs`.
- Cross-subsystem changes or broad confidence: `node scripts/verify.mjs --no-build`.
- Production-bundle changes: `node scripts/verify.mjs`.
- Visual or Tauri IPC behavior: use `pnpm app:dev` where feasible; a plain browser does not host Tauri IPC.

Report each command that ran and its result. Distinguish checks that could not run from checks that were skipped, and do not present compilation as proof of visual or Windows-shell correctness. Never commit or deploy as part of verification unless explicitly asked.
