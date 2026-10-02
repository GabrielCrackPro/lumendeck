import { describe, expect, it } from "vitest";
import { lightsGradient } from "./deviceLights";

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
    // Four bands is the whole point: this is what replaced "4 zones" as text.
    expect(lightsGradient(ZONES)).toBe(
      "linear-gradient(90deg, rgb(96 140 255) 0.0%, rgb(255 120 90) 33.3%, rgb(120 235 170) 66.7%, rgb(200 130 255) 100.0%)",
    );
  });

  it("samples a per-key board instead of emitting a stop per LED", () => {
    // A 96-stop gradient string rebuilt on every colour frame is a real cost for
    // no visual gain at six pixels tall.
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
    // A row that loses its light entirely is a gap where a device used to be.
    const g = lightsGradient(ZONES, { muted: true });
    expect(g.startsWith("linear-gradient")).toBe(false);
    expect(g).toContain("rgb(30 32 36)");
  });

  it("falls back to the unlit colour when the engine has pushed nothing", () => {
    expect(lightsGradient([])).toBe("rgb(30 32 36)");
  });
});