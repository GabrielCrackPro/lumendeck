import { describe, it, expect } from "vitest";
import {
  OVERVIEW_PROFILE_LIMIT,
  visibleProfiles,
  profileSummary,
  condenseWindowShortcuts,
  splitAccelerator,
  globalHotkeyState,
  attentionItems,
  greetingKeyForHour,
  recencyBucket,
  recencyValue,
} from "./overviewCards";
import { HOTKEY_ACTIONS, type HotkeyActionId } from "@shared/constants";
import type { HotkeyConfig, SceneProfile, StickerDef } from "@shared/types";

const sticker = (id: string): StickerDef =>
  ({
    id,
    name: id,
    x: 10,
    y: 20,
    w: 100,
    h: 100,
    visible: true,
  } as StickerDef);

const profile = (id: string, over: Partial<SceneProfile> = {}): SceneProfile =>
  ({
    id,
    name: id,
    wallpaper: { kind: "image", source: "C:/vault/a.png" },
    rgb: { mode: "ambient", animationSpeed: 1 },
    stickers: [],
    logo: null,
    createdMs: 0,
    ...over,
  } as SceneProfile);

const many = (count: number): SceneProfile[] =>
  Array.from({ length: count }, (_, i) => profile(`p${i}`));

const hotkeys = (over: Partial<Record<HotkeyActionId, string>> = {}): HotkeyConfig => {
  const out: Partial<Record<HotkeyActionId, { accelerator: string }>> = {};
  for (const { id } of HOTKEY_ACTIONS) out[id] = { accelerator: over[id] ?? "" };
  return out as HotkeyConfig;
};

