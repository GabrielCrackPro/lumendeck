// Query decisions stay pure; WallpaperTab owns UI state and pagination.
// See `skills/gallery-palette-rationale/SKILL.md` for cross-cutting behavior contracts.
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
  /** Minimum width in pixels; null means no floor. */
  minWidth: number | null;
  picks: GalleryPick;
  /** Monitor device name, or "all". */
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

/** Shared by grid filtering and kind counts. */
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
    // See `skills/gallery-palette-rationale/SKILL.md`: global fallback applies only without an override.
    const o = ctx.perMonitor?.[q.display];
    const onIt = o && o.kind === e.kind && o.source === e.source;
    const isGlobal =
      !o && ctx.globalKind !== undefined && e.kind === ctx.globalKind && e.source === ctx.globalSource;
    if (!onIt && !isGlobal) return false;
  }

  if (q.minWidth != null) {
    // Unknown dimensions must remain visible. See `skills/gallery-palette-rationale/SKILL.md`.
    const meta = ctx.index?.[e.source];
    if (meta && meta.width < q.minWidth) return false;
  }
  return true;
}

/**
 * Filter, then sort; search matches entry names only.
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
      sorted.sort((a, b) => b.addedMs - a.addedMs || collator.compare(a.name, b.name));
      break;
    case "oldest":
      sorted.sort((a, b) => a.addedMs - b.addedMs || collator.compare(a.name, b.name));
      break;
    case "used":
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
    // See skills/gallery-palette-rationale/SKILL.md: unknown measurements sort last.
    case "resolution":
      sorted.sort((a, b) => byMeasured(a, b, index, (m) => m.width * m.height));
      break;
    case "length":
      sorted.sort((a, b) => byMeasured(a, b, index, (m) => m.duration ?? 0));
      break;
  }
  return sorted;
}

/** Derive the full matching order, current page, and empty-state filter mode together. */
export function deriveGalleryView(
  entries: GalleryEntry[],
  collections: WallpaperCollection[],
  query: GalleryQuery,
  context: SelectContext,
  limit: number,
) {
  const gallery = selectGallery(entries, collections, query, context);
  return {
    gallery,
    visibleGallery: gallery.slice(0, limit),
    filtered:
      query.search.trim() !== "" ||
      query.kind !== "all" ||
      query.collection !== "all" ||
      query.picks !== "all" ||
      query.display !== "all" ||
      query.minWidth !== null,
  };
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
 * then show. See `skills/gallery-palette-rationale/SKILL.md` for the lifted-kind count rule.
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
