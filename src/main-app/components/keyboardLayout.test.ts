import { describe, expect, it } from "vitest";
import {
  ANSI_ROWS,
  ZONE_CEILING,
  ansiKeyCount,
  buildKeyboardPlates,
  disposition,
  dispositionLabel,
  plateAt,
  zoneFor,
} from "./keyboardLayout";

const OPTS = { pad: 8, gap: 2.5 };

describe("ansiKeyCount", () => {
  it("counts every cap in the block", () => {
    // 13 F-keys + 14 + 14 + 13 + 12 + 8
    expect(ansiKeyCount()).toBe(74);
  });

  it("matches the row lengths", () => {
    const expected = [13, 14, 14, 13, 12, 8];
    expect(ANSI_ROWS.map((r) => r.length)).toEqual(expected);
  });
});

describe("disposition", () => {
  it("adds a numpad only on full-size boards", () => {
    expect(disposition(140, 140).withNumpad).toBe(true);
    expect(disposition(119, 119).withNumpad).toBe(false);
  });

  it("adds a nav cluster from TKL up", () => {
    expect(disposition(100, 100).withNav).toBe(true);
    expect(disposition(89, 89).withNav).toBe(false);
  });

  it("treats a handful of colours as zones, not per-key LEDs", () => {
    expect(disposition(60, 6).zoned).toBe(true);
    expect(disposition(6, 6).zoned).toBe(true);
  });

  it("stops treating colours as zones once per-key is plausible", () => {
    expect(disposition(104, 104).zoned).toBe(false);
    expect(disposition(104, ZONE_CEILING).zoned).toBe(false);
  });

  it("is not zoned when nothing is reporting", () => {
    expect(disposition(104, 0).zoned).toBe(false);
  });
});

