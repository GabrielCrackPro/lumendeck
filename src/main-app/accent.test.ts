import { describe, expect, it } from "vitest";
import { contrastRatio, readableOnTheme, relativeLuminance } from "./accent";

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
    expect(contrastRatio(out, [17, 18, 22])).toBeGreaterThanOrEqual(3.0);
    // Still blue: blue channel dominates, not a gray blob.
    expect(out[2]).toBeGreaterThan(out[0]);
    expect(out[2]).toBeGreaterThan(out[1]);
  });

  it("darkens blinding accents on light theme", () => {
    const out = readableOnTheme([255, 250, 240], "light");
    expect(contrastRatio(out, [233, 231, 224])).toBeGreaterThanOrEqual(3.0);
  });

  it("extreme case still converges", () => {
    // Pure black accent on dark theme must resolve to something visible.
    const out = readableOnTheme([0, 0, 0], "dark");
    expect(contrastRatio(out, [17, 18, 22])).toBeGreaterThanOrEqual(3.0);
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
    const ratio = contrastRatio(half, [17, 18, 22]);
    expect(ratio).toBeLessThan(contrastRatio(full, [17, 18, 22]));
  });
});
