// A device's lights, summarised for a row.
//
// This module used to hold the package layout for a device-list LED strip as
// well, which was a second renderer of an LED alongside the keyboard preview
// and the mode tiles. It is gone: the device card no longer draws LEDs at all
// — the collapsed row shows the lights as one line of colour, and the large
// live preview lives in the stage where there is room for it. What survives is
// the part that replaced the numbers.

import { DARK_LED, type Rgb } from "./ledPaint";

/**
 * A device's lights as one line of colour, for a collapsed row.
 *
 * The point of a summary is to replace the numbers, not to sit next to them: a
 * 4-zone board draws as four bands and a 30-LED strip as a run, so you can see
 * what the device is doing without reading `24 LEDs · 4 zones`. Sampling rather
 * than emitting a stop per LED, because a 96-key board would otherwise produce a
 * 96-stop gradient string on every colour frame.
 *
 * A muted device still gets a bar, because a row that loses its light entirely
 * is a gap where a device used to be.
 */
export function lightsGradient(
  colors: readonly Rgb[],
  opts: { muted?: boolean; maxStops?: number } = {},
): string {
  const { muted = false, maxStops = 24 } = opts;
  if (muted || colors.length === 0) {
    return `rgb(${DARK_LED[0]} ${DARK_LED[1]} ${DARK_LED[2]})`;
  }
  if (colors.length === 1) {
    const c = colors[0]!;
    return `rgb(${c[0]} ${c[1]} ${c[2]})`;
  }
  const n = Math.max(2, Math.min(colors.length, maxStops));
  const stops: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = colors[Math.floor((i * colors.length) / n)]!;
    stops.push(
      `rgb(${c[0]} ${c[1]} ${c[2]}) ${((i / (n - 1)) * 100).toFixed(1)}%`,
    );
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/**
 * The colour a reactive-mode preview samples, chosen the way the accent is.
 *
 * This used to be `Object.values(deviceColors)[0]` — whatever device the store
 * map happened to list first, which could be a muted device or a mouse when a
 * keyboard was lit. The preview's job is to show what the lights are doing, so
 * it samples the same device the accent would: the keyboard first, then any
 * device in the loop, then — as a last resort the accent chain also keeps —
 * any device that has ever reported a non-black colour.
 */
export function previewLiveColor(
  deviceColors: Readonly<Record<number, { rgb: Rgb }>>,
  devices: readonly { id: number; typeName: string }[],
  excluded: readonly number[],
): Rgb | null {
  const excludedSet = new Set(excluded);
  const inLoop = devices
    .filter((d) => !excludedSet.has(d.id))
    .sort((a, b) => {
      const kb = (x: { typeName: string }) => (/keyboard/i.test(x.typeName) ? 0 : 1);
      return kb(a) - kb(b);
    });
  for (const d of inLoop) {
    const c = deviceColors[d.id]?.rgb;
    if (c) return c;
  }
  for (const c of Object.values(deviceColors)) {
    if (c.rgb.some((v) => v > 0)) return c.rgb;
  }
  return null;
}