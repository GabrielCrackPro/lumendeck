import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";


export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
}

export const PANEL_MAX_H = 256;
export const GAP = 4;
export const EDGE = 8;

export type Align = "left" | "right";

export interface Placement {
  top: number;
  left: number;
  align: Align;
  width: number;
  maxHeight: number;
  side: "below" | "above";
}

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
  const side: "below" | "above" =
    below >= Math.min(panelH, above) || above <= 0 ? "below" : "above";

  const room = side === "below" ? below : above;
  const maxHeight = Math.max(0, Math.min(PANEL_MAX_H, room));

  const top =
    side === "below" ? trigger.bottom + GAP : trigger.top - GAP - maxHeight;

  const preferred = align === "right" ? trigger.right - panelW : trigger.left;
  const left = Math.max(EDGE, Math.min(preferred, viewportW - EDGE));

  return { top: Math.max(EDGE, top), left, maxHeight, side, align, width: panelW };
}

export function panelStyle(p: Placement): {
  top: number;
  left: number;
  maxHeight: number;
  width?: number;
} {
  return p.width
    ? { top: p.top, left: p.left, maxHeight: p.maxHeight, width: p.width }
    : { top: p.top, left: p.left, maxHeight: p.maxHeight };
}

export const UNMEASURED = -9999;


export interface PanelBox {
  top: number;
  left: number;
  maxHeight: number;
  width?: number;
}

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
    const wanted = panel?.scrollHeight || PANEL_MAX_H;
    const wide = panel?.offsetWidth || 0;
    setBox(
      panelStyle(placeDropdown(r, wanted, window.innerWidth, window.innerHeight, align, wide)),
    );
  }, [align, triggerRef]);

  useLayoutEffect(() => {
    if (!shown) {
      setBox(null);
      return;
    }
    measure();
  }, [shown, measure]);

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
