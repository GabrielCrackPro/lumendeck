import { describe, expect, it } from "vitest";
import type { DiscoverSourceCfg } from "@shared/types";
import {
  DISCOVER_SOURCES,
  activeSources,
  canLoadMore,
  formatDuration,
  missingApiKey,
  sourceById,
  sourceConfig,
  thumbKey,
} from "./discoverSources";

const entry = (
  id: string,
  patch: Partial<DiscoverSourceCfg> = {},
): DiscoverSourceCfg => ({
  id,
  enabled: true,
  apiKey: "",
  defaultQuery: "",
  ...patch,
});

describe("discover sources", () => {
  it("offers exactly the sources the backend implements", () => {
    expect(DISCOVER_SOURCES.map((s) => s.id)).toEqual([
      "bing",
      "wallhaven",
      "pixabay",
      "coverr",
    ]);
  });

  it("keeps every label and hint a literal catalog key", () => {
    for (const s of DISCOVER_SOURCES) {
      expect(s.label).toMatch(/^gallery\.[a-z0-9-]+$/);
      expect(s.hint).toMatch(/^gallery\.discover-hint-[a-z-]+$/);
    }
  });

  it("gates only pixabay behind a key, and only lets it link out over https", () => {
    expect(DISCOVER_SOURCES.filter((s) => s.needsKey).map((s) => s.id)).toEqual([
      "pixabay",
    ]);
    for (const s of DISCOVER_SOURCES) {
      if (s.keyUrl) expect(s.keyUrl).toMatch(/^https:\/\//);
    }
    expect(sourceById("pixabay").keyUrl).toBeDefined();
    expect(sourceById("coverr").keyUrl).toBeUndefined();
  });

  it("marks every source but the fixed Bing feed searchable", () => {
    expect(sourceById("bing").searchable).toBe(false);
    for (const id of ["wallhaven", "pixabay", "coverr"]) {
      expect(sourceById(id).searchable).toBe(true);
    }
  });

  it("serves videos from pixabay and coverr only", () => {
    expect(DISCOVER_SOURCES.filter((s) => s.video).map((s) => s.id)).toEqual([
      "pixabay",
      "coverr",
    ]);
  });

  it("falls back to the first source for an unknown id", () => {
    expect(sourceById("gopher").id).toBe(DISCOVER_SOURCES[0]!.id);
    expect(sourceById("").id).toBe(DISCOVER_SOURCES[0]!.id);
  });
});

describe("activeSources", () => {
  it("follows the saved order and drops disabled sources", () => {
    const active = activeSources([
      entry("coverr"),
      entry("bing", { enabled: false }),
      entry("wallhaven"),
      entry("pixabay"),
    ]);
    expect(active.map((s) => s.id)).toEqual(["coverr", "wallhaven", "pixabay"]);
  });

  it("adds a built-in the saved config never recorded as enabled", () => {
    // Config saved before an update: the source must stay queryable, which
    // is the same fallback the backend applies.
    const active = activeSources([entry("bing")]);
    expect(active.map((s) => s.id)).toEqual([
      "bing",
      "wallhaven",
      "pixabay",
      "coverr",
    ]);
  });

  it("skips ids it does not recognise and ignores repeats", () => {
    const active = activeSources([
      entry("gopher"),
      entry("bing", { enabled: false }),
      entry("bing"),
      entry("coverr"),
    ]);
    // Saved entries first (the disabled bing claims its slot), then the
    // registry entries the config never recorded.
    expect(active.map((s) => s.id)).toEqual(["coverr", "wallhaven", "pixabay"]);
  });

  it("falls back to every source enabled while no config is loaded", () => {
    expect(activeSources(undefined).map((s) => s.id)).toEqual(
      DISCOVER_SOURCES.map((s) => s.id),
    );
  });
});

describe("sourceConfig", () => {
  it("finds the saved entry for one source only", () => {
    const configured = [entry("pixabay", { apiKey: "abc" })];
    expect(sourceConfig(configured, "pixabay")?.apiKey).toBe("abc");
    expect(sourceConfig(configured, "coverr")).toBeUndefined();
    expect(sourceConfig(undefined, "bing")).toBeUndefined();
  });
});

describe("missingApiKey", () => {
  const pixabay = sourceById("pixabay");
  const coverr = sourceById("coverr");

  it("holds until a keyed source has a non-blank key", () => {
    expect(missingApiKey(pixabay, undefined)).toBe(true);
    expect(missingApiKey(pixabay, entry("pixabay"))).toBe(true);
    expect(missingApiKey(pixabay, entry("pixabay", { apiKey: " " }))).toBe(true);
    expect(missingApiKey(pixabay, entry("pixabay", { apiKey: "abc" }))).toBe(false);
  });

  it("never blocks a keyless source", () => {
    expect(missingApiKey(coverr, undefined)).toBe(false);
    expect(missingApiKey(coverr, entry("coverr"))).toBe(false);
  });
});

describe("formatDuration", () => {
  it("renders clip length as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(12)).toBe("0:12");
    expect(formatDuration(75)).toBe("1:15");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("is empty for absent or invalid values", () => {
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(Number.NaN)).toBe("");
    expect(formatDuration(-1)).toBe("");
  });
});

describe("canLoadMore", () => {
  it("offers more pages while below the last one", () => {
    expect(canLoadMore(42, 1)).toBe(true);
    expect(canLoadMore(2, 1)).toBe(true);
  });

  it("stops on the last page", () => {
    expect(canLoadMore(1, 1)).toBe(false);
    expect(canLoadMore(42, 42)).toBe(false);
    expect(canLoadMore(42, 43)).toBe(false);
  });

  it("never offers more for a source without paging", () => {
    expect(canLoadMore(null, 1)).toBe(false);
    expect(canLoadMore(Number.NaN, 1)).toBe(false);
  });
});

describe("thumbKey", () => {
  it("is the URL itself so two sources cannot collide on an id", () => {
    expect(thumbKey("https://th.wallhaven.cc/lg/xe/xek223.jpg")).toBe(
      "https://th.wallhaven.cc/lg/xe/xek223.jpg",
    );
  });
});
