import { describe, expect, it } from "vitest";
import { volumeGlyph } from "./volumeGlyph";

describe("volumeGlyph", () => {
  it("shows the crossed speaker when muted, whatever the level", () => {
    expect(volumeGlyph(true, 60)).toBe("off");
    expect(volumeGlyph(true, 100)).toBe("off");
  });

  it("shows the crossed speaker at zero even when not muted", () => {
    expect(volumeGlyph(false, 0)).toBe("off");
  });

  it("picks one wave below the cutoff and two above it", () => {
    expect(volumeGlyph(false, 1)).toBe("low");
    expect(volumeGlyph(false, 33)).toBe("low");
    expect(volumeGlyph(false, 34)).toBe("high");
    expect(volumeGlyph(false, 100)).toBe("high");
  });

  it("treats silence as off and everything else as audible", () => {
    expect(volumeGlyph(false, 0)).not.toBe("low");
    expect(volumeGlyph(false, 1)).not.toBe("off");
  });

  it("clamps a level that arrives out of range", () => {
    expect(volumeGlyph(false, -10)).toBe("off");
    expect(volumeGlyph(false, 5000)).toBe("high");
  });

  it("falls back to silence for a level that is not a number", () => {
    expect(volumeGlyph(false, Number.NaN)).toBe("off");
  });
});
