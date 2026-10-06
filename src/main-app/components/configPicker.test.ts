import { describe, it, expect } from "vitest";
import {
  configName,
  isDuplicateConfigName,
  canDeleteProfile,
  configPendingKey,
  applyingConfigKey,
  wallpaperSourceLabel,
} from "./configPicker";

describe("configName", () => {
  it("keeps what was typed", () => {
    expect(configName("Night gaming", "Scene 2026-01-01")).toBe("Night gaming");
  });

  it("trims the ends", () => {
    // Leading and trailing space is invisible in the list and permanent in the
    // file, so it is dropped rather than stored.
    expect(configName("  Night  ", "fallback")).toBe("Night");
  });

  it("falls back when the field is blank", () => {
    expect(configName("", "fallback")).toBe("fallback");
    expect(configName("   ", "fallback")).toBe("fallback");
  });

  it("keeps a name that is only whitespace between words", () => {
    // The trap in a trim-based check: " " is empty and "Night gaming" is not,
    // but a name made of non-breaking space is a real attempt at a name.
    expect(configName("Night gaming", "fallback")).toBe("Night gaming");
  });
});

describe("wallpaperSourceLabel", () => {
  it("names local media by its filename", () => {
    expect(wallpaperSourceLabel("media://loop-4k.mp4")).toBe("loop-4k.mp4");
    expect(wallpaperSourceLabel("C:\\Users\\gab\\Pictures\\dusk.jpg")).toBe("dusk.jpg");
    expect(wallpaperSourceLabel("/home/gab/shot.png")).toBe("shot.png");
  });

  it("reads the localhost form the media protocol uses", () => {
    expect(wallpaperSourceLabel("media://localhost/C:/x.jpg")).toBe("x.jpg");
  });

  it("names a web source by its host, not its path", () => {
    // The page is what was chosen; the path under it is usually incidental,
    // and a full URL would never fit the line it has to sit in.
    expect(wallpaperSourceLabel("https://example.com/a/b?x=1")).toBe("example.com");
  });

  it("keeps a shader preset id as it is", () => {
    expect(wallpaperSourceLabel("aurora")).toBe("aurora");
  });

  it("prints something rather than nothing when it cannot read one", () => {
    expect(wallpaperSourceLabel("")).toBe("");
    // A source with separators but no name degrades to its last non-empty part.
    expect(wallpaperSourceLabel("media://")).toBe("media:");
  });
});

describe("isDuplicateConfigName", () => {
  it("accepts a name nobody has used", () => {
    expect(isDuplicateConfigName("Gaming", ["Work", "Night"])).toBe(false);
  });

  it("rejects an exact repeat", () => {
    expect(isDuplicateConfigName("Night", ["Work", "Night"])).toBe(true);
  });

  it("ignores case", () => {
    // Two entries reading as "Night" and "night" look like a bug in a list of
    // eight, so they count as the same name.
    expect(isDuplicateConfigName("NIGHT", ["night"])).toBe(true);
  });

  it("ignores surrounding space on either side", () => {
    expect(isDuplicateConfigName("  Night  ", ["Night"])).toBe(true);
    expect(isDuplicateConfigName("Night", ["  Night  "])).toBe(true);
  });

  it("is not a duplicate of itself when nothing is saved yet", () => {
    expect(isDuplicateConfigName("Night", [])).toBe(false);
  });

  it("does not block a blank name, which falls back to a date instead", () => {
    // A blank field is not "a config called ''" — it never gets that far.
    expect(isDuplicateConfigName("", ["Night"])).toBe(false);
    expect(isDuplicateConfigName("   ", ["Night"])).toBe(false);
  });
});

describe("canDeleteProfile", () => {
  it("allows a delete while more than one profile exists", () => {
    expect(canDeleteProfile(2)).toBe(true);
    expect(canDeleteProfile(7)).toBe(true);
  });

  it("refuses the last one", () => {
    // The header avatar would have nothing to show and the only route back to a
    // liked setup would be gone.
    expect(canDeleteProfile(1)).toBe(false);
  });

  it("stays refused at zero, where there is nothing left to delete", () => {
    expect(canDeleteProfile(0)).toBe(false);
  });
});

describe("applyingConfigKey", () => {
  it("round-trips a config id through its pending key", () => {
    // What the picker compares against `scene.id`, so it has to come back as
    // the bare id rather than the prefixed key it was stored under.
    expect(applyingConfigKey([configPendingKey("s7")])).toBe("s7");
  });

  it("returns null when nothing is in flight", () => {
    expect(applyingConfigKey([])).toBeNull();
  });

  it("ignores the capture key", () => {
    // Saving writes a config; it does not apply one. Reading it as an apply
    // would put a spinner on whichever row happens to be named after it.
    expect(applyingConfigKey(["scene-save"])).toBeNull();
  });

  it("ignores unrelated actions sharing the component", () => {
    // Overview runs every pending key of the whole tab through one set.
    expect(applyingConfigKey(["mute", "scene-abc"])).toBe("abc");
    expect(applyingConfigKey(["mute", "gallery"])).toBeNull();
  });

  it("does not lose the in-flight apply when a later press is refused", () => {
    // The exclusive guard turns the second press into a no-op while the first
    // is still running. Whichever key is in the set is the truth.
    expect(applyingConfigKey(new Set(["scene-abc"]))).toBe("abc");
  });
});
