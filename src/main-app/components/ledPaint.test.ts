import { describe, expect, it } from "vitest";
import {
  DARK_LED,
  EMITTER_BOOST,
  emitterColor,
  glowAlpha,
  glowRadius,
  ledRadius,
  previewDpr,
} from "./ledPaint";

describe("DARK_LED", () => {
  it("is one shared unlit colour, and it is not black", () => {
    // A true-black package reads as a hole punched in the track. All three
    // renderers used to bring their own grey here.
    expect(DARK_LED).toEqual([30, 32, 36]);
    expect(Math.max(...DARK_LED)).toBeGreaterThan(0);
  });
});

describe("emitterColor", () => {
  it("pushes each channel toward white", () => {
    expect(emitterColor([0, 0, 0])).toEqual([77, 77, 77]);
    expect(emitterColor([100, 100, 100])).toEqual([147, 147, 147]);
  });

  it("leaves white alone", () => {
    expect(emitterColor([255, 255, 255])).toEqual([255, 255, 255]);
  });

  it("never leaves the 0-255 range", () => {
    for (const boost of [-1, 0, 0.3, 1, 4]) {
      for (const rgb of [
        [0, 0, 0],
        [255, 255, 255],
        [12, 240, 99],
      ] as [number, number, number][]) {
        for (const c of emitterColor(rgb, boost)) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(255);
          expect(Number.isInteger(c)).toBe(true);
        }
      }
    }
  });

  it("takes no boost for an unlit package, so it stays dark", () => {
    // This is the muted-device case, and the reason boost is a parameter
    // rather than the constant baked in.
    expect(emitterColor(DARK_LED, 0)).toEqual(DARK_LED);
  });

  it("defaults to the documented overdrive", () => {
    expect(emitterColor([0, 0, 0])).toEqual(emitterColor([0, 0, 0], EMITTER_BOOST));
  });
});

describe("glowAlpha", () => {
  it("scales with how much light the colour puts out", () => {
    // The defect: the device strip used a constant alpha, so a black LED threw
    // the same halo as a white one.
    const dark = glowAlpha([4, 4, 8]);
    const mid = glowAlpha([128, 128, 128]);
    const bright = glowAlpha([255, 255, 255]);
    expect(dark).toBeLessThan(mid);
    expect(mid).toBeLessThan(bright);
  });

  it("keeps a floor so a dark LED still reads as geometry", () => {
    expect(glowAlpha([0, 0, 0])).toBeGreaterThan(0.05);
    expect(glowAlpha(DARK_LED)).toBeGreaterThan(0.05);
  });

  it("never exceeds full alpha", () => {
    expect(glowAlpha([255, 255, 255])).toBeLessThanOrEqual(1);
  });

  it("weights green the way the eye does", () => {
    // Rec. 709 luma, so pure green glows harder than pure blue at the same
    // numeric value. Anything else makes a blue LED look underlit.
    expect(glowAlpha([0, 255, 0])).toBeGreaterThan(glowAlpha([0, 0, 255]));
  });
});

describe("ledRadius", () => {
  it("scales with the package so one shape reads at two sizes", () => {
    expect(ledRadius(40)).toBeCloseTo(12);
    expect(ledRadius(4)).toBeCloseTo(1.2);
    expect(ledRadius(40) / ledRadius(4)).toBeCloseTo(10);
  });

  it("never degenerates to nothing on a tiny package", () => {
    expect(ledRadius(0.2)).toBeGreaterThan(0);
    expect(ledRadius(0)).toBeGreaterThan(0);
  });
});

describe("glowRadius", () => {
  it("scales with the package", () => {
    expect(glowRadius(40)).toBeGreaterThan(glowRadius(4));
  });

  it("stays positive for a zero-sized package", () => {
    expect(glowRadius(0)).toBeGreaterThan(0);
  });
});

describe("previewDpr", () => {
  it("caps a high-density display", () => {
    expect(previewDpr(4)).toBe(3);
  });

  it("never drops below 1", () => {
    // 0 is what a display reporting no ratio actually hands over, and dividing
    // by it produced a zero-sized backing store.
    expect(previewDpr(0)).toBe(1);
    expect(previewDpr(undefined)).toBe(1);
    expect(previewDpr(-2)).toBe(1);
  });

  it("passes a 1x display through unchanged", () => {
    expect(previewDpr(1)).toBe(1);
  });

  it("keeps a 2x display at 2", () => {
    expect(previewDpr(2)).toBe(2);
  });

  it("honours an explicit cap", () => {
    expect(previewDpr(3, 2)).toBe(2);
  });
});