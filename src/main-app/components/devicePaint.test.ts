// The Overview tab used to select the whole live-colour map, which is a fresh
// object on every coalesced RGB frame (~12Hz). That put the entire screen on the
// colour frame's cadence to repaint one bar in one row. Vitest renders nothing,
// so this is a source assertion — the same shape the store's invariants use —
// and it is here because the failure it guards is invisible in review: adding
// one field back to a selector reads as a harmless widening.
import { describe, expect, it } from "vitest";

// Both globs eagerly: the tabs live one directory down from the components, and
// `?raw` on a .tsx is not the CSS-plugin trap `index.css` is — that only bites
// stylesheets.
const files = {
  ...import.meta.glob("./*.tsx", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("./tabs/*.tsx", { query: "?raw", import: "default", eager: true }),
} as Record<string, string>;

const source = (path: string) => files[path];

describe("frame-rate store fields stay out of tab selectors", () => {
  it("the Overview tab does not select deviceColors", () => {
    const src = source("./tabs/OverviewTab.tsx") ?? "";
    expect(src).not.toBe("");
    // Any mention at all: the rows get theirs from DeviceRow, so the tab has
    // no business naming the field.
    expect(src).not.toMatch(/deviceColors/);
  });

  it("the RGB tab does not select deviceColors either", () => {
    // It keeps its own throttled copy for the accent sample, which is a slow
    // value — but it must not be handing that map to the rows.
    const src = source("./tabs/RgbTab.tsx") ?? "";
    expect(src).not.toBe("");
    expect(src).not.toMatch(/live=\{deviceColors/);
  });

  it("the device row reads its own slice of the map", () => {
    // The whole fix in one line: one key, so a frame repaints the row whose
    // pixels changed and nothing else.
    const src = source("./DeviceRow.tsx") ?? "";
    expect(src).not.toBe("");
    expect(src).toMatch(/useStore\(\(s\) => s\.deviceColors\[device\.id\]\)/);
  });

  it("no tab passes a live colour down as a prop", () => {
    for (const tab of ["./tabs/OverviewTab.tsx", "./tabs/RgbTab.tsx"]) {
      expect(source(tab) ?? "").not.toMatch(/live=\{/);
    }
  });
});