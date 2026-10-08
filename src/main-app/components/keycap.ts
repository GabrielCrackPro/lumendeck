
import { paintLedGlow, roundRectPath, type Rgb } from "./ledPaint";

export type { Rgb };

export function capRadius(w: number, h: number): number {
  return Math.min(w, h) * 0.18;
}

export function capFaceLuma(rgb: Rgb, lift = 1): number {
  const channel = (c: number) => 0.78 * Math.min(255, c * 1.06 * lift);
  return (channel(rgb[0]) + channel(rgb[1]) + channel(rgb[2])) / 3;
}

export function legendInk(rgb: Rgb, lift = 1): string {
  const bright = capFaceLuma(rgb, lift);
  return bright > 150
    ? `rgba(10,10,14,${Math.min(0.7, (bright - 150) / 90 + 0.35)})`
    : "rgba(255,255,255,0.68)";
}

export function legendFits(label: string, w: number, fontSize: number): boolean {
  return !!label.trim() && w > fontSize * 2.1;
}

export interface KeycapOptions {
  home?: boolean;
  hover?: boolean;
  label?: string;
  dpr?: number;
  lift?: number;
}

export function paintKeycap(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: Rgb,
  opts: KeycapOptions = {},
): void {
  const { home, hover, label, dpr = 1, lift = hover ? 1.12 : 1 } = opts;
  const [cr, cg, cb] = rgb;
  const radius = capRadius(w, h);

  paintLedGlow(ctx, x + w / 2, y + h / 2, Math.max(w, h), rgb);

  ctx.beginPath();
  roundRectPath(ctx, x + 1, y + 1.2 * dpr, w, h, radius);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fill();

  const top = [
    Math.round(0.78 * Math.min(255, cr * 1.06 * lift)),
    Math.round(0.78 * Math.min(255, cg * 1.06 * lift)),
    Math.round(0.78 * Math.min(255, cb * 1.06 * lift)),
  ];
  const bottom = `rgb(${Math.round(0.78 * cr * 0.72 * lift)},${Math.round(
    0.78 * cg * 0.72 * lift,
  )},${Math.round(0.78 * cb * 0.72 * lift)})`;

  const bodyGrad = ctx.createLinearGradient(0, y, 0, y + h);
  bodyGrad.addColorStop(0, `rgb(${top[0]},${top[1]},${top[2]})`);
  bodyGrad.addColorStop(1, bottom);
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = bodyGrad;
  ctx.fill();

  const gloss = ctx.createLinearGradient(0, y, 0, y + h * 0.5);
  gloss.addColorStop(0, "rgba(255,255,255,0.22)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.beginPath();
  roundRectPath(ctx, x + 1, y + 1, w - 2, h * 0.45, radius * 0.75);
  ctx.fillStyle = gloss;
  ctx.fill();

  if (hover) {
    ctx.beginPath();
    roundRectPath(
      ctx,
      x - 0.5 * dpr,
      y - 0.5 * dpr,
      w + dpr,
      h + dpr,
      radius + 0.5 * dpr,
    );
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();
  }

  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.strokeStyle = hover ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();

  if (home) {
    ctx.beginPath();
    ctx.ellipse(
      x + w / 2,
      y + h - 3 * dpr,
      3.5 * dpr,
      1.4 * dpr,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fill();
  }

  const fontSize = Math.max(7 * dpr, h * 0.22);
  if (label && legendFits(label, w, fontSize)) {
    ctx.font = `600 ${fontSize}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = legendInk(rgb, lift);
    ctx.fillText(label, x + w / 2, y + h / 2 + h * 0.045);
  }
}

export function paintZoneSeam(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  dpr = 1,
): void {
  ctx.beginPath();
  roundRectPath(ctx, x - 1.6 * dpr, y, 1.2 * dpr, h, 0.6 * dpr);
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fill();
  ctx.beginPath();
  roundRectPath(ctx, x - 0.6 * dpr, y, 0.8 * dpr, h, 0.4 * dpr);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fill();
}

export function paintCase(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  dpr = 1,
): void {
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, "#171a22");
  grad.addColorStop(0.45, "#0d0f14");
  grad.addColorStop(1, "#07080b");
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 18 * dpr;
  ctx.shadowOffsetY = 6 * dpr;
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  const rimH = Math.max(8 * dpr, h * 0.22);
  const rim = ctx.createLinearGradient(0, y, 0, y + rimH);
  rim.addColorStop(0, "rgba(255,255,255,0.16)");
  rim.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = rim;
  ctx.fillRect(x, y, w, rimH);
  ctx.restore();

  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.stroke();
}
