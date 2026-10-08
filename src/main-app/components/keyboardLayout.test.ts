import { describe, expect, it } from "vitest";
import {
  ANSI_ROWS,
  BEZEL,
  ZONE_CEILING,
  ansiKeyCount,
  buildKeyboardPlates,
  caseRect,
  disposition,
  dispositionLabel,
  plateAt,
  plateBounds,
  zoneFor,
} from "./keyboardLayout";

const OPTS = { pad: 8, gap: 2.5 };

describe("ansiKeyCount", () => {
  it("counts every cap in the block", () => {
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
    const got = Array.from({ length: 8 }, (_, i) => zoneFor(i, 8, 4));
    expect(got.map((z) => z.zone)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(got.map((z) => z.boundary)).toEqual([
      false, false, true, false, true, false, true, false,
    ]);
  });

  it("never marks the very first key as a boundary", () => {
    expect(zoneFor(0, 104, 6).boundary).toBe(false);
  });

  it("clamps the last zone rather than indexing past the colour array", () => {
    const zones = Array.from({ length: 5 }, (_, i) => zoneFor(i, 5, 3).zone);
    expect(zones).toEqual([0, 0, 1, 1, 2]);
    expect(Math.max(...zones)).toBeLessThan(3);
  });

  it("survives more zones than keys", () => {
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
    const plates = buildKeyboardPlates(1000, 208, {
      ...OPTS,
      disposition: disposition(140, 6),
      colorCount: 6,
    });
    for (const p of plates) {
      expect(p.zone).toBeGreaterThanOrEqual(0);
      expect(p.zone).toBeLessThan(6);
    }
    const mainLast = plates.filter((p) => p.cluster === "main").at(-1)!.zone;
    const navFirst = plates.find((p) => p.cluster === "nav")!.zone;
    const numpadFirst = plates.find((p) => p.cluster === "numpad")!.zone;
    expect(navFirst).toBeGreaterThan(mainLast - 1);
    expect(numpadFirst).toBeGreaterThanOrEqual(navFirst);
    expect(plates.at(-1)!.zone).toBe(5);
  });

  it("never numbers a zone outside the reported colour count", () => {
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
    expect(dispositionLabel(6, 5)).toBe("lightbar");
    expect(dispositionLabel(6, 6)).toBe("zonedBoard");
    expect(dispositionLabel(104, 20)).toBe("zonedBoard");
  });
});

describe("plateBounds", () => {
  const board = (leds: number) =>
    buildKeyboardPlates(600, 200, {
      ...OPTS,
      disposition: disposition(leds, leds),
      colorCount: leds,
    });

  it("is null for an empty board, so the caller can fall back", () => {
    expect(plateBounds([])).toBeNull();
  });

  it("encloses every plate", () => {
    for (const leds of [70, 96, 140]) {
      const plates = board(leds);
      const b = plateBounds(plates)!;
      expect(b).not.toBeNull();
      for (const p of plates) {
        expect(p.x).toBeGreaterThanOrEqual(b.x - 0.001);
        expect(p.y).toBeGreaterThanOrEqual(b.y - 0.001);
        expect(p.x + p.w).toBeLessThanOrEqual(b.x + b.w + 0.001);
        expect(p.y + p.h).toBeLessThanOrEqual(b.y + b.h + 0.001);
      }
    }
  });

  it("is no wider than the canvas, and smaller for a small board", () => {
    const b60 = plateBounds(board(70))!;
    const bFull = plateBounds(board(140))!;
    expect(b60.w).toBeLessThan(600);
    expect(b60.w).toBeLessThan(bFull.w);
  });
});

describe("caseRect", () => {
  const CANVAS = { w: 600, h: 200 };

  it("falls back to the whole canvas when there is no board", () => {
    expect(caseRect(null, CANVAS)).toEqual({ x: 0, y: 0, w: 600, h: 200 });
  });

  it("wraps the board in a bezel on every side", () => {
    const board = { x: 50, y: 40, w: 300, h: 100 };
    const c = caseRect(board, CANVAS);
    expect(c.w).toBeGreaterThan(board.w);
    expect(c.h).toBeGreaterThan(board.h);
    expect(c.w - board.w).toBeCloseTo(board.h * BEZEL.side * 2, 6);
  });

  it("has a thicker bottom bezel than top, the way a case does", () => {
    const board = { x: 50, y: 40, w: 300, h: 100 };
    const c = caseRect(board, CANVAS);
    const extra = c.h - board.h;
    expect(extra * (BEZEL.bottom / (BEZEL.top + BEZEL.bottom))).toBeGreaterThan(
      extra * (BEZEL.top / (BEZEL.top + BEZEL.bottom)),
    );
  });

  it("centres the board, because the layout top-aligns it", () => {
    const c = caseRect({ x: 50, y: 20, w: 300, h: 60 }, CANVAS);
    expect(c.y).toBeCloseTo((CANVAS.h - c.h) / 2, 6);
    expect(c.x).toBeCloseTo((CANVAS.w - c.w) / 2, 6);
  });

  it("scales with the board rather than being a fixed pixel count", () => {
    const bigBoard = { x: 0, y: 0, w: 300, h: 200 };
    const smallBoard = { x: 0, y: 0, w: 90, h: 60 };
    const big = caseRect(bigBoard, { w: 900, h: 600 });
    const small = caseRect(smallBoard, { w: 900, h: 600 });
    expect(big.h - bigBoard.h).toBeGreaterThan(small.h - smallBoard.h);
    expect(big.h - bigBoard.h).toBeCloseTo(
      200 * (BEZEL.top + BEZEL.bottom),
      6,
    );
  });

  it("takes the whole canvas rather than cropping the keys when it is too big", () => {
    const huge = caseRect({ x: 0, y: 0, w: 590, h: 195 }, CANVAS);
    expect(huge).toEqual({ x: 0, y: 0, w: 600, h: 200 });
  });

  it("accepts a custom bezel", () => {
    const board = { x: 50, y: 40, w: 300, h: 100 };
    const c = caseRect(board, CANVAS, { top: 0, bottom: 0, side: 0 });
    expect(c.w).toBe(board.w);
    expect(c.h).toBe(board.h);
    expect(c.x).toBeCloseTo((CANVAS.w - board.w) / 2, 6);
  });
});