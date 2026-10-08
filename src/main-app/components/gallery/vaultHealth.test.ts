import { describe, it, expect } from "vitest";
import { duplicateIds, findDuplicates, healthOf, sourceKey } from "./vaultHealth";
import type { GalleryEntry, WallpaperKind } from "@shared/types";

const BS = String.fromCharCode(92);
const win = (name: string) => `C:` + BS + `Media` + BS + name;

let seq = 0;
function entry(partial: Partial<GalleryEntry> & { source: string }): GalleryEntry {
  seq += 1;
  return {
    id: partial.id ?? `e${seq}`,
    name: partial.name ?? partial.source,
    kind: (partial.kind ?? "video") as WallpaperKind,
    source: partial.source,
    addedMs: partial.addedMs ?? 0,
    thumb: partial.thumb ?? null,
    opts: partial.opts ?? null,
  };
}

describe("sourceKey", () => {
  it("is null for kinds that are not files", () => {
    expect(sourceKey(entry({ source: "https://x/y", kind: "web" }))).toBeNull();
    expect(sourceKey(entry({ source: "aurora", kind: "shader" }))).toBeNull();
  });

  it("is null for a blank source", () => {
    expect(sourceKey(entry({ source: "   " }))).toBeNull();
  });

  it("lowercases, so a path Explorer re-cased still matches", () => {
    expect(sourceKey(entry({ source: win("Clip.MP4") }))).toBe(
      sourceKey(entry({ source: win("clip.mp4") })),
    );
  });
});

describe("findDuplicates", () => {
  it("finds two entries pointing at the same file", () => {
    const a = entry({ source: win("a.mp4") });
    const b = entry({ source: win("a.mp4") });
    const dupes = findDuplicates([a, b]);
    expect(dupes.size).toBe(1);
    expect([...dupes.values()][0]).toEqual([a.id, b.id]);
  });

  it("ignores distinct files", () => {
    expect(findDuplicates([entry({ source: win("a.mp4") }), entry({ source: win("b.mp4") })]).size).toBe(0);
  });

  it("keeps the first member of a set as the keeper", () => {
    const first = entry({ source: win("a.mp4") });
    const second = entry({ source: win("a.mp4") });
    const third = entry({ source: win("a.mp4") });
    const redundant = duplicateIds([first, second, third]);
    expect([...redundant]).toEqual([second.id, third.id]);
    expect(redundant.has(first.id)).toBe(false);
  });

  it("does not merge a video and an image that share a path", () => {
    expect(
      findDuplicates([
        entry({ source: win("a.mp4"), kind: "video" }),
        entry({ source: win("a.mp4"), kind: "image" }),
      ]).size,
    ).toBe(1);
  });
});

describe("healthOf", () => {
  const missing = new Set(["m"]);
  const dupes = new Set(["d"]);

  it("reports a missing file above a duplicate", () => {
    expect(healthOf("m", missing, dupes)).toBe("missing");
  });

  it("reports a duplicate", () => {
    expect(healthOf("d", missing, dupes)).toBe("duplicate");
  });

  it("reports nothing for a healthy entry", () => {
    expect(healthOf("ok", missing, dupes)).toBeNull();
  });
});
