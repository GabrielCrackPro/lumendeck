// One policy for how an LED looks, shared by every colour preview.
//
// There were three renderers — the 24-LED mode strip, the per-device strip in
// the device list, and the keyboard preview — and three different answers to
// the same four questions:
//
//   emitter colour   raw  |  +30% toward white  |  x0.78 (darker)
//   glow             none |  constant alpha     |  luma-scaled alpha
//   unlit colour     none |  [30,32,36]         |  [10,11,16]
//   corner radius    led*0.32 | pkgH*0.3        |  a fixed 4px
//
// Two of those are not just different, they are opposites: the device strip ran
// its packages hotter than the colour being shown, while the keyboard shaded
// them darker. And the constant glow alpha meant a nearly-black LED on a dim
// device threw the same halo as a white one, which is the one thing a glow is
// not supposed to do.
//
// The maths lives here, pure and tested, so the three call sites differ only in
// where the LEDs go.

import { luma, type Rgb } from "./rgbStrip";

export type { Rgb };

/**
 * An unlit LED: dark, but not a hole in the track.
 *
 * One value, not one per renderer. A preview that shows "off" as three
 * different greys cannot be read as the same hardware at a glance.
 */
export const DARK_LED: Rgb = [30, 32, 36];

/**
 * How far to push an LED's colour toward white.
 *
 * A lit emitter is brighter than the colour it is showing; that overdrive is
 * what separates a glowing package from a painted rectangle.
 */
export const EMITTER_BOOST = 0.3;

/** An unlit package is not boosted at all, or it would read as dimly lit. */
export function emitterColor(rgb: Rgb, boost: number = EMITTER_BOOST): Rgb {
  // Clamped, because a boost outside 0..1 otherwise produces channels outside
  // 0..255 and an invalid `rgb()` string handed to a canvas fillStyle. Every
  // other function here is total; this one had to be too.
  const push = (c: number) =>
    Math.max(0, Math.min(255, Math.round(c + (255 - c) * boost)));
  return [push(rgb[0]), push(rgb[1]), push(rgb[2])];
}

/**
 * Glow strength for a colour, scaled by how much light it actually puts out.
 *
 * The floor matters as much as the slope: a black or near-black LED still gets
 * a faint halo, because a dark package on a lit strip is visible as geometry,
 * and a halo with no brightness at all makes the strip look broken rather than
 * dim. Capped at 1 so a fully saturated white cannot exceed full alpha.
 */
export function glowAlpha(rgb: Rgb): number {
  const lum = luma(rgb) / 255;
  return Math.min(1, 0.06 + 0.34 * lum);
}

/**
 * Corner radius for an LED package of `size`.
 *
 * Proportional, so a 4px dot and a 40px package are the same shape scaled —
 * which is the difference between "the same object at two sizes" and two
 * different objects. The floor keeps a dot from degenerating into a triangle.
 */
export function ledRadius(size: number): number {
  return Math.max(0.5, size * 0.3);
}

/** Halo radius around an LED of `size`. */
export function glowRadius(size: number): number {
  return Math.max(1, size * 1.15);
}

/**
 * Backing-store scale, capped.
 *
 * Every preview is redrawn per frame; an uncapped 3x display triples the fill
 * cost for a few extra pixels of glow. The cap used to be 3 in two renderers
 * and 2 in the third, so the same strip was drawn at different resolutions
 * depending on which panel it was in.
 */
export function previewDpr(ratio?: number, max = 3): number {
  // The ratio is a parameter rather than read inline so this stays pure and
  // testable: reading `window` inside made every assertion about it depend on
  // mutating a global. Callers in the app pass nothing.
  const r = ratio ?? (typeof window === "undefined" ? 1 : window.devicePixelRatio);
  return Math.min(max, Math.max(1, r || 1));
}

/**
 * A cheap summary of one frame, for deciding whether a repaint is needed.
 *
 * Previews are redrawn many times a second and the expensive part is the paint,
 * not the colours, so a frame that has not visibly changed should be skipped.
 * But "summarise" was done by sampling only `ledColors[0]`, which is wrong for
 * exactly the boards this preview exists to show: on a zoned board zone 3 can
 * change while zone 0 holds still, and nothing repainted until some other LED
 * moved. The board sat there showing last week's zone colours.
 *
 * The fear behind that sample was that walking every LED was too expensive. It
 * is not: this is a rolling integer hash, so it is one imul and one xor per
 * channel with no allocation and no string building, and ~140 of them take
 * microseconds. Sampling was the wrong trade — it bought almost nothing and
 * cost correctness, because no fixed set of sample points covers a four-zone
 * board without missing one.
 *
 * `extra` carries whatever else changes the picture (a hovered key), so a
 * caller gets one comparable string rather than concatenating by hand.
 */
export function frameSignature(
  rgb: Rgb,
  leds: readonly Rgb[],
  extra = "",
): string {
  // FNV-1a, 32-bit. Math.imul because a plain multiply on a value that has
  // overflowed 32 bits silently loses low bits, which is how a hash starts
  // reporting equality for different frames.
  let h = 0x811c9dc5;
  for (let i = 0; i < leds.length; i++) {
    const c = leds[i]!;
    h = Math.imul(h ^ c[0], 16777619);
    h = Math.imul(h ^ c[1], 16777619);
    h = Math.imul(h ^ c[2], 16777619);
  }
  return `${rgb.join(",")}:${leds.length}:${h >>> 0}:${extra}`;
}

// ---------- canvas helpers ----------

/**
 * Rounded-rect path with a fallback.
 *
 * WebView2 is evergreen Chromium and always has `roundRect`, but two of the
 * three renderers called it unguarded while the third had already written this
 * guard — so the safe version existed and was not used. One copy, called by all.
 */
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

/**
 * The halo around one LED.
 *
 * Drawn with `fillRect` over the halo's bounding box rather than an `arc`, so
 * it costs the same whatever the radius and cannot leave a seam where a shape
 * and its fill disagree.
 */
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

/**
 * One LED package: halo, then the package itself.
 *
 * `boost` is a parameter rather than a boolean `muted` because the three
 * surfaces have different reasons to draw an unlit package — a muted device, a
 * mode that has not produced a colour yet, a keyboard with no data — and each
 * of those still wants the same geometry.
 */
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