import { describe, expect, it } from "vitest";
import { formatHex, isParsableHex, parseHex, tidyHexDraft } from "./colorHex";

describe("parseHex", () => {
  it("reads the six-digit form it displays", () => {
    expect(parseHex("#5078FF")).toEqual([0x50, 0x78, 0xff]);
    expect(parseHex("5078ff")).toEqual([0x50, 0x78, 0xff]);
  });

  it("treats # as optional", () => {
    expect(parseHex("EC4899")).toEqual(parseHex("#EC4899"));
  });

  it("expands three-digit shorthand by doubling each digit", () => {
    expect(parseHex("#f0a")).toEqual([0xff, 0x00, 0xaa]);
    expect(parseHex("fff")).toEqual([255, 255, 255]);
    expect(parseHex("#000")).toEqual([0, 0, 0]);
  });

  it("keeps alpha forms, discarding the alpha", () => {
    expect(parseHex("#f0a8")).toEqual([0xff, 0x00, 0xaa]);
    expect(parseHex("#5078FF80")).toEqual([0x50, 0x78, 0xff]);
  });

  it("ignores surrounding whitespace", () => {
    expect(parseHex("  #EC4899 \n")).toEqual([0xec, 0x48, 0x99]);
  });

  it("returns null rather than a wrong colour for junk", () => {
    for (const bad of [
      "",
      "#",
      "#12",
      "#12345",
      "#1234567",
      "#123456789",
      "#GGGGGG",
      "#5078F",
      "rgb(1,2,3)",
      "purple",
      "#-12345",
    ]) {
      expect(parseHex(bad), bad).toBeNull();
    }
  });

  it("does not accept a stray inner #", () => {
    expect(parseHex("#50#78FF")).toBeNull();
  });
});

describe("isParsableHex", () => {
  it("agrees with parseHex", () => {
    expect(isParsableHex("#f0a")).toBe(true);
    expect(isParsableHex("#ggg")).toBe(false);
  });
});

describe("formatHex", () => {
  it("uppercases and zero-pads to six digits", () => {
    expect(formatHex([0, 0, 0])).toBe("#000000");
    expect(formatHex([255, 170, 1])).toBe("#FFAA01");
  });

  it("rounds rather than truncating a fractional channel", () => {
    expect(formatHex([0.5, 1.5, 2.4])).toBe("#010202");
  });

  it("round-trips through parseHex", () => {
    for (const hex of ["#000000", "#FFFFFF", "#5078FF", "#EC4899"]) {
      expect(formatHex(parseHex(hex)!)).toBe(hex.toUpperCase());
    }
  });
});

describe("tidyHexDraft", () => {
  it("drops the # and uppercases, keeping what is being typed", () => {
    expect(tidyHexDraft(" #f0a ")).toBe("F0A");
    expect(tidyHexDraft("f0")).toBe("F0");
    expect(tidyHexDraft("")).toBe("");
  });
});