# LumenDeck

**Wallpaper-driven RGB lighting, live wallpapers, and screen stickers — for Windows.**

LumenDeck turns your desktop into a cohesive, living surface: your wallpaper becomes the
light source for your whole RGB setup, a canvas you can decorate, and a stage for
animated scenes — all running natively behind your desktop icons.

A first-run wizard walks you through importing media, connecting OpenRGB, picking a
mood, and tuning the app, so it's usable within a minute of installing.

## Features

### Wallpaper-driven RGB

- Connects to **OpenRGB** (SDK server on `localhost:6742`) and streams colors to all
  detected devices (keyboards, mice, RGB strips, motherboards…)
- Modes: **Ambient** (whole-wallpaper dominant color), **Zone sync** (draw rectangles
  on the wallpaper, map each to devices), **Pulse** (brightness-follow), **Static**
- Color mixer: brightness, saturation, gamma, transition smoothing, min-update interval
- Per-device exclude list; live device list with LED counts; multi-monitor aware —
  zone sampling and ambient follow the primary display
- With a video wallpaper, lighting flows with the footage (10 fps sampling)
- **Night dimming**: schedule (`night_start` / `night_end` / brightness cap) that clamps
  LED brightness during evening hours
- **Accent sync**: pipe the wallpaper's dominant color into the app's UI accent

### Live wallpapers

- Sources: **video** (looped, hardware-decoded), **image**, **slideshow** (folder,
  interval + crossfade), **web page** (sandboxed), **shader** (4 built-in GLSL presets:
  Aurora, Liquid, Plasma, Starfield)
- Attaches **behind your desktop icons** via the Win32 WorkerW technique
- **Per-monitor wallpapers**: override the global wallpaper on any display, with
  smooth crossfade transitions between sources
- The static desktop background and (optionally) the **Windows lock screen** follow
  the wallpaper — captured from a real decoded frame, not a stale thumbnail
- Auto-pauses on battery saver or when a fullscreen app is in the foreground; keeps
  the last frame visible while paused instead of going black
- Self-heals: re-attaches and re-positions after display topology or DPI changes,
  and rebuilds the decode pipeline after transient video errors
- Playback tuning: speed, brightness, saturation, hue, per-source object-fit
  (auto / cover / contain / fill), muted volume
- The blit loop caps itself to the video's native frame rate — a 24 fps source does
  ~half the canvas work of a naive 60 fps loop, with no visible difference

### Stickers anywhere

- Pin **images, GIFs, or short videos** anywhere on screen
- Click-to-place overlay with aspect-aware sizing; dedicated transparent window per
  sticker; stickers **mirror across all monitors** by default (configurable)
- **Edit mode**: drag to move, corner-handle to resize, right-click or **ESC** to exit;
  clicks pass through to the desktop everywhere except over LumenDeck windows
- Per-sticker: click-through, z-order above/below taskbar, opacity, fit, mute,
  visibility; duplicate and reorder from the tray or the manager UI

### App

- Console-style UI (graphite/ivory, hairline frames) with light/dark theming,
  **AMOLED mode** (true-black dark theme), and system-accent-derived highlight color
- Tray menu: open, toggle wallpaper pause, switch lighting mode, edit stickers, quit
- 12-column overview dashboard; scenes let you apply a saved wallpaper + lighting
  - sticker profile in one click
- Launch-on-startup, single-instance, factory reset from the UI
- Quiet logging by default — routine diagnostics are debug-level; run with
  `RUST_LOG=lumendeck=debug` to see them

## Tech stack

