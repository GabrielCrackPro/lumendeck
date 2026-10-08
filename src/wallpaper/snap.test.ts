import { describe, expect, it } from "vitest";
import { applySnap, snapResizeAxis, type Rect, type SnapOptions } from "./snap";

const base: SnapOptions = {
  snapToGrid: false,
  snapToShapes: true,
  gridSize: 32,
  threshold: 8,
  others: [],
  monitors: [],
};

const at = (x: number, y: number, w = 100, h = 80): Rect => ({ x, y, w, h });

describe("applySnap — alignment guides", () => {
  it("snaps left edge to another sticker's left edge", () => {
    const others = [at(500, 300)];
    const { rect, guides } = applySnap(at(506, 100), { ...base, others });
    expect(rect.x).toBe(500);
    expect(guides).toContainEqual({ axis: "v", pos: 500 });
  });

  it("snaps right edge to another sticker's right edge", () => {
    const others = [at(500, 300, 200, 100)];
    const { rect, guides } = applySnap(at(609, 100, 95, 100), { ...base, others });
    expect(rect.x).toBe(605);
    expect(guides).toContainEqual({ axis: "v", pos: 700 });
  });

  it("snaps left edge to another sticker's center line", () => {
    const others = [at(500, 300, 200, 100)];
    const { rect, guides } = applySnap(at(594, 100), { ...base, others });
    expect(rect.x).toBe(600);
    expect(guides).toContainEqual({ axis: "v", pos: 600 });
  });

  it("snaps both axes independently", () => {
    const others = [at(500, 300)];
    const { rect, guides } = applySnap(at(505, 294), { ...base, others });
    expect(rect.x).toBe(500);
    expect(rect.y).toBe(300);
    expect(guides).toEqual([
      { axis: "v", pos: 500 },
      { axis: "h", pos: 300 },
    ]);
  });

  it("snaps to monitor edges and centers", () => {
    const monitors = [at(0, 0, 1920, 1080)];
    const { rect, guides } = applySnap(at(956, 100), { ...base, monitors });
    expect(rect.x).toBe(960);
    expect(guides).toContainEqual({ axis: "v", pos: 960 });
  });

  it("ignores lines beyond threshold", () => {
    const others = [at(600, 300)];
    const { rect, guides } = applySnap(at(620, 100), { ...base, others });
    expect(rect.x).toBe(620);
    expect(guides).toEqual([]);
  });

  it("picks the closest matching line", () => {
    const others = [at(500, 300), at(506, 300)];
    const { rect } = applySnap(at(510, 100), { ...base, others });
    expect(rect.x).toBe(506);
  });
});

describe("applySnap — grid", () => {
  const grid = { ...base, snapToGrid: true, gridSize: 32 };

  it("rounds to the nearest grid line when no alignment matches", () => {
    const { rect, guides } = applySnap(at(36, 0), { ...grid, others: [at(200, 0)] });
    expect(rect.x).toBe(32);
    expect(guides).toContainEqual({ axis: "v", pos: 32 });
  });

  it("alignment guides win over the grid", () => {
    const { rect, guides } = applySnap(at(498, 0), { ...grid, others: [at(500, 0)] });
    expect(rect.x).toBe(500);
    expect(guides).toContainEqual({ axis: "v", pos: 500 });
  });

  it("does not snap when snapping is disabled", () => {
    const off = { ...base, snapToGrid: false, snapToShapes: false };
    const { rect, guides } = applySnap(at(36, 0), off);
    expect(rect.x).toBe(36);
    expect(guides).toEqual([]);
  });
});

describe("snapResizeAxis", () => {
  it("snaps the moving right edge to a neighbor's edge", () => {
    const o = { ...base, others: [at(500, 0)] };
    const r = snapResizeAxis(504, 400, true, 24, o);
    expect(r.edge).toBe(500);
    expect(r.size).toBe(100);
    expect(r.guide).toBe(500);
  });

  it("keeps the fixed edge when resizing from the left", () => {
    const o = { ...base, others: [at(100, 0)] };
    const r = snapResizeAxis(104, 200, true, 24, o);
    expect(r.edge).toBe(100);
    expect(r.size).toBe(100);
    expect(r.guide).toBe(100);
  });

  it("enforces minimum size after snapping (moving edge right of fixed)", () => {
    const r = snapResizeAxis(103, 100, true, 24, base);
    expect(r.size).toBe(24);
    expect(r.edge).toBe(124);
  });

  it("enforces minimum size after snapping (moving edge left of fixed)", () => {
    const r = snapResizeAxis(94, 100, true, 24, base);
    expect(r.size).toBe(24);
    expect(r.edge).toBe(76);
  });

  it("snaps to grid when no shapes match", () => {
    const o = { ...base, snapToGrid: true, gridSize: 32 };
    const r = snapResizeAxis(36, 0, true, 24, o);
    expect(r.edge).toBe(32);
    expect(r.size).toBe(32);
  });
});
