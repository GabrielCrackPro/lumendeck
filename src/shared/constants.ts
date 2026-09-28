// Shared constants for LumenDeck.

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
} as const;

export const STICKER_MIN_SIZE = 48;
export const STICKER_DEFAULT_W = 220;
export const STICKER_DEFAULT_H = 220;

/** Default OpenRGB SDK port. */
export const OPENRGB_PORT = 6742;

/** Default zone-sampling rate. */
export const SAMPLE_FPS = 10;

/** Default glow color (sky-blue) used as fallback across UI and backend. */
export const DEFAULT_GLOW: [number, number, number] = [56, 189, 248];

/** Dark background for mode art thumbnails. */
export const MODE_ART_BG = "#0a101d";

/** Dark text on glow-filled buttons/badges. */
export const GLOW_TEXT_DARK = "#06121f";

export const SHADERS = [
  { id: "aurora", label: "Aurora" },
  { id: "liquid", label: "Liquid" },
  { id: "plasma", label: "Plasma" },
  { id: "starfield", label: "Starfield" },
] as const;

export type RgbModeGroup = "reactive" | "animation";

export const RGB_MODES: {
  id: "ambient" | "zone" | "pulse" | "static" | "cycle" | "wave" | "breathe" | "audioReactive";
  label: string;
  hint: string;
  group: RgbModeGroup;
}[] = [
  { id: "ambient", label: "Ambient", hint: "Whole wallpaper dominant color", group: "reactive" },
  { id: "zone", label: "Zone sync", hint: "Map regions of the wallpaper to devices", group: "reactive" },
  { id: "pulse", label: "Pulse", hint: "Brightness-follow of the wallpaper", group: "reactive" },
  { id: "static", label: "Static", hint: "One fixed color", group: "reactive" },
  { id: "cycle", label: "Color cycle", hint: "Whole device sweeps through hues", group: "animation" },
  { id: "wave", label: "Wave", hint: "Rainbow gradient marching around the device", group: "animation" },
  { id: "breathe", label: "Breathe", hint: "Static color pulsing softly", group: "animation" },
  { id: "audioReactive", label: "Audio reactive", hint: "LEDs pulse to system audio beat", group: "animation" },
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
