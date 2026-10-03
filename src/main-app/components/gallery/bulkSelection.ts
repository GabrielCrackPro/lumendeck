// What a bulk action on a selection should actually do.
//
// Pure, because both of these were wrong in ways only a test catches, and
// neither was visible from the component: the selection bar's own tooltip says
// one thing and the code underneath did another.

/** An entry, or just enough of one to restore it. */
export interface Removable {
  id: string;
  addedMs: number;
}

/** Selected ids, without importing the whole selection model for one type. */
export type Selected = ReadonlySet<string>;

/** Vault order, so every bulk action resolves the same selection identically. */
function byAge<T extends Removable>(a: T, b: T): number {
  return a.addedMs - b.addedMs || a.id.localeCompare(b.id);
}

/**
 * The single entry a bulk apply should set, and how many it stands for.
 *
 * Applying each selected wallpaper in turn ends in exactly the same place as
 * applying only the newest one, and costs one wallpaper change per item on the
 * way there -- for a five-item selection that is five full decodes on every
 * display, with a toast for each. `applyOrder`'s own contract already said the
 * caller applies the last one; the caller applied all of them.
 *
 * Ordering by `addedMs` so the same selection always ends on the same
 * wallpaper however it was built. A run picked with Shift and the same run
 * Ctrl-clicked are the same set and must not disagree about the result.
 */
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

/**
 * The entries a bulk delete should remove, in the order to remove them.
 *
 * Unlike the apply, a delete genuinely has to happen once per entry -- there is
 * no "last one wins" to collapse it onto. What can be collapsed is the *noise*:
 * see `restoreEntries`.
 *
 * Deduplicated by id. The backend keys the vault by id so this cannot happen
 * today, but the caller loops the result into one `gallery_remove` call each,
 * and a repeated id would delete twice -- the second failing, and failing
 * visibly, for something the user did not do twice. Guaranteeing it here costs
 * one Set and keeps that assumption off the caller.
 */
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

/**
 * Put removed entries back into a vault, for one undo rather than many.
 *
 * Appended rather than spliced back to their old index: `selectGallery` orders
 * by `addedMs` or by name and never by array position, so the index an entry
 * happened to occupy is not observable anywhere. What *is* observable is the
 * undo count -- the bulk path raised one toast per deleted wallpaper, so taking
 * back a five-item delete meant pressing Undo five times and watching five cards
 * stack up in the corner.
 */
export function restoreEntries<T extends Removable>(vault: T[], removed: readonly T[]): T[] {
  if (removed.length === 0) return vault;
  return [...vault, ...removed];
}

/**
 * The ids a bulk delete should send.
 *
 * Iterating the *entries* rather than the selection is the point: a selected
 * entry removed from the vault by anything other than the user leaves a stale id
 * in the set, and a delete sent for it is a backend error rendered to someone
 * who did not cause it.
 */
export function removableIds<T extends Removable>(
  entries: readonly T[],
  selected: Selected,
): string[] {
  return bulkRemovePlan(entries, selected).map((e) => e.id);
}