
import type { WallpaperCollection } from "@shared/types";
import type { GalleryPick, GalleryQuery } from "./galleryQuery";
import { GALLERY_KIND_LABEL, originLabel } from "./kindLabels";

export interface ActiveFilter {
  key: "search" | "kind" | "origin" | "picks" | "collection" | "display" | "minWidth";
  label: string;
  labelKey: string | null;
  clear:
    | { kind: "query"; patch: Partial<GalleryQuery> }
    | { kind: "collection"; id: "all" };
}

export interface ActiveFilterLabels {
  floors: { id: string; label: string }[];
  anyResolution: string;
  displays: { device: string; name: string }[];
  anyDisplay: string;
  unknownCollection: string;
}

const PICK_LABEL: Record<Exclude<GalleryPick, "all">, string> = {
  favourites: "gallery.favourites",
  uncollected: "gallery.uncollected",
};

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

  if (q.origin !== "all") {
    out.push({
      key: "origin",
      label: q.origin,
      labelKey: originLabel(q.origin),
      clear: { kind: "query", patch: { origin: "all" } },
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
      label: col ? col.name : labels.unknownCollection,
      labelKey: col ? null : labels.unknownCollection,
      clear: { kind: "collection", id: "all" },
    });
  }

  if (q.display !== "all") {
    const hit = labels.displays.find((d) => d.device === q.display);
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

export function filterBadgeCount(filters: ActiveFilter[]): number {
  return filters.filter((f) => f.key !== "search").length;
}