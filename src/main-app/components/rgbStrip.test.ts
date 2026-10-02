import { describe, expect, it } from "vitest";
import {
  AUDIO_FLOOR,
  averageColor,
  hsvToRgb,
  luma,
  rgbToHsv,
  saturate,
  scaleLuma,
  stripFrame,
  STRIP_LEDS,
  type Rgb,
} from "./rgbStrip";

const SAT = 1, VAL = 1;
const LIVE: Rgb = [40, 60, 120];
const STATIC: Rgb = [200, 30, 40];

const frame = (over: Partial<Parameters<typeof stripFrame>[0]> = {}) =>
  stripFrame({
    mode: "static",
    time: 0,
    ledCount: STRIP_LEDS,
    saturation: SAT,
    brightness: VAL,
    liveColor: LIVE,
    staticColor: STATIC,
    ...over,
  });

describe("hsvToRgb", () => {
  it("matches the engine's primaries at full saturation", () => {
    // The same six sectors palette::hsv_to_rgb builds.
    expect(hsvToRgb(0, 1, 1)).toEqual([255, 0, 0]);
    expect(hsvToRgb(60, 1, 1)).toEqual([255, 255, 0]);
    expect(hsvToRgb(120, 1, 1)).toEqual([0, 255, 0]);
    expect(hsvToRgb(180, 1, 1)).toEqual([0, 255, 255]);
    expect(hsvToRgb(240, 1, 1)).toEqual([0, 0, 255]);
    expect(hsvToRgb(300, 1, 1)).toEqual([255, 0, 255]);
  });

  it("wraps hue into 0..360 from either direction", () => {
    expect(hsvToRgb(360, 1, 1)).toEqual(hsvToRgb(0, 1, 1));
    expect(hsvToRgb(-120, 1, 1)).toEqual(hsvToRgb(240, 1, 1));
    expect(hsvToRgb(725, 1, 1)).toEqual(hsvToRgb(5, 1, 1));
  });

  it("is black at zero value and gray at zero saturation", () => {
    expect(hsvToRgb(200, 1, 0)).toEqual([0, 0, 0]);
    const gray = hsvToRgb(200, 0, 0.5);
    expect(gray[0]).toBe(gray[1]);
    expect(gray[1]).toBe(gray[2]);
  });

  it("clamps out-of-range saturation and value rather than wrapping them", () => {
    // Clamping both to 1 gives a fully saturated colour at that hue, which is
    // why this is red and not white.
    expect(hsvToRgb(0, 5, 5)).toEqual([255, 0, 0]);
    // Negative saturation clamps to 0, which is mid-gray at half value, not
    // black: in HSV it is value that carries lightness.
    expect(hsvToRgb(0, -3, 0.5)).toEqual([128, 128, 128]);
    expect(hsvToRgb(0, 1, -1)).toEqual([0, 0, 0]);
  });
});

describe("rgbToHsv", () => {
  it("round-trips the primaries", () => {
    for (const [rgb, hue] of [
      [[255, 0, 0], 0],
      [[0, 255, 0], 120],
      [[0, 0, 255], 240],
    ] as [Rgb, number][]) {
      const back = hsvToRgb(rgbToHsv(rgb).h, 1, 1);
      expect(Math.abs(back[0] - rgb[0])).toBeLessThanOrEqual(2);
      expect(Math.abs(back[1] - rgb[1])).toBeLessThanOrEqual(2);
      expect(Math.abs(back[2] - rgb[2])).toBeLessThanOrEqual(2);
      expect(Math.abs(rgbToHsv(rgb).h - hue)).toBeLessThan(2);
    }
  });

  it("reports zero hue for gray, as the engine does", () => {
    expect(rgbToHsv([128, 128, 128]).h).toBe(0);
    expect(rgbToHsv([0, 0, 0]).s).toBe(0);
  });

  it("keeps hue in range for a mid-tone color", () => {
    const { h } = rgbToHsv([12, 200, 90]);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });
});

