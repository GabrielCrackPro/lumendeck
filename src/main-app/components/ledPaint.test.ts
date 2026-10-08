import { describe, expect, it } from "vitest";
import {
  DARK_LED,
  EMITTER_BOOST,
  emitterColor,
  frameSignature,
  glowAlpha,
  glowRadius,
  ledRadius,
  previewDpr,
} from "./ledPaint";

describe("DARK_LED", () => {
  it("is one shared unlit colour, and it is not black", () => {
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
    expect(emitterColor(DARK_LED, 0)).toEqual(DARK_LED);
  });

  it("defaults to the documented overdrive", () => {
    expect(emitterColor([0, 0, 0])).toEqual(emitterColor([0, 0, 0], EMITTER_BOOST));
  });
});

describe("glowAlpha", () => {
  it("scales with how much light the colour puts out", () => {
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
describe("frameSignature", () => {
  const rgb: [number, number, number] = [10, 20, 30];
  const four = [
    [1, 1, 1],
    [2, 2, 2],
    [3, 3, 3],
    [4, 4, 4],
  ] as [number, number, number][];

  it("is stable when nothing changed", () => {
    expect(frameSignature(rgb, four)).toBe(frameSignature(rgb, four));
  });

  it("notices a change in any single LED, at any position", () => {
    for (let i = 0; i < four.length; i++) {
      const moved = four.map((c, j) =>
        j === i ? ([9, 9, 9] as [number, number, number]) : c,
      );
      expect(frameSignature(rgb, moved), `LED ${i} went unnoticed`).not.toBe(
        frameSignature(rgb, four),
      );
    }
  });

  it("notices a change in the last zone", () => {
    const moved = four.map((c, i) => (i === 3 ? ([9, 9, 9] as [number, number, number]) : c));
    expect(frameSignature(rgb, moved)).not.toBe(frameSignature(rgb, four));
  });

  it("notices a change on a full-size board's last LED too", () => {
    const wide = Array.from({ length: 96 }, (_, i) => [
      i,
      i,
      i,
    ] as [number, number, number]);
    const moved = wide.map((c, i) =>
      i === 95 ? ([1, 1, 1] as [number, number, number]) : c,
    );
    expect(frameSignature(rgb, moved)).not.toBe(frameSignature(rgb, wide));
  });

  it("notices a change in the representative colour or the count", () => {
    expect(frameSignature([9, 9, 9], four)).not.toBe(frameSignature(rgb, four));
    expect(frameSignature(rgb, four.slice(0, 3))).not.toBe(frameSignature(rgb, four));
  });

  it("carries the extra token so a hover still repaints", () => {
    expect(frameSignature(rgb, four, "W")).not.toBe(frameSignature(rgb, four, "Q"));
    expect(frameSignature(rgb, four, "W")).toBe(frameSignature(rgb, four, "W"));
  });

  it("handles a board with no colours yet", () => {
    expect(() => frameSignature(rgb, [])).not.toThrow();
    expect(frameSignature(rgb, [])).not.toBe(frameSignature(rgb, four));
  });

  it("does not confuse one frame's samples with another's", () => {
    const a = frameSignature(rgb, [[1, 1, 1], [1, 1, 1], [1, 1, 1]]);
    const b = frameSignature(rgb, [[1, 1, 1], [1, 1, 1], [1, 1, 2]]);
    expect(a).not.toBe(b);
  });
});