describe("visibleProfiles", () => {
  it("shows everything when the list already fits", () => {
    const scenes = many(3);
    const r = visibleProfiles(scenes, null);
    expect(r.shown).toEqual(scenes);
    expect(r.hidden).toBe(0);
  });

  it("truncates to the limit and counts the rest", () => {
    const r = visibleProfiles(many(8), null);
    expect(r.shown).toHaveLength(OVERVIEW_PROFILE_LIMIT);
    expect(r.hidden).toBe(3);
    expect(r.shown[0]!.id).toBe("p0");
    expect(r.shown[OVERVIEW_PROFILE_LIMIT - 1]!.id).toBe("p4");
  });

  it("keeps the applied profile visible even when it is past the cut", () => {
    const scenes = many(8);
    const r = visibleProfiles(scenes, "p7");
    expect(r.shown.map((s) => s.id)).toContain("p7");
    expect(r.hidden).toBe(3);
  });

  it("displaces the last row rather than appending, so the count holds", () => {
    const scenes = many(8);
    const r = visibleProfiles(scenes, "p7");
    expect(r.shown).toHaveLength(OVERVIEW_PROFILE_LIMIT);
    expect(r.shown.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3", "p7"]);
  });

  it("leaves the list alone when the applied profile is already shown", () => {
    const r = visibleProfiles(many(8), "p2");
    expect(r.shown.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("ignores an applied id that is no longer in the list", () => {
    const r = visibleProfiles(many(8), "deleted");
    expect(r.shown.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    expect(r.hidden).toBe(3);
  });

  it("handles an empty list", () => {
    const r = visibleProfiles([], null);
    expect(r.shown).toEqual([]);
    expect(r.hidden).toBe(0);
  });
});

describe("profileSummary", () => {
  it("reports the wallpaper kind, lighting mode and sticker count", () => {
    const scene = profile("a", {
      wallpaper: {
        kind: "video",
        source: "C:/vault/a.mp4",
      } as SceneProfile["wallpaper"],
      rgb: { mode: "wave" } as SceneProfile["rgb"],
      stickers: [sticker("s1"), sticker("s2")],
    });
    expect(profileSummary(scene)).toEqual({
      kind: "video",
      mode: "wave",
      stickers: 2,
    });
  });

  it("counts a profile saved before stickers were captured as none", () => {
    expect(profileSummary(profile("a")).stickers).toBe(0);
  });
});

describe("condenseWindowShortcuts", () => {
  const LABEL = "Switch tab";
  const rows = [
    { keys: ["Ctrl", "K"], what: "Command palette" },
    { keys: ["Ctrl", "1"], what: "Overview" },
    { keys: ["Ctrl", "2"], what: "Lighting" },
    { keys: ["Ctrl", "3"], what: "Wallpaper" },
    { keys: ["Ctrl", "4"], what: "Stickers" },
    { keys: ["Ctrl", "5"], what: "Settings" },
    { keys: ["Ctrl", "B"], what: "Collapse / expand sidebar" },
    { keys: ["?"], what: "This list" },
    { keys: ["Esc"], what: "Close / go back" },
  ];

  it("folds the five tab rows into one", () => {
    const out = condenseWindowShortcuts(rows, LABEL);
    expect(out).toHaveLength(5);
    expect(out.map((r) => r.what)).toEqual([
      "Command palette",
      LABEL,
      "Collapse / expand sidebar",
      "This list",
      "Close / go back",
    ]);
  });

  it("writes the digit range from the first and last tab", () => {
    const out = condenseWindowShortcuts(rows, LABEL);
    expect(out[1]!.keys).toEqual(["Ctrl", "1-5"]);
  });

  it("keeps the folded row where the first tab was, not at the end", () => {
    const out = condenseWindowShortcuts(rows, LABEL);
    expect(out[0]!.what).toBe("Command palette");
    expect(out[1]!.what).toBe(LABEL);
    expect(out[2]!.what).toBe("Collapse / expand sidebar");
  });

  it("leaves a non-tab Ctrl row alone", () => {
    const out = condenseWindowShortcuts(rows, LABEL);
    expect(out.some((r) => r.what === "Collapse / expand sidebar")).toBe(true);
  });

  it("does not fold a lone digit binding into a range", () => {
    const one = [
      { keys: ["Ctrl", "K"], what: "Command palette" },
      { keys: ["Ctrl", "1"], what: "Overview" },
      { keys: ["Esc"], what: "Close / go back" },
    ];
    expect(condenseWindowShortcuts(one, LABEL)).toEqual(one);
  });

  it("returns the rows untouched when there are no tab rows", () => {
    const none = [
      { keys: ["Ctrl", "K"], what: "Command palette" },
      { keys: ["Esc"], what: "Close / go back" },
    ];
    expect(condenseWindowShortcuts(none, LABEL)).toEqual(none);
  });

  it("handles an empty list", () => {
    expect(condenseWindowShortcuts([], LABEL)).toEqual([]);
  });

  it("does not fold a digit row that has extra keys", () => {
    const shifted = [
      { keys: ["Ctrl", "1"], what: "Overview" },
      { keys: ["Ctrl", "2"], what: "Lighting" },
      { keys: ["Ctrl", "Shift", "3"], what: "Other" },
    ];
    const out = condenseWindowShortcuts(shifted, LABEL);
    expect(out.some((r) => r.what === "Other")).toBe(true);
    expect(out).toHaveLength(2);
  });
});

describe("splitAccelerator", () => {
  it("splits modifiers and the key into caps", () => {
    expect(splitAccelerator("Ctrl+Alt+D")).toEqual(["Ctrl", "Alt", "D"]);
  });

  it("reads Super as Win, the label on the key itself", () => {
    expect(splitAccelerator("Super+Shift+L")).toEqual(["Win", "Shift", "L"]);
  });

  it("normalises case", () => {
    expect(splitAccelerator("ctrl+alt+space")).toEqual(["Ctrl", "Alt", "space"]);
  });

  it("returns nothing for an empty accelerator", () => {
    expect(splitAccelerator("")).toEqual([]);
  });

  it("returns nothing for a combo with no single key", () => {
    expect(splitAccelerator("Ctrl+A+B")).toEqual([]);
  });

  it("returns nothing rather than echoing a combo that will not parse", () => {
    expect(splitAccelerator("Ctrl++")).toEqual([]);
  });
});

describe("globalHotkeyState", () => {
  it("reports nothing bound on a fresh install", () => {
    const s = globalHotkeyState(hotkeys(), true);
    expect(s.boundCount).toBe(0);
    expect(s.bound).toEqual([]);
    expect(s.dormant).toBe(false);
    expect(s.total).toBe(11);
  });

  it("counts and names the bound actions", () => {
    const s = globalHotkeyState(
      hotkeys({ toggleDashboard: "Ctrl+Alt+D", toggleMute: "Ctrl+Alt+M" }),
      true,
    );
    expect(s.boundCount).toBe(2);
    expect(s.bound.map((r) => r.id)).toEqual(["toggleDashboard", "toggleMute"]);
    expect(s.bound[0]!.caps).toEqual(["Ctrl", "Alt", "D"]);
    expect(s.dormant).toBe(false);
  });

  it("keeps the catalogue's order, not the config's key order", () => {
    const s = globalHotkeyState(
      hotkeys({ nextWallpaper: "Ctrl+Alt+N", toggleDashboard: "Ctrl+Alt+D" }),
      true,
    );
    expect(s.bound.map((r) => r.id)).toEqual(["toggleDashboard", "nextWallpaper"]);
  });

  it("counts bindings as bound but dormant while the master switch is off", () => {
    const s = globalHotkeyState(hotkeys({ toggleDashboard: "Ctrl+Alt+D" }), false);
    expect(s.boundCount).toBe(1);
    expect(s.dormant).toBe(true);
    expect(s.enabled).toBe(false);
  });

  it("is not dormant when the switch is off and nothing is bound", () => {
    const s = globalHotkeyState(hotkeys(), false);
    expect(s.boundCount).toBe(0);
    expect(s.dormant).toBe(false);
  });

  it("ignores a binding that is only whitespace", () => {
    expect(globalHotkeyState(hotkeys({ toggleMute: "   " }), true).boundCount).toBe(0);
  });

  it("skips a combo that will not parse rather than drawing empty caps", () => {
    const s = globalHotkeyState(
      hotkeys({ toggleDashboard: "Ctrl+Alt+D", toggleMute: "Ctrl+A+B" }),
      true,
    );
    expect(s.boundCount).toBe(1);
    expect(s.bound[0]!.id).toBe("toggleDashboard");
  });
});

describe("attentionItems", () => {
  const ok = { rgbConnected: true, wallpaperPaused: false, lightingEnabled: true };

  it("says nothing when nothing wants doing", () => {
    expect(attentionItems(ok)).toEqual([]);
  });

  it("reports every problem at once, not just the first", () => {
    expect(attentionItems({ rgbConnected: false, wallpaperPaused: true, lightingEnabled: false }).map((i) => i.id)).toEqual([
      "openrgb-offline",
      "wallpaper-paused",
      "lighting-off",
    ]);
  });

  it("puts the offline engine first", () => {
    const ids = attentionItems({ rgbConnected: false, wallpaperPaused: false, lightingEnabled: false }).map((i) => i.id);
    expect(ids[0]).toBe("openrgb-offline");
  });

  it("offers the click that fixes each item", () => {
    const items = attentionItems({ rgbConnected: false, wallpaperPaused: true, lightingEnabled: false });
    expect(items[0]!.action).toEqual({ kind: "navigate", tab: "rgb" });
    expect(items[1]!.action).toEqual({ kind: "navigate", tab: "wallpaper" });
    expect(items[2]!.action).toEqual({ kind: "toggle-lighting" });
  });

  it("keeps a paused wallpaper an issue even when the engine is fine", () => {
    expect(attentionItems({ ...ok, wallpaperPaused: true }).map((i) => i.id)).toEqual([
      "wallpaper-paused",
    ]);
  });
});

describe("greetingKeyForHour", () => {
  it("keeps the late-night salutation before five", () => {
    expect(greetingKeyForHour(0)).toBe("overview.up-late");
    expect(greetingKeyForHour(4)).toBe("overview.up-late");
  });

  it("flips to morning at five", () => {
    expect(greetingKeyForHour(5)).toBe("overview.good-morning");
    expect(greetingKeyForHour(11)).toBe("overview.good-morning");
  });

  it("flips to afternoon at noon", () => {
    expect(greetingKeyForHour(12)).toBe("overview.good-afternoon");
    expect(greetingKeyForHour(17)).toBe("overview.good-afternoon");
  });

  it("flips to evening at six and holds it through the last hour", () => {
    expect(greetingKeyForHour(18)).toBe("overview.good-evening");
    expect(greetingKeyForHour(23)).toBe("overview.good-evening");
  });
});

describe("recency", () => {
  it("calls anything inside five seconds now", () => {
    expect(recencyBucket(0)).toBe("now");
    expect(recencyBucket(4_999)).toBe("now");
  });

  it("moves to seconds, then minutes, then hours", () => {
    expect(recencyBucket(5_000)).toBe("seconds");
    expect(recencyBucket(59_999)).toBe("seconds");
    expect(recencyBucket(60_000)).toBe("minutes");
    expect(recencyBucket(3_599_999)).toBe("minutes");
    expect(recencyBucket(3_600_000)).toBe("hours");
  });

  it("does not print a raw second count for a change from yesterday", () => {
    expect(recencyValue(43_200_000)).toEqual({ value: 12, unit: "hours" });
  });

  it("reports the number in the unit the bucket implies", () => {
    expect(recencyValue(9_400)).toEqual({ value: 9, unit: "seconds" });
    expect(recencyValue(125_000)).toEqual({ value: 2, unit: "minutes" });
    expect(recencyValue(7_260_000)).toEqual({ value: 2, unit: "hours" });
  });

  it("treats a clock that went backwards as now rather than as nonsense", () => {
    expect(recencyBucket(-5_000)).toBe("now");
    expect(recencyBucket(Number.NaN)).toBe("now");
  });
});
