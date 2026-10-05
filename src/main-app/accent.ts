// Accent readability: the UI accent (--glow) can come from the OS, the
// wallpaper's dominant color, or a live device color — none of which are
// chosen for legibility on the dashboard's surfaces. These helpers score a
// color against the current theme's background and, when it would be hard to
// read, pick a nearby shade of the same hue that is.
import { parseHex } from "./components/colorHex";
import { themeToken } from "@shared/palette";
import { DEFAULT_GLOW } from "@shared/constants";

/** [r, g, b] tuple, 0..255. */
type RGB = [number, number, number];

/**
 * Relative luminance per WCAG 2.1 (0 = black, 1 = white). The sRGB gamma
 * expansion matters: plain luma misjudges dark reds and greens badly.
 */
export function relativeLuminance([r, g, b]: RGB): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** WCAG contrast ratio between two colors, 1..21. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Partial strength: interpolate lightness and saturation between the original
 * and the corrected colour, holding hue fixed.
 *
 * The gamma-space channel lerp this replaced was the root of the washout
 * described on `liftToward`, so doing it here too would reintroduce the bug at
 * half the distance — the user dials strength down to keep more of their
 * colour, and the dial would take it away instead. Its comment also described
 * itself as a "linear" mix while doing a gamma-space one, which is what let
 * the mistake survive this long.
 */
function blend(a: RGB, b: RGB, t: number): RGB {
  // Returning the endpoint outright rather than round-tripping it is not just a
  // shortcut. Converting an 8-bit colour back to HSL and forward again is not
  // the identity: a channel can move by one, and at a colour sitting exactly on
  // the contrast floor that was enough to drop 3.004 to 2.99 -- so full
  // strength failed to reach the floor it had just been solved for.
  if (t >= 1) return b;
  const [h, sa, la] = toHsl(a);
  const [, sb, lb] = toHsl(b);
  return fromHsl([h, sa + (sb - sa) * t, la + (lb - la) * t]);
}

/** [h 0..1, s 0..1, l 0..1]. */
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
  // At l = 0 and l = 1 the chroma term cannot be represented; the arithmetic
  // above collapses to black and white on its own, which is what makes the
  // final step of the ramp always clear the contrast floor.
  return [clamp(ch(h + 1 / 3)), clamp(ch(h)), clamp(ch(h - 1 / 3))];
}

/**
 * Steps in the ramp. Fine enough that the first colour to clear the floor is
 * the closest one that does, so the accent moves as little as the fix allows.
 */
const RAMP_STEPS = 40;

/**
 * The minimum contrast the accent needs against app surfaces. Below this,
 * accent text/buttons stop reading as interactive (borders vanish, text
 * smears). 3.0 is the WCAG "large text / UI component" floor; chasing full
 * 4.5 would wash out saturated mid-tones the user picked on purpose.
 */
const MIN_ACCENT_CONTRAST = 3.0;

/**
 * A palette colour, as RGB.
 *
 * Every colour this file uses comes out of the palette the stylesheet is
 * generated from, so a contrast decision cannot be made against something the
 * user never sees. The background in particular used to be an invented
 * [17,18,22] graphite that matched neither `.dark` nor `.dark.amoled`.
 *
 * A value that is not a hex is a bug in our own declarations, not a runtime
 * condition, so it throws rather than falling back to something plausible.
 */
function paletteRgb(theme: "dark" | "light", token: string): RGB {
  const hex = themeToken(theme, false, token);
  const rgb = parseHex(hex);
  if (!rgb) {
    throw new Error(`--${token} is not a hex colour: ${hex}`);
  }
  return rgb;
}

/** The surface the accent sits on: `--bg`, or its AMOLED override. */
export function surfaceRgb(theme: "dark" | "light", amoled = false): RGB {
  const hex = themeToken(theme, amoled, "bg");
  const rgb = parseHex(hex);
  if (!rgb) {
    throw new Error(`the ${theme} background is not a hex colour: ${hex}`);
  }
  return rgb;
}

/**
 * Walk lightness until the colour clears the contrast floor on the surface,
 * holding hue and saturation.
 *
 * The step this replaces interpolated each RGB channel toward `accent-lift`,
 * which is #ffffff on dark and #110f0a on light. Both endpoints are
 * desaturated, so every interpolation between a vivid source and one of them
 * bleeds saturation in proportion to how far it travelled -- measured over
 * 20000 dark, saturated samples, 72% of them came back with less than half
 * their original saturation. A wallpaper's deep indigo #0a0e28 became the
 * near-grey #626575: a technically correct contrast fix that destroyed the
 * colour the user actually picked. Lightness is the only axis that moves a
 * colour toward or away from the background, so moving it alone changes the
 * contrast without touching what the colour *is*.
 *
 * If lightness alone cannot reach the floor — a hue that the surface happens
 * to sit directly opposite, in luminance terms — the walk still terminates at
 * `lift`'s lightness, which `fromHsl` collapses to black or white. White
 * against the darkest surface and black against the lightest both clear 3.0
 * many times over, so the ramp has no unreachable end.
 */
function liftToward(rgb: RGB, surface: RGB, lift: RGB): RGB {
  const [h, s, l0] = toHsl(rgb);
  const targetL = toHsl(lift)[2];
  for (let i = 1; i <= RAMP_STEPS; i++) {
    const step = fromHsl([h, s, l0 + (targetL - l0) * (i / RAMP_STEPS)]);
    if (contrastRatio(step, surface) >= MIN_ACCENT_CONTRAST) return step;
  }
  return fromHsl([h, s, targetL]);
}

