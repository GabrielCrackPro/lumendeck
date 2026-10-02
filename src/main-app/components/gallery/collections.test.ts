import { describe, expect, it } from "vitest";
import {
  coverFor,
  isReadyUrl,
  liveCount,
  membershipDiff,
  visibleSelection,
} from "./collections";
import type { GalleryEntry, WallpaperKind } from "@shared/types";

const entry = (over: Partial<GalleryEntry> & { id: string }): GalleryEntry => ({
  name: over.id,
  kind: "video" as WallpaperKind,
  source: `C:/wall/${over.id}.mp4`,
  addedMs: 0,
  ...over,
});

// What the backend actually stores: a finished URL, not a path.
const THUMB = "http://media.localhost/C:/Users/x/AppData/Roaming/LumenDeck/thumbs/a.jpg";

describe("isReadyUrl", () => {
  it("recognises a URL the backend already built", () => {
    // The regression: this value was being run through convertFileSrc again,
    // which prefixes a second protocol onto a complete URL.
    expect(isReadyUrl(THUMB)).toBe(true);
    expect(isReadyUrl("media://localhost/C:/x.jpg")).toBe(true);
    expect(isReadyUrl("//cdn/x.jpg")).toBe(true);
  });

  it("leaves a filesystem path alone so it still gets converted", () => {
    expect(isReadyUrl("C:/Users/x/Pictures/a.jpg")).toBe(false);
    expect(isReadyUrl("\\\\server\\share\\a.jpg")).toBe(false);
  });
});

describe("coverFor", () => {
  const art = { aurora: "linear-gradient(...)" };

  it("uses the stored thumbnail verbatim, without re-encoding it", () => {
    const c = coverFor({ entryIds: ["a"] }, [entry({ id: "a", thumb: THUMB })], art);
    expect(c).toEqual({ kind: "image", url: THUMB, convert: false });
  });

  it("falls back to the source path when there is no thumbnail", () => {
    const c = coverFor({ entryIds: ["a"] }, [entry({ id: "a" })], art);
    expect(c).toEqual({ kind: "image", url: "C:/wall/a.mp4", convert: true });
  });

  it("skips members whose file was deleted", () => {
    // The id stays in entryIds forever, so a removed first entry would
    // otherwise leave the collection showing nothing while its second member
    // sits right there.
    const c = coverFor(
      { entryIds: ["gone", "here"] },
      [entry({ id: "here", thumb: THUMB })],
      art,
    );
    expect(c).toEqual({ kind: "image", url: THUMB, convert: false });
  });

  it("is empty when every member is gone", () => {
    expect(coverFor({ entryIds: ["a", "b"] }, [], art)).toEqual({ kind: "empty" });
    expect(coverFor({ entryIds: [] }, [entry({ id: "a" })], art)).toEqual({
      kind: "empty",
    });
  });

  it("prefers a member that already has a thumbnail over one that does not", () => {
    const c = coverFor(
      { entryIds: ["plain", "cached"] },
      [entry({ id: "plain" }), entry({ id: "cached", thumb: THUMB })],
      art,
    );
    expect(c).toEqual({ kind: "image", url: THUMB, convert: false });
  });

  it("prefers an image file over a video when neither has a thumbnail", () => {
    const c = coverFor(
      { entryIds: ["v", "i"] },
      [entry({ id: "v" }), entry({ id: "i", kind: "image", source: "C:/wall/i.png" })],
      art,
    );
    expect(c).toEqual({ kind: "image", url: "C:/wall/i.png", convert: true });
  });

  it("draws a shader as its gradient rather than as a broken image", () => {
    const c = coverFor(
      { entryIds: ["s"] },
      [entry({ id: "s", kind: "shader", source: "aurora" })],
      art,
    );
    expect(c).toEqual({ kind: "shader", art: "linear-gradient(...)" });
  });

  it("gives a web wallpaper an icon, not a nonsense file path", () => {
    // source is a URL here. Treating it as a path produces a request for a
    // file called "https:" and shows an empty frame.
    const c = coverFor(
      { entryIds: ["w"] },
      [entry({ id: "w", kind: "web", source: "https://example.com/x.mp4" })],
      art,
    );
    expect(c).toEqual({ kind: "web" });
  });

  it("gives a slideshow folder an icon too", () => {
    const c = coverFor(
      { entryIds: ["s"] },
      [entry({ id: "s", kind: "slideshow", source: "C:/pics" })],
      art,
    );
    expect(c).toEqual({ kind: "slideshow" });
  });

  it("falls back to another member when the best-ranked one is a shader", () => {
    const c = coverFor(
      { entryIds: ["s", "v"] },
      [entry({ id: "s", kind: "shader", source: "aurora" }), entry({ id: "v", thumb: THUMB })],
      art,
    );
    expect(c).toEqual({ kind: "image", url: THUMB, convert: false });
  });
});

describe("liveCount", () => {
  it("counts only members that still exist", () => {
    expect(liveCount({ entryIds: ["a", "gone"] }, [entry({ id: "a" })])).toBe(1);
  });

  it("is zero for an empty collection", () => {
    expect(liveCount({ entryIds: [] }, [entry({ id: "a" })])).toBe(0);
  });
});

describe("membershipDiff", () => {
  it("splits ids into new and already-present", () => {
    const d = membershipDiff({ entryIds: ["a"] }, ["a", "b"]);
    expect(d).toEqual({ toAdd: ["b"], alreadyIn: ["a"] });
  });

  it("collapses a repeated id so it is not toggled twice", () => {
    // Two toggles of the same entry is a removal, not an add.
    const d = membershipDiff({ entryIds: [] }, ["a", "a", "a"]);
    expect(d.toAdd).toEqual(["a"]);
  });

  it("adding to an empty collection is all additions", () => {
    const d = membershipDiff({ entryIds: [] }, ["a", "b"]);
    expect(d).toEqual({ toAdd: ["a", "b"], alreadyIn: [] });
  });

  it("adding a selection that is already entirely present changes nothing", () => {
    const d = membershipDiff({ entryIds: ["a", "b"] }, ["a", "b"]);
    expect(d.toAdd).toEqual([]);
    expect(d.alreadyIn).toEqual(["a", "b"]);
  });

  it("preserves the selection order", () => {
    const d = membershipDiff({ entryIds: [] }, ["c", "a", "b"]);
    expect(d.toAdd).toEqual(["c", "a", "b"]);
  });
});

describe("visibleSelection", () => {
  it("splits the selection into on-screen and hidden", () => {
    const r = visibleSelection(new Set(["a", "b", "z"]), ["a", "b"]);
    expect(r.visible).toEqual(["a", "b"]);
    expect(r.hiddenCount).toBe(1);
  });

  it("is everything visible when nothing is filtered away", () => {
    const r = visibleSelection(new Set(["a", "b"]), ["a", "b"]);
    expect(r).toEqual({ visible: ["a", "b"], hiddenCount: 0 });
  });

  it("reports a fully hidden selection rather than pretending it is empty", () => {
    // This is the bug: the bar reads "5 selected" over a grid showing none of
    // them, and the bulk delete acts on all five.
    const r = visibleSelection(new Set(["a", "b"]), ["x", "y"]);
    expect(r.visible).toEqual([]);
    expect(r.hiddenCount).toBe(2);
  });
});
