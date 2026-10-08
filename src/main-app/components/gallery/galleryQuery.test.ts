import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUERY,
  collectionsOf,
  deriveGalleryView,
  inAnyCollection,
  isMember,
  kindCounts,
  selectGallery,
  type GalleryQuery,
} from "./galleryQuery";
import type { GalleryEntry, WallpaperCollection } from "@shared/types";
import type { VaultIndex } from "./vaultIndex";

function entry(over: Partial<GalleryEntry> = {}): GalleryEntry {
  return {
    id: "a",
    name: "Aurora",
    kind: "video",
    source: "C:/a.mp4",
    addedMs: 1000,
    thumb: null,
    opts: null,
    favorite: false,
    lastAppliedMs: null,
    ...over,
  };
}


function collection(over: Partial<WallpaperCollection> = {}): WallpaperCollection {
  return { id: "c1", name: "Desk", entryIds: ["a"], ...over };
}

const query = (over: Partial<GalleryQuery> = {}): GalleryQuery => ({
  ...DEFAULT_QUERY,
  collection: "all",
  ...over,
});

describe("deriveGalleryView", () => {
  const all = [
    entry({ id: "z", name: "Zed", addedMs: 300 }),
    entry({ id: "a", name: "Aurora", addedMs: 200 }),
    entry({ id: "b", name: "Bee", addedMs: 100 }),
  ];

  it("distinguishes a filtered-empty view from an empty vault", () => {
    const view = deriveGalleryView(all, [], query({ search: "no match" }), {}, 1);
    expect(view.gallery).toEqual([]);
    expect(view.visibleGallery).toEqual([]);
    expect(view.filtered).toBe(true);

    const empty = deriveGalleryView([], [], query(), {}, 60);
    expect(empty.gallery).toEqual([]);
    expect(empty.visibleGallery).toEqual([]);
    expect(empty.filtered).toBe(false);
  });

  it("treats a resolution floor as an active filter", () => {
    const entryBelowFloor = entry({ id: "small", source: "C:/small.mp4" });
    const view = deriveGalleryView(
      [entryBelowFloor],
      [],
      query({ minWidth: 1920 }),
      { index: { "C:/small.mp4": { width: 640, height: 360, duration: null } } },
      1,
    );
    expect(view.gallery).toEqual([]);
    expect(view.filtered).toBe(true);
  });

  it("preserves sorted order across pages when a facet is active", () => {
    const entries = all.map((item) => ({ ...item, kind: "image" as const }));
    const view = deriveGalleryView(entries, [], query({ sort: "oldest", kind: "image" }), {}, 2);
    expect(view.gallery.map((item) => item.id)).toEqual(["b", "a", "z"]);
    expect(view.visibleGallery.map((item) => item.id)).toEqual(["b", "a"]);
    expect(view.filtered).toBe(true);
  });
});

describe("selectGallery", () => {
  it("returns everything when nothing is filtered", () => {
    const all = [entry({ id: "a" }), entry({ id: "b" })];
    expect(selectGallery(all, [], query())).toHaveLength(2);
  });

  it("filters by kind", () => {
    const all = [entry({ id: "a", kind: "video" }), entry({ id: "b", kind: "image" })];
    const out = selectGallery(all, [], query({ kind: "image" }));
    expect(out.map((e) => e.id)).toEqual(["b"]);
  });

  it("filters by collection membership", () => {
    const all = [entry({ id: "a" }), entry({ id: "b" })];
    const cols = [collection({ entryIds: ["b"] })];
    const out = selectGallery(all, cols, query({ collection: "c1" }));
    expect(out.map((e) => e.id)).toEqual(["b"]);
  });

  it("matches the name case-insensitively", () => {
    const out = selectGallery([entry({ name: "Sunset" })], [], query({ search: "SUN" }));
    expect(out).toHaveLength(1);
  });

  it("ignores diacritics so a Spanish keyboard finds an accented name", () => {
    const out = selectGallery([entry({ name: "canción.mp4" })], [], query({ search: "cancion" }));
    expect(out).toHaveLength(1);
  });

  it("does not match on path or kind, only the name", () => {
    const out = selectGallery(
      [entry({ name: "clip", source: "C:/holiday/beach.mp4" })],
      [],
      query({ search: "holiday" }),
    );
    expect(out).toHaveLength(0);
  });

  it("sorts newest first by default and breaks ties by name", () => {
    const all = [
      entry({ id: "z", name: "Zed", addedMs: 5000 }),
      entry({ id: "b", name: "Bee", addedMs: 5000 }),
      entry({ id: "o", name: "Old", addedMs: 9000 }),
    ];
    expect(selectGallery(all, [], query()).map((e) => e.name)).toEqual(["Old", "Bee", "Zed"]);
  });

  it("sorts oldest first, by name and by kind", () => {
    const all = [
      entry({ id: "1", name: "Beta", kind: "image", addedMs: 10 }),
      entry({ id: "2", name: "Alpha", kind: "video", addedMs: 20 }),
    ];
    expect(selectGallery(all, [], query({ sort: "oldest" })).map((e) => e.name)).toEqual([
      "Beta",
      "Alpha",
    ]);
    expect(selectGallery(all, [], query({ sort: "name" })).map((e) => e.name)).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(selectGallery(all, [], query({ sort: "kind" })).map((e) => e.kind)).toEqual([
      "image",
      "video",
    ]);
  });

  it("combines every filter", () => {
    const cols = [collection({ id: "c9", entryIds: ["b"] })];
    const all = [
      entry({ id: "a", name: "keep", kind: "image" }),
      entry({ id: "b", name: "keep", kind: "image" }),
      entry({ id: "c", name: "other", kind: "image" }),
    ];
    const out = selectGallery(all, cols, query({ search: "keep", kind: "image", collection: "c9" }));
    expect(out.map((e) => e.id)).toEqual(["b"]);
  });
});

