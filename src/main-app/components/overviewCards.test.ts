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

/**
 * A profile fixture holding only what these functions read.
 *
 * Cast at the fixture boundary rather than spelled out field by field, for the
 * reason `profileMatch.test.ts` gives: `WallpaperConfig` and `RgbConfig` carry
 * volume, slideshow, mixer, zones and device names, none of which any assertion
 * here touches. The defaults are complete so that a fixture omitting one cannot
 * read as `undefined` at runtime and quietly change an answer.
 */
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

/** `count` profiles named p0..pN-1, in order. */
const many = (count: number): SceneProfile[] =>
  Array.from({ length: count }, (_, i) => profile(`p${i}`));

/**
 * A hotkey config where every action is unbound, with `over` applied.
 *
 * Built from `HOTKEY_ACTIONS` rather than a hand-written list so a new action
 * added to the catalogue is covered by default instead of reading as `undefined`
 * and throwing inside `globalHotkeyState`.
 */
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
    // First in, first shown: truncating must not reshuffle the list.
    expect(r.shown[0]!.id).toBe("p0");
    expect(r.shown[OVERVIEW_PROFILE_LIMIT - 1]!.id).toBe("p4");
  });

  it("keeps the applied profile visible even when it is past the cut", () => {
    // The bug this exists for: apply p7 from Settings, and a card that
    // truncates by position shows nothing that says what is running.
    const scenes = many(8);
    const r = visibleProfiles(scenes, "p7");
    expect(r.shown.map((s) => s.id)).toContain("p7");
    expect(r.hidden).toBe(3);
  });

  it("displaces the last row rather than appending, so the count holds", () => {
    const scenes = many(8);
    const r = visibleProfiles(scenes, "p7");
    expect(r.shown).toHaveLength(OVERVIEW_PROFILE_LIMIT);
    // The cut stays at the end of the list: p4 is the row that goes, and p5
    // does not jump forward to take its place. The active profile is added to
    // the visible window, it does not reorder it.
    expect(r.shown.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3", "p7"]);
  });

  it("leaves the list alone when the applied profile is already shown", () => {
    const r = visibleProfiles(many(8), "p2");
    expect(r.shown.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("ignores an applied id that is no longer in the list", () => {
    // Deleting from the picker leaves the header holding a ghost id. It must
    // not evict a real row looking for something that is gone.
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
  // The overlay's real shape: palette, five Ctrl+digit tabs, then three more.
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
    // Palette first, then the folded tabs, then the rest: order is the
    // overlay's order with the run collapsed in place.
    expect(out[0]!.what).toBe("Command palette");
    expect(out[1]!.what).toBe(LABEL);
    expect(out[2]!.what).toBe("Collapse / expand sidebar");
  });

  it("leaves a non-tab Ctrl row alone", () => {
    // Ctrl+B is the only remaining Ctrl+letter binding; folding on digits is
    // what keeps it from disappearing into the tab group.
    const out = condenseWindowShortcuts(rows, LABEL);
    expect(out.some((r) => r.what === "Collapse / expand sidebar")).toBe(true);
  });

  it("does not fold a lone digit binding into a range", () => {
    const one = [
      { keys: ["Ctrl", "K"], what: "Command palette" },
      { keys: ["Ctrl", "1"], what: "Overview" },
      { keys: ["Esc"], what: "Close / go back" },
    ];
    // A single tab is a real binding, not a range: "Ctrl 1" would claim keys
    // that are not bound to anything.
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
    // "Ctrl+Shift+1" is a different binding shape and must stay its own row.
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
    // "Ctrl+A+B" has two key tokens, so there is no one key to draw.
    expect(splitAccelerator("Ctrl+A+B")).toEqual([]);
  });

  it("returns nothing rather than echoing a combo that will not parse", () => {
    // The Settings row shows these in red; a card that printed one back would
    // look like a working binding.
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
    // HOTKEY_ACTIONS order, so the card lists actions the same way every
    // time instead of reshuffling as the config object changes.
    expect(s.bound.map((r) => r.id)).toEqual(["toggleDashboard", "nextWallpaper"]);
  });

  it("counts bindings as bound but dormant while the master switch is off", () => {
    // The distinction the old card could not make: these keys are not taken,
    // but they are not unbound either, and reporting them as unbound sends the
    // user to rebind keys they already bound.
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
    // The old strip suppressed "lighting off" whenever anything else was
    // wrong, so a machine with OpenRGB down and the lights off was told about
    // one of the two and nothing about the other.
    expect(attentionItems({ rgbConnected: false, wallpaperPaused: true, lightingEnabled: false }).map((i) => i.id)).toEqual([
      "openrgb-offline",
      "wallpaper-paused",
      "lighting-off",
    ]);
  });

  it("puts the offline engine first", () => {
    // It is the reason the rest may be consequences rather than choices, and
    // the one that is not fixed from this screen.
    const ids = attentionItems({ rgbConnected: false, wallpaperPaused: false, lightingEnabled: false }).map((i) => i.id);
    expect(ids[0]).toBe("openrgb-offline");
  });

  it("offers the click that fixes each item", () => {
    const items = attentionItems({ rgbConnected: false, wallpaperPaused: true, lightingEnabled: false });
    expect(items[0]!.action).toEqual({ kind: "navigate", tab: "rgb" });
    expect(items[1]!.action).toEqual({ kind: "navigate", tab: "wallpaper" });
    // The master switch is on this very screen; sending someone to another tab
    // to find it is the thing this strip is replacing.
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
