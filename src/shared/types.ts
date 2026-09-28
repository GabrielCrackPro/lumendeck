// Shared type contract between the Rust backend and all frontends.
// Mirrors src-tauri/src/config.rs (serde camelCase).

export type ThemeMode = "system" | "light" | "dark";

export type WallpaperKind = "video" | "image" | "slideshow" | "web" | "shader";

export type ShaderId = "aurora" | "liquid" | "plasma" | "starfield";

export interface SlideshowConfig {
  /** Absolute folder path containing images. */
  folder: string;
  /** Seconds each image stays on screen. */
  intervalSec: number;
  /** Crossfade seconds between images. */
  crossfadeSec: number;
}

export interface WallpaperConfig {
  kind: WallpaperKind;
  /** media:// URL or absolute path for video/image, URL for web, preset id for shader. */
  source: string;
  volume: number;
  slideshow: SlideshowConfig;
  /** How video fills each monitor: cover | contain | fill | auto. */
  videoFit: "cover" | "contain" | "fill" | "auto";
  /** Video playback rate (1 = normal). */
  videoSpeed: number;
  /** Video grading: brightness multiplier. */
  videoBrightness: number;
  /** Video grading: saturation multiplier (0 = gray). */
  videoSaturation: number;
  /** Video grading: hue rotation in degrees. */
  videoHue: number;
  /** Per-display wallpaper overrides keyed by monitor device string. */
  perMonitor: Record<string, PerMonitorWallpaper>;
}

/** Per-display wallpaper override (kind+source only; playback opts are global). */
export interface PerMonitorWallpaper {
  kind: WallpaperKind;
  source: string;
}

export type RgbMode = "ambient" | "zone" | "pulse" | "static" | "cycle" | "wave" | "breathe" | "audioReactive";

export interface RgbMixer {
  brightness: number;
  saturation: number;
  gamma: number;
  /** 0 = snap, 1 = very slow easing. */
  smoothing: number;
}

export interface ZoneDef {
  id: string;
  name: string;
  /** Normalized rect within the wallpaper (0..1). */
  x: number;
  y: number;
  w: number;
  h: number;
  deviceIds: number[];
}

export interface RgbConfig {
  enabled: boolean;
  host: string;
  port: number;
  mode: RgbMode;
  staticColor: [number, number, number];
  zones: ZoneDef[];
  mixer: RgbMixer;
  minUpdateMs: number;
  excludedDevices: number[];
  /** Animation playback speed multiplier (0.1..5, 1 = normal). */
  animationSpeed: number;
  /** Seconds of inactivity before lights turn off (0 = disabled, min 30). */
  idleTimeoutSec: number;
  /** How often (seconds) to check for idle state (1..60). */
  idleCheckIntervalSec: number;
  /** Device driving the dashboard accent color (null = auto, -1 = static color). */
  accentDevice: number | null;
  /** Audio-reactive sensitivity (0.1..3, 1 = normal). */
  audioSensitivity: number;
  /** Audio-reactive smoothing (0 = snap, 1 = very slow). */
  audioSmoothing: number;
  /** Audio capture source: "system" or "microphone". */
  audioSource: "system" | "microphone";
  /** Wave travel direction: 1 = forward, -1 = reverse. */
  waveDirection: 1 | -1;
  /** Cycle rainbow spread across the strip in degrees (30..720). */
  cycleSpread: number;
  /** Named lighting profiles for quick switching (tray + dashboard). */
  profiles: RgbProfile[];
  /** Night dimming window (local "hh:mm", wraps midnight; empty = off). */
  nightStart: string;
  nightEnd: string;
  /** Brightness cap during the night window (0..1). */
  nightBrightness: number;
}

export interface RgbProfile {
  name: string;
  mode: RgbMode;
  staticColor: [number, number, number];
  animationSpeed: number;
}

export type StickerFit = "contain" | "cover" | "fill";

export interface StickerDef {
  id: string;
  name: string;
  /** media:// URL. */
  url: string;
  /** Virtual-screen coordinates (px). */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  fit: StickerFit;
  muted: boolean;
  visible: boolean;
  /** Render in a topmost OS window above all applications. */
  onTop: boolean;
}

export interface StickerSettings {
  removeBackground: boolean;
  /** Mirror wallpaper-layer stickers onto all monitors. */
  allMonitors: boolean;
}

