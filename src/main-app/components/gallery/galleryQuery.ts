// Pure query logic for the wallpaper vault: what to show, and in what order.
//
// Kept out of the component so it can be tested without a DOM, and so the grid
// and the panel can agree on what "the current selection" means.

import type { GalleryEntry, WallpaperCollection, WallpaperKind } from "@shared/types";
import type { VaultIndex } from "./vaultIndex";

/** How the vault is ordered. Newest-first is the default because the common
 *  case is "I just added something, show it to me". */
export type GallerySort =
  | "recent"
  | "oldest"
  | "used"
  | "favourites"
  | "name"
  | "kind"
  | "resolution"
  | "length";

/** A shortcut filter that is not a kind and not a collection. */
export type GalleryPick = "all" | "favourites" | "uncollected";

export interface GalleryQuery {
  /** Free text over the entry name, case- and accent-insensitive. */
  search: string;
  /** Collection id, or "all" for the whole vault. */
  collection: string;
  /** Wallpaper kind, or "all". */
  kind: WallpaperKind | "all";
  sort: GallerySort;
  /**
   * Smallest width an entry may have, in pixels. Null is no floor.
   *
   * Needs the vault index to mean anything: an entry the index has not measured
   * is not "under the floor", it is unknown, and hiding it would make the
   * filter look like it is deleting things.
   */
  minWidth: number | null;
  picks: GalleryPick;
  /**
   * Monitor device name, or "all". The global wallpaper counts as being on
   * every display, so "what is on display 2" still finds it.
   */
  display: string;
}

/** Everything outside the query itself that filtering needs to know. */
export interface SelectContext {
  /** Resolution and length, keyed by source path. */
  index?: VaultIndex;
  /** Display device name -> its override, if any. */
  perMonitor?: Record<string, { kind: string; source: string } | undefined>;
  /** The global wallpaper, so it can count as running on any display. */
  globalKind?: WallpaperKind;
  globalSource?: string;
}

/** Diacritics stripped so "cancion" finds "canción". */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export const DEFAULT_QUERY: Omit<GalleryQuery, "collection"> = {
  search: "",
  kind: "all",
  sort: "recent",
  minWidth: null,
  picks: "all",
  display: "all",
};

export function isMember(
  entry: GalleryEntry,
  collections: WallpaperCollection[],
  collectionId: string,
): boolean {
  return collections.some((c) => c.id === collectionId && c.entryIds.includes(entry.id));
}

/** In any collection at all. This is what "uncollected" is the absence of. */
export function inAnyCollection(
  entry: GalleryEntry,
  collections: WallpaperCollection[],
): boolean {
  return collections.some((c) => c.entryIds.includes(entry.id));
}

