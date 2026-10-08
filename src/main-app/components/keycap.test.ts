import { describe, expect, it } from "vitest";
import { capFaceLuma, capRadius, legendFits, legendInk } from "./keycap";

describe("capRadius", () => {
  it("scales with the cap rather than being a constant", () => {
    expect(capRadius(40, 40)).toBeCloseTo(7.2, 6);
    expect(capRadius(160, 40)).toBeCloseTo(7.2, 6);
  });

  it("takes the short edge, so a wide cap is not left with swollen corners", () => {
    expect(capRadius(200, 30)).toBeCloseTo(5.4, 6);
  });
});

describe("legendInk", () => {
  it("is light on a dark cap", () => {
    expect(legendInk([10, 12, 20])).toBe("rgba(255,255,255,0.68)");
  });

  it("flips to dark ink on a cap lit near white", () => {
    const ink = legendInk([250, 250, 250]);
    expect(ink.startsWith("rgba(10,10,14")).toBe(true);
  });

  it("darkens further the brighter the cap gets", () => {
    const alpha = (c: string) => Number(c.split(",")[3]?.replace(")", ""));
    expect(alpha(legendInk([255, 255, 255]))).toBeGreaterThan(
      alpha(legendInk([200, 200, 200])),
    );
  });

  it("never goes fully opaque, because a cap is still a lit surface", () => {
    const alpha = Number(legendInk([255, 255, 255]).split(",")[3]?.replace(")", ""));
    expect(alpha).toBeLessThanOrEqual(0.7);
  });
});

describe("capFaceLuma", () => {
  it("measures the lit face, not the raw LED colour", () => {
    expect(capFaceLuma([255, 255, 255])).toBeLessThan(255);
  });

  it("rises with a hover lift", () => {
    expect(capFaceLuma([200, 200, 200], 1.12)).toBeGreaterThan(
      capFaceLuma([200, 200, 200], 1),
    );
  });
});

describe("legendFits", () => {
  const font = 9;
  it("rejects a key too narrow to hold its legend", () => {
    expect(legendFits("W", 16, font)).toBe(false);
    expect(legendFits("W", 40, font)).toBe(true);
  });

  it("rejects a blank label, which the spacebar carries", () => {
    expect(legendFits("   ", 100, font)).toBe(false);
  });
});
