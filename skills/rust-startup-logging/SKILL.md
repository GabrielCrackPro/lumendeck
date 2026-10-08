---
name: rust-startup-logging
description: Preserve LumenDeck Rust startup order, WebView2/media behavior, window state, logging, and diagnostics. Use before changing Tauri entry-point or logging behavior.
---

# Rust startup and logging constraints

Read this before changing `src-tauri/src/lib.rs` or `src-tauri/src/main.rs`.
Keep implementation/API contracts next to code; this guide holds cross-cutting rationale.

## Startup order and visible state

- Initialize the logger before installing the panic hook, so startup panics have a
  destination. Keep the panic hook as the single owner of the panic error line.
- Initialize config before setting WebView2 options, because video decode options
  depend on persisted preferences and must be set before creating any webview.
- Autostart should build the dashboard hidden unless the user opted to show it.
  Manual launches show the dashboard. Tray activation must restore/unminimize it.
- Show the first hidden-start hint only once, and derive its text from the actual
  enabled/paused state; do not claim that wallpaper or lighting is running when
  it is not.
- Apply saved window state only to the dashboard. Sticker, placement, and
  wallpaper windows are positioned from their owning config and must not inherit
  old geometry. Persist only size, position, and maximized state: visibility,
  decoration, and fullscreen flags can make login or frameless-window behavior
  wrong. Recheck restored dimensions against current monitor work areas/minimums.
- Debounce move/resize persistence, but save synchronously on close: an
  in-flight debounce can be lost when the process exits.

## WebView2 and media

- Disable DirectComposition video overlays so sticker layers can composite over
  video, but keep hardware decode enabled by default: software decode stalls and
  destabilizes 4K playback. Only enable software decode when the persisted
  preference explicitly requests it.
- Disable native occlusion tracking for wallpaper webviews. Explorer places them
  behind desktop icons, so Chromium would otherwise treat them as covered and
  suspend video/animation.
- Serve media through the registered `media` protocol; WebView2 uses its HTTP-like
  origin for range requests. Continue to register only media roots owned by live
  gallery/sticker data.

## Logging and diagnostics

- Preserve `%APPDATA%/LumenDeck/lumendeck.log`, the 5 MiB cap, and one rotated
  generation; support instructions rely on that path and bounded retention.
- Log state transitions rather than polls. `RUST_LOG` overrides the default
  `Info` level; per-tick detail belongs at debug. A single module owns each
  transition and panic reporting belongs to the panic hook.
- Keep the custom line format: local wall-clock time with milliseconds, short
  module target, and fixed-width level. The webview console is also forwarded
  into this log, so frontend diagnostics do not depend on devtools.
- The Developer UI reads the effective log level and build facts; do not report
  a guessed default when `RUST_LOG` changed the running process.

## AI editing guidance

Do not duplicate these paragraphs in comments. Keep short inline comments only
where a nearby branch's constraint is easy to break; keep Rust public API docs,
unsafe/safety explanations, test-specific rationale, and compiler directives in
source. This guide is the broader startup relationship map, not a replacement
for function signatures or tests.
