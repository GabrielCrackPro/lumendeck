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
});
