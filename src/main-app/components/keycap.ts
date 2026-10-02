// How one keycap looks.
//
// This was a closure inside the keyboard preview's paint function, which meant
// the device list could not draw a keyboard without growing a second copy of
// it. That is the failure this repository already has three times over — three
// renderers, three answers to how an LED looks — so the policy lives here and
// both callers share it.
//
// The decisions that can be checked without a canvas are pure functions above
// the drawing: the corner radius and the legend ink, both of which are
// functions of the cap and the colour behind the legend.

import { paintLedGlow, roundRectPath, type Rgb } from "./ledPaint";

export type { Rgb };

/**
 * Corner radius for a cap of this size.
 *
 * Proportional, because a 6.25u spacebar with the same 4px corner as a 1u key
 * reads as two different objects. Real keycaps scale their corner with the cap,
 * and so does this.
 */
export function capRadius(w: number, h: number): number {
  return Math.min(w, h) * 0.18;
}

/** Luminance of a cap's lit face, used to decide which ink a legend needs. */
export function capFaceLuma(rgb: Rgb, lift = 1): number {
  // 0.78 is the same shading curve the cap body is painted with, so this is the
  // colour the legend actually sits on rather than the raw LED colour. Getting
  // that wrong is how a dark legend ends up on a cap that is still too dark to
  // carry one.
  const channel = (c: number) => 0.78 * Math.min(255, c * 1.06 * lift);
  return (channel(rgb[0]) + channel(rgb[1]) + channel(rgb[2])) / 3;
}

/**
 * Legend ink for a cap lit this brightly.
 *
 * A fixed white legend vanished the moment a zone was lit near white — which is
 * the exact state a zoned board spends its life in, since those caps are not
 * individually dimmable. Darkening scales with how far past the threshold the
 * cap is, so a barely-bright cap gets faintly dark ink rather than a hard
 * switch to black.
 */
export function legendInk(rgb: Rgb, lift = 1): string {
  const bright = capFaceLuma(rgb, lift);
  return bright > 150
    ? `rgba(10,10,14,${Math.min(0.7, (bright - 150) / 90 + 0.35)})`
    : "rgba(255,255,255,0.68)";
}

/** A legend only fits on a key wide enough to hold it. */
export function legendFits(label: string, w: number, fontSize: number): boolean {
  // The old guard was `w > max(7, 0.24 * w) * 1.6`, which is a tautology for any
  // sane width, so single-character legends spilled across half-unit modifiers.
  return !!label.trim() && w > fontSize * 2.1;
}

export interface KeycapOptions {
  /** Home-row keys get the tactile bar. */
  home?: boolean;
  /** A hovered cap lifts, so the pointer feels like it is over something. */
  hover?: boolean;
  /** Omit below the size at which text is legible rather than a smudge. */
  label?: string;
  dpr?: number;
  /** Multiplies the cap's brightness; 1 is the resting state. */
  lift?: number;
}

/**
 * One keycap: halo, shadow, convex body, gloss, and optionally a legend.
 *
 * Caps keep a shading curve rather than the shared emitter overdrive: a keycap
 * is a physical shell with a lit edge, not a bare package, and the gloss only
 * reads against a body that falls off vertically.
 */
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

  // The same halo policy as a strip LED, so a cap and a package throw the same
  // light for the same colour.
  paintLedGlow(ctx, x + w / 2, y + h / 2, Math.max(w, h), rgb);

  // Drop shadow under the cap.
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

  // Cap body with a vertical shade, so taller caps read as convex.
  const bodyGrad = ctx.createLinearGradient(0, y, 0, y + h);
  bodyGrad.addColorStop(0, `rgb(${top[0]},${top[1]},${top[2]})`);
  bodyGrad.addColorStop(1, bottom);
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = bodyGrad;
  ctx.fill();

  // Top gloss.
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

/**
 * The seam where one lighting zone hands over to the next.
 *
 * A gap in the case with a bright wire down it. The original was a solid white
 * bar glued to the leading edge of the key, which read as a stray artefact
 * rather than a boundary — and on a per-key board, where there are no zones, it
 * was the only white mark on the whole case.
 */
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

/**
 * The dark case a board of caps sits in.
 *
 * Shared with the device list so a keyboard in the list and the same keyboard
 * in the stage are the same object at two sizes. The rim light is what turns a
 * black slab into hardware: in the light theme a dark rectangle with no shadow
 * reads as a hole cut in the card.
 */
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

  // Rim light along the top edge, where a real case catches the room. Its depth
  // follows the case rather than being a fixed number of pixels, or it overruns
  // the case on a short one.
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
