# LumenDeck

**Wallpaper-driven RGB lighting, live wallpapers, and screen stickers — for Windows.**

LumenDeck turns your desktop into a cohesive, living surface: your wallpaper becomes the
light source for your whole RGB setup, a canvas you can decorate, and a stage for
animated scenes — all running natively behind your desktop icons.

## Features

### 🎨 Wallpaper-driven RGB
- Connects to **OpenRGB** (SDK server on `localhost:6742`) and streams colors to all
  detected devices (keyboards, mice, RGB strips, motherboards…)
- Modes: **Ambient** (whole-wallpaper dominant color), **Zone sync** (draw rectangles on
  the wallpaper, map each to devices), **Pulse** (brightness-follow), **Static**
- Color mixer: brightness, saturation, gamma, transition smoothing, min-update interval
- Per-device exclude list; live device list with LED counts
- With a video wallpaper, lighting flows with the footage (10 fps sampling)

### 🖼️ Live wallpapers
- Sources: **video** (looped, hardware-decoded), **image**, **slideshow** (folder,
  interval + crossfade), **web page** (sandboxed), **shader** (4 built-in GLSL presets:
  Aurora, Liquid, Plasma, Starfield)
- Attaches **behind your desktop icons** via the Win32 WorkerW technique
- Auto-pauses on battery saver or when a fullscreen app is in the foreground
- Re-attaches after display/DPI changes

### ✨ Stickers anywhere
- Pin **images, GIFs, or short videos** anywhere on screen
- Click-to-place overlay; dedicated transparent window per sticker
- **Edit mode**: drag to move, corner-handle to resize
- Per-sticker: click-through, z-order above/below taskbar, opacity, fit, mute, visibility

### ⚙️ App
- Light/dark theming, tray menu (open, edit stickers, quit)
- Launch-on-startup, single-instance, config at `%APPDATA%/LumenDeck/config.json`

## Tech stack

| Layer      | Tech                                                              |
|------------|-------------------------------------------------------------------|
| Shell      | [Tauri 2](https://tauri.app) (Rust) + WebView2                    |
| UI         | React 19, TypeScript (strict), Tailwind CSS 4, Zustand            |
| Win32      | `windows` crate — WorkerW attach, click-through, monitor enum     |
| RGB        | [`openrgb`](https://crates.io/crates/openrgb) (native SDK client) |
| Media      | Custom `media://` protocol (path-safe, extension-allowlisted)     |
| Packaging  | electron-builder-free NSIS via Tauri bundler                      |

## Development

```bash
pnpm install
pnpm icons        # regenerate app icons
pnpm app:dev      # run the desktop app (vite + cargo)
```

Prerequisites: Node 20+, pnpm, [Rust](https://rustup.rs) with the MSVC toolchain,
WebView2 (preinstalled on Windows 11), and [OpenRGB](https://openrgb.org) with its SDK
server enabled for RGB sync.

## Build

```bash
pnpm app:build    # NSIS installer in src-tauri/target/release/bundle/
```

## Tests

```bash
pnpm test         # vitest: sampler math + palette/config tests (Rust: cargo test)
cargo test        # from src-tauri/
```

## Configuration

Settings persist to `%APPDATA%/LumenDeck/config.json` (atomic writes, schema-versioned).
The JSON is camelCase and mirrored by `src/shared/types.ts`.

## Notes & limits

- WorkerW attach works on stock Windows 10/11 shells; heavily modified shells may fall
  back to a bottom-anchored window (the app flags this in the UI).
- Sticker video formats depend on WebView2's codecs (H.264/VP9 work out of the box).
- `media://` only serves files with media extensions from directories you've picked in
  the app.
