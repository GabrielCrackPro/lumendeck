import { parseHex } from "./components/colorHex";
import { themeToken } from "@shared/palette";
import { DEFAULT_GLOW } from "@shared/constants";

type RGB = [number, number, number];

export function relativeLuminance([r, g, b]: RGB): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function blend(a: RGB, b: RGB, t: number): RGB {
  if (t >= 1) return b;
  const [h, sa, la] = toHsl(a);
  const [, sb, lb] = toHsl(b);
  return fromHsl([h, sa + (sb - sa) * t, la + (lb - la) * t]);
}

type HSL = [number, number, number];

function toHsl([r0, g0, b0]: RGB): HSL {
  const r = r0 / 255;
  const g = g0 / 255;
  const b = b0 / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h =
    mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h < 0 ? h + 1 : h, s, l];
}

function fromHsl([h, s, l]: HSL): RGB {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    const x = ((t % 1) + 1) % 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return [clamp(ch(h + 1 / 3)), clamp(ch(h)), clamp(ch(h - 1 / 3))];
}

const RAMP_STEPS = 40;

const MIN_ACCENT_CONTRAST = 3.0;

function paletteRgb(theme: "dark" | "light", token: string): RGB {
  const hex = themeToken(theme, false, token);
  const rgb = parseHex(hex);
  if (!rgb) {
    throw new Error(`--${token} is not a hex colour: ${hex}`);
  }
  return rgb;
}

export function surfaceRgb(theme: "dark" | "light", amoled = false): RGB {
  const hex = themeToken(theme, amoled, "bg");
  const rgb = parseHex(hex);
  if (!rgb) {
    throw new Error(`the ${theme} background is not a hex colour: ${hex}`);
  }
  return rgb;
}

function liftToward(rgb: RGB, surface: RGB, lift: RGB): RGB {
  const [h, s, l0] = toHsl(rgb);
  const targetL = toHsl(lift)[2];
  for (let i = 1; i <= RAMP_STEPS; i++) {
    const step = fromHsl([h, s, l0 + (targetL - l0) * (i / RAMP_STEPS)]);
    if (contrastRatio(step, surface) >= MIN_ACCENT_CONTRAST) return step;
  }
  return fromHsl([h, s, targetL]);
}

export function readableOnTheme(
  rgb: RGB,
  theme: "dark" | "light",
  strength = 1,
  amoled = false,
): RGB {
  if (strength <= 0) return rgb;
  const surface = surfaceRgb(theme, amoled);
  if (contrastRatio(rgb, surface) >= MIN_ACCENT_CONTRAST) return rgb;
  const fixed = liftToward(rgb, surface, paletteRgb(theme, "accent-lift"));
  return blend(rgb, fixed, Math.min(1, strength));
}

export type AccentSource =
  | "wallpaper"
  | "windows"
  | "static"
  | "device"
  | "fallback";

export const ACCENT_SOURCE_LABELS: Record<AccentSource, string> = {
  wallpaper: "common.accent-follows-the-wallpaper",
  windows: "common.accent-follows-windows",
  static: "common.accent-is-frozen",
  device: "common.accent-follows-a-device",
  fallback: "common.accent-has-not-settled",
};

export interface AccentInput {
  deviceColors: Record<number, { rgb: RGB }>;
  mode: string | undefined;
  staticColor: RGB | undefined;
  excludedDevices: number[] | undefined;
  devices: { id: number; typeName: string }[];
  accentDevice: number | null;
  accentLive: boolean;
  wallpaperColor: RGB | null;
  sysAccent: RGB | null;
  theme: "dark" | "light";
  autoShade: number;
  amoled: boolean;
}

export function resolveAccent(input: AccentInput): {
  rgb: RGB;
  source: AccentSource;
} {
  const pick = (rgb: RGB, source: AccentSource) => ({
    rgb: readableOnTheme(
      rgb,
      input.theme,
      Math.max(0, Math.min(1, input.autoShade)),
      input.amoled,
    ),
    source,
  });
  const wpColor =
    input.wallpaperColor && input.wallpaperColor.some((v) => v > 24)
      ? input.wallpaperColor
      : null;
  const fallback =
    input.mode === "static" || input.mode === "breathe"
      ? input.staticColor
      : undefined;
  if (input.accentLive && wpColor) return pick(wpColor, "wallpaper");
  if (!input.accentLive) {
    return input.sysAccent
      ? pick(input.sysAccent, "windows")
      : pick(input.staticColor ?? fallback ?? DEFAULT_GLOW, "fallback");
  }
  if (input.accentDevice === -1) {
    return pick(
      input.staticColor ?? fallback ?? input.sysAccent ?? DEFAULT_GLOW,
      "static",
    );
  }
  if (input.accentDevice != null) {
    const picked = input.deviceColors[input.accentDevice]?.rgb;
    if (picked) return pick(picked, "device");
  }
  const excludedSet = new Set(input.excludedDevices ?? []);
  const activeIds = input.devices
    .filter((d) => !excludedSet.has(d.id))
    .sort((a, b) => {
      const kb = (x: { typeName: string }) => (/keyboard/i.test(x.typeName) ? 0 : 1);
      return kb(a) - kb(b);
    })
    .map((d) => d.id);
  const live =
    activeIds.map((id) => input.deviceColors[id]?.rgb).find((c) => c != null) ??
    Object.values(input.deviceColors).find((c) => c.rgb.some((v) => v > 0))?.rgb;
  if (live) return pick(live, "device");
  return pick(wpColor ?? fallback ?? input.sysAccent ?? DEFAULT_GLOW, "fallback");
}
