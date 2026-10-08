# Architecture

How LumenDeck is put together, and why the shapes are what they are. For
conventions and hard rules see [`AGENTS.md`](../AGENTS.md).

## Contents

- [Processes and windows](#processes-and-windows)
- [The frame pipeline](#the-frame-pipeline)
- [IPC](#ipc)
- [Configuration](#configuration)
- [Threading](#threading)
- [Logging](#logging)
- [Build identity](#build-identity)
- [Frontend](#frontend)
- [Colour](#colour)

If you are looking for a recipe rather than a reason — how to add a command, a
setting or a piece of copy — it is in
[`development.md`](development.md). If you are changing something that renders,
[`design.md`](design.md) is the reference for tokens and primitives.

## Processes and windows

One Rust process hosts four kinds of webview. They are separate webviews rather
than one window with conditional rendering because they have genuinely different
requirements: one must sit behind the desktop icons, one must be click-through,
and one must never be occluded.

| Webview          | Entry              | Job                                              |
| ---------------- | ------------------ | ------------------------------------------------ |
| Dashboard        | `main-app.html`    | the window the user interacts with               |
| Wallpaper        | `wallpaper.html`   | one per monitor, behind desktop icons (WorkerW)   |
| Sticker          | `sticker.html`     | one per sticker, top-level and transparent       |
| Placement        | `placement.html`   | one, only while placing a sticker                |

**WorkerW** is the load-bearing trick. The desktop's icon list lives in a window
owned by Explorer. LumenDeck asks Explorer for a `WorkerW` handle, reparents its
wallpaper window into it, and places it directly behind the icon layer — which
is what makes the wallpaper visible *behind* icons rather than behind the whole
shell. Modified third-party shells may not expose a usable handle; the app falls
back to a bottom-anchored window and says so in the UI rather than failing
quietly. See `workerw.rs` and `window_utils.rs`.

**Sticker windows** are top-level and transparent, with click-through toggled per
sticker. They mirror across monitors by default, because a sticker pinned to the
middle of a screen you are not looking at is not much use.

**Zone sampling** is a frontend concern that feeds the backend. The wallpaper
webview already has the decoded frame in a canvas, so it samples rectangles the
user drew over that canvas and sends the average colour on a timer. The backend
never reads pixels.

## The frame pipeline

```
<video> decode -> <canvas> blit -> visible wallpaper webview
                  |
                  +- sample drawn colour zones every 100ms -> RGB engine
                  +- push a JPEG snapshot on source change -> OS background,
                                                             lock screen,
                                                             decode-failure fallback
```

Blitting through a canvas rather than presenting the video element directly is
what lets stickers and UI composite above reliably, and it gives one place to
sample colours from.

The static background snapshot is deliberately **not** per-frame. It is pushed
once per wallpaper source change, plus a periodic refresh. A push per frame makes
the desktop background flicker and floods the log; if `desktop wallpaper set`
appears more often than that, something is wrong.

The blit loop caps itself to the video's own frame rate. A 24 fps source does
roughly half the canvas work of a naive 60 fps loop with no visible difference.

## IPC

`src/main-app/ipc.ts` is a typed wrapper over every Tauri command, and
`src-tauri/src/ipc.rs` defines them. Adding a command means touching both, plus
the shared type if it returns a struct — the recipe is in
[`development.md`](development.md#adding-an-ipc-command).

Commands are plain functions returning `Result<T, String>` (or `Option<T>` when
"nothing to report" is normal). Errors cross the boundary as strings.

Events flow the other way, through `events.rs`, and are emitted to **all**
windows. The ones that exist: display topology changed, config changed, accent
changed, wallpaper paused, scenes applied. Two reasons it is a broadcast rather
than targeted: every window wants most of these, and a missed targeted event
leaves one window permanently stale with no way to detect it.

## Configuration

`%APPDATA%/LumenDeck/config.json`. Written atomically (temp file plus rename),
schema-versioned, camelCase, hot-reloaded by a filesystem watch. The TS mirror is
`src/shared/types.ts`.

Three pieces, and they have distinct jobs:

- **`config.rs`** — the schema, its migrations, and the `Default` impls.
- **`config_store.rs`** — persistence, the in-memory store, and the update lock.
- **`config_watch.rs`** — notices external edits and reloads them.

The migration function runs on every parse, so a file from an older build is
upgraded on the way in rather than rejected.

**Defaults mean two different things**, which is the subtlest thing in this file
and the easiest to break:

- `Config::default()` is the value serde substitutes for a field a stored config
  predates. It answers "what does an existing user keep seeing".
- `config_store::first_run_defaults()` answers "what does a new install start
  with".

These currently differ in exactly one field. A test enforces that they do not
drift apart casually.

Side effects — applying the wallpaper, syncing autostart, re-binding hotkeys —
are debounced onto a dedicated worker thread, so a burst of config writes
produces one application rather than several.

## Threading

Rust work is spread across named threads rather than a pool, because most of it
is long-lived and owns a specific resource:

| Thread            | Owns                                             |
| ----------------- | ------------------------------------------------ |
| `side-effects`    | debounced application of config changes          |
| `audio-capture`   | the WASAPI loopback capture                      |
| accent watcher    | polling the accent registry every 3s             |
| config watcher    | filesystem watch on the config directory         |
| idle poller       | "has the user touched anything" detection         |

The accent watcher is worth understanding, because it solves a problem that
looks like timing and is not. LumenDeck writes the Windows accent to follow the
wallpaper, and also polls the registry to notice when *the user* changes it.
Without bookkeeping the poll cannot tell its own write from a user's, so every
write was echoed back as a change — once in events, twice in the log. The fix is
in `accent_watch.rs`: remember what was last written and compare values. A
time-based suppression would have swallowed a genuine user change that happened
to land in the same window.

## Logging

Default level is `Info`; `RUST_LOG` overrides it, so `RUST_LOG=lumendeck=debug`
works without a rebuild. One file, 5 MB, one generation kept.

Format is set in `lib.rs` via a custom `logfmt` closure rather than the plugin
default, because two details are load-bearing for the file being greppable at
3am: the module name is shortened to its last segment (`lumendeck_lib::ipc`
reads as `ipc`), and the level is padded to five columns so `INFO` and `ERROR`
line up.

The default level is a product decision, not a default. Anything that fires per
tick, or logs a value that did not change, belongs at `debug` — see the
[`rust-startup-logging` skill](../skills/rust-startup-logging/SKILL.md).

### Crashes

`panic.rs` installs a hook, called after `init_logging` so there is a logger to
write to. A panic becomes one `error` line — message, location, thread, and the
build id — and is also kept in a static that `dev_info` reports as `last_panic`.

The static is the reason for the module. A panicking background thread does not
always take the process down, so a report filed from a session that "looked
fine" is the case with no other trace. The payload is downcast defensively:
`panic_any` puts arbitrary data there, and reading it must not itself panic.

The previous hook is chained rather than replaced, so `tauri dev` still gets its
console output.

## Build identity

The version cannot say which build something is. Every build between two
releases carries the same number, so a bug report that says "0.2.7" does not
distinguish a shipped installer from a build of a branch that happens to sit at
0.2.7.

So the revision is stamped in at build time, in two places that are expected to
agree and are worth comparing when they don't:

- `build.rs` runs `git rev-parse --short HEAD` and `git status --porcelain`,
  emitting `LUMENDECK_BUILD_ID` and `LUMENDECK_BUILD_DIRTY`. `dev_info` reports
  them, so the value describes the executable itself and cannot drift.
- `vite.config.ts` reads the same two facts and injects `__APP_BUILD_ID__` for
  the About card.

The **dirty flag carries most of the weight here**, because this repository's
development pattern is a long-running uncommitted working tree. A bare SHA would
report the same commit for every local build regardless of what had changed on
top of it — which is precisely the ambiguity being removed.

Both paths degrade to `unknown` / absent outside a git checkout rather than
failing the build, because a build from an exported tree should still compile.

### The rerun trap

`build.rs` declares `rerun-if-changed` for the manifest, and **a single
`rerun-if-changed` anywhere in a build script replaces cargo's default** — "rerun
when any file in the package changes" — with the explicit list. So the baked
identity is frozen at the first build unless something declares otherwise, and a
stale id is worse than none: the badge is believed.

`declare_rerun_paths()` therefore watches `src`, `Cargo.toml`, `../.git/HEAD` and
the current branch's ref file. The git paths are the non-obvious half: a commit
does not have to change a file to move HEAD, and `.git/HEAD` alone only catches a
branch switch, not a commit on the current branch.

Verified by negative control — with those four lines removed, editing a `.rs`
file does not rerun the script and the id stays frozen.

The webview's `console.log` is captured into the same file, which is why
frontend code logs through IPC rather than only to devtools: a user who cannot
open devtools still needs their half of the story.

## Frontend

`src/main-app/` is the dashboard. State lives in one Zustand store
(`store.ts`); components read narrow selectors and call typed wrappers in
`ipc.ts`. Nothing reaches for `invoke` directly.

`components/ui.tsx` is the design system, and it exists for a reason: the same
button, card, collapsible section and empty state were hand-rolled in four places
and drifted to different radii, different icon sizes and different spacing. When
something does not fit, the answer is to add a primitive there.

Pure logic lives outside components in named modules beside them, with tests
beside those. The list is long and deliberate; see `AGENTS.md` for why.

### Gallery selection

Selection is modelled as a set, in `gallery/selection.ts`. Plain click replaces,
Ctrl toggles, Shift spans, Ctrl+Shift spans and adds, and a stale anchor falls
back to selecting the clicked tile and adopting it as the new anchor. Ordering
is by `addedMs` then id, so selection order is deterministic. 41 tests, because
every one of those interactions has a boundary case and none of them are visible
to a typechecker.

## Colour

There is one HSV conversion, in `components/rgbStrip.ts`, and it is a deliberate
port of the Rust `palette` module — same construction, byte for byte. The preview
used to carry its own copy inline with nothing checking it against the engine,
and it had drifted on three separate points. Keeping them identical is what makes
the preview trustworthy.

`components/ledPaint.ts` is the same idea for appearance: one policy for how an
LED looks — emitter overdrive, glow alpha scaled by luma, unlit colour, corner
radius — shared by the mode tiles, the per-device strips and the keyboard
preview, which had each answered those four questions differently.

`components/colorHex.ts` owns parsing. Three-digit shorthand is accepted because
that is how colours are written by hand, and alpha forms are accepted with the
alpha discarded rather than refused.