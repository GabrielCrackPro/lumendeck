// Shared constants for LumenDeck.

import type { HotkeyConfig } from "./types";

/** Prefix of the custom asset protocol for local media. */
export const MEDIA_SCHEME = "media";

/** Tauri event names. */
export const EVENTS = {
  CONFIG_CHANGED: "config-changed",
  CONFIG_RELOADED: "config-reloaded",
  ZONE_SAMPLE: "zone-sample",
  PLACING: "sticker-placing",
  PLACING_CURSOR: "sticker-placing-cursor",
  PLACING_SIZE: "sticker-placing-size",
  EDITOR_MOUSE: "sticker-editor-mouse",
  EDITOR_STATE: "sticker-editor",
  RGB_STATUS: "rgb-status",
  WALLPAPER_COLOR: "wallpaper-color",
  RGB_FRAME: "rgb-frame",
  AUDIO_LEVEL: "audio-level",
  MEDIA_SESSION: "media-session",
  WALLPAUSE: "wallpaper-pause",
  DISPLAY_CHANGED: "display-changed",
  SYSTEM_ACCENT: "system-accent-changed",
  VOLUME_CHANGED: "volume-changed",
  /** A global hotkey could not be bound, or a pressed one had nothing to do. */
  HOTKEY_ERROR: "hotkey-error",
  /**
   * After every registration pass: the full list of bindings the OS refused.
   * Unlike HOTKEY_ERROR this is not a one-off announcement — the settings row
   * keeps the warning up for as long as the combo is genuinely unbound.
   */
  HOTKEY_STATUS: "hotkey-status",
} as const;

// The sticker size and the default glow used to live here. Both are in
// tokens.json now, because the backend needs the same numbers: 220 was
// restated in four places in the placement overlay and again in Rust, and the
// exports below were imported by nothing at all. Re-exported so the callers
// that only need the glow keep importing from one module.
export { DEFAULT_GLOW } from "./tokens";

/** Default OpenRGB SDK port. */
export const OPENRGB_PORT = 6742;

/** Default zone-sampling rate. */
export const SAMPLE_FPS = 10;

/** Dark background for mode art thumbnails. */
export const MODE_ART_BG = "#0a101d";

/** Dark text on glow-filled buttons/badges. */
export const GLOW_TEXT_DARK = "#06121f";

export const SHADERS = [
  { id: "aurora", label: "shaders.aurora" },
  { id: "liquid", label: "shaders.liquid" },
  { id: "plasma", label: "shaders.plasma" },
  { id: "starfield", label: "shaders.starfield" },
] as const;

/** Key of `HotkeyConfig` that holds each action's binding. */
export type HotkeyActionId = keyof HotkeyConfig;

/**
 * Every bindable action, in the order the settings card lists them. The
 * `suggested` combos are the defaults shown before the user records anything —
 * they are never registered on their own, because taking an OS-wide key the
 * user did not ask for is how an ambient app becomes annoying.
 *
 * All suggestions sit in the Ctrl+Alt family: that corner is mostly free on
 * Windows, and keeping one family makes the whole list readable at a glance.
 */