/** Collections an entry belongs to, in vault order. Drives the dot on a card. */
export function collectionsOf(
  entry: GalleryEntry,
  collections: WallpaperCollection[],
): WallpaperCollection[] {
  return collections.filter((c) => c.entryIds.includes(entry.id));
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * The one filter. Both the grid and the kind counts run this, so the numbers on
 * the chips can never disagree with what clicking them would show — the bug you
 * get the moment each has its own copy of the rules.
 */
function matches(
  e: GalleryEntry,
  collections: WallpaperCollection[],
  q: GalleryQuery,
  ctx: SelectContext,
): boolean {
  if (q.kind !== "all" && e.kind !== q.kind) return false;
  if (q.collection !== "all" && !isMember(e, collections, q.collection)) return false;

  const needle = fold(q.search.trim());
  if (needle && !fold(e.name).includes(needle)) return false;

  if (q.picks === "favourites" && !e.favorite) return false;
  if (q.picks === "uncollected" && inAnyCollection(e, collections)) return false;

  if (q.display !== "all") {
    const o = ctx.perMonitor?.[q.display];
    const onIt = o && o.kind === e.kind && o.source === e.source;
    // The global wallpaper shows on every display that has no override, so
    // "what is on display 2" has to include the global one. Without this a
    // single-monitor setup looks permanently empty and you cannot find the
    // wallpaper you are actually looking at.
    const isGlobal =
      !o && ctx.globalKind !== undefined && e.kind === ctx.globalKind && e.source === ctx.globalSource;
    if (!onIt && !isGlobal) return false;
  }

  if (q.minWidth != null) {
    const meta = ctx.index?.[e.source];
    // Unmeasured means unknown, and unknown passes. A filter that quietly hides
    // everything it has not measured yet looks like data loss.
    if (meta && meta.width < q.minWidth) return false;
  }
  return true;
}

/**
 * Filter, then sort. Search matches the name only — matching on path or kind
 * would surface entries the user cannot recognise by the thing they typed.
 */
export function selectGallery(
  entries: GalleryEntry[],
  collections: WallpaperCollection[],
  q: GalleryQuery,
  ctx: SelectContext = {},
): GalleryEntry[] {
  const index = ctx.index ?? {};
  const filtered = entries.filter((e) => matches(e, collections, q, ctx));
  const sorted = [...filtered];

  switch (q.sort) {
    case "recent":
      // Ties are common: a folder import stamps every entry in the same
      // millisecond, so fall back to the name rather than leaving the order
      // dependent on the filesystem's enumeration.
      sorted.sort((a, b) => b.addedMs - a.addedMs || collator.compare(a.name, b.name));
      break;
    case "oldest":
      sorted.sort((a, b) => a.addedMs - b.addedMs || collator.compare(a.name, b.name));
      break;
    case "used":
      // What was on the screen, not what arrived in the vault. Never-applied
      // entries go last rather than pretending they were applied at epoch.
      sorted.sort((a, b) => (b.lastAppliedMs ?? -1) - (a.lastAppliedMs ?? -1)
        || collator.compare(a.name, b.name));
      break;
    case "favourites":
      sorted.sort((a, b) => Number(b.favorite) - Number(a.favorite)
        || b.addedMs - a.addedMs
        || collator.compare(a.name, b.name));
      break;
    case "name":
      sorted.sort((a, b) => collator.compare(a.name, b.name));
      break;
    case "kind":
      sorted.sort(
        (a, b) => a.kind.localeCompare(b.kind) || collator.compare(a.name, b.name),
      );
      break;
    // Both of these sort unmeasured entries last rather than pretending they
    // are zero. An empty duration is a still image and a real 0s video exists,
    // so "shortest first" putting a photo above a clip would be a lie.
    case "resolution":
      sorted.sort((a, b) => byMeasured(a, b, index, (m) => m.width * m.height));
      break;
    case "length":
      sorted.sort((a, b) => byMeasured(a, b, index, (m) => m.duration ?? 0));
      break;
  }
  return sorted;
}

/** Ascending by a measured fact, with unmeasured entries last. */
function byMeasured(
  a: GalleryEntry,
  b: GalleryEntry,
  index: VaultIndex,
  value: (m: VaultIndex[string]) => number,
): number {
  const ma = index[a.source];
  const mb = index[b.source];
  if (!ma && !mb) return collator.compare(a.name, b.name);
  if (!ma) return 1;
  if (!mb) return -1;
  return value(ma) - value(mb) || collator.compare(a.name, b.name);
}

/**
 * How many entries each kind has within the current view, so the kind filter
 * can show counts and disable the kinds that match nothing. Runs the same
 * predicate as the grid, so a count can never promise entries a click would not
 * then show.
 *
 * The kind filter is deliberately lifted for this: the number on the "All" chip
 * is what you would get by *clearing* the kind, and the number on each kind chip
 * is what you would get by setting it. Applying the current kind first would
 * make "All" report the count of whichever kind was already selected.
 */
export function kindCounts(
  entries: GalleryEntry[],
  collections: WallpaperCollection[],
  q: GalleryQuery,
  ctx: SelectContext = {},
): Record<string, number> {
  const withoutKind: GalleryQuery = { ...q, kind: "all" };
  const counts: Record<string, number> = { all: 0 };
  for (const e of entries) {
    if (!matches(e, collections, withoutKind, ctx)) continue;
    counts.all = (counts.all ?? 0) + 1;
    counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  }
  return counts;
}
