import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Placement maths for the portalled dropdown panel.
//
// The panel used to be `position: absolute` inside the trigger's wrapper. That
// put it in the trigger's stacking context and under the trigger's own clipping,
// so any ancestor with `overflow: hidden` cut the option list in half — the
// keyboard preview, which rounds its stage with `overflow-hidden`, lost the
// bottom of every menu. A dropdown in a scrolling list had the same problem one
// scroll away, and no amount of `z-index` fixes either, because both are
// containment rather than paint order.
//
// So the panel is portalled to `document.body` and positioned from the trigger's
// viewport rect instead. That is only possible if the placement is computed
// rather than declared in CSS, which is what this module is.
//
// Pure and DOM-free so it can be tested: vitest runs with no document, so a
// function that called `getBoundingClientRect` could only be checked by reading
// the source.

/** The bits of a rect this module needs, so callers can pass anything shaped like one. */
export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
}

/** How much room the panel may use before it has to scroll. */
export const PANEL_MAX_H = 256; // max-h-64
/** Gap between the trigger and the panel, matching the old `top-[calc(100%+4px)]`. */
export const GAP = 4;
/** Distance kept from the viewport edge, so a panel never sits flush to it. */
export const EDGE = 8;

/**
 * Which horizontal edge of the trigger the panel lines up with.
 *
 * `right` is for a menu owned by a control at the end of a row: aligned by its
 * right edge it hangs off the trigger the way a native menu does, where left
 * alignment would push it past the edge of a narrow window.
 */
export type Align = "left" | "right";

export interface Placement {
  top: number;
  left: number;
  /** Which horizontal edge the panel was aligned to. */
  align: Align;
  /** Measured panel width, needed to align by the right edge. */
  width: number;
  maxHeight: number;
  /** Which side of the trigger the panel opened on. */
  side: "below" | "above";
}

/**
 * Where to put a panel of `panelH` so it is fully on screen and beside its
 * trigger.
 *
 * Two rules, in order:
 *
 * 1. Open below unless below would not fit, and above would. Not "always below":
 *    a trigger near the bottom of the window would open a panel that is mostly
 *    off-screen, and scrolling a fixed panel into reach is worse than flipping.
 * 2. Clamp to the viewport, so a trigger near the right edge gets a panel that
 *    slides left rather than one whose options cannot be clicked.
 *
 * The height is capped at what actually fits. A list taller than the space
 * available scrolls (the panel keeps `overflow-y-auto`) rather than overflowing,
 * which is what `max-h-64` used to guarantee unconditionally.
 */
export function placeDropdown(
  trigger: Rect,
  panelH: number,
  viewportW: number,
  viewportH: number,
  align: Align = "left",
  panelW = 0,
): Placement {
  const below = viewportH - trigger.bottom - GAP - EDGE;
  const above = trigger.top - GAP - EDGE;
  // Prefer below on a tie: it is the position the old CSS always used, so
  // flipping only where it has to keeps the change invisible where nothing was
  // wrong.
  const side: "below" | "above" =
    below >= Math.min(panelH, above) || above <= 0 ? "below" : "above";

  const room = side === "below" ? below : above;
  const maxHeight = Math.max(0, Math.min(PANEL_MAX_H, room));

  const top =
    side === "below" ? trigger.bottom + GAP : trigger.top - GAP - maxHeight;

  // Aligned to the trigger, then pulled back inside the viewport.
  //
  // The clamp is `>= EDGE` rather than also clamping the right edge, because
  // the panel keeps its CSS width and this function does not know it until it
  // has been laid out. A panel near the right edge therefore slides left as
  // far as it can rather than being allowed to hang off screen.
  const preferred = align === "right" ? trigger.right - panelW : trigger.left;
  const left = Math.max(EDGE, Math.min(preferred, viewportW - EDGE));

  return { top: Math.max(EDGE, top), left, maxHeight, side, align, width: panelW };
}

/** The `style` object for the panel, given a placement. */
export function panelStyle(p: Placement): {
  top: number;
  left: number;
  maxHeight: number;
  width?: number;
} {
  // Width is passed through only when known, so an unmeasured panel does not
  // get an explicit 0 and collapse.
  return p.width
    ? { top: p.top, left: p.left, maxHeight: p.maxHeight, width: p.width }
    : { top: p.top, left: p.left, maxHeight: p.maxHeight };
}

/**
 * A rect standing in for "no measurement yet".
 *
 * The panel renders before its first measurement can land, and `position: fixed`
 * with no coordinates puts it at the viewport's top-left corner for one frame —
 * a visible flash at 0,0 on every open. Hiding it until measured avoids that,
 * and this is the value the style starts from.
 */
export const UNMEASURED = -9999;
// ---------------------------------------------------------------------------
// The hook every anchored panel uses.
// ---------------------------------------------------------------------------


export interface PanelBox {
  top: number;
  left: number;
  maxHeight: number;
  width?: number;
}

/**
 * Positions a portalled panel against its trigger.
 *
 * One hook for all three anchored panels in the app — the select dropdown, the
 * gallery's collection menu and its per-card action menu — so the flip-above,
 * edge-clamp and re-measure-on-scroll rules are stated once. Three copies of
 * this is how they drift apart.
 *
 * Returns the ref to put on the panel, the style to give it, and whether it has
 * been measured yet.
 */
export function useAnchoredPanel(
  triggerRef: React.RefObject<HTMLElement | null>,
  shown: boolean,
  align: Align = "left",
) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<PanelBox | null>(null);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect() as DOMRect & Rect;
    const panel = panelRef.current;
    // Natural size once laid out, else the cap: flipping above needs a height to
    // decide against, and an unrendered panel has none.
    const wanted = panel?.scrollHeight || PANEL_MAX_H;
    const wide = panel?.offsetWidth || 0;
    setBox(
      panelStyle(placeDropdown(r, wanted, window.innerWidth, window.innerHeight, align, wide)),
    );
  }, [align, triggerRef]);

  // Layout rather than passive effect, so the panel is placed before the browser
  // paints it. A passive effect leaves one frame at the fallback position.
  useLayoutEffect(() => {
    if (!shown) {
      setBox(null);
      return;
    }
    measure();
  }, [shown, measure]);

  // Fixed to the viewport, so scrolling leaves the panel behind its trigger.
  // Capture phase, because the scroll that matters is often an inner list's.
  useEffect(() => {
    if (!shown) return;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [shown, measure]);

  const style: React.CSSProperties = box
    ? { position: "fixed", top: box.top, left: box.left, maxHeight: box.maxHeight, width: box.width }
    : { position: "fixed", top: UNMEASURED, left: UNMEASURED, maxHeight: PANEL_MAX_H };

  return { panelRef, style, measured: box !== null };
}
