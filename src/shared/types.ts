
export type ThemeMode = "system" | "light" | "dark";

export type WallpaperKind = "video" | "image" | "slideshow" | "web" | "shader";

export type ShaderId = "aurora" | "liquid" | "plasma" | "starfield";

export interface SlideshowConfig {
  folder: string;
  intervalSec: number;
  crossfadeSec: number;
}

export interface WallpaperConfig {
  kind: WallpaperKind;
  source: string;
  volume: number;
  slideshow: SlideshowConfig;
  videoFit: "cover" | "contain" | "fill" | "auto";
  videoSpeed: number;
  videoBrightness: number;
  videoSaturation: number;
  videoHue: number;
  perMonitor: Record<string, PerMonitorWallpaper>;
  applyAfterImport?: boolean;
  indexAfterImport?: boolean;
}

export interface PerMonitorWallpaper {
  kind: WallpaperKind;
  source: string;
}

export type RgbMode = "ambient" | "zone" | "pulse" | "static" | "cycle" | "wave" | "breathe" | "audioReactive";

export interface RgbMixer {
  brightness: number;
  saturation: number;
  gamma: number;
  smoothing: number;
}

export interface ZoneDef {
  id: string;
  name: string;
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
  deviceNames: Record<string, string>;
  animationSpeed: number;
  idleTimeoutSec: number;
  idleCheckIntervalSec: number;
  accentDevice: number | null;
  audioSensitivity: number;
  audioSmoothing: number;
  audioSource: "system" | "microphone";
  waveDirection: 1 | -1;
  cycleSpread: number;
  nightStart: string;
  nightEnd: string;
  nightBrightness: number;
  trackFlashMs: number;
}

export type StickerFit = "contain" | "cover" | "fill";

export interface StickerDef {
  id: string;
  name: string;
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  fit: StickerFit;
  muted: boolean;
  visible: boolean;
  onTop: boolean;
}

export interface StickerSettings {
  removeBackground: boolean;
  allMonitors: boolean;
}

export interface GeneralConfig {
  autostart: boolean;
  theme: ThemeMode;
  language: string;
  screenNames: Record<string, string>;
  pauseOnBatterySaver: boolean;
  pauseOnFullscreen: boolean;
  wallpaperEnabled: boolean;
  accentLive: boolean;
  softwareVideoDecode: boolean;
  accentSyncEnabled: boolean;
  accentSyncArmed: boolean;
  lockScreenFollowsWallpaper: boolean;
  lockScreenArmed: boolean;
  onboarded: boolean;
  activeProfileId: string | null;
  accentAutoShade: number;
  amoled: boolean;
  showColorHex: boolean;
  minimizeToTray: boolean;
  showDashboardOnLogin: boolean;
  startupHintShown: boolean;
  changelogSeenVersion: string;
  hotkeysEnabled: boolean;
  hotkeys: HotkeyConfig;
  hotkeyBlinkMs: number;
  hotkeyBlinkColor: [number, number, number];
  updateCheckMinutes: number;
}

export interface HotkeyBinding {
  accelerator: string;
}

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
  nextWallpaper: HotkeyBinding;
}

export interface HotkeyError {
  action: string;
  accelerator: string;
  message: string;
}

export interface EntryOptions {
  fit?: string;
  speed?: number;
  volume?: number;
  brightness?: number;
  saturation?: number;
  hue?: number;
}

export interface GalleryEntry {
  id: string;
  name: string;
  kind: WallpaperKind;
  source: string;
  addedMs: number;
  thumb?: string | null;
  opts?: EntryOptions | null;
  favorite?: boolean;
  lastAppliedMs?: number | null;
}

export interface WallpaperCollection {
  id: string;
  name: string;
  entryIds: string[];
}

export interface WallpaperPlaylist {
  id: string;
  name: string;
  source: string;
  rules: PlaylistRule[];
  shuffleMin: number;
  crossfadeSec: number;
  enabled: boolean;
}

export interface SceneProfile {
  id: string;
  name: string;
  wallpaper: WallpaperConfig;
  rgb: RgbConfig;
  stickers: StickerDef[];
  logo: string | null;
  createdMs: number;
}

export interface PlaylistRule {
  start: string;
  source: string;
}

export interface StickerSnap {
  grid: boolean;
  guides: boolean;
  gridSize: number;
}

export interface StickerSettings {
  removeBackground: boolean;
}

export interface LumenConfig {
  version: number;
  general: GeneralConfig;
  wallpaper: WallpaperConfig;
  rgb: RgbConfig;
  stickers: StickerDef[];
  gallery: GalleryEntry[];
  galleryShuffle: boolean;
  collections: WallpaperCollection[];
  playlists: WallpaperPlaylist[];
  scenes: SceneProfile[];
  stickerSnap: StickerSnap;
  sticker: StickerSettings;
}

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

export interface OpenrgbStatus {
  ready: boolean;
  version: string;
  sizeBytes: number;
  releasesPage: string;
  installedAt: string | null;
}

export type TransferKind = "profiles" | "config";

export interface TransferPreview {
  kind: TransferKind;
  fromVersion: string;
  profiles: string[];
  replacesEverything: boolean;
  bundledMedia: number;
  missingMedia: string[];
}

export interface RgbStatus {
  connected: boolean;
  protocolVersion: number | null;
  devices: RgbDeviceInfo[];
  lastError: string | null;
}

export interface ZoneSample {
  id: string;
  rgb: [number, number, number];
  luma: number;
}

export interface DeviceColor {
  id: number;
  rgb: [number, number, number];
  ledColors: [number, number, number][];
}

export interface AudioLevel {
  volume: number;
  pulse: number;
  deviceName: string;
}

export interface MediaInfo {
  title: string;
  artist: string;
  album: string;
  appId: string;
  playing: boolean;
  art: string;
  appIcon: string;
  positionSec: number;
  durationSec: number;
  positionUpdatedMs: number;
  shuffle: boolean | null;
  repeat: 0 | 1 | 2 | null;
}

export type DevInfo = {
  version: string;
  debug: boolean;
  buildId: string;
  buildDirty: boolean;
  logLevel: string;
  configPath: string;
  logPath: string;
  dataDir: string;
  lastPanic: string | null;
  reportHeader: string;
};

export interface PerfSnapshot {
  cpuPercent: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  ageMs: number | null;
}
