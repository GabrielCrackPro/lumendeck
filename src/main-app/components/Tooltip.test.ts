import { describe, expect, it } from "vitest";
import {
  TIP_DELAY_MS,
  resolveTooltipPlacement,
  shouldShowTooltip,
  type Rect,
  type Size,
} from "./Tooltip";

const VIEWPORT: Size = { width: 1000, height: 800 };
/** A tooltip long enough that centring it on an edge target would overflow. */
const TIP: Size = { width: 160, height: 28 };

/** A target of `width` x `height` with its top-left at (x, y). */
function target(x: number, y: number, width = 32, height = 32): Rect {
  return { x, y, width, height };
}

describe("resolveTooltipPlacement", () => {
  it("centres on the target when the preferred side fits", () => {
    const t = target(500, 400);
    const p = resolveTooltipPlacement(t, TIP, VIEWPORT, "top");
    expect(p.side).toBe("top");
    // Horizontally centred: the tooltip's midpoint is the target's.
    expect(p.x + TIP.width / 2).toBe(t.x + t.width / 2);
    // Above the target, with the gap between them.
    expect(p.y + TIP.height).toBe(t.y - 8);
  });

  it("flips below when there is no room above", () => {
    // A target near the top of the window: above would be cut off.
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
    // The failure a sloppy `>` would introduce: flipping a tooltip that had
    // room, so it jumps to the other side of a control near a window edge for
    // no reason.
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
    // Centred on a target in the corner, the tooltip would hang off two edges.
    const p = resolveTooltipPlacement(target(0, 0), TIP, VIEWPORT, "bottom");
    expect(p.x).toBeGreaterThanOrEqual(8);
    expect(p.y).toBeGreaterThanOrEqual(8);
  });

  it("never renders off-screen when neither side fits", () => {
    // A target taller than the window has no correct side. Being on-screen and
    // slightly wrong beats being clipped and unreadable.
    const tall = target(100, 0, 32, VIEWPORT.height + 400);
    const p = resolveTooltipPlacement(tall, TIP, VIEWPORT, "top");
    expect(p.y).toBeGreaterThanOrEqual(8);
    expect(p.y).toBeLessThanOrEqual(VIEWPORT.height - TIP.height);
  });

  it("survives a viewport smaller than the tooltip", () => {
    // Minimum-size windows and split-screen columns are both real here.
    const tiny: Size = { width: 120, height: 60 };
    const p = resolveTooltipPlacement(target(10, 10, 20, 20), TIP, tiny, "top");
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(8);
  });

  it("measures from the viewport, not the document", () => {
    // Fixed positioning uses client coordinates, and the card lives inside a
    // scrolling pane, so adding scroll offsets would place it near enough and
    // eventually far enough to be wrong.
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
    // Every caller passes a translated string that can legitimately be empty —
    // a track with no title, a device not named yet. An empty tooltip is an
    // unexplained rectangle after a hover delay, which is worse than nothing.
    for (const v of ["", "   ", null, undefined]) {
      expect(shouldShowTooltip(v as string)).toBe(false);
    }
  });
});

describe("TIP_DELAY_MS", () => {
  it("is long enough that sweeping the pointer does not flash tooltips", () => {
    // A tooltip on contact makes a toolbar feel twitchy; below roughly a third
    // of a second a cursor crossing a row triggers several.
    expect(TIP_DELAY_MS).toBeGreaterThanOrEqual(300);
    expect(TIP_DELAY_MS).toBeLessThan(1000);
  });
});