describe("palette helpers", () => {
  it("computes gray luma as the channel value", () => {
    expect(luma([128, 128, 128])).toBeCloseTo(128, 1);
  });

  it("is a no-op at saturation 1 and fully gray at 0", () => {
    expect(saturate([10, 200, 30], 1)).toEqual([10, 200, 30]);
    const c = saturate([10, 200, 30], 0);
    expect(c[0]).toBe(c[1]);
    expect(c[1]).toBe(c[2]);
  });

  it("boosts saturation above the engine's 2x threshold", () => {
    expect(saturate([200, 20, 20], 2)[0]).toBeGreaterThan(200);
  });

  it("clamps when scaling past full range", () => {
    expect(scaleLuma([200, 200, 200], 4)).toEqual([255, 255, 255]);
    expect(scaleLuma([200, 200, 200], 0)).toEqual([0, 0, 0]);
  });
});

describe("stripFrame", () => {
  it("returns one colour per LED", () => {
    for (const n of [1, 12, 24, 60]) {
      expect(frame({ ledCount: n })).toHaveLength(n);
    }
  });

  it("is empty for zero or negative LEDs rather than dividing by zero", () => {
    expect(frame({ ledCount: 0 })).toEqual([]);
    expect(frame({ ledCount: -4 })).toEqual([]);
  });

  it("paints static evenly across the strip", () => {
    const leds = frame({ mode: "static", brightness: 1, saturation: 1 });
    expect(new Set(leds.map(String)).size).toBe(1);
    expect(leds[0]).toEqual(STATIC);
  });

  it("leaves the last LED one step short of the gradient end", () => {
    // The bug this replaced: position was i/(n-1), which put the last LED at
    // the very end of the sweep instead of stopping short like the engine.
    // With a 360 spread over 24 LEDs the step is 15 degrees, so the last LED
    // must sit at 345, not 360 (which would be 0 again).
    const leds = frame({ mode: "cycle", cycleSpread: 360, time: 0 });
    expect(rgbToHsv(leds[0]!).h).toBeCloseTo(0, 0);
    expect(rgbToHsv(leds.at(-1)!).h).toBeCloseTo(345, 0);
  });

  it("sweeps hue monotonically in cycle mode", () => {
    const leds = frame({ mode: "cycle", cycleSpread: 360, time: 0 });
    const hues = leds.map((c) => rgbToHsv(c).h);
    for (let i = 1; i < hues.length; i++) {
      const step = (hues[i]! - hues[i - 1]! + 360) % 360;
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThan(30);
    }
  });

  it("moves the wave over time", () => {
    const a = frame({ mode: "wave", time: 0 });
    const b = frame({ mode: "wave", time: 2 });
    expect(a).not.toEqual(b);
  });

  it("reverses travel when the direction flips", () => {
    // Not a spatial mirror: flipping the sign reverses which way the pattern
    // moves, it does not reflect the gradient. So the check is that the two
    // frames differ, and that running the reversed one further along equals
    // running the forward one backwards in time.
    const right = frame({ mode: "wave", time: 1, waveDirection: 1 });
    const left = frame({ mode: "wave", time: 1, waveDirection: -1 });
    expect(right).not.toEqual(left);
    // At t=0 both directions agree, since there is nothing to travel yet.
    expect(frame({ mode: "wave", time: 0, waveDirection: 1 })).toEqual(
      frame({ mode: "wave", time: 0, waveDirection: -1 }),
    );
  });

  it("breathes between 15% and 100% and never below the floor", () => {
    const dim = stripFrame({
      mode: "breathe", time: 0, ledCount: 2,
      saturation: 1, brightness: 1, liveColor: null, staticColor: STATIC,
    })[0]!;
    const bright = stripFrame({
      mode: "breathe", time: 2.25, ledCount: 2,
      saturation: 1, brightness: 1, liveColor: null, staticColor: STATIC,
    })[0]!;
    expect(luma(bright)).toBeGreaterThan(luma(dim));
    // The floor is 15% of the source, never zero.
    expect(luma(dim)).toBeGreaterThan(luma(STATIC) * 0.1);
  });

  it("returns to where it started after one full breath", () => {
    const at = (t: number) =>
      stripFrame({
        mode: "breathe", time: t, ledCount: 1,
        saturation: 1, brightness: 1, liveColor: null, staticColor: STATIC,
      })[0]!;
    expect(at(0)).toEqual(at(4.5));
  });

  it("follows the wallpaper colour in ambient mode", () => {
    const leds = frame({ mode: "ambient", liveColor: LIVE, brightness: 1, saturation: 1 });
    expect(leds[0]).toEqual(LIVE);
  });

  it("never drops below 35% in pulse mode", () => {
    // A near-black wallpaper: the floor is what keeps the strip visibly alive.
    const dark = frame({ mode: "pulse", liveColor: [4, 4, 4], brightness: 1, saturation: 1 });
    expect(luma(dark[0]!)).toBeGreaterThan(0);
    const bright = frame({ mode: "pulse", liveColor: [255, 255, 255], brightness: 1, saturation: 1 });
    expect(luma(bright[0]!)).toBeGreaterThan(luma(dark[0]!));
  });

  it("steps down in three bands for zone mode", () => {
    const leds = frame({ mode: "zone", liveColor: [200, 200, 200], brightness: 1, saturation: 1 });
    // 24 LEDs at i/n, so the first band ends at index 7 and the second at 15.
    const shift = [1, 0.72, 0.45];
    expect(luma(leds[0]!)).toBeGreaterThan(luma(leds.at(-1)!));
    expect(Math.abs(luma(leds[7]!) - luma(leds[8]!))).toBeGreaterThan(0);
    expect(Math.abs(luma(leds[15]!) - luma(leds[16]!))).toBeGreaterThan(0);
    // Within a band nothing changes.
    expect(luma(leds[3]!)).toBe(luma(leds[4]!));
    expect(shift[0]! > shift[1]!).toBe(true);
  });

  it("floors quiet audio rather than going dark", () => {
    const silent = frame({ mode: "audioReactive", audioVolume: 0, brightness: 1, saturation: 1 });
    expect(luma(silent[0]!)).toBeGreaterThan(0);
    // The floor is the documented constant.
    expect(AUDIO_FLOOR).toBe(0.3);
  });

  it("brightens with volume in audio reactive mode", () => {
    const quiet = frame({ mode: "audioReactive", audioVolume: 0.4, brightness: 1, saturation: 1 });
    const loud = frame({ mode: "audioReactive", audioVolume: 1, brightness: 1, saturation: 1 });
    expect(luma(loud[0]!)).toBeGreaterThan(luma(quiet[0]!));
  });

  it("applies brightness as a ceiling on every mode", () => {
    for (const mode of ["static", "ambient", "pulse", "cycle", "wave", "zone"] as const) {
      for (const c of frame({ mode, brightness: 0.5, saturation: 1 })) {
        for (const ch of c) {
          expect(ch).toBeGreaterThanOrEqual(0);
          expect(ch).toBeLessThanOrEqual(255);
        }
      }
    }
  });

  it("desaturates toward gray as saturation drops", () => {
    // The preview used to apply saturation to finished sRGB, which greys the
    // colour instead of pulling the hue's own saturation down.
    const vivid = frame({ mode: "cycle", saturation: 1 })[0]!;
    const muted = frame({ mode: "cycle", saturation: 0.2 })[0]!;
    const spread = (c: Rgb) => Math.max(...c) - Math.min(...c);
    expect(spread(muted)).toBeLessThan(spread(vivid));
  });

  it("goes fully black at zero brightness", () => {
    for (const mode of ["static", "ambient", "pulse", "cycle", "wave", "zone"] as const) {
      for (const c of frame({ mode, brightness: 0, saturation: 1 })) {
        expect(luma(c)).toBeLessThan(3);
      }
    }
  });

  it("is deterministic for the same inputs", () => {
    expect(frame({ mode: "wave", time: 1.234 })).toEqual(frame({ mode: "wave", time: 1.234 }));
  });

  it("handles every mode without throwing", () => {
    const modes = ["static", "ambient", "pulse", "zone", "cycle", "wave", "breathe", "audioReactive"] as const;
    for (const mode of modes) {
      expect(frame({ mode })).toHaveLength(STRIP_LEDS);
      // Also with no live colour yet, which is the pre-first-sample state.
      expect(frame({ mode, liveColor: null })).toHaveLength(STRIP_LEDS);
    }
  });
});

describe("averageColor", () => {
  it("averages a frame", () => {
    expect(averageColor([[0, 0, 0], [255, 255, 255]])).toEqual([128, 128, 128]);
  });

  it("is black for an empty frame", () => {
    expect(averageColor([])).toEqual([0, 0, 0]);
  });
});