export interface GeneralConfig {
  autostart: boolean;
  theme: ThemeMode;
  pauseOnBatterySaver: boolean;
  pauseOnFullscreen: boolean;
  wallpaperEnabled: boolean;
  /** UI accent follows live device colors (true) or frozen to the static color (false). */
  accentLive: boolean;
  /** Decode wallpaper video in software (low-end fallback). Read at startup. */
  softwareVideoDecode: boolean;
  /** Sync the Windows accent color to the wallpaper's dominant color. */
  accentSyncEnabled: boolean;
  /** Internal: original accent backed up on first sync (for restore). */
  accentSyncArmed: boolean;
  /** Apply wallpaper changes to the Windows lock screen too. */
  lockScreenFollowsWallpaper: boolean;
  /** First-run onboarding wizard has been completed. */
  onboarded: boolean;
  /** True-black surfaces in dark theme (saves power on OLED panels). */
  amoled: boolean;
  /** The minimize button hides the dashboard to the tray instead of the taskbar. */
  minimizeToTray: boolean;
}

export interface GalleryEntry {
  id: string;
  name: string;
  kind: WallpaperKind;
  /** Absolute path (video/image), URL (web), or preset id (shader). */
  source: string;
  addedMs: number;
  /** media:// URL of the generated thumbnail (videos/images), when ready. */
  thumb?: string | null;
}

/** A named group of vault entries (membership only, no copies). */
export interface WallpaperCollection {
  id: string;
  name: string;
  /** Gallery entry ids, in display order. */
  entryIds: string[];
}

/** Rotation source over a collection or the whole vault. */
export interface WallpaperPlaylist {
  id: string;
  name: string;
  /** `collection:<id>` or `all`. */
  source: string;
  /** Time-of-day rules; the last rule with start <= now wins. */
  rules: PlaylistRule[];
  /** Shuffle to a different entry every N minutes (0 = off → hourly). */
  shuffleMin: number;
  /** Crossfade seconds between playlist transitions (0 = instant cut). */
  crossfadeSec: number;
  enabled: boolean;
}

export interface SceneProfile {
  id: string;
  name: string;
  wallpaper: WallpaperConfig;
  rgb: RgbConfig;
  createdMs: number;
}

export interface PlaylistRule {
  /** Start time "hh:mm" local. */
  start: string;
  /** `collection:<id>` or `all`. */
  source: string;
}

/** Snap behavior for the on-wallpaper sticker editor. */
export interface StickerSnap {
  /** Quantize positions to a grid. */
  grid: boolean;
  /** Align to other stickers and monitor edges/centers. */
  guides: boolean;
  /** Grid cell size in physical px. */
  gridSize: number;
}

/** Sticker behavior settings. */
export interface StickerSettings {
  /** Remove flat background at placement time (transparent PNG/APNG). */
  removeBackground: boolean;
}

export interface LumenConfig {
  version: number;
  general: GeneralConfig;
  wallpaper: WallpaperConfig;
  rgb: RgbConfig;
  stickers: StickerDef[];
  gallery: GalleryEntry[];
  collections: WallpaperCollection[];
  playlists: WallpaperPlaylist[];
  scenes: SceneProfile[];
  stickerSnap: StickerSnap;
  sticker: StickerSettings;
}

/** Alias matching the Rust `Config` struct. */
export type Config = LumenConfig;

export interface StickerLibraryEntry {
  id: string;
  name: string;
  url: string;
  kind: "image" | "video";
}

export interface RgbDeviceInfo {
  id: number;
  name: string;
  typeName: string;
  leds: number;
  zones: string[];
}

export interface RgbStatus {
  connected: boolean;
  protocolVersion: number | null;
  devices: RgbDeviceInfo[];
  lastError: string | null;
}

/** One sample of a zone or the full-screen dominant color, sent at sample rate. */
export interface ZoneSample {
  id: string;
  rgb: [number, number, number];
  /** Relative brightness 0..1, used by pulse mode. */
  luma: number;
}

/** One device's pushed color in an rgb-frame event. */
export interface DeviceColor {
  id: number;
  rgb: [number, number, number];
  /** Per-LED colors for animation modes (evenly sampled, capped). */
  ledColors: [number, number, number][];
}

/** Audio level data emitted from the RGB engine. */
export interface AudioLevel {
  volume: number;
  beat: boolean;
  /** WASAPI device name currently being captured (e.g. "Speakers (Realtek Audio)"). */
  deviceName: string;
}
