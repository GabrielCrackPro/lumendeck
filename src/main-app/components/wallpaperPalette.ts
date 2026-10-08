
import type { DeviceColor } from "@shared/types";

const CHROMA_GAP = 26;

export const PALETTE_SIZE = 4;

export interface PaletteEntry {
  rgb: [number, number, number];
  count: number;
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  return (
    Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
  );
}

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
