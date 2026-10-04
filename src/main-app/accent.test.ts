import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  readableOnTheme,
  relativeLuminance,
  surfaceRgb,
} from "./accent";
import { formatHex } from "./components/colorHex";

// The surfaces are NOT restated here. They come from src/shared/palette.ts,
// which is also what the stylesheet is generated from, so a test that copied
// the hexes would be a third copy to keep in sync. The drift guard is the
// themeTokens build step, which refuses to run against a stylesheet that has
// lost its marker. What is asserted below is the behaviour on the real
// surface, which is the part worth pinning.
// Colour helpers, spelled out rather than imported: accent.ts exports its own
// HSL conversions for the ramp and asserting on them would let a bug in those
// hide behind a test that used the same code to check itself.
type RGB = [number, number, number];

function hslOf([r0, g0, b0]: RGB): [number, number, number] {
  const r = r0 / 255, g = g0 / 255, b = b0 / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return [0, 0, l];
  const h =
    mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(((h / 6) % 1) + 1) % 1, d / (1 - Math.abs(2 * l - 1)), l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    const x = ((t % 1) + 1) % 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return [c(ch(h + 1 / 3)), c(ch(h)), c(ch(h - 1 / 3))];
}

const DARK_BG = surfaceRgb("dark");
const AMOLED_BG = surfaceRgb("dark", true);
const LIGHT_BG = surfaceRgb("light");

describe("surfaceRgb", () => {
  it("resolves the three backgrounds the stylesheet is built from", () => {
    // The three --bg values, as the browser will see them. Written as the hex
    // string so a change to palette.ts is visible as a change here rather
    // than silently moving the numbers.
    expect(formatHex(surfaceRgb("light"))).toBe("#E9E7E0");
    expect(formatHex(surfaceRgb("dark"))).toBe("#101214");
    expect(formatHex(surfaceRgb("dark", true))).toBe("#000000");
  });
});

describe("relativeLuminance", () => {
  it("black is 0, white is 1", () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
  });

  it("sRGB gamma matters for dark colors", () => {
    // 10/255 raw would look near-black by linear math; gamma keeps it tiny
    // but nonzero — just checking ordering sanity vs mid gray.
    const dark = relativeLuminance([10, 10, 10]);
    const mid = relativeLuminance([128, 128, 128]);
    expect(dark).toBeLessThan(mid);
    expect(dark).toBeGreaterThan(0);
  });
});

describe("contrastRatio", () => {
  it("same color is 1, black vs white is 21", () => {
    expect(contrastRatio([0, 0, 0], [0, 0, 0])).toBe(1);
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
  });
});

