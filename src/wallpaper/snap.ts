/**
 * Snap-to-grid + smart alignment guides for the sticker editor.
 *
 * Pure functions over virtual-screen physical px so they're unit-testable.
 * `applySnap` quantizes a sticker rect against:
 *  1. other stickers' left/center/right and top/middle/bottom edges,
 *  2. monitor edges and centers,
 *  3. the grid (when enabled) — only where no alignment line matched.
 * Each axis snaps independently. Returned guides are the *matched* lines so
 * the editor can draw them while dragging.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Guide {
  /** "v" = vertical line (x), "h" = horizontal line (y). */
  axis: "v" | "h";
  /** Physical px position of the line on the virtual screen. */
  pos: number;
}

export interface SnapOptions {
  snapToGrid: boolean;
  snapToShapes: boolean;
  gridSize: number;
  /** Snap threshold in physical px. */
  threshold: number;
  /** Other rects to align against (visible stickers). */
  others: Rect[];
  /** Monitor bounds (virtual-screen coords). */
  monitors: Rect[];
}

const EMPTY: SnapOptions = {
  snapToGrid: false,
  snapToShapes: false,
  gridSize: 32,
  threshold: 8,
  others: [],
  monitors: [],
};

/** Candidate x-lines for vertical-edge snapping. */
function vLines(o: SnapOptions): number[] {
  const out: number[] = [];
  if (!o.snapToShapes) return out;
  for (const b of o.others) out.push(b.x, b.x + b.w / 2, b.x + b.w);
  for (const m of o.monitors) out.push(m.x, m.x + m.w / 2, m.x + m.w);
  return out;
}

/** Candidate y-lines for horizontal-edge snapping. */
function hLines(o: SnapOptions): number[] {
  const out: number[] = [];
  if (!o.snapToShapes) return out;
  for (const b of o.others) out.push(b.y, b.y + b.h / 2, b.y + b.h);
  for (const m of o.monitors) out.push(m.y, m.y + m.h / 2, m.y + m.h);
  return out;
}

interface AxisSnap {
  delta: number;
  guides: number[];
}

/** Closest line within threshold of any edge; guides win over grid. */
function snapAxis(edges: number[], lines: number[], o: SnapOptions): AxisSnap {
  let best: { delta: number; guide: number } | null = null;

  if (o.snapToShapes) {
    for (const line of lines) {
      for (const e of edges) {
        const d = line - e;
        if (Math.abs(d) <= o.threshold && (!best || Math.abs(d) < Math.abs(best.delta))) {
          best = { delta: d, guide: line };
        }
      }
    }
  }

  if (o.snapToGrid && !best) {
    const g = Math.max(1, o.gridSize);
    for (const e of edges) {
      const snapped = Math.round(e / g) * g;
      const d = snapped - e;
      if (Math.abs(d) <= o.threshold && (!best || Math.abs(d) < Math.abs(best.delta))) {
        best = { delta: d, guide: snapped };
      }
    }
  }

  return best ? { delta: best.delta, guides: [best.guide] } : { delta: 0, guides: [] };
}

/** Apply grid + alignment snapping to a full rect (move gestures). */
export function applySnap(
  r: Rect,
  o: Partial<SnapOptions> = {},
): { rect: Rect; guides: Guide[] } {
  const opt = { ...EMPTY, ...o };
  const v = snapAxis([r.x, r.x + r.w], vLines(opt), opt);
  const h = snapAxis([r.y, r.y + r.h], hLines(opt), opt);
  const guides: Guide[] = [
    ...v.guides.map((pos): Guide => ({ axis: "v", pos })),
    ...h.guides.map((pos): Guide => ({ axis: "h", pos })),
  ];
  return {
    rect: { x: r.x + v.delta, y: r.y + h.delta, w: r.w, h: r.h },
    guides,
  };
}

/**
 * Snap a resize gesture on one axis: only the moving edge snaps; the
 * opposite edge stays put. Enforces a minimum size. Returns the snapped
 * moving-edge coordinate (and matched guide line, if any).
 */
export function snapResizeAxis(
  /** Moving edge position (x when horizontal, y otherwise). */
  edge: number,
  /** Opposite (fixed) edge position on the same axis. */
  fixedEdge: number,
  horizontal: boolean,
  minSize: number,
  o: Partial<SnapOptions> = {},
): { edge: number; size: number; guide: number | null } {
  const opt = { ...EMPTY, ...o };
  const lines = horizontal ? vLines(opt) : hLines(opt);

  let snapped = edge;
  let guide: number | null = null;

  if (opt.snapToShapes) {
    let bestD = Infinity;
    for (const line of lines) {
      const d = line - edge;
      if (Math.abs(d) <= opt.threshold && Math.abs(d) < bestD) {
        bestD = Math.abs(d);
        snapped = line;
        guide = line;
      }
    }
  }
  if (opt.snapToGrid && guide === null) {
    const g = Math.max(1, opt.gridSize);
    const gs = Math.round(edge / g) * g;
    if (Math.abs(gs - edge) <= opt.threshold) {
      snapped = gs;
      guide = gs;
    }
  }

  let size = Math.abs(snapped - fixedEdge);
  if (size < minSize) {
    size = minSize;
    snapped = fixedEdge + (edge >= fixedEdge ? minSize : -minSize);
  }
  return { edge: snapped, size, guide };
}
