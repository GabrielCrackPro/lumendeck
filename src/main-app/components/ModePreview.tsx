import { useEffect, useRef } from "react";
import type { RgbMode } from "@shared/types";
import { averageColor, stripFrame, STRIP_LEDS, type Rgb } from "./rgbStrip";

export interface ModePreviewProps {
  mode: RgbMode;
  staticColor: Rgb;
  /** The wallpaper's dominant colour, or null before the first sample. */
  liveColor: Rgb | null;
  /** Animation speed multiplier; the loop folds it into elapsed time. */
  speed: number;
  brightness: number;
  saturation: number;
  /** Active tiles run at full frame rate; inactive ones are throttled. */
  active: boolean;
  audioVolume?: number;
  cycleSpread?: number;
  waveDirection?: 1 | -1;
}

/** Throttle for an inactive tile: enough to read as moving, cheap enough to
 *  leave several on screen at once. ~15fps. */
const IDLE_MS = 66;

/**
 * A 24-LED strip previewing one lighting mode.
 *
 * All the colour maths lives in `rgbStrip`, which is pure and tested against
 * the Rust engine's own behaviour. This file only decides where the LEDs go
 * and how bright the backdrop is.
 *
 * That split is the point: the preview used to carry its own copy of the
 * per-mode maths inline in the draw loop, with no way to check it against the
 * engine, and it had drifted on three points. See `rgbStrip`.
 */
export function ModePreview({
  mode,
  staticColor,
  liveColor,
  speed,
  brightness,
  saturation,
  active,
  audioVolume,
  cycleSpread = 360,
  waveDirection = 1,
}: ModePreviewProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  // Perf: `audioVolume` updates at 25-40Hz through the store. As an effect
  // dependency it would tear down and rebuild this draw loop on every tick and
  // re-render the whole tab. The loop reads the ref instead, so the animation
  // stays in sync with the audio engine at no React cost.
  const audioRef = useRef(audioVolume);
  audioRef.current = audioVolume;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let timer = 0;
    const t0 = performance.now();

    // Arrow functions, so `canvas` and `ctx` keep their narrowing inside the
    // body. A hoisted `function draw` would re-widen both to `T | null`.
    const draw = () => {
      // Perf: when the app is hidden (tray, minimised) rAF is throttled but
      // setTimeout is not, so skip all canvas work until the window is back.
      if (document.hidden) {
        schedule();
        return;
      }
      // Real device pixel ratio, capped: the strip is redrawn every frame, and
      // a 3x display would triple the fill cost for a few extra pixels of glow.
      const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      const W = (canvas.width = Math.round(canvas.offsetWidth * dpr));
      const H = (canvas.height = Math.round(canvas.offsetHeight * dpr));

      // Speed is folded in here rather than inside the maths, matching how the
      // engine multiplies elapsed time by the configured speed.
      const time = ((performance.now() - t0) / 1000) * speed;

      const leds = stripFrame({
        mode,
        time,
        ledCount: STRIP_LEDS,
        saturation,
        brightness,
        liveColor,
        staticColor,
        audioVolume: audioRef.current,
        cycleSpread,
        waveDirection,
      });

      // Backdrop: a dim wash of the strip's own average, so the tile is tinted
      // by whatever the mode is doing rather than sitting on flat black.
      const dim = averageColor(leds).map(
        (v) => Math.min(255, Math.round(v * 0.16)),
      ) as Rgb;
      ctx.fillStyle = `rgb(${dim[0]},${dim[1]},${dim[2]})`;
      ctx.fillRect(0, 0, W, H);

      // The strip itself.
      const pad = 6 * dpr;
      const gap = 2 * dpr;
      const led = Math.min((W - pad * 2) / STRIP_LEDS - gap, (H - pad * 2) * 0.34);
      const stripW = STRIP_LEDS * (led + gap) - gap;
      const x0 = (W - stripW) / 2;
      const y = H / 2 - led / 2;
      const rad = led * 0.32;
      for (let i = 0; i < leds.length; i++) {
        const [r, g, b] = leds[i]!;
        const x = x0 + i * (led + gap);
        ctx.beginPath();
        ctx.roundRect(x - led * 0.4, y - led * 0.4, led * 1.8, led * 1.8, rad);
        ctx.fillStyle = `rgb(${r} ${g} ${b} / 0.22)`;
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(x, y, led, led, rad);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fill();
      }

      // Floor reflection.
      const reflTop = y + led * 1.6;
      const refl = ctx.createLinearGradient(0, reflTop, 0, H);
      refl.addColorStop(0, `rgba(${Math.min(255, dim[0] * 4)},${Math.min(255, dim[1] * 4)},${Math.min(255, dim[2] * 4)},0.5)`);
      refl.addColorStop(1, "transparent");
      ctx.fillStyle = refl;
      ctx.fillRect(0, reflTop, W, Math.max(0, H - reflTop));

      schedule();
    };

    const schedule = () => {
      if (active) {
        raf = requestAnimationFrame(draw);
      } else {
        timer = window.setTimeout(draw, IDLE_MS);
      }
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [mode, staticColor, liveColor, speed, brightness, saturation, active, cycleSpread, waveDirection]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}
