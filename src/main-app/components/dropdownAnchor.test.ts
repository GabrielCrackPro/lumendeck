import { describe, expect, it } from "vitest";
import {
  EDGE,
  GAP,
  PANEL_MAX_H,
  UNMEASURED,
  panelStyle,
  placeDropdown,
  type Rect,
} from "./dropdownAnchor";

/** A trigger at a given top-left. */
const trigger = (top: number, left = 100, w = 120, h = 32): Rect => ({
  top,
  left,
  width: w,
  height: h,
  bottom: top + h,
  right: left + w,
});

const VIEW_W = 1000;
const VIEW_H = 800;

describe("placeDropdown", () => {
  it("opens below the trigger when there is room", () => {
    const p = placeDropdown(trigger(100), 200, VIEW_W, VIEW_H);
    expect(p.side).toBe("below");
    expect(p.top).toBe(100 + 32 + GAP);
    expect(p.left).toBe(100);
  });

  it("flips above when below would not fit", () => {
    // Trigger near the bottom: 200px of panel cannot go under it.
    const p = placeDropdown(trigger(760), 200, VIEW_W, VIEW_H);
    expect(p.side).toBe("above");
    expect(p.top).toBeLessThan(760);
  });

  it("caps the height to the room available rather than overflowing", () => {
    // A trigger low in a tall window, with a panel taller than the cap. It opens
    // below because `above` is the larger space, and the cap holds the panel to
    // what actually fits -- so it scrolls rather than running off the window.
    const p = placeDropdown(trigger(700), PANEL_MAX_H, VIEW_W, VIEW_H);
    expect(p.side).toBe("above");
    expect(p.maxHeight).toBe(PANEL_MAX_H);

    const tight = placeDropdown(trigger(100), PANEL_MAX_H, VIEW_W, 300);
    expect(tight.side).toBe("below");
    expect(tight.maxHeight).toBe(300 - (100 + 32) - GAP - EDGE);
    expect(tight.maxHeight).toBeLessThan(PANEL_MAX_H);
    expect(tight.maxHeight).toBeGreaterThan(0);
  });

  it("never exceeds the design cap even with room to spare", () => {
    const p = placeDropdown(trigger(10), 5000, VIEW_W, VIEW_H);
    expect(p.maxHeight).toBe(PANEL_MAX_H);
  });

  it("keeps the panel inside the left edge", () => {
    const p = placeDropdown(trigger(100, 900), 200, VIEW_W, VIEW_H);
    expect(p.left).toBeLessThanOrEqual(VIEW_W - EDGE);
  });

  it("keeps the panel inside the top edge", () => {
    const p = placeDropdown(trigger(0, 100), 200, VIEW_W, VIEW_H);
    expect(p.top).toBeGreaterThanOrEqual(EDGE);
  });

  it("does not go negative when the trigger is off-screen above", () => {
    // A trigger scrolled partly out of view: `top` can be negative.
    const p = placeDropdown(trigger(-40), 200, VIEW_W, VIEW_H);
    expect(p.top).toBeGreaterThanOrEqual(EDGE);
    expect(Number.isFinite(p.top)).toBe(true);
  });

  it("prefers below when both sides would fit", () => {
    // Mid-window: either side has room, and the old CSS always opened below.
    const p = placeDropdown(trigger(380), 100, VIEW_W, VIEW_H);
    expect(p.side).toBe("below");
  });

  it("gives a non-zero height even when the trigger is at the very bottom", () => {
    // The degenerate case the keyboard preview hit. A maxHeight of 0 would render
    // an invisible panel, which is worse than a short one.
    const p = placeDropdown(trigger(790), 200, VIEW_W, VIEW_H);
    expect(p.side).toBe("above");
    expect(p.maxHeight).toBeGreaterThan(0);
  });

  it("returns finite coordinates for every trigger position", () => {
    // A fuzz over the whole viewport, because a NaN here becomes a panel at an
    // unreachable place with no error anywhere.
    for (let top = -100; top <= VIEW_H; top += 37) {
      for (const left of [-50, 0, 500, VIEW_W - 10]) {
        const p = placeDropdown(trigger(top, left), 200, VIEW_W, VIEW_H);
        expect(Number.isFinite(p.top)).toBe(true);
        expect(Number.isFinite(p.left)).toBe(true);
        expect(Number.isFinite(p.maxHeight)).toBe(true);
        expect(p.maxHeight).toBeGreaterThanOrEqual(0);
        expect(p.top).toBeGreaterThanOrEqual(EDGE);
        expect(p.left).toBeGreaterThanOrEqual(EDGE);
      }
    }
  });
});

describe("panelStyle", () => {
  it("carries exactly the three properties the panel needs", () => {
    const p = placeDropdown(trigger(100), 200, VIEW_W, VIEW_H);
    expect(panelStyle(p)).toEqual({
      top: p.top,
      left: p.left,
      maxHeight: p.maxHeight,
    });
  });
});

describe("UNMEASURED", () => {
  it("is off-screen, so an unplaced panel cannot flash at the origin", () => {
    // The failure this guards: `position: fixed` with no coordinates lands at the
    // viewport's top-left corner, which on every open is a visible flicker.
    expect(UNMEASURED).toBeLessThan(0);
  });
});
// The per-card action menu hangs off the trailing half of a chip, so it aligns
// by its right edge. Left-aligning that one pushes it past a narrow window.
describe("alignment", () => {
  const t = trigger(100, 600, 120, 32);

  it("aligns by the left edge by default", () => {
    const p = placeDropdown(t, 200, VIEW_W, VIEW_H);
    expect(p.align).toBe("left");
    expect(p.left).toBe(600);
  });

  it("aligns by the right edge when asked", () => {
    const p = placeDropdown(t, 200, VIEW_W, VIEW_H, "right", 144);
    expect(p.align).toBe("right");
    // Right edges line up: 600 + 120 - 144.
    expect(p.left + 144).toBe(t.right);
  });

  it("clamps rather than hanging off when right alignment does not fit", () => {
    // Trigger hard against the left edge: `right - width` is negative, and
    // honouring it would put the menu off-screen.
    const edge = trigger(100, 8, 120, 32);
    const p = placeDropdown(edge, 200, VIEW_W, VIEW_H, "right", 144);
    expect(p.left).toBe(EDGE);
    expect(p.left).toBeGreaterThanOrEqual(0);
  });

  it("reports the width it was given", () => {
    expect(placeDropdown(t, 200, VIEW_W, VIEW_H, "right", 144).width).toBe(144);
  });

  it("carries width into the style only when measured", () => {
    // An unmeasured panel must not be pinned to width 0, which would collapse it.
    expect(panelStyle(placeDropdown(t, 200, VIEW_W, VIEW_H))).not.toHaveProperty(
      "width",
    );
    expect(
      panelStyle(placeDropdown(t, 200, VIEW_W, VIEW_H, "right", 144)),
    ).toHaveProperty("width", 144);
  });
});
