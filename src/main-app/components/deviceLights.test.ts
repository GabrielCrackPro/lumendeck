import { describe, expect, it } from "vitest";
import { lightsGradient, previewLiveColor } from "./deviceLights";

const ZONES: [number, number, number][] = [
  [96, 140, 255],
  [255, 120, 90],
  [120, 235, 170],
  [200, 130, 255],
];
const MANY = Array.from({ length: 96 }, (_, i) => [
  i,
  i,
  i,
] as [number, number, number]);

describe("lightsGradient", () => {
  it("shows a zoned board as its zones rather than a blur", () => {
    expect(lightsGradient(ZONES)).toBe(
      "linear-gradient(90deg, rgb(96 140 255) 0.0%, rgb(255 120 90) 33.3%, rgb(120 235 170) 66.7%, rgb(200 130 255) 100.0%)",
    );
  });

  it("samples a per-key board instead of emitting a stop per LED", () => {
    const g = lightsGradient(MANY, { maxStops: 24 });
    expect(g.startsWith("linear-gradient")).toBe(true);
    expect(g.split("rgb(").length - 1).toBe(24);
  });

  it("ends at 100% so the bar spans its full width", () => {
    expect(lightsGradient(ZONES).trimEnd().endsWith("100.0%)")).toBe(true);
  });

  it("goes flat for a single colour, rather than dividing by zero", () => {
    expect(lightsGradient([[10, 20, 30]])).toBe("rgb(10 20 30)");
  });

  it("keeps a muted device visible instead of dropping its bar", () => {
    const g = lightsGradient(ZONES, { muted: true });
    expect(g.startsWith("linear-gradient")).toBe(false);
    expect(g).toContain("rgb(30 32 36)");
  });

  it("falls back to the unlit colour when the engine has pushed nothing", () => {
    expect(lightsGradient([])).toBe("rgb(30 32 36)");
  });
});

describe("previewLiveColor", () => {
  type Dev = { id: number; typeName: string };
  const RED: [number, number, number] = [220, 30, 30];
  const GREEN: [number, number, number] = [30, 200, 30];
  const colors = {
    1: { rgb: RED },
    2: { rgb: GREEN },
  };

  it("prefers the keyboard over other devices, like the accent does", () => {
    const devices: Dev[] = [
      { id: 2, typeName: "Mouse" },
      { id: 1, typeName: "RGB Keyboard" },
    ];
    expect(previewLiveColor(colors, devices, [])).toEqual(RED);
  });

  it("never samples a muted device while one in the loop is lit", () => {
    const devices: Dev[] = [
      { id: 1, typeName: "Keyboard" },
      { id: 2, typeName: "Mouse" },
    ];
    expect(previewLiveColor(colors, devices, [1])).toEqual(GREEN);
  });

  it("falls back to any reported colour when every device is muted", () => {
    const devices: Dev[] = [{ id: 1, typeName: "Keyboard" }];
    expect(previewLiveColor(colors, devices, [1])).toEqual(RED);
  });

  it("falls through a device with no colour to one that has reported", () => {
    const devices: Dev[] = [
      { id: 9, typeName: "Keyboard" },
      { id: 2, typeName: "Mouse" },
    ];
    expect(previewLiveColor(colors, devices, [])).toEqual(GREEN);
  });

  it("returns null when nothing has ever reported", () => {
    expect(previewLiveColor({}, [{ id: 1, typeName: "Keyboard" }], [])).toBeNull();
  });
});