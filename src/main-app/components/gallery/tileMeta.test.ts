import { describe, it, expect } from "vitest";
import {
  tileMetaFor,
  hasTileMeta,
  meetsFloor,
  type TileMeta,
} from "./tileMeta";
import { resolutionClass } from "./NowShowingCard";
import type { VaultIndex } from "./vaultIndex";
import type { GalleryEntry } from "@shared/types";

const entry = (over: Partial<GalleryEntry> = {}): GalleryEntry => ({
  id: "e1",
  name: "clip",
  kind: "video",
  source: "C:/a.mp4",
  addedMs: 0,
  ...over,
});

const index: VaultIndex = {
  "C:/a.mp4": { width: 3840, height: 2160, duration: 255 },
};

describe("resolutionClass", () => {
  it("calls a 4K frame 4k", () => {
    expect(resolutionClass(3840)).toBe("4k");
  });

  it("calls a 1080p frame hd", () => {
    expect(resolutionClass(1920)).toBe("hd");
  });

  it("returns null for anything unmeasured", () => {
    expect(resolutionClass(undefined)).toBeNull();
  });

  it("returns null below HD, since a label would overstate it", () => {
    expect(resolutionClass(1280)).toBeNull();
  });

  it("treats 3440 as hd, not 4k", () => {
    expect(resolutionClass(3440)).toBe("hd");
  });

  it("counts a 3840-wide ultrawide as 4k", () => {
    expect(resolutionClass(3840)).toBe("4k");
  });
});

describe("tileMetaFor", () => {
  it("reads resolution and duration off the vault index", () => {
    expect(tileMetaFor(entry(), index)).toEqual({
      resolution: "3840x2160",
      duration: "4:15",
    });
  });

  it("omits the duration on a still image", () => {
    const meta = tileMetaFor(
      entry({ kind: "image", source: "C:/b.jpg" }),
      { "C:/b.jpg": { width: 800, height: 600, duration: 0 } },
    );
    expect(meta.duration).toBeNull();
    expect(meta.resolution).toBe("800x600");
  });

  it("shows nothing at all for an entry the index has not measured", () => {
    expect(tileMetaFor(entry({ source: "C:/unknown.mp4" }), index)).toEqual({
      resolution: null,
      duration: null,
    });
  });

  it("shows nothing when there is no index at all", () => {
    expect(tileMetaFor(entry(), undefined)).toEqual({
      resolution: null,
      duration: null,
    });
  });

  it("keeps a real zero duration rather than hiding it", () => {
    const meta = tileMetaFor(entry(), { "C:/a.mp4": { width: 640, height: 480, duration: 0 } });
    expect(meta.duration).toBe("0:00");
  });
});

describe("hasTileMeta", () => {
  it("is false only when there is genuinely nothing to say", () => {
    expect(hasTileMeta({ resolution: null, duration: null })).toBe(false);
    expect(hasTileMeta({ resolution: "800x600", duration: null })).toBe(true);
    expect(hasTileMeta({ resolution: null, duration: "4:15" })).toBe(true);
  });

  it("an unmeasured tile renders no facts row at all", () => {
    const meta: TileMeta = tileMetaFor(entry({ source: "C:/x.mp4" }), index);
    expect(hasTileMeta(meta)).toBe(false);
  });
});

describe("meetsFloor", () => {
  it("passes everything at the zero floor", () => {
    expect(meetsFloor(entry({ source: "C:/unknown.mp4" }), index, 0)).toBe(true);
  });

  it("counts a 4K entry as 4K", () => {
    expect(meetsFloor(entry(), index, 3840)).toBe(true);
  });

  it("does not count 1080p as 4K", () => {
    expect(
      meetsFloor(entry(), { "C:/a.mp4": { width: 1920, height: 1080, duration: 1 } }, 3840),
    ).toBe(false);
  });

  it("does not count a wide-but-short ultrawide as 4K", () => {
    expect(
      meetsFloor(entry(), { "C:/a.mp4": { width: 3840, height: 1080, duration: 1 } }, 3840),
    ).toBe(false);
  });

  it("does not count an unmeasured entry against any floor", () => {
    expect(meetsFloor(entry({ source: "C:/unknown.mp4" }), index, 3840)).toBe(false);
  });

  it("counts a genuine 32:9 4K ultrawide as 4K", () => {
    expect(
      meetsFloor(entry(), { "C:/a.mp4": { width: 3840, height: 1600, duration: 1 } }, 3840),
    ).toBe(true);
  });

  it("keeps 720p out of the 1080p floor", () => {
    const at1080 = { "C:/a.mp4": { width: 1920, height: 1080, duration: 1 } };
    expect(meetsFloor(entry(), at1080, 1920)).toBe(true);
    expect(
      meetsFloor(entry(), { "C:/a.mp4": { width: 1280, height: 720, duration: 1 } }, 1920),
    ).toBe(false);
  });
});