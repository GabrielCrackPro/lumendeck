import { describe, expect, it } from "vitest";
import { volumeGlyph } from "./volumeGlyph";

describe("volumeGlyph", () => {
  it("shows the crossed speaker when muted, whatever the level", () => {
    // Mute at 60 and mute at 100 are the same fact to the user, and a glyph that
    // still showed two waves would claim sound is coming out.
    expect(volumeGlyph(true, 60)).toBe("off");
    expect(volumeGlyph(true, 100)).toBe("off");
  });

  it("shows the crossed speaker at zero even when not muted", () => {
    // A slider dragged to zero is silent; drawing an audible speaker there is
    // the same lie as a muted one, in the other direction.
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
    // A stray value must not select a glyph that does not exist, which would
    // render nothing at all in the button.
    expect(volumeGlyph(false, -10)).toBe("off");
    expect(volumeGlyph(false, 5000)).toBe("high");
  });

  it("falls back to silence for a level that is not a number", () => {
    // NaN would make every comparison false and fall through to "high", showing
    // two waves on a control that has no idea what the volume is.
    expect(volumeGlyph(false, Number.NaN)).toBe("off");
  });
});
