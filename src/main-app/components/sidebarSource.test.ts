import { describe, expect, it } from "vitest";
import { ALL_TABS, SETTINGS_TAB, TABS } from "./Sidebar";

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
    const src = sidebarSource();
    expect(src).toContain("SETTINGS_TAB.id");
    expect(src).not.toMatch(/className=\{i === \d+ \?/);
  });

  it("puts settings last, which is what the divider implies", () => {
    const last = ALL_TABS[ALL_TABS.length - 1];
    expect(last).toBeDefined();
    expect(last!.id).toBe(SETTINGS_TAB.id);
    expect(TABS).not.toContainEqual(SETTINGS_TAB);
  });

  it("carries no hardcoded shortcut copy", () => {
    expect(sidebarSource()).not.toMatch(/>\s*CTRL\s/);
  });

  it("uses the delegated tooltip attribute rather than native title", () => {
    const src = sidebarSource();
    expect(src).toContain("data-tip=");
    expect(src).not.toMatch(/\btitle=\{t\(/);
  });

  it("drops the tooltip on the shortcut button while the rail is folded", () => {
    expect(sidebarSource()).toContain(
      "data-tip={collapsed ? undefined : t(\"nav.keyboard-shortcuts\")}",
    );
  });

  it("labels a collapsed rail row, since that is all it has to go on", () => {
    expect(sidebarSource()).toContain("collapsed ? `${t(item.label)}");
  });
});