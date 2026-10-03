import { describe, it, expect } from "vitest";
import { avatarInitial } from "./avatarInit";

describe("avatarInitial", () => {
  it("takes the first letter", () => {
    expect(avatarInitial("Night gaming")).toBe("N");
  });

  it("uppercases, so two configs do not read as n and N", () => {
    expect(avatarInitial("night")).toBe("N");
  });

  it("keeps a name that starts with a digit", () => {
    // Inventing a letter for "3AM" would be a lie about what the config is
    // called; the 3 is the honest answer.
    expect(avatarInitial("3AM")).toBe("3");
  });

  it("takes the whole first character, not half of it", () => {
    // A surrogate pair sliced by index renders as U+FFFD in the circle, which
    // is exactly the kind of thing this function exists to prevent.
    expect(avatarInitial("\u{1F3B9} night")).toBe("\u{1F3B9}");
    expect(avatarInitial("éclair")).toBe("É");
  });

  it("ignores leading space", () => {
    expect(avatarInitial("   Night")).toBe("N");
  });

  it("returns empty for a name that has none", () => {
    // Absent, null and blank are all the same state: nothing to draw, so the
    // caller falls back to an icon rather than to a glyph.
    expect(avatarInitial("")).toBe("");
    expect(avatarInitial("   ")).toBe("");
    expect(avatarInitial(null)).toBe("");
    expect(avatarInitial(undefined)).toBe("");
  });
});
