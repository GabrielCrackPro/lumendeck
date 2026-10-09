import type { GalleryEntry, WallpaperCollection, WallpaperKind } from "@shared/types";
import type { VaultIndex } from "./vaultIndex";

export type GallerySort =
  | "recent"
  | "oldest"
  | "used"
  | "favourites"
  | "name"
  | "kind"
  | "resolution"
  | "length";

export type GalleryPick = "all" | "favourites" | "uncollected";

export interface GalleryQuery {
  search: string;
  collection: string;
  kind: WallpaperKind | "all";
  sort: GallerySort;
  minWidth: number | null;
  picks: GalleryPick;
  display: string;
  /** "all", a discover source id, "url", or "local". */
  origin: string;
}

export interface SelectContext {
  index?: VaultIndex;
  perMonitor?: Record<string, { kind: string; source: string } | undefined>;
  globalKind?: WallpaperKind;
  globalSource?: string;
}

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
  origin: "all",
};

export const LOCAL_ORIGIN = "local";

/** Where an entry came from; anything untracked counts as a local import. */
export function originOf(e: GalleryEntry): string {
  return e.origin?.trim() || LOCAL_ORIGIN;
}

export function isMember(
  entry: GalleryEntry,
  collections: WallpaperCollection[],
  collectionId: string,
): boolean {
  return collections.some((c) => c.id === collectionId && c.entryIds.includes(entry.id));
}

export function inAnyCollection(
  entry: GalleryEntry,
  collections: WallpaperCollection[],
): boolean {
  return collections.some((c) => c.entryIds.includes(entry.id));
}

export function collectionsOf(
  entry: GalleryEntry,
  collections: WallpaperCollection[],
): WallpaperCollection[] {
  return collections.filter((c) => c.entryIds.includes(entry.id));
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function matches(
  e: GalleryEntry,
  collections: WallpaperCollection[],
  q: GalleryQuery,
  ctx: SelectContext,
): boolean {
  if (q.kind !== "all" && e.kind !== q.kind) return false;
  if (q.collection !== "all" && !isMember(e, collections, q.collection)) return false;
  if (q.origin !== "all" && originOf(e) !== q.origin) return false;

  const needle = fold(q.search.trim());
  if (needle && !fold(e.name).includes(needle)) return false;

  if (q.picks === "favourites" && !e.favorite) return false;
  if (q.picks === "uncollected" && inAnyCollection(e, collections)) return false;

  if (q.display !== "all") {
    const o = ctx.perMonitor?.[q.display];
    const onIt = o && o.kind === e.kind && o.source === e.source;
    const isGlobal =
      !o && ctx.globalKind !== undefined && e.kind === ctx.globalKind && e.source === ctx.globalSource;
    if (!onIt && !isGlobal) return false;
  }

  if (q.minWidth != null) {
    const meta = ctx.index?.[e.source];
    if (meta && meta.width < q.minWidth) return false;
  }
  return true;
}

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
    case "resolution":
      sorted.sort((a, b) => byMeasured(a, b, index, (m) => m.width * m.height));
      break;
    case "length":
      sorted.sort((a, b) => byMeasured(a, b, index, (m) => m.duration ?? 0));
      break;
  }
  return sorted;
}

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
      query.origin !== "all" ||
      query.minWidth !== null,
  };
}

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

export function originCounts(
  entries: GalleryEntry[],
  collections: WallpaperCollection[],
  q: GalleryQuery,
  ctx: SelectContext = {},
): Record<string, number> {
  const withoutOrigin: GalleryQuery = { ...q, origin: "all" };
  const counts: Record<string, number> = { all: 0 };
  for (const e of entries) {
    if (!matches(e, collections, withoutOrigin, ctx)) continue;
    const id = originOf(e);
    counts.all = (counts.all ?? 0) + 1;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}
