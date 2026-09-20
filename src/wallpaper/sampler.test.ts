import { describe, expect, it } from "vitest";
import { avgRect, computeSamples, lumaOf } from "./sampler";

function solidBuf(w: number, h: number, rgb: [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { data, w, h };
}

describe("avgRect", () => {
  it("returns the solid color for a full frame", () => {
    const buf = solidBuf(8, 8, [10, 20, 30]);
    expect(avgRect(buf, 0, 0, 1, 1)).toEqual([10, 20, 30]);
  });

  it("averages two halves correctly", () => {
    const left = solidBuf(4, 4, [255, 0, 0]);
    const right = solidBuf(4, 4, [0, 0, 255]);
    const data = new Uint8ClampedArray(8 * 4 * 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 8; x++) {
        const src = x < 4 ? left : right;
        const si = (y * 4 + (x % 4)) * 4;
        const di = (y * 8 + x) * 4;
        data[di] = src.data[si]!;
        data[di + 1] = src.data[si + 1]!;
        data[di + 2] = src.data[si + 2]!;
        data[di + 3] = 255;
      }
    }
    const buf = { data, w: 8, h: 4 };
    expect(avgRect(buf, 0, 0, 0.5, 1)).toEqual([255, 0, 0]);
    expect(avgRect(buf, 0.5, 0, 0.5, 1)).toEqual([0, 0, 255]);
    expect(avgRect(buf, 0.25, 0, 0.5, 1)).toEqual([128, 0, 128]);
  });

  it("clamps out-of-range rects", () => {
    const buf = solidBuf(4, 4, [1, 2, 3]);
    expect(avgRect(buf, -1, -1, 5, 5)).toEqual([1, 2, 3]);
    expect(avgRect(buf, 0.9, 0.9, 2, 2)).toEqual([1, 2, 3]);
  });
});

describe("lumaOf", () => {
  it("white is 1, black is 0", () => {
    expect(lumaOf([255, 255, 255])).toBeCloseTo(1);
    expect(lumaOf([0, 0, 0])).toBe(0);
  });
});

describe("computeSamples", () => {
  it("emits 'all' plus one sample per zone", () => {
    const buf = solidBuf(8, 8, [50, 100, 150]);
    const samples = computeSamples(buf, [
      { id: "z1", x: 0, y: 0, w: 0.5, h: 1 },
      { id: "z2", x: 0.5, y: 0, w: 0.5, h: 1 },
    ]);
    expect(samples.map((s) => s.id)).toEqual(["all", "z1", "z2"]);
    expect(samples.every((s) => s.rgb[0] === 50)).toBe(true);
  });
});
