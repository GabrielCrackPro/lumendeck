// Which filters are applied, what each is called, and how to take it back off.
//
// Pure and out of the component so it can be tested without a DOM -- and
// because the version that lived in the toolbar was two independent answers to
// "is this filter on" (one counting for the badge, one implicit in the chips),
// which is how the badge came to read 0 while a resolution floor was applied.
// One list, derived once.
//
// Labels are i18n *keys*, not resolved strings: `t()` belongs to the
// component, and a module that resolved it would need the runtime's language.

import type { WallpaperCollection } from "@shared/types";
import type { GalleryPick, GalleryQuery } from "./galleryQuery";
import { GALLERY_KIND_LABEL } from "./kindLabels";

export interface ActiveFilter {
  key: "search" | "kind" | "picks" | "collection" | "display" | "minWidth";
  /**
   * What the chip says. Null means the label is data -- a search term, a
   * collection name, a display name -- which is not translatable and is not
   * safe to look up.
   */
  label: string;
  /** The i18n key for `label`, when there is one. */
  labelKey: string | null;
  /**
   * How to clear it.
   *
   * `collection` is its own case because it has its own setter and its own
   * branch in `selectGallery`; folding it into the query patch would mean a
   * field the query does not have.
   */
  clear:
    | { kind: "query"; patch: Partial<GalleryQuery> }
    | { kind: "collection"; id: "all" };
}

/**
 * The wording the panel needs, passed in rather than imported.
 *
 * The resolution floors in particular: this module must not own that list, or
 * the dropdown and the chips would be able to drift into offering different
 * floors -- and only one of the two would be reachable.
 */
export interface ActiveFilterLabels {
  /** id is the numeric floor as a string; label is its i18n key. */
  floors: { id: string; label: string }[];
  /** Key for "Any resolution", for a floor no longer in the list. */
  anyResolution: string;
  /** Display device name -> display name, in the panel's order. */
  displays: { device: string; name: string }[];
  /** Key for "Any display", for a display unplugged while filtered by it. */
  anyDisplay: string;
  /** Key for "Collections", for a collection deleted while filtered by it. */
  unknownCollection: string;
}

const PICK_LABEL: Record<Exclude<GalleryPick, "all">, string> = {
  favourites: "gallery.favourites",
  uncollected: "gallery.uncollected",
};

/**
 * Every filter currently narrowing the grid, in the order a user would undo
 * them: what they just typed, then the refinements.
 *
 * Search is included even though the badge excludes it. The box shows *what* was
 * typed, not *that it is filtering* -- and a two-character term left in a field
 * reads as a leftover rather than as a filter.
 */
export function activeFilters(
  q: GalleryQuery,
  collections: WallpaperCollection[],
  labels: ActiveFilterLabels,
): ActiveFilter[] {
  const out: ActiveFilter[] = [];

  const search = q.search.trim();
  if (search) {
    out.push({
      key: "search",
      label: search,
      labelKey: null,
      clear: { kind: "query", patch: { search: "" } },
    });
  }

  if (q.kind !== "all") {
    out.push({
      key: "kind",
      label: q.kind,
      labelKey: GALLERY_KIND_LABEL[q.kind],
      clear: { kind: "query", patch: { kind: "all" } },
    });
  }

  if (q.picks !== "all") {
    out.push({
      key: "picks",
      label: q.picks,
      labelKey: PICK_LABEL[q.picks],
      clear: { kind: "query", patch: { picks: "all" } },
    });
  }

  if (q.collection !== "all") {
    const col = collections.find((c) => c.id === q.collection);
    out.push({
      key: "collection",
      // A collection deleted while filtered by it leaves the id dangling in the
      // query until something resets it. The raw id is worse than the generic
      // word, which is still true and is still clickable.
      label: col ? col.name : labels.unknownCollection,
      labelKey: col ? null : labels.unknownCollection,
      clear: { kind: "collection", id: "all" },
    });
  }

  if (q.display !== "all") {
    const hit = labels.displays.find((d) => d.device === q.display);
    // 1-based because that is how the panel labels displays; `find` rather than
    // `findIndex` because the name and the index have to come from one place.
    const label = hit ? `${hit.name} · ${labels.displays.indexOf(hit) + 1}` : null;
    out.push({
      key: "display",
      label: label ?? labels.anyDisplay,
      labelKey: label ? null : labels.anyDisplay,
      clear: { kind: "query", patch: { display: "all" } },
    });
  }

  if (q.minWidth != null) {
    const floor = labels.floors.find((w) => w.id === String(q.minWidth));
    out.push({
      key: "minWidth",
      label: floor ? floor.label : labels.anyResolution,
      labelKey: floor ? floor.label : labels.anyResolution,
      clear: { kind: "query", patch: { minWidth: null } },
    });
  }

  return out;
}

/**
 * How many of these the Filters button should badge.
 *
 * Search is left out: it is visible in the box in the same row, so a badge
 * would restate what is already on screen. Derived from the same list rather
 * than counted again, which is the entire point of this module.
 */
export function filterBadgeCount(filters: ActiveFilter[]): number {
  return filters.filter((f) => f.key !== "search").length;
}