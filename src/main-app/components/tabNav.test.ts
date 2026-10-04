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

/**
 * Every tab component's source, read at build time.
 *
 * Through `import.meta.glob` rather than `node:fs` because the project ships
 * `types: ["vite/client"]` and no `@types/node` on purpose: application code is
 * browser code, and reading files off disk is not something it should be able to
 * do even in a test.
 */
const RAW_TABS = import.meta.glob("./tabs/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The component behind each tab, for the markup checks below. */
const TAB_SOURCE: Record<TabId, string> = {
  overview: "./tabs/OverviewTab.tsx",
  rgb: "./tabs/RgbTab.tsx",
  wallpaper: "./tabs/WallpaperTab.tsx",
  stickers: "./tabs/StickersTab.tsx",
  general: "./tabs/GeneralTab.tsx",
};

/** The source of a tab's component, failing loudly if the glob missed it. */
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
    // The trap this guards: SETTINGS_TAB is deliberately kept out of TABS so the
    // rail can render it after a hairline, so a guard written against TABS alone
    // would silently refuse the update toast's request to open the changelog.
    expect(isTabId("general")).toBe(true);
    expect(TABS.some((tab) => tab.id === "general")).toBe(false);
  });

  it("rejects anything the dashboard cannot render", () => {
    // Setting the pane to an unknown id renders nothing, with no error.
    for (const id of ["", "gallery", "overview ", "OVERVIEW", "nope"]) {
      expect(isTabId(id)).toBe(false);
    }
  });
});

describe("anchorSelector", () => {
  it("quotes the value so a selector cannot be malformed", () => {
    // Unquoted, an id with a space is a syntax error that throws inside
    // querySelector rather than matching nothing.
    expect(anchorSelector("two words")).toBe('[data-anchor="two words"]');
    expect(anchorSelector("lighting-mode")).toBe('[data-anchor="lighting-mode"]');
  });

  it("escapes a quote so the value cannot end the attribute early", () => {
    // Without the escape this selects some other element entirely, and the
    // dashboard scrolls somewhere unrelated without complaint.
    expect(anchorSelector('a"b')).toBe('[data-anchor="a\\"b"]');
  });
});

describe("TAB_ANCHORS", () => {
  it("names anchors that the markup actually publishes", () => {
    // The failure this catches: an anchor in the registry that no card carries.
    // `navigateTo("rgb", "devicez")` would then switch tab and scroll nowhere,
    // which looks exactly like the seam not working.
    for (const tab of ALL_TABS) {
      const src = tabSource(tab.id);
      for (const anchor of TAB_ANCHORS[tab.id]) {
        expect(src, `${tab.id}/${anchor}`).toContain(`anchor="${anchor}"`);
      }
    }
  });

  it("publishes no anchor the registry has not heard of", () => {
    // The other direction, and the one a test that only reads the registry
    // cannot see: a card marked anchor="x" that nothing can navigate to.
    for (const tab of ALL_TABS) {
      const src = tabSource(tab.id);
      const marked = [...src.matchAll(/anchor="([\w-]+)"/g)].map((m) => m[1]!);
      for (const anchor of marked) {
        expect(TAB_ANCHORS[tab.id], `${tab.id}/${anchor}`).toContain(anchor);
      }
    }
  });

  it("keeps anchor names unique within a tab", () => {
    // The query is scoped to the active pane, so the same name on two different
    // tabs is fine -- but twice on one tab means the scroll lands on whichever
    // the DOM happens to list first.
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
    // Landing on the right screen is still worth doing, so the Shell keeps the
    // tab switch and drops only the scroll -- but the anchor must not be
    // honoured on the wrong tab, where a same-named card could exist.
    expect(isAnchorFor("rgb", "vault")).toBe(false);
    expect(isAnchorFor("overview", "devices")).toBe(false);
  });

  it("rejects a typo rather than scrolling nowhere", () => {
    expect(isAnchorFor("rgb", "devicez")).toBe(false);
  });
});

describe("navRequest", () => {
  it("carries a request and clears once applied", () => {
    // The request has to be cleared as it is applied, or the Shell effect that
    // reads it would keep firing on every later render.
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
    // Re-navigating to the tab already showing has to scroll again. Reusing one
    // object would make the second request the same reference, the effect would
    // not re-run, and "show me the vault" would work exactly once.
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
    // It is deliberately not typed: a module-level toast must not import the
    // Sidebar to name a tab. That is why the Shell narrows it before rendering,
    // and these two tests are the pair that keeps the compromise honest.
    useStore.getState().navigateTo("not-a-tab", "also-not-real");
    const request = useStore.getState().navRequest!;
    expect(isTabId(request.tab)).toBe(false);
    expect(request.anchor && isAnchorFor("rgb", request.anchor)).toBeFalsy();
    useStore.getState().clearNavRequest();
  });
});
