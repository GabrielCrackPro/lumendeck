// Accent readability: the UI accent (--glow) can come from the OS, the
// wallpaper's dominant color, or a live device color — none of which are
// chosen for legibility on the dashboard's surfaces. These helpers score a
// color against the current theme's background and, when it would be hard to
// read, pick a nearby shade of the same hue that is.
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

/** Linear 0..1 mix in sRGB space (good enough for shade stepping). */
function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * The minimum contrast the accent needs against app surfaces. Below this,
 * accent text/buttons stop reading as interactive (borders vanish, text
 * smears). 3.0 is the WCAG "large text / UI component" floor; chasing full
 * 4.5 would wash out saturated mid-tones the user picked on purpose.
 */
const MIN_ACCENT_CONTRAST = 3.0;

/** Surfaces the accent sits on, per theme (matches --bg in index.css). */
const SURFACES: Record<"dark" | "light", RGB> = {
  dark: [17, 18, 22], // #11121b-ish graphite
  light: [233, 231, 224], // #e9e7e0 ivory
};

/**
 * Nudge a color until it is readable on the given theme's background,
 * preserving its hue. Steps the color toward white (dark theme) or toward
 * black (light theme) in 6% increments — same family, just a shade that
 * survives the panel it lands on. Returns the input unchanged once the
 * contrast floor is met.
 *
 * `strength` (0..1) scales the whole adjustment: 1 = always reach the
 * contrast floor, 0 = return the color untouched, in between = blend the
 * fixed-point result back toward the original so the user dials the
 * correction strength without losing its direction.
 */
export function readableOnTheme(
  rgb: RGB,
  theme: "dark" | "light",
  strength = 1,
): RGB {
  if (strength <= 0) return rgb;
  const surface = SURFACES[theme];
  if (contrastRatio(rgb, surface) >= MIN_ACCENT_CONTRAST) return rgb;
  const lift: RGB = theme === "dark" ? [255, 255, 255] : [17, 15, 10];
  let fixed: RGB = lift;
  for (let t = 0.06; t <= 0.9; t += 0.06) {
    const step = mix(rgb, lift, t);
    if (contrastRatio(step, surface) >= MIN_ACCENT_CONTRAST) {
      fixed = step;
      break;
    }
  }
  return mix(rgb, fixed, strength);
}
