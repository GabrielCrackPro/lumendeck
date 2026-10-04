import { describe, expect, it } from "vitest";
import { ALL_TABS, SETTINGS_TAB, TABS } from "./Sidebar";

/**
 * The Sidebar's own source, read at build time.
 *
 * The same `import.meta.glob` trick tabNav.test.ts uses for the tab components:
 * these assertions are about markup that only exists in the render tree, which
 * this environment deliberately has no DOM to render.
 */
const SIDEBAR_SRC = import.meta.glob("./Sidebar.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
})["./Sidebar.tsx"];

function sidebarSource(): string {
  if (typeof SIDEBAR_SRC !== "string") {
    throw new Error("Sidebar.tsx was not globbed; the assertions below cannot run");
  }
  return SIDEBAR_SRC;
}

describe("Sidebar markup", () => {
  it("separates settings by identity, not by list position", () => {
    // The hairline above Settings used to be `i === 4`. That is correct only
    // while there are exactly four tabs before it and it stays last — and when
    // either stops being true the rule silently draws a divider under whichever
    // row happens to land on index 4. A decorative bug, with no error and
    // nothing to grep for.
    const src = sidebarSource();
    expect(src).toContain("SETTINGS_TAB.id");
    // Scoped to the ternary that picks the divider class, so the unrelated
    // `index * 24` stagger below it is not mistaken for the same mistake.
    expect(src).not.toMatch(/className=\{i === \d+ \?/);
  });

  it("puts settings last, which is what the divider implies", () => {
    // The reason the divider exists: Settings is not one of the things being
    // customised, so it is separated from the rest of the rail. Indexed rather
    // than `.at(-1)` so an empty list fails the assertion instead of comparing
    // `undefined` to a string and quietly passing on a falsy match.
    const last = ALL_TABS[ALL_TABS.length - 1];
    expect(last).toBeDefined();
    expect(last!.id).toBe(SETTINGS_TAB.id);
    expect(TABS).not.toContainEqual(SETTINGS_TAB);
  });

  it("carries no hardcoded shortcut copy", () => {
    // "CTRL K" was literal JSX text. It is not a word, so it cannot be
    // translated, and the i18n checker has no reason to flag a keycap label.
    expect(sidebarSource()).not.toMatch(/>\s*CTRL\s/);
  });

  it("uses the delegated tooltip attribute rather than native title", () => {
    // Native `title` gives a browser-drawn tooltip that cannot be styled and
    // appears on a delay. In the collapsed rail it is the *only* label a row
    // has, so it is the place the app's own tooltip matters most.
    const src = sidebarSource();
    expect(src).toContain("data-tip=");
    expect(src).not.toMatch(/\btitle=\{t\(/);
  });

  it("drops the tooltip on the shortcut button while the rail is folded", () => {
    // `w-0` is not a zero-width hit area — the glyph keeps its own width, 16px
    // measured — so a tooltip stayed reachable and anchored itself over empty
    // rail, naming a control the pointer was not on. Dropping the attribute
    // makes the delegated handler's `closest` find nothing.
    expect(sidebarSource()).toContain(
      "data-tip={collapsed ? undefined : t(\"nav.keyboard-shortcuts\")}",
    );
  });

  it("labels a collapsed rail row, since that is all it has to go on", () => {
    // Expanded, the tooltip is the blurb; folded, the label is gone and the
    // tooltip is the only thing distinguishing five identical-looking icons.
    expect(sidebarSource()).toContain("collapsed ? `${t(item.label)}");
  });
});