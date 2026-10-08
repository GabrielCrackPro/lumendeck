# AGENTS.md

Repository entry point for coding agents. Keep universal decisions here; load a
focused skill for task-specific constraints and use `docs/` for architecture,
recipes, and design reference. Do not repeat whole explanations across files.

## Project map

LumenDeck is a Windows-only Tauri 2 desktop app: one Rust process hosts four
webviews (dashboard, wallpaper, stickers, placement). The webviews use
React/TypeScript with Tailwind; Rust owns Windows integration, configuration,
media, and typed IPC. There is no portable macOS/Linux implementation.

| Task | Read before editing |
| --- | --- |
| React, TypeScript, Tailwind, or webview UI | [`frontend-react-tailwind`](skills/frontend-react-tailwind/SKILL.md) |
| Tauri startup, Rust, Win32, config, logging, or IPC backend | [`tauri-rust-backend`](skills/tauri-rust-backend/SKILL.md) |
| Change crossing frontend/backend boundary | Read both skills and [`architecture.md`](docs/architecture.md); use [`development.md` IPC recipe](docs/development.md#adding-an-ipc-command) |
| Gallery queries or command-palette ranking | [`gallery-palette-rationale`](skills/gallery-palette-rationale/SKILL.md) |
| Rust startup and logging behavior | [`rust-startup-logging`](skills/rust-startup-logging/SKILL.md) |
| Visual design tokens, primitives, icons, or motion | [`design.md`](docs/design.md) |
| Copilot agent roles, skills, or workflow | [`.github/agents/`](.github/agents/) and [`ai-workflow.md`](docs/ai-workflow.md) |
| Preparing, validating, or publishing a release | [`release-process`](skills/release-process/SKILL.md) |

Load only relevant guides. Source and tests remain authoritative for exact
interfaces. For work not covered by a skill, inspect the owning module and its
tests before inventing a new abstraction.

The detailed guides in `skills/` remain the shared source of truth. Copilot
skills in `.github/skills/` are task-discovery entry points to those guides,
not a second copy. Codebuff agent definitions in `.agents/` use a separate
tool-specific format; keep their shared project constraints consistent.

## Verify changes

Run the narrowest checks that cover the changed behavior, then the full suite
when work spans subsystems or before claiming the whole app works:

```bash
node scripts/verify.mjs              # version sync, i18n, tsc, vitest, cargo test, vite build
node scripts/verify.mjs --no-build   # same checks except production bundle
npx vitest run                       # frontend pure-logic tests
cd src-tauri && cargo test           # Rust tests
```

The verify script stops on the first failure. Report exactly which checks ran
and any that could not run; a typecheck/build is not proof that UI looks right.
The app cannot boot in a plain browser because Tauri IPC is required; use
`pnpm app:dev` to verify UI behavior in its actual shell, where feasible.

## Shared non-negotiables

- Preserve unrelated working-tree changes. Inspect status before edits; do not
overwrite, stage, stash, or revert work you did not make.
- Never run `cargo fmt`; this repository is not rustfmt-clean. Format Rust by
hand to match neighboring code.
- Keep `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and
`src-tauri/tauri.conf.json` versions in sync. Tag-drift checking needs network.
- User-facing strings go through `t()` and exist in both locale catalogs; run
`node scripts/i18n-check.mjs` after copy changes.
- No emoji. Comments explain why, not what; avoid duplicating rationale in a
focused skill or `docs/`.
- Never log unchanged state or secrets. Log transitions; one module owns each
transition, and the panic hook owns panic reporting.
- Keep `Config::default()` (serde fallback for older saved configs) distinct
from `config_store::first_run_defaults()` (new-install defaults). Preserve the
tests for this contract when changing a default.
- Do not add speculative cross-platform abstractions. Errors crossing Rust IPC
or thread boundaries become `String` via `error::err_str`.

## Routing and delegation

The primary agent owns scope, edits, integration, and final verification. If the
runtime offers subagents, delegate only independent, bounded, read-heavy work
(for example, mapping frontend and backend call paths in parallel). Request
concise findings with file/symbol references and risks, not raw dumps. Keep
writes centralized; do not let agents edit overlapping files, and review each
finding before acting. Delegation is optional: for small tasks, or when its
coordination/context cost exceeds likely benefit, work in one thread. Never
assume a subagent capability the current runtime does not expose.

## Project guides

- [`architecture.md`](docs/architecture.md): processes, webviews, IPC, config,
threading, and data flow.
- [`development.md`](docs/development.md): settings, IPC, UI, copy, tests, and
release recipes.
- [`design.md`](docs/design.md): visual system and component conventions.
- [`skills/`](skills/): focused workflows and non-obvious constraints; activate
only the skill relevant to the change.
- [`.agents/`](.agents/): versioned Codebuff agent definitions; keep them
task-scoped and aligned with the `AgentDefinition` type.

## Change and release hygiene

Follow Conventional Commits if asked to commit. A push to `main` publishes a
release; documentation-only changes should use `[skip release]` on a line of
its own, never `[skip ci]`. After a `feat` or `fix`, regenerate the changelog
with `node scripts/generate-changelog.mjs --commit`. Do not commit, push, or
deploy unless the user asks.
