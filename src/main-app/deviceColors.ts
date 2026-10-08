
import type { DeviceColor } from "@shared/types";

export type DeviceColors = Record<number, DeviceColor>;

export function pruneDeviceColors(
  colors: DeviceColors,
  live: Iterable<number>,
): DeviceColors {
  const keep = live instanceof Set ? live : new Set(live);
  const stale: number[] = [];
  for (const id of Object.keys(colors)) {
    if (!keep.has(Number(id))) {
      stale.push(Number(id));
    }
  }
  if (stale.length === 0) {
    return colors;
  }
  const next: DeviceColors = { ...colors };
  for (const id of stale) {
    delete next[id];
  }
  return next;
}