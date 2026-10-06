import { describe, expect, it } from "vitest";
import { actionsFor, CONTEXT_BOOST, navDigit, SECTION_TAB, stepClamped, stepIndex, withContextBoost } from "./paletteActions";

// Mirrors TabId in Sidebar.tsx. The module is typed against that union, so
// this list is the runtime half of the same contract: if a tab is added or
// renamed, one of the checks below fails rather than the palette quietly
// navigating to an id the Shell does not know.
const TABS = ["overview", "rgb", "wallpaper", "stickers", "general"];

describe("SECTION_TAB", () => {
  it("only names real tabs", () => {
    for (const [group, tab] of Object.entries(SECTION_TAB)) {
      expect(tab === null || TABS.includes(tab), `${group} -> ${tab}`).toBe(true);
    }
  });

  it("omits jumps that would be nonsense", () => {
    expect(SECTION_TAB.navigate).toBeNull(); // it already is navigation
    expect(SECTION_TAB.scene).toBeNull(); // profiles open from the avatar
    expect(SECTION_TAB.app).toBeNull(); // quit and wipe leave the app
  });

  it("sends each owning section to its tab", () => {
    expect(SECTION_TAB.wallpaper).toBe("wallpaper");
    expect(SECTION_TAB.wallpapers).toBe("wallpaper");
    expect(SECTION_TAB.playback).toBe("wallpaper");
    expect(SECTION_TAB.rgb).toBe("rgb");
    expect(SECTION_TAB.config).toBe("general");
  });
});

describe("actionsFor", () => {
  it("leads with run, then pin state, then the jump", () => {
    expect(actionsFor("rgb", false)).toEqual(["run", "pin", "goto"]);
    expect(actionsFor("rgb", true)).toEqual(["run", "unpin", "goto"]);
  });

  it("offers no section jump where there is none", () => {
    expect(actionsFor("navigate", false)).toEqual(["run", "pin"]);
    expect(actionsFor("app", false)).toEqual(["run", "pin"]);
    expect(actionsFor("scene", true)).toEqual(["run", "unpin"]);
  });

  it("degrades an unknown group to run and pin rather than dead-ending", () => {
    expect(actionsFor("brand-new-group", false)).toEqual(["run", "pin"]);
  });
});

describe("navDigit", () => {
  it("numbers the tabs in sidebar order, General last", () => {
    expect(navDigit("overview")).toBe(1);
    expect(navDigit("rgb")).toBe(2);
    expect(navDigit("wallpaper")).toBe(3);
    expect(navDigit("stickers")).toBe(4);
    expect(navDigit("general")).toBe(5);
  });

  it("is null for anything that is not a tab", () => {
    expect(navDigit("nowhere")).toBeNull();
  });
});

describe("stepClamped", () => {
  it("steps by the knob's own granularity", () => {
    expect(stepClamped(0.5, 1, 0.05, 0, 1)).toBeCloseTo(0.55, 6);
    expect(stepClamped(0.5, -1, 0.05, 0, 1)).toBeCloseTo(0.45, 6);
  });

  it("stops at the ends instead of wrapping", () => {
    expect(stepClamped(1, 1, 0.05, 0, 1)).toBe(1);
    expect(stepClamped(0, -1, 0.05, 0, 1)).toBe(0);
  });

  it("does not accumulate float drift across held repeats", () => {
    let v = 0;
    for (let i = 0; i < 7; i++) v = stepClamped(v, 1, 0.05, 0, 1);
    expect(v).toBeCloseTo(0.35, 6);
    expect(Math.round(v * 100)).toBe(35);
  });
});

describe("stepIndex", () => {
  it("advances and wraps", () => {
    expect(stepIndex(0, 3)).toBe(1);
    expect(stepIndex(2, 3)).toBe(0);
  });

  it("starts at 0 when nothing in the list is current", () => {
    expect(stepIndex(-1, 3)).toBe(0);
  });

  it("returns -1 for an empty list so the caller can skip the apply", () => {
    expect(stepIndex(-1, 0)).toBe(-1);
    expect(stepIndex(0, 0)).toBe(-1);
  });

  it("tolerates a current index from outside the list", () => {
    expect(stepIndex(5, 3)).toBe(0);
  });
});

describe("withContextBoost", () => {
  it("lifts a row whose section belongs to the open tab", () => {
    expect(withContextBoost(600, "rgb", "rgb")).toBe(600 + CONTEXT_BOOST);
  });

  it("leaves other sections, unknown groups and no-tab alone", () => {
    expect(withContextBoost(600, "config", "rgb")).toBe(600);
    expect(withContextBoost(600, "brand-new", "rgb")).toBe(600);
    expect(withContextBoost(600, "rgb", null)).toBe(600);
  });

  it("is smaller than the scorer's smallest tier gap", () => {
    // The tiers in paletteScore are 100+ apart; a bigger boost could pull a
    // substring match past a prefix match and make typing lie.
    expect(CONTEXT_BOOST).toBeLessThan(100);
  });
});
