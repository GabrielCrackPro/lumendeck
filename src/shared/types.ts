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
  /** Whether importing a wallpaper also puts it on the displays. */
  applyAfterImport?: boolean;
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
  /**
   * User-chosen names keyed by device id. JSON object keys are strings, so the
   * id arrives as text; absent or blank means "use the driver's name".
   */
  deviceNames: Record<string, string>;
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
  /** Flash on SMTC track change: duration in ms, 0 = disabled. */
  trackFlashMs: number;
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
  /** UI language: "auto" follows the Windows display language, anything else
   *  is a locale tag ("en", "es"). An unknown tag falls back to English
   *  rather than back to "auto", so a choice is never silently overridden. */
  language: string;
  /**
   * User-chosen display names, keyed by the Windows device name
   * ("\\.\DISPLAY1"). Absent or blank means "fall back to the device name".
   */
  screenNames: Record<string, string>;
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
  /**
   * How strongly the dashboard accent is shade-adjusted for legibility on
   * the theme surface (0 = raw source colors, 1 = full contrast lift).
   */
  accentAutoShade: number;
  /** True-black surfaces in dark theme (saves power on OLED panels). */
  amoled: boolean;
  /** The minimize button hides the dashboard to the tray instead of the taskbar. */
  minimizeToTray: boolean;
  /** A launch-at-login start shows the dashboard instead of starting in the tray. */
  showDashboardOnLogin: boolean;
  /** Internal: the one-time tray balloon for a quiet login start was shown. */
  startupHintShown: boolean;
  /** Internal: last version whose release notes were read in the dashboard. */
  changelogSeenVersion: string;
  /**
   * Master switch for system-wide keys. When false, every binding is released
   * from the OS and nothing is grabbed. Bindings are kept, so turning it back
   * on restores them. Mirrors `hotkeys_enabled` in src-tauri/src/config.rs.
   */
  hotkeysEnabled: boolean;
  /** System-wide key bindings; see HOTKEY_ACTIONS for the available actions. */
  hotkeys: HotkeyConfig;
  /**
   * Blink the keyboard backlight when a binding fires: duration in ms,
   * 0 = disabled. Ignored while `hotkeysEnabled` is false.
   */
  hotkeyBlinkMs: number;
  /** Colour of that blink. */
  hotkeyBlinkColor: [number, number, number];
}

/**
 * One configurable system-wide shortcut. `accelerator` uses the
 * Tauri/`global-hotkey` grammar ("Ctrl+Alt+M"); an empty string means unbound.
 * Nothing is bound by default — the user opts in per action.
 */
export interface HotkeyBinding {
  accelerator: string;
}

/** Mirrors `HotkeyConfig` in src-tauri/src/config.rs. */
export interface HotkeyConfig {
  toggleDashboard: HotkeyBinding;
  playPause: HotkeyBinding;
  nextTrack: HotkeyBinding;
  prevTrack: HotkeyBinding;
  toggleMute: HotkeyBinding;
  volumeUp: HotkeyBinding;
  volumeDown: HotkeyBinding;
  toggleWallpaper: HotkeyBinding;
  cycleLightingMode: HotkeyBinding;
  nextProfile: HotkeyBinding;
  nextScene: HotkeyBinding;
  nextWallpaper: HotkeyBinding;
}

/** Payload of the HOTKEY_ERROR event. */
export interface HotkeyError {
  /** Config action id (e.g. "toggleMute"), or empty for a press-time failure. */
  action: string;
  /** The accelerator that was refused, as typed by the user. */
  accelerator: string;
  /** Human-readable reason. */
  message: string;
}

/**
 * Playback overrides for one vault entry.
 *
 * Every field is optional and `undefined` means "inherit the global setting".
 * That distinction matters: inheriting is what lets the global setting keep
 * applying to the rest of the vault when you change it, and an entry that has
 * never been touched carries none of this at all.
 */
export interface EntryOptions {
  /** "cover" | "contain" | "fill" | "auto". */
  fit?: string;
  /** Playback rate; the runtime clamps to 0.1..8. */
  speed?: number;
  /** Audio volume for this entry only. */
  volume?: number;
  brightness?: number;
  saturation?: number;
  hue?: number;
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
  /** Per-entry playback overrides, absent when the entry inherits everything. */
  opts?: EntryOptions | null;
  /** Starred by hand. Not a collection: a collection is a named membership list
   *  you set up deliberately, this is the one-click "I like this one". */
  favorite?: boolean;
  /** When this entry was last put on a display, for the "recently used" sort. */
  lastAppliedMs?: number | null;
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
  /**
   * Decaying transient envelope, 0..1. The backend detects onsets from the
   * rise in audio energy (with a refractory window so one drum hit is one
   * pulse) and decays this on wall-clock time, so it is safe to read without
   * consuming it. Drives the equalizer and the player's beat flash.
   */
  pulse: number;
  /** WASAPI device name currently being captured (e.g. "Speakers (Realtek Audio)"). */
  deviceName: string;
}

/** What the OS media session (SMTC) says is playing, right now. */
export interface MediaInfo {
  title: string;
  artist: string;
  album: string;
  /** Source app display name, e.g. "Spotify" — no .exe, no package suffix. */
  appId: string;
  playing: boolean;
  /** Album art as a data URI. Empty = render a placeholder. */
  art: string;
  /** Source app icon as a PNG data URI. Empty = generic glyph. */
  appIcon: string;
  /** Playback position when the backend sampled it, in seconds. */
  positionSec: number;
  /** Track duration in seconds (0 when the app doesn't report a timeline). */
  durationSec: number;
  /** Unix ms when `positionSec` was sampled, so the UI can extrapolate. */
  positionUpdatedMs: number;
  /** Shuffle state. null = the sender doesn't expose it (control disabled). */
  shuffle: boolean | null;
  /** Repeat mode: 0 off, 1 track, 2 list/queue. null = not exposed. */
  repeat: 0 | 1 | 2 | null;
}
