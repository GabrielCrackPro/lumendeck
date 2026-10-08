import { describe, expect, it } from "vitest";
import {
  TIP_DELAY_MS,
  resolveTooltipPlacement,
  shouldShowTooltip,
  type Rect,
  type Size,
} from "./Tooltip";

const VIEWPORT: Size = { width: 1000, height: 800 };
const TIP: Size = { width: 160, height: 28 };

function target(x: number, y: number, width = 32, height = 32): Rect {
  return { x, y, width, height };
}

describe("resolveTooltipPlacement", () => {
  it("centres on the target when the preferred side fits", () => {
    const t = target(500, 400);
    const p = resolveTooltipPlacement(t, TIP, VIEWPORT, "top");
    expect(p.side).toBe("top");
    expect(p.x + TIP.width / 2).toBe(t.x + t.width / 2);
    expect(p.y + TIP.height).toBe(t.y - 8);
  });

  it("flips below when there is no room above", () => {
    const t = target(500, 2);
    const p = resolveTooltipPlacement(t, TIP, VIEWPORT, "top");
    expect(p.side).toBe("bottom");
    expect(p.y).toBe(t.y + t.height + 8);
  });

  it("flips above when there is no room below", () => {
    const t = target(500, 790, 32, 8);
    const p = resolveTooltipPlacement(t, TIP, VIEWPORT, "bottom");
    expect(p.side).toBe("top");
  });

  it("keeps the preferred side when it only just fits", () => {
    const exact = target(500, TIP.height + 8);
    expect(resolveTooltipPlacement(exact, TIP, VIEWPORT, "top").side).toBe("top");
  });

  it("flips horizontally for a side label that would run off the edge", () => {
    const t = target(2, 400);
    const p = resolveTooltipPlacement(t, TIP, VIEWPORT, "left");
    expect(p.side).toBe("right");
    expect(p.x).toBe(t.x + t.width + 8);
  });

  it("keeps the tooltip inside the window on both axes", () => {
    const p = resolveTooltipPlacement(target(0, 0), TIP, VIEWPORT, "bottom");
    expect(p.x).toBeGreaterThanOrEqual(8);
    expect(p.y).toBeGreaterThanOrEqual(8);
  });

  it("never renders off-screen when neither side fits", () => {
    const tall = target(100, 0, 32, VIEWPORT.height + 400);
    const p = resolveTooltipPlacement(tall, TIP, VIEWPORT, "top");
    expect(p.y).toBeGreaterThanOrEqual(8);
    expect(p.y).toBeLessThanOrEqual(VIEWPORT.height - TIP.height);
  });

  it("survives a viewport smaller than the tooltip", () => {
    const tiny: Size = { width: 120, height: 60 };
    const p = resolveTooltipPlacement(target(10, 10, 20, 20), TIP, tiny, "top");
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(8);
  });

  it("measures from the viewport, not the document", () => {
    const p = resolveTooltipPlacement(target(500, 400), TIP, VIEWPORT, "top");
    expect(p.x).toBeLessThan(VIEWPORT.width);
    expect(p.y).toBeLessThan(VIEWPORT.height);
  });
});

describe("shouldShowTooltip", () => {
  it("shows a real label", () => {
    expect(shouldShowTooltip("Restart lighting")).toBe(true);
  });

  it("refuses an empty or blank label", () => {
    for (const v of ["", "   ", null, undefined]) {
      expect(shouldShowTooltip(v as string)).toBe(false);
    }
  });
});

describe("TIP_DELAY_MS", () => {
  it("is long enough that sweeping the pointer does not flash tooltips", () => {
    expect(TIP_DELAY_MS).toBeGreaterThanOrEqual(300);
    expect(TIP_DELAY_MS).toBeLessThan(1000);
  });
});
