
export type SelectedIds = ReadonlySet<string>;

export interface Selection {
  selected: SelectedIds;
  anchor: string | null;
}

export interface ClickModifiers {
  shift?: boolean;
  ctrl?: boolean;
}

export interface SelectionStep {
  selected: SelectedIds;
  anchor: string | null;
}

export function emptySelection(): Selection {
  return { selected: new Set(), anchor: null };
}

export function selectOne(id: string): Selection {
  return { selected: new Set([id]), anchor: id };
}

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

export function applyClick(
  selection: Selection,
  visibleIds: readonly string[],
  id: string,
  mods: ClickModifiers = {},
): SelectionStep {
  if (mods.shift) {
    const run = selection.anchor === null ? null : spanBetween(visibleIds, selection.anchor, id);
    if (run === null) {
      return selectOne(id);
    }
    const next = new Set(selection.selected);
    if (mods.ctrl) for (const spanId of run) next.add(spanId);
    else return { selected: new Set(run), anchor: selection.anchor };
    return { selected: next, anchor: selection.anchor };
  }

  if (mods.ctrl) {
    const next = new Set(selection.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { selected: next, anchor: id };
  }

  return selectOne(id);
}

export function clearSelection(): Selection {
  return emptySelection();
}

export function selectAll(visibleIds: readonly string[], want: boolean): SelectionStep {
  return want
    ? { selected: new Set(visibleIds), anchor: visibleIds[0] ?? null }
    : emptySelection();
}

export type SelectAllState = "none" | "some" | "all";

export function selectAllState(selected: SelectedIds, visibleIds: readonly string[]): SelectAllState {
  if (visibleIds.length === 0) return "none";
  let hit = 0;
  for (const id of visibleIds) if (selected.has(id)) hit += 1;
  if (hit === 0) return "none";
  return hit === visibleIds.length ? "all" : "some";
}

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

export function anchorIsVisible(visibleIds: readonly string[], anchor: string | null): boolean {
  return anchor !== null && visibleIds.includes(anchor);
}
