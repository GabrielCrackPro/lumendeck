<div align="center">

# LumenDeck

**Your wallpaper is the light source.**

Live wallpapers, RGB lighting driven by what is actually on screen, and stickers
anywhere on your desktop — running natively behind your icons, on Windows.

[![CI](https://github.com/GabrielCrackPro/lumendeck/actions/workflows/ci.yml/badge.svg)](https://github.com/GabrielCrackPro/lumendeck/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/GabrielCrackPro/lumendeck?label=release)](https://github.com/GabrielCrackPro/lumendeck/releases/latest)
[![platform](https://img.shields.io/badge/platform-Windows%2011-0078D4)](https://learn.microsoft.com/windows)

[Tauri 2](https://tauri.app) · [React 19](https://react.dev) · [Rust](https://www.rust-lang.org) · WebView2

</div>

---

## What it does

Pick a video wallpaper. LumenDeck samples the colours off the screen ten times a
second and pushes them to your keyboard, mouse, strips and motherboard through
[OpenRGB](https://openrgb.org). Change the wallpaper and the lighting changes
with it. That is the whole idea; everything below is detail.

- **Reactive modes** — Ambient (whole-wallpaper dominant colour), Zone Sync (draw
  rectangles over the wallpaper, map each to a device), Pulse, Static
- **Animation modes** — Cycle, Wave, Breathe, and Audio Reactive, which samples
  what you are actually playing rather than guessing from the artwork
- **The wallpaper itself** — video, image, slideshow, sandboxed web page, or a
  built-in shader, attached *behind* your desktop icons via the WorkerW technique
- **Per-monitor** — override the wallpaper on any display, crossfading between
  sources
- **The OS follows too** — the static desktop background and, optionally, your
  lock screen, captured from a real decoded frame rather than a thumbnail
- **Stickers anywhere** — images, GIFs and short video, click to place, mirrored
  across all monitors, click-through where you want it
- **Scenes** — capture wallpaper plus lighting plus stickers as one look, recall
  it in a click

A first-run wizard covers importing media, connecting OpenRGB and picking a
mood, so it is useful about a minute after installing.

---

## Quick start

```
1.  Install OpenRGB, enable its SDK server (default localhost:6742)
2.  Install LumenDeck and pick a wallpaper
3.  Lighting follows
```

Prebuilt signed installers are on the
[releases page](https://github.com/GabrielCrackPro/lumendeck/releases/latest).
The first updater-enabled release has to be installed by hand; after that,
updates are offered from inside the app.

### Keyboard

`Ctrl`+`K` opens the command palette. Global hotkeys for pause, next scene,
lighting mode and more are configurable, with a recorder that validates the
combination before it is saved.

---

## How it works

```
  <video> decode ──> <canvas> blit ──> visible wallpaper webview
                        │
                        ├── sample the zones you drew, every 100 ms
                        │      └──> RGB engine ──> OpenRGB ──> your devices
                        │
                        └── JPEG snapshot on source change
                               └──> OS background · lock screen · fallback
```

The wallpaper window is reparented into Explorer's `WorkerW` layer, which is
what puts it behind the icons instead of behind the whole desktop. A hidden
`<video>` decodes; a canvas blits, which is what lets stickers and the UI always
composite above and gives one place to sample colour from.

The blit loop caps itself to the source's frame rate — a 24 fps wallpaper does
roughly half the canvas work of a naive 60 fps loop, with no visible difference.

Full details, including the threading model and the config schema, are in
[`docs/architecture.md`](docs/architecture.md).

---

## Stack

| Layer         | Choice                                                       |
| ------------- | ------------------------------------------------------------ |
| Shell         | Tauri 2 (Rust) + WebView2                                    |
| UI            | React 19, TypeScript strict, Tailwind CSS 4, Zustand        |
| Win32         | `windows` crate — WorkerW, click-through, monitors, input hooks |
| RGB           | [`openrgb`](https://crates.io/crates/openrgb) SDK client     |
| Media         | custom `media://` protocol, path-safe and extension-allowlisted |
| Logging       | `tauri-plugin-log`, fixed 5 MB file, `RUST_LOG` override    |
| Quality       | vitest, `cargo test`, `i18n-check`, `check-versions`, CI    |
| Packaging     | NSIS installer, published by GitHub Actions on `main`         |

---

## Development

```bash
pnpm install
pnpm app:dev                      # the real app
node scripts/verify.mjs           # everything CI runs, in CI's order
node scripts/verify.mjs --no-build # skip the production bundle
```

Individual checks:

```bash
npx tsc --noEmit                   # types
npx vitest run                     # frontend logic
cd src-tauri && cargo test         # Rust
node scripts/i18n-check.mjs        # locale catalogs
node scripts/check-versions.mjs    # version files agree
```

Needs Node 22 (what CI runs), pnpm 10, the Rust MSVC toolchain, and WebView2
(preinstalled on Windows 11). RGB needs OpenRGB with its SDK server.

CI runs every check above on each push and pull request, and publishes a signed
NSIS installer after a successful push to `main`.

### Working on this with Codebuff

[`AGENTS.md`](AGENTS.md) is the agent entry point: conventions, the verification
commands, and the traps that are expensive to rediscover — why `cargo fmt` must
never be run here, why vitest cannot test components, which `Default` impl you
are really changing, and why the log must not contain polls. It also works for
any other tool that reads `AGENTS.md`.

[`docs/architecture.md`](docs/architecture.md) explains how the pieces fit, and
[`docs/development.md`](docs/development.md) has step-by-step recipes for the
changes that come up repeatedly.

---

## Configuration

Settings live in `%APPDATA%/LumenDeck/config.json` — atomic writes,
schema-versioned, camelCase, hot-reloaded when you edit it by hand.

| Group       | Controls                                                     |
| ----------- | ------------------------------------------------------------ |
| `general`   | theme, AMOLED, autostart, pause rules, accent sync, language |
| `wallpaper` | kind, source, fit, playback tuning, volume, slideshow        |
| `sticker`   | placement defaults, all-monitor mirroring                    |
| `rgb`       | mode, zones, mixer, per-device excludes, night dimming       |
| `scenes`    | named wallpaper plus lighting plus sticker profiles          |

---

## Notes and limits

- WorkerW attach works on stock Windows 10 and 11 shells. Heavily modified shells
  may fall back to a bottom-anchored window; the app tells you when it does.
- Codec support follows WebView2. H.264 and VP9 work out of the box; HEVC depends
  on installed codec packs. There is a software-decode fallback for GPUs that
  struggle with 4K H.264 in the hardware pipeline.
- `media://` serves media files only, from folders you chose in the app. It is not
  a general filesystem reader.
- WinRT toast notifications are implemented but not yet verified end to end.
- The dashboard needs the Tauri shell to run. It will not start in a plain
  browser, because the window APIs have no IPC host to talk to — use
  `pnpm app:dev`.

## License

None has been chosen yet — there is no `LICENSE` file and no `license` field in
`package.json` or `Cargo.toml`. Until one is added, the repository is unlicensed
and nobody has been granted rights to redistribute it.