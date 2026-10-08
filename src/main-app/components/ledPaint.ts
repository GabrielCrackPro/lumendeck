
import { luma, type Rgb } from "./rgbStrip";

export type { Rgb };

export const DARK_LED: Rgb = [30, 32, 36];

export const EMITTER_BOOST = 0.3;

export function emitterColor(rgb: Rgb, boost: number = EMITTER_BOOST): Rgb {
  const push = (c: number) =>
    Math.max(0, Math.min(255, Math.round(c + (255 - c) * boost)));
  return [push(rgb[0]), push(rgb[1]), push(rgb[2])];
}

export function glowAlpha(rgb: Rgb): number {
  const lum = luma(rgb) / 255;
  return Math.min(1, 0.06 + 0.34 * lum);
}

export function ledRadius(size: number): number {
  return Math.max(0.5, size * 0.3);
}

export function glowRadius(size: number): number {
  return Math.max(1, size * 1.15);
}

export function previewDpr(ratio?: number, max = 3): number {
  const r = ratio ?? (typeof window === "undefined" ? 1 : window.devicePixelRatio);
  return Math.min(max, Math.max(1, r || 1));
}

export function frameSignature(
  rgb: Rgb,
  leds: readonly Rgb[],
  extra = "",
): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < leds.length; i++) {
    const c = leds[i]!;
    h = Math.imul(h ^ c[0], 16777619);
    h = Math.imul(h ^ c[1], 16777619);
    h = Math.imul(h ^ c[2], 16777619);
  }
  return `${rgb.join(",")}:${leds.length}:${h >>> 0}:${extra}`;
}


export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, rad);
    return;
  }
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function paintLedGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  rgb: Rgb,
): void {
  const rad = glowRadius(size);
  const inner = glowAlpha(rgb);
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
  halo.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${inner})`);
  halo.addColorStop(0.5, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${inner * 0.3})`);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
}

export function paintLed(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  rgb: Rgb,
  boost: number = EMITTER_BOOST,
): void {
  paintLedGlow(ctx, cx, cy, size, rgb);
  const [r, g, b] = emitterColor(rgb, boost);
  roundRectPath(ctx, cx - size / 2, cy - size / 2, size, size, ledRadius(size));
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fill();
}