/**
 * Nudge a color until it is readable on the given theme's background,
 * preserving its hue and saturation. Returns the input unchanged once the
 * contrast floor is met, so a colour that was already fine is never touched.
 *
 * `strength` (0..1) scales the whole adjustment: 1 = always reach the
 * contrast floor, 0 = return the color untouched, in between = blend the
 * fixed-point result back toward the original so the user dials the
 * correction strength without losing its direction.
 *
 * `amoled` selects the true-black surface the AMOLED theme stacks on top of
 * dark. Ignored on light, because App.tsx only applies the class when the
 * resolved theme is not light.
 */
export function readableOnTheme(
  rgb: RGB,
  theme: "dark" | "light",
  strength = 1,
  amoled = false,
): RGB {
  if (strength <= 0) return rgb;
  const surface = surfaceRgb(theme, amoled);
  if (contrastRatio(rgb, surface) >= MIN_ACCENT_CONTRAST) return rgb;
  // Clamped because `strength` is blended as a factor: a stored value above 1
  // would extrapolate past the corrected colour rather than stopping at it.
  const fixed = liftToward(rgb, surface, paletteRgb(theme, "accent-lift"));
  return blend(rgb, fixed, Math.min(1, strength));
}

/** Where the UI accent is coming from. */
export type AccentSource =
  | "wallpaper"
  | "windows"
  | "static"
  | "device"
  | "fallback";

/**
 * What each accent source is called in the interface.
 *
 * A lookup table rather than a template-literal key, so every label is written
 * out somewhere a reader and the i18n checker can both see.
 */
export const ACCENT_SOURCE_LABELS: Record<AccentSource, string> = {
  wallpaper: "common.accent-follows-the-wallpaper",
  windows: "common.accent-follows-windows",
  static: "common.accent-is-frozen",
  device: "common.accent-follows-a-device",
  fallback: "common.accent-has-not-settled",
};

/** Everything the accent chain reads. One field per store value it touches. */
export interface AccentInput {
  deviceColors: Record<number, { rgb: RGB }>;
  mode: string | undefined;
  staticColor: RGB | undefined;
  excludedDevices: number[] | undefined;
  devices: { id: number; typeName: string }[];
  /** Chosen device id, -1 for "frozen", null for "whichever is active". */
  accentDevice: number | null;
  accentLive: boolean;
  wallpaperColor: RGB | null;
  sysAccent: RGB | null;
  theme: "dark" | "light";
  autoShade: number;
  amoled: boolean;
}

/**
 * Resolve the accent colour *and* the branch it came from, in one pass.
 *
 * The colour is what `--glow` is set to; the source is what the Overview's
 * provenance chip names. They are one function because they are one decision:
 * this used to be a hand-kept mirror of the branch order in `Shell.tsx`, and
 * the mirror drifted exactly the way a second copy of a precedence rule does —
 * it read `devices.length > 0` for "there is a device colour", which is a
 * connected device with nothing sampled yet, and it reported a chosen device
 * even when that device had never reported a colour and the chain had walked
 * past it. The chip then explained a colour the user was not looking at, which
 * is the one thing a provenance chip must never do.
 *
 * Precedence, unchanged from the CSS variable's: a visibly non-black wallpaper
 * colour leads while live following is on; with live following off the OS
 * accent leads; then a frozen static colour; then a chosen device that has
 * actually reported; then whichever device is lit (keyboard first); then the
 * factory default. Only the *source* labels differ from before — the colour
 * this returns is byte-for-byte what the old branch produced.
 */
export function resolveAccent(input: AccentInput): {
  rgb: RGB;
  source: AccentSource;
} {
  // One readability pass for every source, so the returned colour keeps the
  // identity of where it came from.
  const pick = (rgb: RGB, source: AccentSource) => ({
    rgb: readableOnTheme(
      rgb,
      input.theme,
      Math.max(0, Math.min(1, input.autoShade)),
      input.amoled,
    ),
    source,
  });
  // A dark scene must not tint the whole UI unreadably dark, so a near-black
  // wallpaper colour is not a colour at all — and the chip must not name it
  // either, which is why this test lives here and not at the call site.
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
    // The OS accent leads when live following is off. Before the one-shot seed
    // lands there is nothing to lead with, and calling that gap "Windows" would
    // send people to a switch that was never involved.
    return input.sysAccent
      ? pick(input.sysAccent, "windows")
      : pick(input.staticColor ?? fallback ?? DEFAULT_GLOW, "fallback");
  }
  // "Off" (-1): freeze the accent to the configured static colour.
  if (input.accentDevice === -1) {
    return pick(
      input.staticColor ?? fallback ?? input.sysAccent ?? DEFAULT_GLOW,
      "static",
    );
  }
  // A manual pick wins outright — but only once that device has reported a
  // colour. A chosen device that is silent is not the source of anything.
  if (input.accentDevice != null) {
    const picked = input.deviceColors[input.accentDevice]?.rgb;
    if (picked) return pick(picked, "device");
  }
  // Otherwise prefer a device actually in the loop: the keyboard first, then
  // any non-excluded device, so an excluded/black device never tints the whole
  // interface black.
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