describe("zoneFor", () => {
  it("spreads keys evenly and marks the first key of each zone", () => {
    // 8 keys, 4 zones: two keys each, boundaries at 2 and 4.
    const got = Array.from({ length: 8 }, (_, i) => zoneFor(i, 8, 4));
    expect(got.map((z) => z.zone)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(got.map((z) => z.boundary)).toEqual([
      false, false, true, false, true, false, true, false,
    ]);
  });

  it("never marks the very first key as a boundary", () => {
    // There is nothing to the left of key 0, so a divider there is nonsense.
    expect(zoneFor(0, 104, 6).boundary).toBe(false);
  });

  it("clamps the last zone rather than indexing past the colour array", () => {
    // 5 keys over 3 zones is 1.667 keys per zone, so the runs are 2/2/1.
    const zones = Array.from({ length: 5 }, (_, i) => zoneFor(i, 5, 3).zone);
    expect(zones).toEqual([0, 0, 1, 1, 2]);
    expect(Math.max(...zones)).toBeLessThan(3);
  });

  it("survives more zones than keys", () => {
    // The fractional case the old float maths got wrong.
    const zones = Array.from({ length: 4 }, (_, i) => zoneFor(i, 4, 59).zone);
    expect(zones.every((z) => Number.isInteger(z))).toBe(true);
    expect(Math.max(...zones)).toBeLessThan(59);
  });

  it("degrades safely with no zones", () => {
    expect(zoneFor(3, 104, 0)).toEqual({ zone: 0, boundary: false });
  });
});

describe("buildKeyboardPlates", () => {
  it("lays out only the main block on a 60% board", () => {
    const plates = buildKeyboardPlates(760, 208, {
      ...OPTS,
      disposition: disposition(61, 61),
      colorCount: 61,
    });
    expect(plates).toHaveLength(ansiKeyCount());
    expect(new Set(plates.map((p) => p.cluster))).toEqual(new Set(["main"]));
  });

  it("adds nav and arrows on a TKL board", () => {
    const plates = buildKeyboardPlates(900, 208, {
      ...OPTS,
      disposition: disposition(100, 100),
      colorCount: 100,
    });
    expect(plates.filter((p) => p.cluster === "nav")).toHaveLength(9);
    expect(plates.filter((p) => p.cluster === "arrow")).toHaveLength(3);
    expect(plates.some((p) => p.cluster === "numpad")).toBe(false);
  });

  it("adds the numpad on a full-size board", () => {
    const plates = buildKeyboardPlates(1000, 208, {
      ...OPTS,
      disposition: disposition(140, 140),
      colorCount: 140,
    });
    expect(plates.filter((p) => p.cluster === "numpad")).toHaveLength(17);
    expect(plates.length).toBe(ansiKeyCount() + 9 + 3 + 17);
  });

  it("keeps every keycap inside the canvas", () => {
    const w = 1000, h = 208;
    const plates = buildKeyboardPlates(w, h, {
      ...OPTS,
      disposition: disposition(140, 140),
      colorCount: 140,
    });
    for (const p of plates) {
      expect(p.x).toBeGreaterThanOrEqual(-0.001);
      expect(p.y).toBeGreaterThanOrEqual(-0.001);
      expect(p.x + p.w).toBeLessThanOrEqual(w + 0.001);
      expect(p.y + p.h).toBeLessThanOrEqual(h + 0.001);
    }
  });

  it("does not let keys grow taller than the space given", () => {
    const tall = buildKeyboardPlates(400, 400, {
      ...OPTS,
      disposition: disposition(61, 61),
      colorCount: 61,
    });
    const rows = new Set(tall.map((p) => p.y)).size;
    expect(rows).toBeLessThanOrEqual(ANSI_ROWS.length);
  });

  it("gives wide keys more room than narrow ones", () => {
    const plates = buildKeyboardPlates(900, 208, {
      ...OPTS,
      disposition: disposition(61, 61),
      colorCount: 61,
    });
    const space = plates.find((p) => p.label === " ")!;
    const letter = plates.find((p) => p.label === "A")!;
    expect(space.w).toBeGreaterThan(letter.w * 3);
  });

  it("wraps the colour index when there are fewer colours than keys", () => {
    // A 61-LED board with 74 keys: the tail must reuse colours, not run off
    // the end of the array.
    const plates = buildKeyboardPlates(900, 208, {
      ...OPTS,
      disposition: disposition(61, 61),
      colorCount: 61,
    });
    for (const p of plates) {
      expect(p.ledIndex).toBeLessThan(61);
      expect(p.ledIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it("spreads zones across the whole board, not just the main block", () => {
    // 6 zones over 103 keys. Zones are contiguous runs, so a 12-key nav
    // cluster can legitimately sit inside a single one — what matters is that
    // each cluster is numbered from its position on the *whole* board rather
    // than restarted at zero. The old code divided by the ANSI count alone
    // while still drawing nav and numpad, so those blocks came out as a run of
    // identical trailing keys.
    const plates = buildKeyboardPlates(1000, 208, {
      ...OPTS,
      disposition: disposition(140, 6),
      colorCount: 6,
    });
    for (const p of plates) {
      expect(p.zone).toBeGreaterThanOrEqual(0);
      expect(p.zone).toBeLessThan(6);
    }
    // Zone numbers climb left to right across clusters.
    const mainLast = plates.filter((p) => p.cluster === "main").at(-1)!.zone;
    const navFirst = plates.find((p) => p.cluster === "nav")!.zone;
    const numpadFirst = plates.find((p) => p.cluster === "numpad")!.zone;
    expect(navFirst).toBeGreaterThan(mainLast - 1);
    expect(numpadFirst).toBeGreaterThanOrEqual(navFirst);
    // And the last key on the board is in the last zone, not an overflow.
    expect(plates.at(-1)!.zone).toBe(5);
  });

  it("never numbers a zone outside the reported colour count", () => {
    // A board that claims more LEDs than keys (a lightbar reporting 140 on a
    // 74-key block) must not invent zones past the end.
    const plates = buildKeyboardPlates(1000, 208, {
      ...OPTS,
      disposition: disposition(140, 6),
      colorCount: 6,
    });
    expect(Math.max(...plates.map((p) => p.ledIndex))).toBeLessThan(6);
  });

  it("paints a zoned board from zones rather than per-key LEDs", () => {
    const plates = buildKeyboardPlates(900, 208, {
      ...OPTS,
      disposition: disposition(104, 6),
      colorCount: 6,
    });
    expect(Math.max(...plates.map((p) => p.ledIndex))).toBeLessThan(6);
    expect(plates.some((p) => p.boundary)).toBe(true);
  });

  it("has no boundaries and no clamping on a per-key board", () => {
    const plates = buildKeyboardPlates(900, 208, {
      ...OPTS,
      disposition: disposition(104, 104),
      colorCount: 104,
    });
    expect(plates.every((p) => !p.boundary)).toBe(true);
    expect(plates.every((p) => p.zone === 0)).toBe(true);
  });

  it("marks home-row keys and only those", () => {
    const plates = buildKeyboardPlates(900, 208, {
      ...OPTS,
      disposition: disposition(61, 61),
      colorCount: 61,
    });
    const homed = plates.filter((p) => p.home).map((p) => p.label);
    expect(homed).toEqual(["W", "A", "S", "D", "F"]);
  });
});

describe("plateAt", () => {
  const plates = buildKeyboardPlates(900, 208, {
    ...OPTS,
    disposition: disposition(61, 61),
    colorCount: 61,
  });

  it("finds the key under a point", () => {
    const target = plates.find((p) => p.label === "G")!;
    const hit = plateAt(plates, target.x + target.w / 2, target.y + target.h / 2);
    expect(hit?.label).toBe("G");
  });

  it("returns null off the board", () => {
    expect(plateAt(plates, 2, 2)).toBeNull();
    expect(plateAt([], 10, 10)).toBeNull();
  });

  it("treats the exact edge as a hit, so adjacent keys are reachable", () => {
    const first = plates[0]!;
    const hit = plateAt(plates, first.x + first.w, first.y + first.h / 2);
    expect(hit).not.toBeNull();
  });
});

describe("dispositionLabel", () => {
  it("names the board by size", () => {
    expect(dispositionLabel(140, 140)).toBe("fullSize");
    expect(dispositionLabel(100, 100)).toBe("tkl");
    expect(dispositionLabel(70, 70)).toBe("ansi");
  });

  it("prefers the zone wording when the board is zoned", () => {
    // Under six zones is a lightbar, not a board: "6 zones" is the useful
    // fact. Six and above is a keyboard that happens to be zoned, so name the
    // layout and carry the count.
    expect(dispositionLabel(6, 5)).toBe("lightbar");
    expect(dispositionLabel(6, 6)).toBe("zonedBoard");
    expect(dispositionLabel(104, 20)).toBe("zonedBoard");
  });
});