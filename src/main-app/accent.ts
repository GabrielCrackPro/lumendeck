// Accent readability: the UI accent (--glow) can come from the OS, the
// wallpaper's dominant color, or a live device color — none of which are
// chosen for legibility on the dashboard's surfaces. These helpers score a
// color against the current theme's background and, when it would be hard to
// read, pick a nearby shade of the same hue that is.
import { parseHex } from "./components/colorHex";
import { themeToken } from "@shared/palette";

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
