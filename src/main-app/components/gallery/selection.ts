// What is selected in the vault grid, and what a click does to it.
//
// This replaces a model that had three separate selection concepts fighting
// each other: a single `selectedId` for the drawer, a keyboard `cursor` that
// moved without selecting anything, and a `checked` set for bulk actions. Each
// had its own key handling and its own idea of what a click meant, so the tile
// click applied the wallpaper while the corner checkbox did something else
// entirely.
//
// There is now one concept. The selection *is* a set of ids. A plain click
// replaces it with one id, Ctrl-click adds or removes one, Shift-click spans a
// run from the anchor. Applying is no longer a click at all -- it is an
// explicit act, because a selection you did not ask for should never change
// every display in the house.
//
// Everything here is pure so the rules can be tested without a DOM, which is
// the only reason they are trustworthy at this level of subtlety.

/** Ids currently selected. Never null, never undefined. */
export type SelectedIds = ReadonlySet<string>;

/** The whole selection, as the component holds it. */
export interface Selection {
  selected: SelectedIds;
  /**
   * Where a Shift-click spans from.
   *
   * Separate from `selected` because it is a *position*, not a membership: the
   * tile it names may already have been deselected, and it survives a filter
   * change that hides it. When it is no longer on screen the span cannot be
   * computed, and the caller falls back to a plain select.
   */
  anchor: string | null;
}

/** Modifiers on a click. */
export interface ClickModifiers {
  shift?: boolean;
  ctrl?: boolean;
}

/** One click's worth of change. */
export interface SelectionStep {
  selected: SelectedIds;
  anchor: string | null;
}

/** An empty selection, ready to hand to `useState`. */
export function emptySelection(): Selection {
  return { selected: new Set(), anchor: null };
}

/** A selection of exactly one entry, which is also the anchor. */
export function selectOne(id: string): Selection {
  return { selected: new Set([id]), anchor: id };
}

/**
 * Every id in the run between `anchor` and `target`, in the order on screen.
 *
 * Returns null when either end is not currently visible. That is the normal
 * case rather than an edge case: the grid is paged and the filter can hide
 * anything, so the anchor is regularly off-screen. Returning null is how the
 * caller knows to degrade deliberately instead of spanning against a position
 * that no longer exists.
 */
export function spanBetween(
  visibleIds: readonly string[],
  anchor: string,
  target: string,
): string[] | null {
  const a = visibleIds.indexOf(anchor);
  const b = visibleIds.indexOf(target);
  if (a < 0 || b < 0) return null;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return visibleIds.slice(lo, hi + 1);
}

/**
 * Apply one click to the selection.
 *
 * `visibleIds` is the grid in the order it is drawn right now, which is what
 * "between" means to someone looking at it. It is a slice of the full vault, so
 * a run never spans past the current page.
 */
export function applyClick(
  selection: Selection,
  visibleIds: readonly string[],
  id: string,
  mods: ClickModifiers = {},
): SelectionStep {
  // Shift-click: span from the anchor and *replace*, because replacing is the
  // only way to shrink a selection with a mouse. Ctrl is what buys back
  // additive spans, which is why both modifiers are carried.
  if (mods.shift) {
    const run = selection.anchor === null ? null : spanBetween(visibleIds, selection.anchor, id);
    if (run === null) {
      // No usable anchor -- select this tile and adopt it as one, so the next
      // Shift-click spans from here instead of degrading again.
      return selectOne(id);
    }
    const next = new Set(selection.selected);
    if (mods.ctrl) for (const spanId of run) next.add(spanId);
    else return { selected: new Set(run), anchor: selection.anchor };
    return { selected: next, anchor: selection.anchor };
  }

  // Ctrl-click: add this tile, or take it out, leaving the rest alone. The
  // anchor still moves, so a following Shift-click spans from the tile just
  // touched rather than one the user can no longer see.
  if (mods.ctrl) {
    const next = new Set(selection.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { selected: next, anchor: id };
  }

  // Plain click: this tile, and only this tile. Re-clicking the selected tile
  // keeps it selected rather than clearing, because "click what is already
  // selected to deselect it" is a guess, and clearing the selection out from
  // under someone who is about to press Apply is the expensive way to be wrong.
  return selectOne(id);
}

/** Empty the selection and forget the anchor. */
export function clearSelection(): Selection {
  return emptySelection();
}

/**
 * Select everything in `ids`, or clear the selection entirely.
 *
 * Scoped to `ids` rather than the whole vault, so a filter is not a way to
 * accidentally apply three hundred wallpapers. Clearing is deliberately
 * absolute: Ctrl+A followed by Ctrl+A again should leave nothing selected, and
 * keeping a hidden remainder would make the second press look broken.
 */
export function selectAll(visibleIds: readonly string[], want: boolean): SelectionStep {
  return want
    ? { selected: new Set(visibleIds), anchor: visibleIds[0] ?? null }
    : emptySelection();
}

/** Whether the select-all control reads empty, mixed or full. */
export type SelectAllState = "none" | "some" | "all";

/** How much of `visibleIds` is selected. */
export function selectAllState(selected: SelectedIds, visibleIds: readonly string[]): SelectAllState {
  // An empty grid is "none", never vacuously "all" -- otherwise the control
  // reads as ticked before the user has done anything.
  if (visibleIds.length === 0) return "none";
  let hit = 0;
  for (const id of visibleIds) if (selected.has(id)) hit += 1;
  if (hit === 0) return "none";
  return hit === visibleIds.length ? "all" : "some";
}

/**
 * Drop selected ids that are gone, keeping the anchor only if it survived.
 *
 * A span from a deleted tile has no position, and leaving the anchor behind
 * makes every later Shift-click quietly degrade into a plain select.
 */
export function pruneSelection(
  selection: Selection,
  liveIds: readonly string[],
): Selection {
  const live = new Set(liveIds);
  const next = new Set<string>();
  for (const id of selection.selected) if (live.has(id)) next.add(id);
  const anchor = selection.anchor !== null && live.has(selection.anchor) ? selection.anchor : null;
  return { selected: next, anchor };
}

/** Whether the anchor still names something on screen. */
export function anchorIsVisible(visibleIds: readonly string[], anchor: string | null): boolean {
  return anchor !== null && visibleIds.includes(anchor);
}

/**
 * The entries to apply, in a stable order.
 *
 * Ordered by the vault rather than by click order, so applying a selection
 * gives the same result however it was built. The caller applies the last one,
 * so "last" is the most recently added wallpaper, not an arbitrary one.
 */
export function applyOrder<T extends { id: string; addedMs: number }>(
  entries: readonly T[],
  selected: SelectedIds,
): T[] {
  return entries
    .filter((e) => selected.has(e.id))
    .sort((a, b) => a.addedMs - b.addedMs || a.id.localeCompare(b.id));
}