describe("isMember / collectionsOf", () => {
  it("reports membership", () => {
    const cols = [collection({ entryIds: ["a"] })];
    expect(isMember(entry(), cols, "c1")).toBe(true);
    expect(isMember(entry(), cols, "nope")).toBe(false);
  });

  it("lists every collection an entry belongs to", () => {
    const cols = [collection({ id: "c1", entryIds: ["a"] }), collection({ id: "c2", entryIds: ["a", "z"] })];
    expect(collectionsOf(entry(), cols).map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});

describe("kindCounts", () => {
  it("counts every kind within the current collection and search", () => {
    const cols = [collection({ entryIds: ["a"] })];
    const all = [
      entry({ id: "a", kind: "video" }),
      entry({ id: "b", kind: "video" }),
      entry({ id: "c", kind: "shader" }),
    ];
    const counts = kindCounts(all, cols, query({ collection: "c1" }));
    expect(counts.all).toBe(1);
    expect(counts.video).toBe(1);
    expect(counts.shader).toBeUndefined();
  });
});

describe("index-backed sorting and filtering", () => {
  const small = entry({ id: "small", name: "Small", source: "C:/small.mp4" });
  const big = entry({ id: "big", name: "Big", source: "C:/big.mp4" });
  const unmeasured = entry({ id: "u", name: "Unmeasured", source: "C:/u.mp4" });
  const all = [small, big, unmeasured];

  const idx: VaultIndex = {
    "C:/small.mp4": { width: 640, height: 360, duration: 300 },
    "C:/big.mp4": { width: 3840, height: 2160, duration: 10 },
  };

  it("sorts by resolution, smallest first", () => {
    const out = selectGallery(all, [], query({ sort: "resolution" }), { index: idx });
    expect(out.map((e) => e.id)).toEqual(["small", "big", "u"]);
  });

  it("sorts by length, shortest first", () => {
    const out = selectGallery(all, [], query({ sort: "length" }), { index: idx });
    expect(out.map((e) => e.id)).toEqual(["big", "small", "u"]);
  });

  it("puts unmeasured entries last rather than first", () => {
    const out = selectGallery(all, [], query({ sort: "length" }), { index: idx });
    expect(out.at(-1)?.id).toBe("u");
  });

  it("compares resolution by pixel count, not by width alone", () => {
    const a = entry({ id: "a", name: "A", source: "C:/a.mp4" });
    const b = entry({ id: "b", name: "B", source: "C:/b.mp4" });
    const two: VaultIndex = {
      "C:/a.mp4": { width: 2560, height: 1080, duration: null },
      "C:/b.mp4": { width: 1920, height: 1200, duration: null },
    };
    const out = selectGallery([a, b], [], query({ sort: "resolution" }), { index: two });
    expect(out.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("falls back to the name when the index is empty", () => {
    const out = selectGallery(all, [], query({ sort: "resolution" }), {});
    expect(out.map((e) => e.name)).toEqual(["Big", "Small", "Unmeasured"]);
  });

  it("hides entries measured below the width floor", () => {
    const out = selectGallery(all, [], query({ minWidth: 1920 }), { index: idx });
    expect(out.map((e) => e.id)).toEqual(["big", "u"]);
  });

  it("keeps unmeasured entries when a width floor is set", () => {
    const out = selectGallery(all, [], query({ minWidth: 1920 }), { index: idx });
    expect(out.map((e) => e.id)).toContain("u");
    expect(out.map((e) => e.id)).not.toContain("small");
  });

  it("applies no floor by default", () => {
    expect(selectGallery(all, [], query(), { index: idx })).toHaveLength(3);
  });
});

describe("favourites, uncollected and per-display views", () => {
  const fav = entry({ id: "fav", name: "Fav", source: "C:/fav.mp4", favorite: true });
  const plain = entry({ id: "plain", name: "Plain", source: "C:/plain.mp4" });
  const filed = entry({ id: "filed", name: "Filed", source: "C:/filed.mp4" });
  const all = [fav, plain, filed];

  it("keeps only favourites when that pick is active", () => {
    const out = selectGallery(all, [], query({ picks: "favourites" }));
    expect(out.map((e) => e.id)).toEqual(["fav"]);
  });

  it("keeps only uncollected entries", () => {
    const cols = [collection({ id: "c1", entryIds: [filed.id] })];
    const out = selectGallery(all, cols, query({ picks: "uncollected" }));
    expect(out.map((e) => e.id).sort()).toEqual(["fav", "plain"]);
  });

  it("an entry in any collection is not uncollected", () => {
    const cols = [collection({ id: "c1", entryIds: [filed.id] })];
    expect(inAnyCollection(filed, cols)).toBe(true);
    expect(inAnyCollection(plain, cols)).toBe(false);
  });

  it("filters to the entry running on a chosen display", () => {
    const onTwo = entry({ id: "two", name: "Two", source: "C:/two.mp4" });
    const ctx = {
      perMonitor: { "\\.\\DISPLAY2": { kind: "video", source: "C:/two.mp4" } },
      globalKind: "video" as const,
      globalSource: "C:/plain.mp4",
    };
    const out = selectGallery([...all, onTwo], [], query({ display: "\\.\\DISPLAY2" }), ctx);
    expect(out.map((e) => e.id)).toEqual(["two"]);
  });

  it("a display with no override shows the global wallpaper", () => {
    const onTwo = entry({ id: "two", name: "Two", source: "C:/two.mp4" });
    const ctx = {
      perMonitor: { "\\.\\DISPLAY2": { kind: "video", source: "C:/two.mp4" } },
      globalKind: "video" as const,
      globalSource: "C:/plain.mp4",
    };
    const out = selectGallery([...all, onTwo], [], query({ display: "\\.\\DISPLAY3" }), ctx);
    expect(out.map((e) => e.id)).toEqual(["plain"]);
  });

  it("counts the global wallpaper as running on every display", () => {
    const ctx = { perMonitor: {}, globalKind: "video" as const, globalSource: "C:/plain.mp4" };
    const out = selectGallery(all, [], query({ display: "any-device" }), ctx);
    expect(out.map((e) => e.id)).toEqual(["plain"]);
  });

  it("sorts by recently used, never-applied last", () => {
    const old = entry({ id: "old", name: "Old", source: "C:/old.mp4", lastAppliedMs: 100 });
    const fresh = entry({ id: "fresh", name: "Fresh", source: "C:/fresh.mp4", lastAppliedMs: 900 });
    const never = entry({ id: "never", name: "Never", source: "C:/never.mp4" });
    const out = selectGallery([never, old, fresh], [], query({ sort: "used" }));
    expect(out.map((e) => e.id)).toEqual(["fresh", "old", "never"]);
  });

  it("sorts favourites first, newest first within each group", () => {
    const a = entry({ id: "a", name: "A", source: "C:/a.mp4", favorite: true, addedMs: 100 });
    const b = entry({ id: "b", name: "B", source: "C:/b.mp4", favorite: true, addedMs: 200 });
    const c = entry({ id: "c", name: "C", source: "C:/c.mp4", addedMs: 900 });
    const out = selectGallery([a, b, c], [], query({ sort: "favourites" }));
    expect(out.map((e) => e.id)).toEqual(["b", "a", "c"]);
  });

  it("the kind counts honour the other filters too", () => {
    const cols = [collection({ id: "c1", entryIds: [filed.id] })];
    const counts = kindCounts(all, cols, query({ picks: "uncollected" }));
    expect(counts.all).toBe(2);
    expect(counts.video).toBe(2);
  });

  it("the All count ignores the kind filter itself", () => {
    const still = entry({ id: "s", name: "S", source: "C:/s.png", kind: "image" });
    const counts = kindCounts([...all, still], [], query({ kind: "image" }));
    expect(counts.all).toBe(4);
    expect(counts.image).toBe(1);
  });
});
