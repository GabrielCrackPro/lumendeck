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
    // The case the card exists to handle: a vault that has never been indexed
    // must print no badge at all rather than claim a resolution.
    expect(resolutionClass(undefined)).toBeNull();
  });

  it("returns null below HD, since a label would overstate it", () => {
    // A 720p file is not "HD" as anyone means the word on this badge, and
    // printing HD for it is the same class of wrong as guessing 1080p.
    expect(resolutionClass(1280)).toBeNull();
  });

  it("treats 3440 as hd, not 4k", () => {
    // 3440x1440 is a 1440p display, not 4K: "4K UHD" means 3840 wide, and a
    // badge that said 4K here would be the card overstating the file. The
    // height is deliberately not consulted -- the label is about width.
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
    // A photo's length is zero. Printing "0:00" on every image tile is noise,
    // and the drawer already treats zero as a real value it must not hide --
    // here the kind decides, not the number.
    const meta = tileMetaFor(
      entry({ kind: "image", source: "C:/b.jpg" }),
      { "C:/b.jpg": { width: 800, height: 600, duration: 0 } },
    );
    expect(meta.duration).toBeNull();
    expect(meta.resolution).toBe("800x600");
  });

  it("shows nothing at all for an entry the index has not measured", () => {
    // Deliberately no per-tile probe fallback: a grid that fires a probe per
    // tile is the request storm mediaMeta's cache exists to prevent, and a
    // grid full of placeholders is worse than a quiet one.
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
    // Zero is a real length for a video, unlike for an image.
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
    // "no floor" has to include entries the index has not measured, or turning
    // a filter off would still hide unmeasured files.
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
    // 3840x1080 clears a width-only test, which would put a 32:9 LED strip in
    // the 4K bucket. The height ratio is what stops it.
    expect(
      meetsFloor(entry(), { "C:/a.mp4": { width: 3840, height: 1080, duration: 1 } }, 3840),
    ).toBe(false);
  });

  it("does not count an unmeasured entry against any floor", () => {
    // Otherwise picking 4K would look like it was deleting files it simply
    // had not measured yet.
    expect(meetsFloor(entry({ source: "C:/unknown.mp4" }), index, 3840)).toBe(false);
  });

  it("counts a genuine 32:9 4K ultrawide as 4K", () => {
    // 3840x1600 is well short of 2160 tall but is a real 4K-class frame, and a
    // strict 16:9 test would exclude every ultrawide from the 4K bucket.
    expect(
      meetsFloor(entry(), { "C:/a.mp4": { width: 3840, height: 1600, duration: 1 } }, 3840),
    ).toBe(true);
  });

  it("keeps 720p out of the 1080p floor", () => {
    // The bug that fixed the model: floors named by height but compared to
    // width let a 1280x720 file through a 1080p filter.
    const at1080 = { "C:/a.mp4": { width: 1920, height: 1080, duration: 1 } };
    expect(meetsFloor(entry(), at1080, 1920)).toBe(true);
    expect(
      meetsFloor(entry(), { "C:/a.mp4": { width: 1280, height: 720, duration: 1 } }, 1920),
    ).toBe(false);
  });
});