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
  EDITOR_MOUSE: "sticker-editor-mouse",
  EDITOR_STATE: "sticker-editor",
  RGB_STATUS: "rgb-status",
  RGB_FRAME: "rgb-frame",
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

export const SHADERS = [
  { id: "aurora", label: "Aurora" },
  { id: "liquid", label: "Liquid" },
  { id: "plasma", label: "Plasma" },
  { id: "starfield", label: "Starfield" },
] as const;

export type RgbModeGroup = "reactive" | "animation";

export const RGB_MODES: {
  id: "ambient" | "zone" | "pulse" | "static" | "cycle" | "wave" | "breathe";
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
] as const;

export const ANIMATION_MODES = new Set(["cycle", "wave", "breathe"] as const);
