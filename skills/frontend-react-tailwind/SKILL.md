---
name: frontend-react-tailwind
description: Implement or review LumenDeck React, TypeScript, Tailwind, and webview UI. Use for dashboard, wallpaper, sticker, placement, gallery, command-palette, component styling, state, and frontend testing tasks.
---

# Frontend and webview work

Use this skill for UI and frontend-owned behavior. Keep the change in the
frontend unless it requires a backend capability; for cross-boundary work also
read [`tauri-rust-backend`](../tauri-rust-backend/SKILL.md) and
[`docs/architecture.md`](../../docs/architecture.md).

## Establish the owner first

- Identify the webview and entry point: `src/main-app/`, `src/wallpaper/`,
  `src/sticker/`, or `src/placement/`.
- Trace existing component, state, IPC wrapper, and tests before editing. The
  dashboard's typed Tauri boundary is `src/main-app/ipc.ts`; Rust commands live
  in `src-tauri/src/ipc.rs`.
- Keep state with its current owner. Extract pure decisions beside the UI into
  small modules and test them; do not move presentation state into a backend or
  add state-management layers without a concrete need.

## Follow local UI contracts

- Compose from `src/main-app/components/ui.tsx`; extend a shared primitive when
  the existing one is insufficient rather than creating a drifting variant.
- Use design tokens and the icon rules in [`docs/design.md`](../../docs/design.md).
  Do not invent colors, radii, icon glyphs, or emoji.
- Preserve the existing interaction model unless the task calls for a behavior
  change. For visual work, check hierarchy, density, keyboard focus, reduced
  motion, and narrow/maximized window layouts against the design reference.
- User-facing copy uses `t()` and keys in both `locales/en.json` and
  `locales/es.json`; use the repository's i18n checker after copy changes.
- Select narrow Zustand values; use `useShallow` for a multi-field selection.
- Preserve webview constraints. Tauri APIs require the Tauri IPC host; a plain
  browser render is not a valid app smoke test.

## Tests and verification

Vitest uses Node without a DOM. Extract policy, parsing, geometry, and state
transitions to pure modules and test them beside the owning component. Do not
write React interaction tests that cannot run in this environment. Add a DOM
test dependency/environment only when rendered interaction assertions are
necessary and explicitly part of the change.

Run the nearest frontend test(s), then as scope warrants:

```bash
npx vitest run
npx tsc --noEmit
node scripts/i18n-check.mjs  # if user-visible copy/catalogs changed
npx vite build
pnpm app:dev                 # shell-level UI check, where feasible
```

Report checks separately: typechecking and bundling do not prove appearance or
Tauri behavior. Inspect the UI in its Tauri shell for visual changes when
feasible; do not claim a plain-browser run verifies IPC integration.

## Related decision records

For gallery filtering/sorting and command-palette ranking invariants, read
[`gallery-palette-rationale`](../gallery-palette-rationale/SKILL.md) when those
modules are in scope. For cross-cutting frontend code comment placement, avoid
copying long rationale into components; retain local API contracts and
safety-sensitive explanations near their implementation.
