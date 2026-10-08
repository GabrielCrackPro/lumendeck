import { describe, expect, it } from "vitest";

const files = {
  ...import.meta.glob("./*.tsx", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("./tabs/*.tsx", { query: "?raw", import: "default", eager: true }),
} as Record<string, string>;

const source = (path: string) => files[path];

describe("frame-rate store fields stay out of tab selectors", () => {
  it("the Overview tab does not select deviceColors", () => {
    const src = source("./tabs/OverviewTab.tsx") ?? "";
    expect(src).not.toBe("");
    expect(src).not.toMatch(/deviceColors/);
  });

  it("the RGB tab does not select deviceColors either", () => {
    const src = source("./tabs/RgbTab.tsx") ?? "";
    expect(src).not.toBe("");
    expect(src).not.toMatch(/live=\{deviceColors/);
  });

  it("the device row reads its own slice of the map", () => {
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