export const HOTKEY_ACTIONS: {
  id: HotkeyActionId;
  label: string;
  description: string;
  suggested: string;
}[] = [
  {
    id: "toggleDashboard",
    label: "hotkeys.toggleDashboard",
    description: "hotkeys.toggleDashboard-description",
    suggested: "Ctrl+Alt+D",
  },
  {
    id: "playPause",
    label: "hotkeys.playPause",
    description: "hotkeys.playPause-description",
    suggested: "Ctrl+Alt+Space",
  },
  {
    id: "nextTrack",
    label: "hotkeys.nextTrack",
    description: "hotkeys.nextTrack-description",
    suggested: "Ctrl+Alt+Right",
  },
  {
    id: "prevTrack",
    label: "hotkeys.prevTrack",
    description: "hotkeys.prevTrack-description",
    suggested: "Ctrl+Alt+Left",
  },
  {
    id: "toggleMute",
    label: "hotkeys.toggleMute",
    description: "hotkeys.toggleMute-description",
    suggested: "Ctrl+Alt+M",
  },
  {
    id: "volumeUp",
    label: "hotkeys.volumeUp",
    description: "hotkeys.volumeUp-description",
    suggested: "Ctrl+Alt+Up",
  },
  {
    id: "volumeDown",
    label: "hotkeys.volumeDown",
    description: "hotkeys.volumeDown-description",
    suggested: "Ctrl+Alt+Down",
  },
  {
    id: "toggleWallpaper",
    label: "hotkeys.toggleWallpaper",
    description: "hotkeys.toggleWallpaper-description",
    suggested: "Ctrl+Alt+P",
  },
  {
    id: "cycleLightingMode",
    label: "hotkeys.cycleLightingMode",
    description: "hotkeys.cycleLightingMode-description",
    suggested: "Ctrl+Alt+L",
  },
  {
    id: "nextProfile",
    label: "hotkeys.nextProfile",
    description: "hotkeys.nextProfile-description",
    suggested: "Ctrl+Alt+R",
  },
  {
    id: "nextScene",
    label: "hotkeys.nextScene",
    description: "hotkeys.nextScene-description",
    suggested: "Ctrl+Alt+S",
  },
  {
    id: "nextWallpaper",
    label: "hotkeys.nextWallpaper",
    description: "hotkeys.nextWallpaper-description",
    suggested: "Ctrl+Alt+N",
  },
];

export type RgbModeGroup = "reactive" | "animation";

// Labels and hints are catalog KEYS, not copy. That is deliberate: the tray
// builds its lighting submenu from the same eight modes, and `tray::mode_key`
// in Rust returns these exact keys. One mode cannot be called "Ambient" in the
// window and something else in the tray, because there is only one string.
export const RGB_MODES: {
  id: "ambient" | "zone" | "pulse" | "static" | "cycle" | "wave" | "breathe" | "audioReactive";
  label: string;
  hint: string;
  group: RgbModeGroup;
}[] = [
  { id: "ambient", label: "lighting.ambient", hint: "lighting.hint-ambient", group: "reactive" },
  { id: "zone", label: "lighting.zone-sync", hint: "lighting.hint-zone", group: "reactive" },
  { id: "pulse", label: "lighting.pulse", hint: "lighting.hint-pulse", group: "reactive" },
  { id: "static", label: "lighting.static", hint: "lighting.hint-static", group: "reactive" },
  { id: "cycle", label: "lighting.color-cycle", hint: "lighting.hint-cycle", group: "animation" },
  { id: "wave", label: "lighting.wave", hint: "lighting.hint-wave", group: "animation" },
  { id: "breathe", label: "lighting.breathe", hint: "lighting.hint-breathe", group: "animation" },
  { id: "audioReactive", label: "lighting.audio-reactive", hint: "lighting.hint-audio", group: "animation" },
] as const;

export const ANIMATION_MODES = new Set(["cycle", "wave", "breathe", "audioReactive"] as const);

/** Conic/radial gradient art for each shader preset thumbnail. */
export const SHADER_ART: Record<string, string> = {
  aurora:
    "conic-gradient(from 210deg at 60% 20%, #06281b 0%, #0f7a4d 30%, #25c07a 50%, #0b1026 75%, #06281b 100%)",
  liquid:
    "conic-gradient(from 40deg at 40% 80%, #02021e 0%, #2743c9 40%, #9333ea 70%, #02021e 100%)",
  plasma:
    "conic-gradient(from 300deg at 50% 50%, #1a0033 0%, #c026d3 45%, #f97316 80%, #1a0033 100%)",
  starfield:
    "radial-gradient(60% 60% at 30% 25%, #334155 0%, #0f172a 45%, #000000 100%)",
};
