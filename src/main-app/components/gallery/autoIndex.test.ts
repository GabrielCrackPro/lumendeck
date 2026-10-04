import { describe, expect, it } from "vitest";
import { autoIndexEnabled, shouldAutoIndex, type AutoIndexRequest } from "./autoIndex";
import type { GalleryEntry, WallpaperKind } from "@shared/types";

function entry(
  id: string,
  kind: WallpaperKind = "video",
  source = `C:/videos/${id}.mp4`,
): GalleryEntry {
  return {
    id,
    name: `${id}.mp4`,
    kind,
    source,
    addedMs: 0,
  } as GalleryEntry;
}

function stampsFor(entries: GalleryEntry[]) {
  const map: Record<string, { mtimeMs: number; size: number }> = {};
  for (const e of entries) map[e.id] = { mtimeMs: 1, size: 10 };
  return map;
}

function req(over: Partial<AutoIndexRequest> = {}): AutoIndexRequest {
  const entries = over.entries ?? [entry("a"), entry("b")];
  return {
    added: 1,
    building: false,
    entries,
    stamps: over.stamps ?? stampsFor(entries),
    index: over.index ?? {},
    ...over,
  };
}

describe("shouldAutoIndex", () => {
  it("builds when a new file arrived and nothing is measured", () => {
    expect(shouldAutoIndex(req())).toBe(true);
  });

  it("does nothing when the import added no entries", () => {
    // Real: a folder of only web pages and shaders returns an empty list.
    expect(shouldAutoIndex(req({ added: 0 }))).toBe(false);
  });

  it("does nothing when a build is already running", () => {
    // A second build would re-probe every entry the first is still probing.
    expect(shouldAutoIndex(req({ building: true }))).toBe(false);
  });

  it("does nothing when every entry is already measured", () => {
    // The check that stops this firing on every import forever. The index is
    // persistent, so a fully covered vault makes any rebuild pure waste.
    const entries = [entry("a"), entry("b")];
    const stamps = stampsFor(entries);
    const index = {
      [entries[0]!.source]: {
        width: 1920,
        height: 1080,
        duration: 10,
        stamp: { mtimeMs: 1, size: 10 },
      },
      [entries[1]!.source]: {
        width: 3840,
        height: 2160,
        duration: 20,
        stamp: { mtimeMs: 1, size: 10 },
      },
    };
    expect(shouldAutoIndex(req({ entries, stamps, index }))).toBe(false);
  });

  it("builds when only some entries are measured", () => {
    const entries = [entry("a"), entry("b")];
    const stamps = stampsFor(entries);
    const index = {
      [entries[0]!.source]: {
        width: 1920,
        height: 1080,
        duration: 10,
        stamp: { mtimeMs: 1, size: 10 },
      },
    };
    expect(shouldAutoIndex(req({ entries, stamps, index }))).toBe(true);
  });

  it("does nothing when the vault holds nothing probeable", () => {
    // Web pages and shaders have no file behind them, so there is no resolution
    // to measure. An import of only those would otherwise start a build that
    // finds no work and reports itself complete.
    const entries = [entry("a", "web"), entry("b", "shader")];
    expect(shouldAutoIndex(req({ entries }))).toBe(false);
  });

  it("builds when a measured file was replaced in place", () => {
    // The stamp is what makes this fire: the path and its cached measurement
    // both still look valid, so a path-keyed check alone would skip it.
    const entries = [entry("a")];
    const index = {
      [entries[0]!.source]: {
        width: 1920,
        height: 1080,
        duration: 10,
        stamp: { mtimeMs: 1, size: 10 },
      },
    };
    const reimported = stampsFor(entries);
    reimported["a"] = { mtimeMs: 2, size: 99 };
    expect(shouldAutoIndex(req({ entries, stamps: reimported, index }))).toBe(true);
  });

  it("ignores entries with no stamp rather than counting them covered", () => {
    // `cachedCount` skips an unstamped entry, so an entry the stamps call
    // could not see is not evidence that the index is complete. This is the
    // shape a fresh import has before stamps are re-read.
    const entries = [entry("a"), entry("b")];
    const partial = { a: { mtimeMs: 1, size: 10 } };
    const index = {
      [entries[0]!.source]: {
        width: 1920,
        height: 1080,
        duration: 10,
        stamp: { mtimeMs: 1, size: 10 },
      },
    };
    expect(shouldAutoIndex(req({ entries, stamps: partial, index }))).toBe(true);
  });
});

describe("autoIndexEnabled", () => {
  it("is on for a config that says so", () => {
    expect(autoIndexEnabled({ indexAfterImport: true })).toBe(true);
  });

  it("is off for an explicit opt-out", () => {
    expect(autoIndexEnabled({ indexAfterImport: false })).toBe(false);
  });

  it("is on when the field is absent, because that is the upgrade default", () => {
    // A config written before the setting existed has no value here. Treating
    // absent as false would silently switch the feature off for every existing
    // user on upgrade, which is the mistake `Config::default()` exists to
    // prevent on the Rust side and this mirrors.
    expect(autoIndexEnabled({})).toBe(true);
  });

  it("is on when there is no config at all", () => {
    expect(autoIndexEnabled(undefined)).toBe(true);
  });
});