// Per-LED colour simulation for the lighting mode preview.
//
// This is a port of the Rust engine's `animation_frame` and its `palette`
// helpers. The old version lived inside the canvas draw loop in RgbTab, where
// "the preview should look like the device" was an unenforceable claim: nothing
// checked the preview against the engine, so it drifted.
//
// It had drifted. Three ways, all fixed here:
//
//   1. Position along the strip was `i / (count - 1)`, so the last LED sat at
//      the very end of the gradient. The engine uses `i / count`, leaving the
//      last LED one step short. On a 24-LED preview that is a visible 4% of the
//      gradient missing from the right-hand end.
//   2. Cycle and wave were generated at a hardcoded 0.92 saturation and then
//      had the mixer's saturation applied to the finished sRGB. The engine
//      passes the mixer's saturation straight into HSV, so pulling saturation
//      down desaturates the hue rather than greying a saturated colour.
//   3. The mixer ran as one fused saturate-and-brighten step. The engine runs
//      saturate -> gamma -> scale_luma, and skips gamma for animations.
//
// Kept deliberately identical to the Rust, including the `speed` already being
// folded into `time` by the caller, so the two can be compared line by line.

import type { RgbMode } from "@shared/types";

export type Rgb = [number, number, number];

/** Virtual LED count. A 24-LED strip reads as a strip at every card width. */
export const STRIP_LEDS = 24;

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * HSV to RGB. A port of `palette::hsv_to_rgb`.
 *
 * Uses the same chunk-of-six construction rather than a hue-to-rgb table, so
 * the numbers match the engine to the byte.
 */
export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s);
  const val = clamp01(v);
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  const sector = Math.floor(hue);
  let r = 0, g = 0, b = 0;
  if (sector < 60) [r, g, b] = [c, x, 0];
  else if (sector < 120) [r, g, b] = [x, c, 0];
  else if (sector < 180) [r, g, b] = [0, c, x];
  else if (sector < 240) [r, g, b] = [0, x, c];
  else if (sector < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [clamp255(Math.round((r + m) * 255)), clamp255(Math.round((g + m) * 255)), clamp255(Math.round((b + m) * 255))];
}

/** RGB to HSV. A port of `palette::rgb_to_hsv`. */
export function rgbToHsv([r, g, b]: Rgb): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const v = max;
  const s = max <= 0 ? 0 : d / max;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

