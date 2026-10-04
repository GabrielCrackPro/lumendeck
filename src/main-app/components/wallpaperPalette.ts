// The colours a wallpaper is currently putting on screen.
//
// The zone list above this one names *where* the picture is sampled; this is
// what came back. It exists as its own module because the interesting decision
// is which colours to show and in what order, and that decision is wrong in
// ways nobody notices by looking: eight near-identical oranges from eight strips
// of one sunset is not a palette, it is one colour counted eight times.
//
// Pure, so the rules can be pinned without a DOM or a running OpenRGB server.

import type { DeviceColor } from "@shared/types";

/**
 * Two colours further apart than this are different colours.
 *
 * 26 is roughly the smallest gap a person would name -- about ten percent of
 * the way along the red axis. Tighter than that and every strip of a gradient
 * becomes its own entry; looser and a picture that really does contain two
 * neighbouring hues collapses into one.
 */
const CHROMA_GAP = 26;

/** Colours shown. Four fits the row beside the zone chips without wrapping. */
export const PALETTE_SIZE = 4;

export interface PaletteEntry {
  rgb: [number, number, number];
  /** How many devices settled on this colour, which is what orders them. */
  count: number;
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  return (
    Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
  );
}

/**
 * Reduce the live device colours to a short palette.
 *
 * Devices that agree are merged into one entry, and an entry is kept for every
 * device behind it -- that count is the only signal saying which colour the
 * picture is mostly made of, so the ordering falls out of the data rather than
 * out of device id, which would just be enumeration order.
 *
 * The first colour seen for a given hue wins, rather than averaging: averaging
 * two strips of a gradient produces a colour that is on screen nowhere, and the
 * whole point of the row is to hand the user something they can paste into
 * another tool.
 */
export function wallpaperPalette(
  colors: Record<number, DeviceColor>,
  limit: number = PALETTE_SIZE,
): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  for (const key of Object.keys(colors)) {
    const device = colors[Number(key)];
    if (!device?.rgb) continue;
    const rgb: [number, number, number] = [
      Math.round(device.rgb[0]),
      Math.round(device.rgb[1]),
      Math.round(device.rgb[2]),
    ];
    const near = entries.find((e) => distance(e.rgb, rgb) <= CHROMA_GAP);
    if (near) {
      near.count += 1;
      continue;
    }
    entries.push({ rgb, count: 1 });
  }
  entries.sort((a, b) => b.count - a.count);
  return entries.slice(0, Math.max(0, limit));
}
