import { describe, expect, it } from "vitest";
import {
  activeFilters,
  filterBadgeCount,
  type ActiveFilter,
  type ActiveFilterLabels,
} from "./activeFilters";
import type { GalleryQuery } from "./galleryQuery";
import type { WallpaperCollection } from "@shared/types";

const LABELS: ActiveFilterLabels = {
  floors: [
    { id: "0", label: "gallery.any-resolution" },
    { id: "1920", label: "gallery.at-least-1080p" },
    { id: "3840", label: "gallery.at-least-4k" },
  ],
  anyResolution: "gallery.any-resolution",
  displays: [
    { device: "\\\\.\\DISPLAY1", name: "DELL U2720Q" },
    { device: "\\\\.\\DISPLAY2", name: "LG 27GL850" },
  ],
  anyDisplay: "gallery.any-display",
  unknownCollection: "gallery.view-collections",
};

const COLLECTIONS: WallpaperCollection[] = [
  { id: "c1", name: "Viajes", entryIds: ["a", "b"] },
  { id: "c2", name: "Negros", entryIds: ["c"] },
];

function query(patch: Partial<GalleryQuery> = {}): GalleryQuery {
  return {
    search: "",
    collection: "all",
    kind: "all",
    sort: "recent",
    minWidth: null,
    picks: "all",
    display: "all",
    ...patch,
  };
}

const list = (q: GalleryQuery): ActiveFilter[] => activeFilters(q, COLLECTIONS, LABELS);

function only(q: GalleryQuery): ActiveFilter {
  const f = list(q);
  expect(f).toHaveLength(1);
  return f[0]!;
}

const keys = (q: GalleryQuery) => list(q).map((f) => f.key);

describe("activeFilters", () => {
  it("is empty when nothing narrows the grid", () => {
    expect(list(query())).toEqual([]);
  });

  it("counts the resolution floor, which the old hand-written list omitted", () => {
    expect(keys(query({ minWidth: 1920 }))).toEqual(["minWidth"]);
    expect(filterBadgeCount(list(query({ minWidth: 1920 })))).toBe(1);
  });

  it("lists every dimension that is applied", () => {
    const all = query({
      search: "cascada",
      kind: "video",
      picks: "uncollected",
      collection: "c1",
      display: "\\\\.\\DISPLAY2",
      minWidth: 3840,
    });
    expect(keys(all)).toEqual(["search", "kind", "picks", "collection", "display", "minWidth"]);
    expect(filterBadgeCount(list(all))).toBe(5);
  });

  it("orders the chips the way they would be undone", () => {
    const all = query({ display: "\\\\.\\DISPLAY1", search: "cascada", kind: "video" });
    expect(keys(all)).toEqual(["search", "kind", "display"]);
  });

  it("trims the search term, so whitespace alone is not a filter", () => {
    expect(keys(query({ search: "   " }))).toEqual([]);
    expect(only(query({ search: "  a  " })).label).toBe("a");
  });

  it("excludes search from the badge but not from the chips", () => {
    const f = list(query({ search: "a" }));
    expect(f).toHaveLength(1);
    expect(filterBadgeCount(f)).toBe(0);
  });

  it("labels a kind by its own key rather than the raw slug", () => {
    expect(only(query({ kind: "video" })).labelKey).toBe("gallery.kind-video");
  });

  it("labels each pick by its own key", () => {
    expect(only(query({ picks: "favourites" })).labelKey).toBe("gallery.favourites");
    expect(only(query({ picks: "uncollected" })).labelKey).toBe("gallery.uncollected");
  });

  it("shows a collection's name as data, not as a lookup", () => {
    const f = only(query({ collection: "c1" }));
    expect(f.label).toBe("Viajes");
    expect(f.labelKey).toBeNull();
  });

  it("falls back rather than printing an id for a deleted collection", () => {
    const f = only(query({ collection: "gone" }));
    expect(f.labelKey).toBe("gallery.view-collections");
    expect(f.clear).toEqual({ kind: "collection", id: "all" });
  });

  it("numbers displays from 1, in the panel's own order", () => {
    expect(only(query({ display: "\\\\.\\DISPLAY1" })).label).toBe("DELL U2720Q · 1");
    expect(only(query({ display: "\\\\.\\DISPLAY2" })).label).toBe("LG 27GL850 · 2");
  });

  it("falls back rather than printing a device path for an unplugged display", () => {
    expect(only(query({ display: "\\\\.\\DISPLAY9" })).labelKey).toBe("gallery.any-display");
  });

  it("labels a floor with the key the dropdown offers", () => {
    expect(only(query({ minWidth: 1920 })).labelKey).toBe("gallery.at-least-1080p");
  });

  it("falls back for a floor the option list no longer has", () => {
    expect(only(query({ minWidth: 7680 })).labelKey).toBe("gallery.any-resolution");
  });

  it("gives every filter a clear that turns off exactly that filter", () => {
    const q = query({ search: "a", kind: "video", picks: "favourites", minWidth: 1920 });
    const expected: Partial<Record<ActiveFilter["key"], Partial<GalleryQuery>>> = {
      search: { search: "" },
      kind: { kind: "all" },
      picks: { picks: "all" },
      minWidth: { minWidth: null },
    };

    for (const f of list(q)) {
      expect(f.clear).toEqual({ kind: "query", patch: expected[f.key] });
    }
  });

  it("clearing one filter leaves the others exactly where they were", () => {
    const q = query({ search: "a", kind: "video", minWidth: 1920 });
    const kind = list(q).find((f) => f.key === "kind")!;
    expect(kind.clear.kind).toBe("query");
    if (kind.clear.kind !== "query") throw new Error("expected a query patch");

    const after: GalleryQuery = { ...q, ...kind.clear.patch };
    expect(after.kind).toBe("all");
    expect(after.search).toBe("a");
    expect(after.minWidth).toBe(1920);
  });

  it("clears a collection through its own setter, not a query patch", () => {
    expect(only(query({ collection: "c1" })).clear).toEqual({
      kind: "collection",
      id: "all",
    });
  });
});

describe("filterBadgeCount", () => {
  it("counts nothing when nothing is applied", () => {
    expect(filterBadgeCount([])).toBe(0);
  });

  it("is never larger than the number of chips", () => {
    const f = list(query({ search: "x", kind: "video", minWidth: 1920 }));
    expect(filterBadgeCount(f)).toBeLessThan(f.length);
  });
});