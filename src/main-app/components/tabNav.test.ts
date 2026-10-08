import { describe, expect, it } from "vitest";
import {
  ALL_ANCHORS,
  ALL_TABS,
  TAB_ANCHORS,
  anchorSelector,
  isAnchorFor,
  isTabId,
  TABS,
  type TabId,
} from "./Sidebar";
import { useStore } from "../store";

const RAW_TABS = import.meta.glob("./tabs/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const TAB_SOURCE: Record<TabId, string> = {
  overview: "./tabs/OverviewTab.tsx",
  rgb: "./tabs/RgbTab.tsx",
  wallpaper: "./tabs/WallpaperTab.tsx",
  stickers: "./tabs/StickersTab.tsx",
  general: "./tabs/GeneralTab.tsx",
};

function tabSource(tab: TabId): string {
  const src = RAW_TABS[TAB_SOURCE[tab]];
  if (typeof src !== "string") {
    throw new Error(`no source globbed for ${tab} at ${TAB_SOURCE[tab]}`);
  }
  return src;
}

describe("isTabId", () => {
  it("accepts every tab the dashboard renders", () => {
    for (const tab of ALL_TABS) expect(isTabId(tab.id)).toBe(true);
  });

  it("accepts the settings tab", () => {
    expect(isTabId("general")).toBe(true);
    expect(TABS.some((tab) => tab.id === "general")).toBe(false);
  });

  it("rejects anything the dashboard cannot render", () => {
    for (const id of ["", "gallery", "overview ", "OVERVIEW", "nope"]) {
      expect(isTabId(id)).toBe(false);
    }
  });
});

describe("anchorSelector", () => {
  it("quotes the value so a selector cannot be malformed", () => {
    expect(anchorSelector("two words")).toBe('[data-anchor="two words"]');
    expect(anchorSelector("lighting-mode")).toBe('[data-anchor="lighting-mode"]');
  });

  it("escapes a quote so the value cannot end the attribute early", () => {
    expect(anchorSelector('a"b')).toBe('[data-anchor="a\\"b"]');
  });
});

describe("TAB_ANCHORS", () => {
  it("names anchors that the markup actually publishes", () => {
    for (const tab of ALL_TABS) {
      const src = tabSource(tab.id);
      for (const anchor of TAB_ANCHORS[tab.id]) {
        expect(src, `${tab.id}/${anchor}`).toContain(`anchor="${anchor}"`);
      }
    }
  });

  it("publishes no anchor the registry has not heard of", () => {
    for (const tab of ALL_TABS) {
      const src = tabSource(tab.id);
      const marked = [...src.matchAll(/anchor="([\w-]+)"/g)].map((m) => m[1]!);
      for (const anchor of marked) {
        expect(TAB_ANCHORS[tab.id], `${tab.id}/${anchor}`).toContain(anchor);
      }
    }
  });

  it("keeps anchor names unique within a tab", () => {
    for (const tab of ALL_TABS) {
      const list = TAB_ANCHORS[tab.id];
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("labels every anchor by tab", () => {
    expect(ALL_ANCHORS).toEqual([
      "rgb/devices",
      "rgb/automation",
      "rgb/lighting-mode",
      "wallpaper/vault",
    ]);
  });
});

describe("isAnchorFor", () => {
  it("accepts a declared anchor on its own tab", () => {
    expect(isAnchorFor("rgb", "devices")).toBe(true);
    expect(isAnchorFor("wallpaper", "vault")).toBe(true);
  });

  it("rejects an anchor belonging to another tab", () => {
    expect(isAnchorFor("rgb", "vault")).toBe(false);
    expect(isAnchorFor("overview", "devices")).toBe(false);
  });

  it("rejects a typo rather than scrolling nowhere", () => {
    expect(isAnchorFor("rgb", "devicez")).toBe(false);
  });
});

describe("navRequest", () => {
  it("carries a request and clears once applied", () => {
    const store = useStore.getState();
    expect(store.navRequest).toBeNull();
    store.navigateTo("general");
    expect(useStore.getState().navRequest).toEqual({
      tab: "general",
      anchor: undefined,
    });
    useStore.getState().clearNavRequest();
    expect(useStore.getState().navRequest).toBeNull();
  });

  it("carries an anchor alongside the tab", () => {
    useStore.getState().navigateTo("rgb", "lighting-mode");
    expect(useStore.getState().navRequest).toEqual({
      tab: "rgb",
      anchor: "lighting-mode",
    });
    useStore.getState().clearNavRequest();
  });

  it("is a fresh object per call, so the same destination can repeat", () => {
    useStore.getState().navigateTo("wallpaper", "vault");
    const first = useStore.getState().navRequest;
    useStore.getState().clearNavRequest();
    useStore.getState().navigateTo("wallpaper", "vault");
    const second = useStore.getState().navRequest;
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
    useStore.getState().clearNavRequest();
  });

  it("holds arbitrary strings rather than TabId", () => {
    useStore.getState().navigateTo("not-a-tab", "also-not-real");
    const request = useStore.getState().navRequest!;
    expect(isTabId(request.tab)).toBe(false);
    expect(request.anchor && isAnchorFor("rgb", request.anchor)).toBeFalsy();
    useStore.getState().clearNavRequest();
  });
});