// The surfaces below are the --bg values in index.css. They are duplicated
// here on purpose: readableOnTheme is pure, and a test that read the real
// custom property would need the DOM this environment deliberately lacks.
// .dark { --bg: #101214 } / .dark.amoled { --bg: #000000 }
describe("readableOnTheme", () => {
  it("keeps already-readable colors untouched", () => {
    // Bright cyan on the dark surface is well above the floor.
    expect(readableOnTheme([56, 189, 248], "dark")).toEqual([56, 189, 248]);
    // Deep navy is fine on the light surface.
    expect(readableOnTheme([20, 30, 90], "light")).toEqual([20, 30, 90]);
  });

  it("lifts near-black wallpaper tones on dark theme, same hue family", () => {
    // Dark blue (typical dim wallpaper sample) is unreadable on graphite.
    const out = readableOnTheme([10, 14, 40], "dark");
    expect(contrastRatio(out, DARK_BG)).toBeGreaterThanOrEqual(3.0);
    // Still blue: blue channel dominates, not a gray blob.
    expect(out[2]).toBeGreaterThan(out[0]);
    expect(out[2]).toBeGreaterThan(out[1]);
  });

  it("darkens blinding accents on light theme", () => {
    const out = readableOnTheme([255, 250, 240], "light");
    expect(contrastRatio(out, LIGHT_BG)).toBeGreaterThanOrEqual(3.0);
  });

  it("extreme case still converges", () => {
    // Pure black accent on dark theme must resolve to something visible.
    const out = readableOnTheme([0, 0, 0], "dark");
    expect(contrastRatio(out, DARK_BG)).toBeGreaterThanOrEqual(3.0);
  });

  it("leaves an accent alone on AMOLED that the wrong surface would have lifted", () => {
    // The bug this exists for, and its direction is not the obvious one. There
    // is no colour that clears the floor on #101214 and fails it on #000000:
    // true black is a strictly easier surface, so the band between the two
    // ratios is empty. What the invented [17,18,22] surface did was lift
    // accents that were already fine on AMOLED, washing them out.
    const slate: [number, number, number] = [80, 95, 120];
    // Clears the floor on true black, misses it on graphite.
    expect(contrastRatio(slate, AMOLED_BG)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(slate, DARK_BG)).toBeLessThan(3.0);

    // Told the truth, it is already readable and comes back untouched.
    expect(readableOnTheme(slate, "dark", 1, true)).toEqual(slate);
    // Told graphite, it gets lifted — which is the over-bright accent an
    // AMOLED user was seeing before the surface was fixed.
    const wrong = readableOnTheme(slate, "dark", 1, false);
    expect(contrastRatio(wrong, DARK_BG)).toBeGreaterThanOrEqual(3.0);
    expect(wrong[2]).toBeGreaterThan(slate[2]);
  });

  it("still lifts on AMOLED an accent that is too dark for true black", () => {
    // The other direction, so the fix is not read as "AMOLED never lifts".
    const nearBlack: [number, number, number] = [10, 14, 40];
    const out = readableOnTheme(nearBlack, "dark", 1, true);
    expect(contrastRatio(out, AMOLED_BG)).toBeGreaterThanOrEqual(3.0);
    expect(out[2]).toBeGreaterThan(nearBlack[2]);
  });

  it("ignores amoled on the light theme", () => {
    // App.tsx only stacks the class on a dark theme, so this combination
    // cannot reach the function. surfaceKey encodes that rather than this
    // call site knowing it, and the test pins the result.
    const blind: [number, number, number] = [255, 250, 240];
    expect(readableOnTheme(blind, "light", 1, true)).toEqual(
      readableOnTheme(blind, "light", 1, false),
    );
  });

  it("strength 0 returns the raw color", () => {
    expect(readableOnTheme([10, 14, 40], "dark", 0)).toEqual([10, 14, 40]);
  });

  it("partial strength blends toward the correction, not necessarily to the floor", () => {
    const raw = [10, 14, 40] as [number, number, number];
    const full = readableOnTheme(raw, "dark", 1);
    const half = readableOnTheme(raw, "dark", 0.5);
    // Between raw and full — direction preserved, magnitude halved.
    expect(half[2]).toBeGreaterThan(raw[2]);
    expect(half[2]).toBeLessThan(full[2]);
    // And it must NOT be guaranteed legible at half strength.
    const ratio = contrastRatio(half, DARK_BG);
    expect(ratio).toBeLessThan(contrastRatio(full, DARK_BG));
  });

  // The saturation regression. The ramp used to lerp each RGB channel toward
  // `accent-lift`, which is #ffffff on dark and #110f0a on light; both are
  // desaturated, so a vivid source bled saturation in proportion to how far it
  // travelled. Over 20000 dark, saturated samples, 72% came back as greys --
  // wallpaper #0a0e28 landed on #626575. Wallpaper and device colours are
  // exactly that population, so this was the common case, not an edge.
  //
  // Asserted in HSL, which is the space the ramp holds constant. HSV
  // saturation necessarily falls as lightness moves toward the middle even at
  // constant HSL saturation, so pinning it would pin an artefact.
  it("keeps saturation when lifting a saturated colour on dark", () => {
    // Deep indigo: unmistakably blue and dark, so it always needed lifting.
    const indigo: RGB = [10, 14, 40];
    const out = readableOnTheme(indigo, "dark");
    expect(contrastRatio(out, DARK_BG)).toBeGreaterThanOrEqual(3.0);
    // Tolerance covers 8-bit rounding; the old ramp lost 0.55 here, not 0.01.
    expect(hslOf(out)[1]).toBeGreaterThan(hslOf(indigo)[1] * 0.9);
    // Blue must still dominate rather than the result being a grey.
    expect(out[2]).toBeGreaterThan(out[0]);
    expect(out[2]).toBeGreaterThan(out[1]);
  });

  it("keeps saturation when darkening a saturated colour on light", () => {
    // A pale pink: light enough to wash out against ivory, saturated enough
    // that the old ramp visibly greyed it.
    const pink: RGB = [250, 209, 209];
    expect(contrastRatio(pink, LIGHT_BG)).toBeLessThan(3.0);
    const out = readableOnTheme(pink, "light");
    expect(contrastRatio(out, LIGHT_BG)).toBeGreaterThanOrEqual(3.0);
    expect(hslOf(out)[1]).toBeGreaterThan(hslOf(pink)[1] * 0.9);
    // Still red, not grey.
    expect(out[0]).toBeGreaterThan(out[2]);
  });

  it("keeps saturation at partial strength too", () => {
    // The strength blend used to lerp in gamma space as well, so dialling the
    // correction down took saturation away from the user instead of giving it
    // back.
    const indigo: RGB = [10, 14, 40];
    for (const strength of [0.25, 0.5, 0.75]) {
      const out = readableOnTheme(indigo, "dark", strength);
      expect(hslOf(out)[1]).toBeGreaterThan(hslOf(indigo)[1] * 0.9);
    }
  });

  it("holds hue across the ramp, not just at its endpoints", () => {
    // A walk could preserve hue at the sampled points and still drift between
    // them, so the hue angle itself is pinned -- and pinned across the whole
    // circle, not just one quadrant.
    for (let h = 0; h < 1; h += 0.05) {
      const src = hslToRgb(h, 0.8, 0.08);
      const out = readableOnTheme(src, "dark");
      const delta = Math.abs(hslOf(out)[0] - hslOf(src)[0]);
      expect(Math.min(delta, 1 - delta)).toBeLessThan(0.01);
    }
  });

  it("still reaches the floor for every hue, not just the ones it walks through", () => {
    // The ramp terminates at the lift's lightness, which fromHsl collapses to
    // white. A hue whose lightness walk cannot reach the floor is the case
    // that made the old code silently substitute the palette's own accent.
    let failures = 0;
    for (let h = 0; h < 1; h += 0.01) {
      for (const l of [0.02, 0.08, 0.16, 0.24]) {
        const src = hslToRgb(h, 0.85, l);
        const out = readableOnTheme(src, "dark", 1, false);
        if (contrastRatio(out, DARK_BG) < 2.9999) failures++;
        if (contrastRatio(out, AMOLED_BG) < 2.9999) failures++;
      }
      for (const l of [0.92, 0.98]) {
        const out = readableOnTheme(hslToRgb(h, 0.85, l), "light", 1, false);
        if (contrastRatio(out, LIGHT_BG) < 2.9999) failures++;
      }
    }
    expect(failures).toBe(0);
  });

  it("clamps strength above 1 to the corrected colour", () => {
    // A stored value over 1 would extrapolate past the fix rather than stopping
    // at it, so the output would drift lighter the further the config drifted.
    const raw: RGB = [10, 14, 40];
    expect(readableOnTheme(raw, "dark", 4)).toEqual(
      readableOnTheme(raw, "dark", 1),
    );
  });

  it("never returns a channel outside 0..255", () => {
    // Rounding inside a walk that runs to the lift's lightness can overshoot on
    // the chroma term; a negative channel silently drops the whole rule in
    // rgb(var(--glow)), taking the accent with it.
    for (let i = 0; i < 500; i++) {
      const src = hslToRgb(i / 500, 1, 0.05);
      for (const out of [
        readableOnTheme(src, "dark"),
        readableOnTheme(src, "light"),
        readableOnTheme(src, "dark", 0.3),
      ]) {
        for (const ch of out) {
          expect(Number.isFinite(ch)).toBe(true);
          expect(ch).toBeGreaterThanOrEqual(0);
          expect(ch).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});