/** Rec. 709 luma of an 8-bit colour. A port of `palette::luma`. */
export function luma([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Scale every channel. A port of `palette::scale_luma`. */
export function scaleLuma(c: Rgb, factor: number): Rgb {
  return [clamp255(Math.round(c[0] * factor)), clamp255(Math.round(c[1] * factor)), clamp255(Math.round(c[2] * factor))];
}

/** Push saturation away from (or toward) luma. A port of `palette::saturate`. */
export function saturate(c: Rgb, amount: number): Rgb {
  const l = luma(c);
  return [
    clamp255(Math.round(l + (c[0] - l) * amount)),
    clamp255(Math.round(l + (c[1] - l) * amount)),
    clamp255(Math.round(l + (c[2] - l) * amount)),
  ];
}

export interface StripOptions {
  mode: RgbMode;
  /** Elapsed seconds, already multiplied by the speed slider. */
  time: number;
  ledCount: number;
  saturation: number;
  brightness: number;
  /** The wallpaper's dominant colour, for the modes that follow the screen. */
  liveColor: Rgb | null;
  /** The user's chosen colour, for static and breathe. */
  staticColor: Rgb;
  /** Live audio level, audio-reactive only. Floored like the engine. */
  audioVolume?: number;
  cycleSpread?: number;
  waveDirection?: 1 | -1;
}

/** Below this the engine treats a volume sample as silence. Mirrors `audio.rs`. */
export const AUDIO_FLOOR = 0.3;

/**
 * One frame of the strip.
 *
 * Returns one colour per LED, already mixed through the mixer. `ledCount` of 0
 * returns an empty array rather than dividing by zero.
 */
export function stripFrame(opts: StripOptions): Rgb[] {
  const {
    mode, time, saturation, brightness,
    liveColor, staticColor,
    audioVolume = 0.3,
    cycleSpread = 360,
    waveDirection = 1,
  } = opts;
  const n = Math.max(0, Math.floor(opts.ledCount));
  if (n === 0) return [];

  const sat = clamp01(saturation);
  const val = clamp01(brightness);
  const base: Rgb = liveColor ?? [40, 60, 120];
  const dir = waveDirection < 0 ? -1 : 1;
  const out: Rgb[] = [];

  for (let i = 0; i < n; i++) {
    // The engine divides by the count, not count-1: the last LED is one step
    // short of the end of the gradient.
    const p = i / n;

    switch (mode) {
      case "static":
        // Non-animated modes go through the mixer as a whole colour.
        out.push(staticColor.map((v) => clamp255(Math.round(v * val))) as Rgb);
        break;

      case "cycle": {
        // Spectrum stretched across the strip by cycleSpread, sliding.
        // Saturation goes in as HSV saturation, matching the engine.
        out.push(hsvToRgb(time * 45 + p * cycleSpread, sat, val));
        break;
      }

      case "wave": {
        // Two hue gradients marching, each LED dimmed by a travelling comet.
        const repeats = 2;
        const travel = dir * time / 3;
        const comet = 0.65 + 0.35 * Math.sin((p - travel) * Math.PI * 2 * repeats);
        out.push(hsvToRgb((p * repeats - travel) * 360, sat, clamp01(val * comet)));
        break;
      }

      case "breathe": {
        // Organic breath: quick 40% inhale, slow 60% exhale, smoothstep, floored
        // at 15%. Non-animated, so it goes through the mixer and not HSV.
        const period = 4.5;
        const phase = (time % period) / period;
        const ease = (x: number) => x * x * (3 - 2 * x);
        const wave = phase < 0.4 ? ease(phase / 0.4) : 1 - ease((phase - 0.4) / 0.6);
        const scaled = staticColor.map((v) => clamp255(Math.round(v * (0.15 + 0.85 * wave) * val))) as Rgb;
        out.push(saturate(scaled, sat));
        break;
      }

      case "ambient": {
        // Mild saturation lift on the wallpaper colour, so wide-spectrum
        // hardware does not render it muddy.
        out.push(saturate(scaleLuma(base, val), sat));
        break;
      }

      case "pulse": {
        // Perceptual brightness curve floored at 35%, driven by the live
        // colour's luma.
        const l = clamp01(luma(base) / 255);
        const factor = 0.35 + 0.65 * Math.pow(l, 0.8);
        out.push(saturate(scaleLuma(base, factor * val), sat));
        break;
      }

      case "zone": {
        // Three descending bands, standing in for three monitors' averages.
        const seg = p < 1 / 3 ? 0 : p < 2 / 3 ? 1 : 2;
        const shift = [1, 0.72, 0.45][seg]!;
        out.push(saturate(scaleLuma(base, shift * val), sat));
        break;
      }

      case "audioReactive": {
        // Volume-floored brightness plus a spectral hue tilt across the strip.
        // The base hue is the wallpaper accent, matching the engine, falling
        // back to the static colour before the first sample arrives.
        const vol = Math.max(audioVolume, AUDIO_FLOOR);
        const audioBase = liveColor ?? staticColor;
        const hue = rgbToHsv(audioBase).h;
        out.push(hsvToRgb(hue + 40 * p * vol, sat, clamp01(val * vol)));
        break;
      }
    }
  }

  return out;
}

/**
 * Mean colour of a frame, for the dim backdrop behind the strip.
 *
 * Integer division, matching the old preview's intent of landing on whole
 * pixels rather than carrying a fraction into a fillStyle.
 */
export function averageColor(frame: readonly Rgb[]): Rgb {
  if (frame.length === 0) return [0, 0, 0];
  let r = 0, g = 0, b = 0;
  for (const c of frame) {
    r += c[0];
    g += c[1];
    b += c[2];
  }
  const n = frame.length;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}