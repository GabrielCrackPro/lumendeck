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
    expect(configName("  Night  ", "fallback")).toBe("Night");
  });

  it("falls back when the field is blank", () => {
    expect(configName("", "fallback")).toBe("fallback");
    expect(configName("   ", "fallback")).toBe("fallback");
  });

  it("keeps a name that is only whitespace between words", () => {
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
    expect(wallpaperSourceLabel("https://example.com/a/b?x=1")).toBe("example.com");
  });

  it("keeps a shader preset id as it is", () => {
    expect(wallpaperSourceLabel("aurora")).toBe("aurora");
  });

  it("prints something rather than nothing when it cannot read one", () => {
    expect(wallpaperSourceLabel("")).toBe("");
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
    expect(canDeleteProfile(1)).toBe(false);
  });

  it("stays refused at zero, where there is nothing left to delete", () => {
    expect(canDeleteProfile(0)).toBe(false);
  });
});

describe("applyingConfigKey", () => {
  it("round-trips a config id through its pending key", () => {
    expect(applyingConfigKey([configPendingKey("s7")])).toBe("s7");
  });

  it("returns null when nothing is in flight", () => {
    expect(applyingConfigKey([])).toBeNull();
  });

  it("ignores the capture key", () => {
    expect(applyingConfigKey(["scene-save"])).toBeNull();
  });

  it("ignores unrelated actions sharing the component", () => {
    expect(applyingConfigKey(["mute", "scene-abc"])).toBe("abc");
    expect(applyingConfigKey(["mute", "gallery"])).toBeNull();
  });

  it("does not lose the in-flight apply when a later press is refused", () => {
    expect(applyingConfigKey(new Set(["scene-abc"]))).toBe("abc");
  });
});
