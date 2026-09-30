import { describe, it, expect } from "vitest";
import {
  extensionOf,
  kindForPath,
  nameForPath,
  resolvePicked,
} from "./mediaKind";

// Built from a char code rather than written out: a literal backslash in this
// file has been mangled in transit before, and a broken character class fails
// at import time with an error that points nowhere near the cause.
const BS = String.fromCharCode(92);
const win = (name: string) => `C:` + BS + `Users` + BS + `g` + BS + `Media` + BS + name;
const posix = (name: string) => `/home/g/Media/${name}`;

describe("extensionOf", () => {
  it("reads the extension from a Windows path", () => {
    expect(extensionOf(win("clip.mp4"))).toBe("mp4");
  });

  it("reads the extension from a POSIX path", () => {
    expect(extensionOf(posix("still.JPEG"))).toBe("jpeg");
  });

  it("lowercases so the extension sets need only one case", () => {
    expect(extensionOf(win("CLIP.MP4"))).toBe("mp4");
  });

  it("has no extension when the name has no dot", () => {
    expect(extensionOf(win("README"))).toBe("");
  });

  it("treats a leading dot as part of the name, not an extension", () => {
    expect(extensionOf(win(".gitignore"))).toBe("");
  });

  it("uses the last dot when the name contains several", () => {
    expect(extensionOf(win("my.holiday.2024.mp4"))).toBe("mp4");
  });
});

describe("kindForPath", () => {
  it("reads the common video containers as video", () => {
    for (const ext of ["mp4", "webm", "mov", "mkv"]) {
      expect(kindForPath(win("clip." + ext))).toBe("video");
    }
  });

  it("reads the common still formats as image", () => {
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "bmp"]) {
      expect(kindForPath(win("still." + ext))).toBe("image");
    }
  });

  it("returns null for anything the dialog could not have offered", () => {
    expect(kindForPath(win("notes.txt"))).toBeNull();
    expect(kindForPath(win("wallpaper.lively"))).toBeNull();
    expect(kindForPath(win("noextension"))).toBeNull();
    expect(kindForPath("")).toBeNull();
  });
});

describe("nameForPath", () => {
  it("strips the directory and the extension", () => {
    expect(nameForPath(win("my clip.mp4"))).toBe("my clip");
  });

  it("keeps the dots that are part of the name", () => {
    expect(nameForPath(win("v1.2.final.png"))).toBe("v1.2.final");
  });

  it("keeps a name that is only an extension-less word", () => {
    expect(nameForPath(win("Untitled"))).toBe("Untitled");
  });

  it("never returns an empty name, whatever it is handed", () => {
    // The vault falls back to a placeholder on an empty name, but that should
    // never be this function's job to trigger.
    expect(nameForPath("")).toBe("Untitled");
    expect(nameForPath(win(""))).toBe("Untitled");
  });

  it("keeps a dotfile name as-is rather than inventing a stem", () => {
    // ".mp4" has no stem, so there is nothing to strip and nothing to add; the
    // file is simply named that.
    expect(nameForPath(win(".mp4"))).toBe(".mp4");
  });
});

describe("resolvePicked", () => {
  it("resolves each path to a kind and a name", () => {
    expect(resolvePicked([win("a.mp4"), posix("b.png")])).toEqual([
      { path: win("a.mp4"), kind: "video", name: "a" },
      { path: posix("b.png"), kind: "image", name: "b" },
    ]);
  });

  it("drops the paths it cannot classify rather than guessing", () => {
    // Guessing would put a text file in the vault as a wallpaper that renders
    // nothing, which is worse than not adding it.
    const out = resolvePicked([win("a.mp4"), win("notes.txt"), win("b.png")]);
    expect(out.map((o) => o.name)).toEqual(["a", "b"]);
  });

  it("keeps order, so the last one picked is the last one applied", () => {
    expect(resolvePicked([win("1.mp4"), win("2.mp4"), win("3.mp4")]).at(-1)?.name).toBe("3");
  });
});
