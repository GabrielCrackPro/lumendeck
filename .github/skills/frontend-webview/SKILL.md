---
name: frontend-webview
description: Use for LumenDeck React, TypeScript, Tailwind, dashboard, gallery, command-palette, wallpaper, sticker, placement, or other webview work.
---

# LumenDeck frontend work

Use the repository's [`frontend-react-tailwind` guide](../../../skills/frontend-react-tailwind/SKILL.md) as the source of truth. For visual-system changes, also read [`docs/design.md`](../../../docs/design.md); for cross-webview behavior, read [`docs/architecture.md`](../../../docs/architecture.md).

Identify the owning webview before editing. Dashboard IPC belongs in `src/main-app/ipc.ts`; dashboard components should not call Tauri `invoke` directly. Compose from `src/main-app/components/ui.tsx`, preserve the current interaction model unless asked to change it, and use both locale catalogs for new visible copy.

For UI changes, inspect keyboard focus, reduced-motion behavior, and narrow/maximized layouts. Use the Tauri shell for visual or IPC verification when feasible; report clearly when only static checks ran.
