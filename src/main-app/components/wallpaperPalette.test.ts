import { describe, expect, it } from "vitest";
import { PALETTE_SIZE, wallpaperPalette } from "./wallpaperPalette";
import type { DeviceColor } from "@shared/types";

/** A live-colour map from `[r, g, b]` tuples, keyed by device id. */
function colors(list: [number, number, number][]): Record<number, DeviceColor> {
  const out: Record<number, DeviceColor> = {};
  list.forEach((rgb, i) => {
    out[i + 1] = { id: i + 1, rgb, ledColors: [rgb] };
  });
  return out;
}

describe("wallpaperPalette", () => {
  it("is empty when nothing is lighting anything", () => {
    expect(wallpaperPalette({})).toEqual([]);
  });

  it("keeps one entry per distinct colour", () => {
    const p = wallpaperPalette(colors([[255, 0, 0], [0, 255, 0], [0, 0, 255]]));
    expect(p).toHaveLength(3);
    expect(p[0]!.count).toBe(1);
  });

  it("merges devices showing the same colour", () => {
    // The failure this guards: eight strips of one sunset rendered as eight
    // swatches, which is one colour counted eight times rather than a palette.
    const p = wallpaperPalette(colors([[255, 120, 40], [255, 120, 40], [255, 120, 40]]));
    expect(p).toHaveLength(1);
    expect(p[0]!.count).toBe(3);
  });

  it("merges near-identical colours rather than splitting them", () => {
    // Two strips of a gradient differ slightly and are still the same colour
    // to anyone looking at the wallpaper.
    const p = wallpaperPalette(colors([[255, 120, 40], [252, 118, 44]]));
    expect(p).toHaveLength(1);
  });

  it("keeps colours far enough apart to be distinct", () => {
    const p = wallpaperPalette(colors([[255, 0, 0], [200, 0, 0]]));
    expect(p).toHaveLength(2);
  });

  it("orders by how many devices agree, not by device id", () => {
    // The count is the only signal for which colour the picture is mostly
    // made of; ordering by id would just be enumeration order.
    const p = wallpaperPalette(
      colors([[10, 10, 10], [255, 0, 0], [250, 4, 2], [248, 2, 6]]),
    );
    expect(p[0]!.rgb).toEqual([255, 0, 0]);
    expect(p[0]!.count).toBe(3);
    expect(p[1]!.count).toBe(1);
  });

  it("keeps the colour actually on screen rather than an average", () => {
    // Averaging two strips of a gradient yields a colour that is on the
    // wallpaper nowhere, which is the one thing this row must not hand over.
    const p = wallpaperPalette(colors([[255, 120, 40], [255, 200, 200]]));
    const reds = p.map((e) => e.rgb);
    expect(reds).toContainEqual([255, 120, 40]);
  });

  it("rounds to whole channels so the hex is not fractional", () => {
    const p = wallpaperPalette(colors([[254.6, 1.2, 3.4]]));
    expect(p[0]!.rgb).toEqual([255, 1, 3]);
  });

  it("caps the list so the row cannot run away", () => {
    const many: [number, number, number][] = [];
    for (let i = 0; i < 30; i++) many.push([i * 8, 0, 0]);
    expect(wallpaperPalette(colors(many))).toHaveLength(PALETTE_SIZE);
  });

  it("skips an entry with no colour rather than drawing black", () => {
    // A device that has connected but never reported would otherwise pin the
    // first swatch to #000000, which reads as a colour the picture chose.
    const map = colors([[255, 0, 0]]);
    map[9] = { id: 9, rgb: undefined as never, ledColors: [] };
    const p = wallpaperPalette(map);
    expect(p).toHaveLength(1);
    expect(p[0]!.rgb).toEqual([255, 0, 0]);
  });
});
