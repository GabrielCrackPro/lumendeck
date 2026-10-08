
export interface Removable {
  id: string;
  addedMs: number;
}

export type Selected = ReadonlySet<string>;

function byAge<T extends Removable>(a: T, b: T): number {
  return a.addedMs - b.addedMs || a.id.localeCompare(b.id);
}

export function bulkApplyPlan<T extends Removable>(
  entries: readonly T[],
  selected: Selected,
): { apply: T | null; collapsed: number } {
  const ordered = entries.filter((e) => selected.has(e.id)).sort(byAge);
  return {
    apply: ordered.length ? ordered[ordered.length - 1]! : null,
    collapsed: ordered.length,
  };
}

export function bulkRemovePlan<T extends Removable>(
  entries: readonly T[],
  selected: Selected,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of entries) {
    if (!selected.has(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out.sort(byAge);
}

export function restoreEntries<T extends Removable>(vault: T[], removed: readonly T[]): T[] {
  if (removed.length === 0) return vault;
  return [...vault, ...removed];
}

export function removableIds<T extends Removable>(
  entries: readonly T[],
  selected: Selected,
): string[] {
  return bulkRemovePlan(entries, selected).map((e) => e.id);
}