import { describe, expect, it } from "vitest";
import { shaderCanvasSize } from "./shaders";

describe("shaderCanvasSize", () => {
  it("uses native resolution for common displays", () => {
    expect(shaderCanvasSize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(shaderCanvasSize(2560, 1600)).toEqual({ width: 2560, height: 1600 });
  });

  it("clamps tiny screens to a sane minimum", () => {
    expect(shaderCanvasSize(0, 0)).toEqual({ width: 64, height: 36 });
  });

  it("caps ultra-wide displays at 4K width preserving aspect", () => {
    const { width, height } = shaderCanvasSize(5120, 1440);
    expect(width).toBe(3840);
    expect(height).toBe(Math.floor(1440 * (3840 / 5120)));
  });
});