| Layer     | Tech                                                                                 |
| --------- | ------------------------------------------------------------------------------------ |
| Shell     | [Tauri 2](https://tauri.app) (Rust) + WebView2                                       |
| UI        | React 19, TypeScript (strict), Tailwind CSS 4, Zustand                               |
| Win32     | `windows` crate — WorkerW attach, click-through, monitor enum, low-level input hooks |
| RGB       | [`openrgb`](https://crates.io/crates/openrgb) (native SDK client)                    |
| Media     | Custom `media://` protocol (path-safe, extension-allowlisted)                        |
| Packaging | NSIS installer via Tauri bundler (GitHub Actions on `v*` tags)                       |

## Architecture notes

- **Windows** — `wallpaper-*` windows sit behind desktop icons (WorkerW), one per
  monitor; stickers get their own top-level transparent windows; a placement overlay
  handles click-to-place under a low-level mouse/keyboard hook.
- **Frame pipeline** — a hidden `<video>` decodes; a canvas blit presents frames into
  the normal DOM tree (so stickers and UI always composite above), samples color zones
  for the RGB engine every 100 ms, and pushes a JPEG snapshot to the backend once per
  source change to use as the OS background / lock screen / decode-failure fallback.
- **State** — one `config.json` drives everything; each webview polls `get_wallpaper_info`
  (2 s self-heal) and the backend watches the config file for external edits.
- **Config safety** — atomic writes, schema-versioned, hot-reloaded.

## Development

```bash
pnpm install
pnpm app:dev      # run the desktop app (vite on :1420 + cargo run)
pnpm test         # vitest (frontend)
cargo test        # from src-tauri/ — Rust unit tests
pnpm app:build    # NSIS installer in src-tauri/target/release/bundle/
```

Prerequisites: Node 20+, pnpm 10, Rust (MSVC toolchain), WebView2 (preinstalled on
Windows 11), and [OpenRGB](https://openrgb.org) with its SDK server enabled for RGB sync.

CI runs `tsc`, `vitest`, and `cargo test` on every push/PR; tagging `vX.Y.Z` builds the
NSIS installer and attaches it to a GitHub release.

### Signed in-app updates

The first updater-enabled release must be installed manually by users of older builds.
Future releases are checked at startup and can be installed from Settings.

Generate the updater signing key locally and keep the private key out of the repository:

```powershell
pnpm tauri signer generate -w "$env:USERPROFILE\.tauri\lumendeck.key"
```

Set the generated public key as `plugins.updater.pubkey` in
`src-tauri/tauri.conf.json`. Add the private key file contents to the GitHub Actions
secret `TAURI_SIGNING_PRIVATE_KEY`; if the key has a password, add it as
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Releases tagged `vX.Y.Z` then publish the signed
NSIS installer, its signature, and `latest.json`. Never commit or share the private key.

The updater signature verifies update packages; it is separate from Windows
Authenticode signing and does not by itself remove SmartScreen publisher warnings.

## Configuration

Settings persist to `%APPDATA%/LumenDeck/config.json` (atomic writes, schema-versioned,
camelCase — mirrored by `src/shared/types.ts`). Notable groups:

| Group       | What it controls                                                      |
| ----------- | --------------------------------------------------------------------- |
| `general`   | theme, AMOLED, autostart, pause toggles, accent sync, onboarding flag |
| `wallpaper` | kind, source, fit, speed/brightness/saturation/hue, volume, slideshow |
| `sticker`   | placement defaults, all-monitors mirroring                            |
| `rgb`       | mode, zones, mixer, per-device excludes, night dimming schedule       |
| `scenes`    | named wallpaper + lighting + sticker profiles                         |

## Notes & limits

- WorkerW attach works on stock Windows 10/11 shells; heavily modified shells may fall
  back to a bottom-anchored window (the app flags this in the UI).
- Sticker/video codec support follows WebView2 (H.264 and VP9 work out of the box; HEVC
  depends on installed codec packs). A software-decode fallback exists for GPUs that
  choke on 4K H.264 in WebView2's hardware pipeline.
- `media://` only serves files with media extensions from directories you've picked in
  the app — no arbitrary filesystem reads.
- The static background is throttled to one push per wallpaper source change (plus a
  30-minute refresh); repeated pushes per frame would flicker the desktop and spam the
  log. If you see `desktop wallpaper set` more than that, it's a bug.
