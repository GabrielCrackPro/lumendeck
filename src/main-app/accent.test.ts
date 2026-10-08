import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  readableOnTheme,
  relativeLuminance,
  resolveAccent,
  surfaceRgb,
} from "./accent";
import { formatHex } from "./components/colorHex";

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
    expect(readableOnTheme([56, 189, 248], "dark")).toEqual([56, 189, 248]);
    expect(readableOnTheme([20, 30, 90], "light")).toEqual([20, 30, 90]);
  });

  it("lifts near-black wallpaper tones on dark theme, same hue family", () => {
    const out = readableOnTheme([10, 14, 40], "dark");
    expect(contrastRatio(out, DARK_BG)).toBeGreaterThanOrEqual(3.0);
    expect(out[2]).toBeGreaterThan(out[0]);
    expect(out[2]).toBeGreaterThan(out[1]);
  });

  it("darkens blinding accents on light theme", () => {
    const out = readableOnTheme([255, 250, 240], "light");
    expect(contrastRatio(out, LIGHT_BG)).toBeGreaterThanOrEqual(3.0);
  });

  it("extreme case still converges", () => {
    const out = readableOnTheme([0, 0, 0], "dark");
    expect(contrastRatio(out, DARK_BG)).toBeGreaterThanOrEqual(3.0);
  });

  it("leaves an accent alone on AMOLED that the wrong surface would have lifted", () => {
    const slate: [number, number, number] = [80, 95, 120];
    expect(contrastRatio(slate, AMOLED_BG)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(slate, DARK_BG)).toBeLessThan(3.0);

    expect(readableOnTheme(slate, "dark", 1, true)).toEqual(slate);
    const wrong = readableOnTheme(slate, "dark", 1, false);
    expect(contrastRatio(wrong, DARK_BG)).toBeGreaterThanOrEqual(3.0);
    expect(wrong[2]).toBeGreaterThan(slate[2]);
  });

  it("still lifts on AMOLED an accent that is too dark for true black", () => {
    const nearBlack: [number, number, number] = [10, 14, 40];
    const out = readableOnTheme(nearBlack, "dark", 1, true);
    expect(contrastRatio(out, AMOLED_BG)).toBeGreaterThanOrEqual(3.0);
    expect(out[2]).toBeGreaterThan(nearBlack[2]);
  });

  it("ignores amoled on the light theme", () => {
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
    expect(half[2]).toBeGreaterThan(raw[2]);
    expect(half[2]).toBeLessThan(full[2]);
    const ratio = contrastRatio(half, DARK_BG);
    expect(ratio).toBeLessThan(contrastRatio(full, DARK_BG));
  });

  it("keeps saturation when lifting a saturated colour on dark", () => {
    const indigo: RGB = [10, 14, 40];
    const out = readableOnTheme(indigo, "dark");
    expect(contrastRatio(out, DARK_BG)).toBeGreaterThanOrEqual(3.0);
    expect(hslOf(out)[1]).toBeGreaterThan(hslOf(indigo)[1] * 0.9);
    expect(out[2]).toBeGreaterThan(out[0]);
    expect(out[2]).toBeGreaterThan(out[1]);
  });

  it("keeps saturation when darkening a saturated colour on light", () => {
    const pink: RGB = [250, 209, 209];
    expect(contrastRatio(pink, LIGHT_BG)).toBeLessThan(3.0);
    const out = readableOnTheme(pink, "light");
    expect(contrastRatio(out, LIGHT_BG)).toBeGreaterThanOrEqual(3.0);
    expect(hslOf(out)[1]).toBeGreaterThan(hslOf(pink)[1] * 0.9);
    expect(out[0]).toBeGreaterThan(out[2]);
  });

  it("keeps saturation at partial strength too", () => {
    const indigo: RGB = [10, 14, 40];
    for (const strength of [0.25, 0.5, 0.75]) {
      const out = readableOnTheme(indigo, "dark", strength);
      expect(hslOf(out)[1]).toBeGreaterThan(hslOf(indigo)[1] * 0.9);
    }
  });

  it("holds hue across the ramp, not just at its endpoints", () => {
    for (let h = 0; h < 1; h += 0.05) {
      const src = hslToRgb(h, 0.8, 0.08);
      const out = readableOnTheme(src, "dark");
      const delta = Math.abs(hslOf(out)[0] - hslOf(src)[0]);
      expect(Math.min(delta, 1 - delta)).toBeLessThan(0.01);
    }
  });

  it("still reaches the floor for every hue, not just the ones it walks through", () => {
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
    const raw: RGB = [10, 14, 40];
    expect(readableOnTheme(raw, "dark", 4)).toEqual(
      readableOnTheme(raw, "dark", 1),
    );
  });

  it("never returns a channel outside 0..255", () => {
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

describe("resolveAccent", () => {
  const base = {
    deviceColors: {},
    mode: "none",
    staticColor: undefined,
    excludedDevices: [],
    devices: [],
    accentDevice: null,
    accentLive: true,
    wallpaperColor: null,
    sysAccent: null,
    theme: "dark" as const,
    autoShade: 0,
    amoled: false,
  };
  const RED: RGB = [220, 30, 30];
  const device = (id: number, rgb: RGB) => ({ id, rgb });

  it("follows a visibly non-black wallpaper colour while live", () => {
    const out = resolveAccent({ ...base, wallpaperColor: RED });
    expect(out.source).toBe("wallpaper");
    expect(out.rgb).toEqual(RED);
  });

  it("does not name the wallpaper when its colour is too dark to lead", () => {
    const out = resolveAccent({ ...base, wallpaperColor: [2, 2, 2] });
    expect(out.source).toBe("fallback");
  });

  it("does not name a device that has never reported a colour", () => {
    const out = resolveAccent({
      ...base,
      devices: [{ id: 7, typeName: "Keyboard" }],
      deviceColors: {},
    });
    expect(out.source).toBe("fallback");
  });

  it("falls through a silent chosen device to a lit one", () => {
    const out = resolveAccent({
      ...base,
      accentDevice: 7,
      devices: [
        { id: 7, typeName: "Keyboard" },
        { id: 9, typeName: "Mouse" },
      ],
      deviceColors: { 9: device(9, RED) },
    });
    expect(out.source).toBe("device");
    expect(out.rgb).toEqual(RED);
  });

  it("prefers the keyboard over other lit devices", () => {
    const mouse: RGB = [10, 200, 10];
    const out = resolveAccent({
      ...base,
      devices: [
        { id: 3, typeName: "Mouse" },
        { id: 5, typeName: "RGB Keyboard" },
      ],
      deviceColors: { 3: device(3, mouse), 5: device(5, RED) },
    });
    expect(out.rgb).toEqual(RED);
  });

  it("prefers a device in the loop over an excluded one", () => {
    const excludedRed: RGB = [220, 30, 30];
    const inLoopGreen: RGB = [10, 200, 10];
    const out = resolveAccent({
      ...base,
      devices: [
        { id: 3, typeName: "Mouse" },
        { id: 5, typeName: "Keyboard" },
      ],
      excludedDevices: [3],
      deviceColors: { 3: device(3, excludedRed), 5: device(5, inLoopGreen) },
    });
    expect(out.source).toBe("device");
    expect(out.rgb).toEqual(inLoopGreen);
  });

  it("reports Windows as the source when live following is off", () => {
    const out = resolveAccent({
      ...base,
      accentLive: false,
      sysAccent: RED,
      wallpaperColor: RED,
    });
    expect(out.source).toBe("windows");
    expect(out.rgb).toEqual(RED);
  });

  it("reports a frozen accent as frozen, not as Windows", () => {
    const out = resolveAccent({
      ...base,
      accentLive: true,
      accentDevice: -1,
      staticColor: RED,
    });
    expect(out.source).toBe("static");
    expect(out.rgb).toEqual(RED);
  });

  it("names the factory default rather than blaming a source that is fine", () => {
    const out = resolveAccent(base);
    expect(out.source).toBe("fallback");
  });

  it("does not call an unseeded session Windows before the OS accent lands", () => {
    const out = resolveAccent({
      ...base,
      accentLive: false,
      sysAccent: null,
      staticColor: RED,
    });
    expect(out.source).toBe("fallback");
    expect(out.rgb).toEqual(RED);
  });
});
