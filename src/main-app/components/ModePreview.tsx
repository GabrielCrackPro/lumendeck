import { useEffect, useRef } from "react";
import { useStore } from "../store";
import type { RgbMode } from "@shared/types";
import { averageColor, stripFrame, STRIP_LEDS, type Rgb } from "./rgbStrip";
import { emitterColor, ledRadius, paintLedGlow, previewDpr, roundRectPath } from "./ledPaint";

export interface ModePreviewProps {
  mode: RgbMode;
  staticColor: Rgb;
  liveColor: Rgb | null;
  speed: number;
  brightness: number;
  saturation: number;
  active: boolean;
  cycleSpread?: number;
  waveDirection?: 1 | -1;
}

const IDLE_MS = 66;

export function ModePreview({
  mode,
  staticColor,
  liveColor,
  speed,
  brightness,
  saturation,
  active,
  cycleSpread = 360,
  waveDirection = 1,
}: ModePreviewProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  const audioRef = useRef(useStore.getState().audioLevel.volume);
  useEffect(
    () =>
      useStore.subscribe((s) => {
        audioRef.current = s.audioLevel.volume;
      }),
    [],
  );

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let timer = 0;
    const t0 = performance.now();

    const draw = () => {
      if (document.hidden) {
        schedule();
        return;
      }
      const dpr = previewDpr();
      const W = (canvas.width = Math.round(canvas.offsetWidth * dpr));
      const H = (canvas.height = Math.round(canvas.offsetHeight * dpr));

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

      const dim = averageColor(leds).map(
        (v) => Math.min(255, Math.round(v * 0.16)),
      ) as Rgb;
      ctx.fillStyle = `rgb(${dim[0]},${dim[1]},${dim[2]})`;
      ctx.fillRect(0, 0, W, H);

      const pad = 6 * dpr;
      const gap = 2 * dpr;
      const led = Math.min((W - pad * 2) / STRIP_LEDS - gap, (H - pad * 2) * 0.34);
      const stripW = STRIP_LEDS * (led + gap) - gap;
      const x0 = (W - stripW) / 2;
      const cx0 = x0 + led / 2;
      const cy = H / 2;
      for (let i = 0; i < leds.length; i++) {
        const color = emitterColor(leds[i]!);
        const cx = cx0 + i * (led + gap);
        paintLedGlow(ctx, cx, cy, led, color);
        roundRectPath(ctx, cx - led / 2, cy - led / 2, led, led, ledRadius(led));
        ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
        ctx.fill();
      }

      const reflTop = cy + led * 0.9;
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
