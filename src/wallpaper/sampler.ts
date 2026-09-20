// Pure sampling math for zone color analysis. Works on a small downscaled
// pixel buffer (e.g. 64x36) drawn from the media element.

export interface PixelBuf {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

export interface Sample {
  id: string;
  rgb: [number, number, number];
  luma: number;
}

export interface ZoneRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function avgRect(buf: PixelBuf, x: number, y: number, w: number, h: number): [number, number, number] {
  const x0 = Math.max(0, Math.floor(x * buf.w));
  const y0 = Math.max(0, Math.floor(y * buf.h));
  const x1 = Math.min(buf.w, Math.ceil((x + w) * buf.w));
  const y1 = Math.min(buf.h, Math.ceil((y + h) * buf.h));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * buf.w + px) * 4;
      r += buf.data[i]!;
      g += buf.data[i + 1]!;
      b += buf.data[i + 2]!;
      n++;
    }
  }
  if (n === 0) return [0, 0, 0];
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

export function lumaOf(rgb: [number, number, number]): number {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

/** Full-frame dominant sample plus one sample per zone. */
export function computeSamples(buf: PixelBuf, zones: ZoneRect[]): Sample[] {
  const out: Sample[] = [];
  const all = avgRect(buf, 0, 0, 1, 1);
  out.push({ id: "all", rgb: all, luma: lumaOf(all) });
  for (const z of zones) {
    const rgb = avgRect(buf, z.x, z.y, z.w, z.h);
    out.push({ id: z.id, rgb, luma: lumaOf(rgb) });
  }
  return out;
}
