import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import { Card, Toggle, Slider, Btn, ColorInput, Dropdown, Section, Segmented } from "../ui";
import { IconRefresh, IconZap, IconWave, IconDevice, IconPlus, IconTrash } from "../icons";
import { RGB_MODES, ANIMATION_MODES } from "@shared/constants";
import { rgbToHex } from "../../utilities";
import type { RgbMode } from "@shared/types";

/**
 * One physical key: label + width in u (1u = standard keycap).
 * Real ANSI layout incl. stagger, modifiers, and function row.
 */
type Key = [label: string, width: number] | [label: string, width: number, home: true];

const KEY_ROWS: Key[][] = [
  // Function row
  [["Esc", 1], ["F1", 1], ["F2", 1], ["F3", 1], ["F4", 1], ["F5", 1], ["F6", 1], ["F7", 1], ["F8", 1], ["F9", 1], ["F10", 1], ["F11", 1], ["F12", 1]],
  // Numbers
  [["~", 1], ["1", 1], ["2", 1], ["3", 1], ["4", 1], ["5", 1], ["6", 1], ["7", 1], ["8", 1], ["9", 1], ["0", 1], ["-", 1], ["=", 1], ["⌫", 2]],
  // QWERTY
  [["Tab", 1.5], ["Q", 1], ["W", 1, true], ["E", 1], ["R", 1], ["T", 1], ["Y", 1], ["U", 1], ["I", 1], ["O", 1], ["P", 1], ["[", 1], ["]", 1], ["\\", 1.5]],
  // Home row
  [["Caps", 1.75], ["A", 1, true], ["S", 1, true], ["D", 1, true], ["F", 1, true], ["G", 1], ["H", 1], ["J", 1], ["K", 1], ["L", 1], [";", 1], ["'", 1], ["⏎", 2.25]],
  // Shift row
  [["⇧", 2.25], ["Z", 1], ["X", 1], ["C", 1], ["V", 1], ["B", 1], ["N", 1], ["M", 1], [",", 1], [".", 1], ["/", 1], ["⇧", 2.75]],
  // Bottom row
  [["Ctrl", 1.25], ["Win", 1.25], ["Alt", 1.25], [" ", 6.25], ["Alt", 1.25], ["Fn", 1.25], ["☰", 1.25], ["Ctrl", 1.25]],
];

/** Numpad block, only appended when the device reports >= 120 LEDs. */
const NUMPAD_ROWS: Key[][] = [
  [["Num", 1], ["/", 1], ["*", 1], ["-", 1]],
  [["7", 1], ["8", 1], ["9", 1], ["+", 1]],
  [["4", 1], ["5", 1], ["6", 1]],
  [["1", 1], ["2", 1], ["3", 1], ["⏎", 1]],
  [["0", 2], [".", 1]],
];

/**
 * Live device preview that adapts to the connected hardware's disposition:
 *  - keyboards render a real ANSI layout (a numpad block appears when the
 *    reported LED count suggests one), painted from per-LED frames;
 *  - any other device (strip, mousemat, mouse, RAM...) renders as an LED
 *    dot-matrix sized to its reported LED count.
 * The shown device is auto-selected: first keyboard, else first device.
 */
export function KeyboardPreview() {
  const { rgb, deviceColors } = useStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);

  const kbDevice =
    rgb.devices.find((d) => /keyboard/i.test(d.typeName)) ?? rgb.devices[0];
  const kb =
    previewId != null && rgb.devices.some((d) => d.id === previewId)
      ? rgb.devices.find((d) => d.id === previewId)!
      : kbDevice;
  const kbColors = kb ? deviceColors[kb.id] : undefined;
  const isKeyboard = kb != null && /keyboard/i.test(kb.typeName);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !kb) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = 2;
    const W = (canvas.width = canvas.offsetWidth * dpr);
    const H = (canvas.height = canvas.offsetHeight * dpr);
    ctx.clearRect(0, 0, W, H);

    // Brushed-metal plate behind the keys: vertical sheen + soft vignette.
    const plateGrad = ctx.createLinearGradient(0, 0, 0, H);
    plateGrad.addColorStop(0, "#14161d");
    plateGrad.addColorStop(0.5, "#0b0c11");
    plateGrad.addColorStop(1, "#08090d");
    ctx.beginPath();
    ctx.roundRect(2 * dpr, 2 * dpr, W - 4 * dpr, H - 4 * dpr, 12 * dpr);
    ctx.fillStyle = plateGrad;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const base = kbColors?.rgb ?? ([10, 11, 16] as [number, number, number]);
    const leds = kbColors?.ledColors ?? null;

    // Per-key light bleed: each lit cap gets a halo before the cap itself is
    // drawn, so the plate around bright keys visibly glows like real shine-
    // through keycaps.
    const drawGlow = (x: number, y: number, w: number, h: number, color: [number, number, number]) => {
      const [r, g, b] = color;
      const cx = x + w / 2, cy = y + h / 2;
      const rad = Math.max(w, h) * 1.15;
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      halo.addColorStop(0, `rgba(${r},${g},${b},${0.34 * lum + 0.06})`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(x - rad, y - rad, w + rad * 2, h + rad * 2);
    };

    const cap = (cr: number, cg: number, cb: number) =>
      `rgb(${Math.round(0.78 * cr)},${Math.round(0.78 * cg)},${Math.round(0.78 * cb)})`;
    const drawCap = (x: number, y: number, w: number, h: number, color: [number, number, number], label?: string, home?: boolean, radius = 4 * dpr) => {
      const [cr, cg, cb] = color;
      drawGlow(x, y, w, h, color);
      // drop shadow under cap
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1.2 * dpr, w, h, radius);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fill();
      // cap body with vertical shade (taller caps look convex)
      const bodyGrad = ctx.createLinearGradient(0, y, 0, y + h);
      bodyGrad.addColorStop(0, cap(Math.min(255, cr * 1.06), Math.min(255, cg * 1.06), Math.min(255, cb * 1.06)));
      bodyGrad.addColorStop(1, cap(cr * 0.72, cg * 0.72, cb * 0.72));
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.fillStyle = bodyGrad;
      ctx.fill();
      // top gloss
      const grad = ctx.createLinearGradient(0, y, 0, y + h * 0.5);
      grad.addColorStop(0, "rgba(255,255,255,0.22)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, w - 2, h * 0.45, 3 * dpr);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (home) {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h - 3 * dpr, 3.5 * dpr, 1.4 * dpr, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.fill();
      }
      if (label && w > Math.max(7, 0.24 * w) * 1.6) {
        ctx.font = `600 ${Math.max(7 * dpr, h * 0.22)}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillText(label, x + w / 2, y + h / 2 + h * 0.045);
      }
    };

    if (!kb) return;

    if (isKeyboard) {
      // Layout adaptivity: LED count suggests whether a numpad (full-size)
      // and a nav cluster (TKL/full) exist alongside the main alphanumeric
      // block.
      const withNumpad = kb.leds >= 120;
      const withNav = kb.leds >= 90;
      const pad = 8 * dpr;
      const gap = 2.5 * dpr;
      const numU = 4;
      const navU = 3;
      const mainU = 15; // widest ANSI row
      const totalU = mainU + (withNav ? navU + 0.35 : 0) + (withNumpad ? numU + 0.35 : 0);
      const keyU = (W - pad * 2) / totalU;
      const keyH = Math.min((H - pad * 2) / KEY_ROWS.length - gap, keyU);
      const mainW = mainU * keyU;

      // Main alphanumeric block (always left).
      let idx = 0;
      const zoneCount = leds?.length ?? 0;
      const zoned = isKeyboard && zoneCount > 0 && zoneCount < 60;
      // Keys per zone: split the sequential LED index space evenly across the
      // keyboard area, like OpenRGB distributes zones on laptop keyboards.
      const keyIdx = { n: 0 };
      const zoneColorFor = (i: number): [number, number, number] =>
        leds?.[i % leds.length] ?? base;
      const zoneOfKey = (i: number) =>
        zoned ? Math.floor((i * zoneCount) / 104) : i; // 104 = ANSI key count

      if (zoned) {
        // Paint the main block in per-zone colors and mark boundaries with a
        // bright divider line between zone spans.
        const totalKeys = KEY_ROWS.reduce((n: number, r: Key[]) => n + r.length, 0);
        const perZone = totalKeys / zoneCount;
        let keyIndex = 0;
        KEY_ROWS.forEach((row, ri) => {
          let x = pad;
          const y = pad + ri * (keyH + gap);
          for (const [label, w, home] of row) {
            const z = Math.min(zoneCount - 1, Math.floor(keyIndex / perZone));
            const isBoundary =
              keyIndex > 0 && keyIndex % perZone < 1;
            const color = zoneColorFor(z);
            drawCap(x, y, w * keyU - gap, keyH, color, label, home);
            if (isBoundary) {
              // zone divider: thin bright line on the keycap's left edge
              ctx.save();
              ctx.beginPath();
              ctx.roundRect(x, y, 1.6 * dpr, keyH, 1 * dpr);
              ctx.fillStyle = "rgba(255,255,255,0.65)";
              ctx.fill();
              ctx.restore();
            }
            keyIndex += 1;
            x += w * keyU;
          }
        });
        idx = totalKeys;
      } else {
        let idx0 = 0;
        KEY_ROWS.forEach((row, ri) => {
          let x = pad;
          const y = pad + ri * (keyH + gap);
          for (const [label, w, home] of row) {
            const color = leds?.[idx0 % leds.length] ?? base;
            drawCap(x, y, w * keyU - gap, keyH, color, label, home);
            idx0 += 1;
            x += w * keyU;
          }
        });
        idx = idx0;
      }
      void keyIdx;
      void zoneOfKey;


      // Nav cluster: 3x3 block + arrow row, bottom-aligned like real boards.
      if (withNav) {
        const nx = pad + mainW + 0.35 * keyU;
        const navKeys = ["PrtSc", "ScrLk", "Pau", "Ins", "Home", "PgUp", "Del", "End", "PgDn"];
        const navCols = 3;
        const navRows = 3;
        const navKeyU = (navU * keyU) / navCols;
        const navKeyH = keyH * 0.8; // slightly shorter, like real nav keys
        const navBottom = H - pad;
        const arrowsY = navBottom - navKeyH - gap;
        const navTop = pad;
        for (let r = 0; r < navRows; r++) {
          for (let c = 0; c < navCols; c++) {
            const label = navKeys[r * navCols + c] ?? "";
            const color = leds?.[idx % leds.length] ?? base;
            drawCap(
              nx + c * navKeyU,
              navTop + r * (navKeyH + gap),
              navKeyU - gap,
              navKeyH,
              color,
              label,
            );
            idx += 1;
          }
        }
        // Arrow cluster, bottom-right of the nav area.
        const arrowKeys = ["<", "v", ">"];
        arrowKeys.forEach((label, ci) => {
          const color = leds?.[idx % leds.length] ?? base;
          drawCap(nx + ci * navKeyU, arrowsY, navKeyU - gap, navKeyH, color, label);
          idx += 1;
        });
        void navBottom;
      }

      // Numpad block, bottom-aligned, with the classic tall keys.
      if (withNumpad) {
        const nx = W - pad - numU * keyU;
        NUMPAD_ROWS.forEach((row, ri) => {
          const extra = row.length === 5 ? (keyH + gap) / 2 : 0;
          const y = H - pad - NUMPAD_ROWS.length * (keyH + gap) + gap + ri * (keyH + gap) - extra;
          let x = nx;
          for (let ci = 0; ci < row.length; ci++) {
            const key = row[ci]!;
            const label = key[0];
            const w = key[1];
            const h = row.length === 5 && ci === row.length - 1 ? keyH + extra : keyH;
            const color = leds?.[idx % leds.length] ?? base;
            drawCap(x, y, w * keyU - gap, h, color, label);
            idx += 1;
            x += w * keyU;
          }
        });
      }
    } else {
      // Non-keyboard: dot-matrix of the device's LEDs, wrapped rows.
      const count = Math.max(1, Math.min(kb.leds || 16, 240));
      const cols = Math.min(count, Math.ceil(W / (14 * dpr)));
      const rows = Math.ceil(count / cols);
      const gap = 5 * dpr;
      const dot = Math.min(
        (W - gap * (cols + 1)) / cols,
        (H - gap * (rows + 1)) / rows,
      );
      const ox = (W - (cols * dot + gap * (cols - 1))) / 2;
      const oy = (H - (rows * dot + gap * (rows - 1))) / 2;
      for (let i = 0; i < count; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const rowCols = Math.min(cols, count - r * cols);
        const offset = (W - (rowCols * dot + (rowCols - 1) * gap)) / 2;
        const color = leds?.[i % leds.length] ?? base;
        const dx = offset + c * (dot + gap);
        const dy = oy + r * (dot + gap);
        drawGlow(dx, dy, dot, dot, color);
        ctx.beginPath();
        ctx.roundRect(dx, dy, dot, dot, dot * 0.3);
        ctx.fillStyle = cap(color[0], color[1], color[2]);
        ctx.fill();
      }
      void ox;
    }
  }, [kb, kbColors, isKeyboard, deviceColors]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel-strong)] p-3.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_0%,rgb(255_255_255/0.06),transparent_55%)]" />
      <div className="relative z-10 mx-auto w-full max-w-[760px]">
        <canvas ref={canvasRef} className="h-52 w-full" />
      </div>
      <div className="relative z-10 mx-auto mt-2 flex w-full max-w-[760px] items-center justify-between gap-3">
        <span className="kicker shrink-0">
          {kb
            ? isKeyboard
              ? kb.leds >= 120
                ? "full-size ansi · live"
                : kb.leds >= 90
                  ? "tkl ansi · live"
                  : kb.leds >= 60
                    ? "ansi layout · live"
                    : kb.leds >= 6
                      ? `ansi layout · ${kb.leds} zone${kb.leds === 1 ? "" : "s"}`
                      : `${kb.leds} zone${kb.leds === 1 ? "" : "s"} · live`
              : `${kb.leds} leds · live`
            : "no device"}
        </span>
        {rgb.devices.length > 1 && (
          <Dropdown
            className="min-w-0 flex-1"
            value={kb?.id ?? ""}
            options={rgb.devices.map((d) => ({
              id: d.id,
              label: `${d.name || `Device ${d.id}`} · ${d.leds}`,
            }))}
            onChange={(v) => setPreviewId(Number(v))}
          />
        )}
        {rgb.devices.length <= 1 && (
          <span className="min-w-0 truncate font-mono text-[10px] text-[var(--text-faint)]">
            {kb?.name ?? "—"}
          </span>
        )}
      </div>
      {!rgb.connected && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--bg)_75%,transparent)] text-xs font-medium tracking-wide text-[var(--text-dim)] backdrop-blur-[2px]">
          Connect OpenRGB to see live colors
        </div>
      )}
    </div>
  );
}

/** Per-mode line icon. */
function ModeIcon({ mode, className }: { mode: RgbMode; className?: string }) {
  const common = { className, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, viewBox: "0 0 24 24" };
  switch (mode) {
    case "ambient":
      return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2" /></svg>;
    case "zone":
      return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 3v18M3 12h9" /></svg>;
    case "pulse":
      return <svg {...common}><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>;
    case "static":
      return <svg {...common}><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" /></svg>;
    case "cycle":
      return <svg {...common}><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" /></svg>;
    case "wave":
      return <svg {...common}><path d="M2 12c2.5-5 5.5-5 8 0s5.5 5 8 0M2 12c2.5 5 5.5 5 8 0" /></svg>;
    case "breathe":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7" opacity="0.5" /><circle cx="12" cy="12" r="10" opacity="0.2" /></svg>;
    case "audioReactive":
      return <svg {...common}><path d="M3 12v-2m4 2v-4m4 4v-6m4 6v-4m4 4v-2" /><path d="M3 12h18" /></svg>;
  }
}

/**
 * Real per-LED strip preview: simulates the engine's math for each mode on a
 * virtual 24-LED strip (same palette rules as the Rust engine: hue sweeps for
 * cycle/wave, static/breathe from the chosen color, ambient/pulse/zone driven
 * by the live wallpaper color), mixed through brightness/saturation.
 */
const STRIP_LEDS = 24;
function ModePreview({ mode, staticColor, liveColor, speed, brightness, saturation, active, audioVolume, cycleSpread = 360, waveDirection = 1 }: {
  mode: RgbMode;
  staticColor: [number, number, number];
  liveColor: [number, number, number] | null;
  speed: number;
  brightness: number;
  saturation: number;
  active: boolean;
  audioVolume?: number;
  cycleSpread?: number;
  waveDirection?: 1 | -1;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const t0 = performance.now();

    const draw = () => {
      const dpr = 2;
      const W = (canvas.width = canvas.offsetWidth * dpr);
      const H = (canvas.height = canvas.offsetHeight * dpr);
      const t = ((performance.now() - t0) / 1000) * speed;

      const base: [number, number, number] = liveColor ?? [40, 60, 120];
      const leds: [number, number, number][] = [];
      const N = STRIP_LEDS;
      for (let i = 0; i < N; i++) {
        const f = i / (N - 1);
        switch (mode) {
          case "static":
            leds.push(staticColor);
            break;
          case "cycle": {
            // Engine: rainbow stretched by cycleSpread across the strip, sliding.
            leds.push(hsl((t * 45 + f * cycleSpread) % 360));
            break;
          }
          case "wave": {
            // Engine: two hue gradients marching (direction-aware), comet pulse.
            const d = waveDirection;
            const h = (((f * 2 - d * t * 0.333) % 1) + 1) % 1 * 360;
            const comet = 0.65 + 0.35 * Math.sin((f - d * t * 0.333) * Math.PI * 2 * 2);
            leds.push(hsl(h).map((v) => Math.round(v * comet)) as [number, number, number]);
            break;
          }
          case "breathe": {
            // Engine: 4.5s organic breath — quick 40% inhale, slow exhale, smoothstep.
            const period = 4.5;
            const p = (t % period) / period;
            const ease = (x: number) => x * x * (3 - 2 * x);
            const wave = p < 0.4 ? ease(p / 0.4) : 1 - ease((p - 0.4) / 0.6);
            const b = 0.15 + 0.85 * wave;
            leds.push(staticColor.map((v) => Math.round(v * b)) as [number, number, number]);
            break;
          }
          case "ambient": {
            // Engine: mild 1.25x saturation lift on the wallpaper color.
            const l = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
            leds.push(base.map((v) => Math.round(Math.min(255, l + (v - l) * 1.25))) as [number, number, number]);
            break;
          }
          case "pulse": {
            // Engine: perceptual brightness curve floored at 35% (drive from luma of the live color).
            const luma = (0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2]) / 255;
            const b = 0.35 + 0.65 * Math.pow(luma, 0.8);
            leds.push(base.map((v) => Math.round(v * b)) as [number, number, number]);
            break;
          }
          case "zone": {
            const seg = f < 1 / 3 ? 0 : f < 2 / 3 ? 1 : 2;
            const shift = [1, 0.72, 0.45][seg] ?? 1;
            leds.push(base.map((v) => Math.round(v * shift)) as [number, number, number]);
            break;
          }
          case "audioReactive": {
            // Engine: volume-floored brightness + spectral hue tilt across the strip.
            const vol = Math.max(audioVolume ?? 0.3, 0.3);
            leds.push(hsl((hslHue(staticColor) + 40 * f * vol) % 360).map((v) => Math.round(v * vol)) as [number, number, number]);
            break;
          }
        }
      }

      // mixer (brightness/saturation), like the engine does
      const sat = saturation;
      const mix = leds.map(([r, g, b]) => {
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return [
          Math.min(255, (l + (r - l) * sat) * brightness),
          Math.min(255, (l + (g - l) * sat) * brightness),
          Math.min(255, (l + (b - l) * sat) * brightness),
        ] as [number, number, number];
      });

      // backdrop: dim average
      const avg = mix.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]] as [number, number, number], [0, 0, 0] as [number, number, number]);
      const dim = avg.map((v) => Math.round((v / N) * 0.16)) as [number, number, number];
      ctx.fillStyle = `rgb(${dim[0]},${dim[1]},${dim[2]})`;
      ctx.fillRect(0, 0, W, H);

      // the strip
      const pad = 6 * dpr;
      const gap = 2 * dpr;
      const led = Math.min((W - pad * 2) / N - gap, (H - pad * 2) * 0.34);
      const stripW = N * (led + gap) - gap;
      const x0 = (W - stripW) / 2;
      const y = H / 2 - led / 2;
      const rad = led * 0.32;
      for (let i = 0; i < N; i++) {
        const [r, g, b] = mix[i]!;
        const x = x0 + i * (led + gap);
        // glow halo
        ctx.beginPath();
        ctx.roundRect(x - led * 0.4, y - led * 0.4, led * 1.8, led * 1.8, rad);
        ctx.fillStyle = `rgb(${r} ${g} ${b} / 0.22)`;
        ctx.fill();
        // LED body
        ctx.beginPath();
        ctx.roundRect(x, y, led, led, rad);
        ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
        ctx.fill();
      }
      // floor reflection
      const refl = ctx.createLinearGradient(0, y + led * 1.6, 0, H);
      refl.addColorStop(0, `rgba(${dim[0] * 4},${dim[1] * 4},${dim[2] * 4},0.5)`);
      refl.addColorStop(1, "transparent");
      ctx.fillStyle = refl;
      ctx.fillRect(0, y + led * 1.6, W, H - (y + led * 1.6));

      // Active tiles run at full rAF; inactive ones stay alive but throttled
      // to ~15fps so the gallery always moves without burning GPU.
      if (active) {
        raf = requestAnimationFrame(draw);
      } else {
        raf = window.setTimeout(draw, 66) as unknown as number;
      }
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(raf);
    };
  }, [mode, staticColor, liveColor, speed, brightness, saturation, active, audioVolume, cycleSpread, waveDirection]);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}

function hsl(h: number): [number, number, number] {
  const c = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * Math.max(0, Math.min(1, 1 - Math.abs(k - 3)) * 0.92));
  };
  return [c(5), c(3), c(1)];
}

/** Hue of an RGB color in degrees (0 when gray). */
function hslHue([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
}

export default function RgbTab() {
  const { cfg, rgb, save, audioLevel } = useStore();
  const deviceColors = useStore((s) => s.deviceColors);
  const [profileNaming, setProfileNaming] = useState(false);
  const [profileNameVal, setProfileNameVal] = useState("");
  const promptProfileName = () => {
    setProfileNaming(true);
    setProfileNameVal(`Profile ${(cfg?.rgb.profiles.length ?? 0) + 1}`);
    return null; // commit happens via the inline form below
  };
  // Hooks must run unconditionally — derive everything after they complete.
  if (!cfg) return null;
  const rgbCfg = cfg.rgb;
  const isAnimated = (ANIMATION_MODES as ReadonlySet<RgbMode>).has(rgbCfg.mode);

  const ledTotal = rgb.devices.reduce((n, d) => n + d.leds, 0);
  const activeMode = RGB_MODES.find((m) => m.id === rgbCfg.mode);
  const liveWallpaperColor = Object.values(deviceColors)[0]?.rgb ?? null;

  return (
    <div className="stagger space-y-6">
      {/* ---- hero: live stage ---- */}
      <Card title="Live stage">
        <div className="grid gap-5 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <KeyboardPreview />
          <div className="flex min-w-0 flex-col justify-between gap-4">
            <span
              className={`relative block h-20 w-full overflow-hidden rounded-xl border ${
                rgbCfg.enabled ? "border-[rgb(var(--glow)/0.4)]" : "border-[var(--line)]"
              }`}
            >
              <ModePreview
                mode={rgbCfg.mode}
                staticColor={rgbCfg.staticColor}
                liveColor={liveWallpaperColor}
                speed={rgbCfg.animationSpeed}
                brightness={rgbCfg.mixer.brightness}
                saturation={rgbCfg.mixer.saturation}
                active={rgbCfg.enabled}
                audioVolume={audioLevel.volume}
                cycleSpread={rgbCfg.cycleSpread}
                waveDirection={rgbCfg.waveDirection}
              />
              <span className="absolute inset-0 bg-[linear-gradient(180deg,rgb(255_255_255/0.08),transparent_40%)]" />
              <span className="absolute bottom-2 left-3 font-mono text-[10px] uppercase tracking-wider text-[rgb(255_255_255/0.75)]">
                {rgbCfg.enabled ? "active" : "sync off"}
              </span>
            </span>
            <div>
              <div className="kicker">
                {activeMode?.group === "animation" ? "Animated mode" : "Reactive mode"}
              </div>
              <div className="mt-0.5 text-lg font-semibold text-[var(--text)]">
                {activeMode?.label ?? rgbCfg.mode}
              </div>
            </div>
            <div>
              <div className="font-mono text-[11px] text-[var(--text-dim)]">
                {rgb.devices.length} devices · {ledTotal.toLocaleString()} leds
              </div>
              <label className="mt-2 flex items-center gap-2">
                <span className="kicker shrink-0">accent from</span>
                <Dropdown
                  className="min-w-0 flex-1"
                  value={rgbCfg.accentDevice ?? ""}
                  options={[
                    { id: "", label: "Auto (keyboard first)" },
                    { id: -1, label: "Off (static color)" },
                    ...rgb.devices.map((d) => ({
                      id: d.id,
                      label: d.name || `Device ${d.id}`,
                    })),
                  ]}
                  onChange={(v) =>
                    save((c) => {
                      c.rgb.accentDevice = v === "" ? null : Number(v);
                    })
                  }
                />
              </label>
            </div>
            <Toggle
              label="RGB sync enabled"
              checked={rgbCfg.enabled}
              onChange={(v) => save((c) => (c.rgb.enabled = v))}
            />
            <Toggle
              label="UI follows lights"
              checked={cfg?.general.accentLive ?? false}
              onChange={(v) => save((c) => (c.general.accentLive = v))}
            />
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
      <div className="space-y-6">
        <Card
          title="Devices"
          right={
            rgb.connected ? (
              <span className="font-mono text-[10px] tracking-wide text-[var(--text-faint)]">
                {ledTotal.toLocaleString()} leds
              </span>
            ) : undefined
          }
        >
          {rgb.connected ? (
            <ul className="mt-5 space-y-2.5">
              {rgb.devices.filter((d) => !rgbCfg.excludedDevices.includes(d.id)).map((d) => {
                const live = useStore.getState().deviceColors[d.id];
                const hex = live ? rgbToHex(live.rgb as [number, number, number]) : null;
                return (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel-strong)] px-3.5 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] text-[var(--text-dim)]"
                        style={
                          live
                            ? {
                                color: `rgb(${live.rgb[0]} ${live.rgb[1]} ${live.rgb[2]})`,
                                boxShadow: `inset 0 0 14px -4px rgb(${live.rgb[0]} ${live.rgb[1]} ${live.rgb[2]} / 0.8)`,
                              }
                            : undefined
                        }
                      >
                        <IconDevice type={d.typeName} className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-[var(--text)]">
                            {d.name || `Device ${d.id}`}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <span className="truncate text-[11px] capitalize text-[var(--text-faint)]">
                            {d.typeName.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}
                          </span>
                          <span className="h-0.5 w-0.5 rounded-full bg-[var(--line-strong)]" />
                          <span className="font-mono text-[11px] text-[var(--text-dim)]">
                            {d.leds} LEDs
                          </span>
                          {d.zones.length > 0 && (
                            <>
                              <span className="h-0.5 w-0.5 rounded-full bg-[var(--line-strong)]" />
                              <span className="truncate text-[11px] text-[var(--text-faint)]">
                                {d.zones.length} zone{d.zones.length === 1 ? "" : "s"}: {d.zones.slice(0, 2).join(", ")}
                                {d.zones.length > 2 ? ` +${d.zones.length - 2}` : ""}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {hex && (
                        <>
                          <span className="hidden font-mono text-[10px] uppercase text-[var(--text-faint)] sm:block">
                            {hex}
                          </span>
                          <span
                            className="h-5 w-5 rounded-lg border border-[rgb(255_255_255/0.14)] shadow-[0_0_10px_-2px_rgb(255_255_255/0.25)]"
                            style={{
                              background: `rgb(${live!.rgb[0]} ${live!.rgb[1]} ${live!.rgb[2]})`,
                            }}
                          />
                        </>
                      )}
                      <Toggle
                      label=""
                      checked={true}
                      onChange={() =>
                        save((c) => {
                          c.rgb.excludedDevices = [...c.rgb.excludedDevices, d.id];
                        })
                      }
                    />
                    </div>
                  </li>
                );
              })}
              {rgb.devices.filter((d) => !rgbCfg.excludedDevices.includes(d.id)).length === 0 && (
                <li className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel-strong)] px-3.5 py-3 text-sm text-[var(--text-faint)]">
                  {rgb.devices.length > 0
                    ? "All devices excluded. Toggle them on from Settings."
                    : "Connected, but no devices reported yet."}
                  <Btn onClick={() => useStore.getState().load()}>
                    <IconRefresh className="h-4 w-4" />
                    Refresh
                  </Btn>
                </li>
              )}
              {rgb.devices.length === 0 && (
                <li className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel-strong)] px-3.5 py-3 text-sm text-[var(--text-faint)]">
                  Connected, but no devices reported yet.
                  <Btn onClick={() => useStore.getState().load()}>
                    <IconRefresh className="h-4 w-4" />
                    Refresh
                  </Btn>
                </li>
              )}
            </ul>
          ) : (
            <div className="mt-5 space-y-3.5 text-sm text-[var(--text-dim)]">
              <div className="flex items-start gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel-strong)] p-3.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-300">
                  <IconZap className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="leading-relaxed">
                    Start <b className="font-semibold text-[var(--text)]">OpenRGB</b> with the
                    SDK server enabled (Settings → Server → Start). It listens on port
                    6742 by default.
                  </p>
                  {rgb.lastError && (
                    <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-[var(--text-faint)]">
                      {rgb.lastError}
                    </p>
                  )}
                </div>
              </div>
              <Btn onClick={() => useStore.getState().load()}>
                <IconRefresh className="h-4 w-4" />
                Retry
              </Btn>
            </div>
          )}
          <div className="mt-4 border-t border-[var(--line)] pt-4">
            <Toggle
              label="Turn off lights when idle"
              description="Automatically turn off RGB after a period of no keyboard or mouse activity."
              checked={rgbCfg.idleTimeoutSec > 0}
              onChange={(v) =>
                save((c) => {
                  c.rgb.idleTimeoutSec = v ? 300 : 0;
                  if (!c.rgb.idleCheckIntervalSec || c.rgb.idleCheckIntervalSec < 1) {
                    c.rgb.idleCheckIntervalSec = 10;
                  }
                })
              }
            />
            {rgbCfg.idleTimeoutSec > 0 && (
              <>
                <Slider
                  label="Idle timeout"
                  min={30}
                  max={3600}
                  step={30}
                  value={rgbCfg.idleTimeoutSec}
                  format={(v) => {
                    if (v < 60) return `${v}s`;
                    const m = Math.floor(v / 60);
                    const s = v % 60;
                    return s > 0 ? `${m}m ${s}s` : `${m} min`;
                  }}
                  onChange={(v) => save((c) => (c.rgb.idleTimeoutSec = v))}
                />
                <Slider
                  label="Check interval"
                  min={1}
                  max={60}
                  step={1}
                  value={rgbCfg.idleCheckIntervalSec}
                  format={(v) => `${v}s`}
                  onChange={(v) => save((c) => (c.rgb.idleCheckIntervalSec = v))}
                />
              </>
            )}

            <div className="mt-4 border-t border-[var(--line)] pt-4">
              <Toggle
                label="Night dimming"
                description="Cap LED brightness during a daily window (e.g. 22:00 to 07:00) so the lights don't glare in the dark."
                checked={!!rgbCfg.nightStart && !!rgbCfg.nightEnd}
                onChange={(v) =>
                  save((c) => {
                    if (v) {
                      c.rgb.nightStart = "22:00";
                      c.rgb.nightEnd = "07:00";
                      if (!c.rgb.nightBrightness) c.rgb.nightBrightness = 0.3;
                    } else {
                      c.rgb.nightStart = "";
                      c.rgb.nightEnd = "";
                    }
                  })
                }
              />
              {!!rgbCfg.nightStart && !!rgbCfg.nightEnd && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-[var(--text-faint)]">Starts</span>
                    <input
                      type="time"
                      value={rgbCfg.nightStart}
                      onChange={(e) => save((c) => (c.rgb.nightStart = e.target.value))}
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-2.5 py-1.5 text-sm outline-none focus:border-[rgb(var(--glow)/0.5)]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-[var(--text-faint)]">Ends</span>
                    <input
                      type="time"
                      value={rgbCfg.nightEnd}
                      onChange={(e) => save((c) => (c.rgb.nightEnd = e.target.value))}
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-2.5 py-1.5 text-sm outline-none focus:border-[rgb(var(--glow)/0.5)]"
                    />
                  </label>
                  <div className="col-span-2">
                    <Slider
                      label="Night brightness cap"
                      min={0}
                      max={100}
                      step={5}
                      value={Math.round(rgbCfg.nightBrightness * 100)}
                      format={(v) => `${v}%`}
                      onChange={(v) => save((c) => (c.rgb.nightBrightness = v / 100))}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className="space-y-5">
        <Card
          title="Lighting mode"
          right={
            <span className="inline-flex items-center gap-2.5 font-mono text-[10px] tracking-wide">
              <span className="text-[var(--text-faint)]">
                {Math.round(rgbCfg.mixer.brightness * 100)}% bright
              </span>
              <span className="h-0.5 w-0.5 rounded-full bg-[var(--line-strong)]" />
              {isAnimated ? (
                <span className="inline-flex items-center gap-1.5 text-[rgb(var(--glow))]">
                  <IconWave className="h-3.5 w-3.5" />
                  {rgbCfg.animationSpeed.toFixed(1)}×
                </span>
              ) : (
                <span className="text-[var(--text-faint)]">
                  {rgbCfg.mixer.smoothing === 0 ? "snap" : `${Math.round(rgbCfg.mixer.smoothing * 100)}% smooth`}
                </span>
              )}
              {!rgbCfg.enabled && (
                <span className="rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-px uppercase text-amber-300">off</span>
              )}
            </span>
          }
        >
          {(["reactive", "animation"] as const).map((group) => (
            <div key={group}>
              <div className="kicker mb-2 mt-5 first:mt-0">
                {group === "reactive" ? "Reactive to wallpaper" : "Animated"}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {RGB_MODES.filter((m) => m.group === group).map((m) => {
                  const active = rgbCfg.mode === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => save((c) => (c.rgb.mode = m.id as RgbMode))}
                      className={`group relative flex aspect-[16/10] w-full flex-col overflow-hidden rounded-xl border transition-all duration-200 ${
                        active
                          ? "border-[rgb(var(--glow)/0.6)] shadow-[0_8px_28px_-10px_rgb(var(--glow)/0.55)] ring-2 ring-[rgb(var(--glow)/0.25)]"
                          : "border-[var(--line)] hover:border-[var(--line-strong)] hover:brightness-110"
                      }`}
                    >
                      {/* full-bleed live per-LED strip preview */}
                      <ModePreview
                        mode={m.id as RgbMode}
                        staticColor={rgbCfg.staticColor}
                        liveColor={liveWallpaperColor}
                        speed={rgbCfg.animationSpeed}
                        brightness={rgbCfg.mixer.brightness}
                        saturation={rgbCfg.mixer.saturation}
                        active={active}
                        audioVolume={audioLevel.volume}
                        cycleSpread={rgbCfg.cycleSpread}
                        waveDirection={rgbCfg.waveDirection}
                      />
                      <span className="absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0.45)_0%,transparent_30%,transparent_45%,rgb(0_0_0/0.78)_100%)]" />
                      {/* top row: icon + active pill */}
                      <span className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
                        <ModeIcon
                          mode={m.id as RgbMode}
                          className={`h-4 w-4 shrink-0 drop-shadow ${active ? "text-[rgb(var(--glow))]" : "text-white/70"}`}
                        />
                        {active && (
                          <span className="rounded-md bg-[rgb(var(--glow))] px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-black/85">
                            active
                          </span>
                        )}
                      </span>
                      {/* bottom: name + hint, always visible */}
                      <span className="absolute inset-x-0 bottom-0 p-2.5">
                        <span
                          className={`block text-[13px] font-semibold leading-tight ${
                            active ? "text-[rgb(var(--glow))]" : "text-white"
                          }`}
                        >
                          {m.label}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] leading-snug text-white/55">
                          {m.hint}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {/* ---- profiles: save/apply named snapshots, also exposed in tray ---- */}
          <div className="mt-6 border-t border-[var(--line)] pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold text-[var(--text)]">Profiles</div>
                <div className="mt-0.5 text-[11px] text-[var(--text-faint)]">
                  Save the current mode, color and speed as a snapshot — switchable from
                  the tray menu.
                </div>
              </div>
              {profileNaming ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = profileNameVal.trim();
                    if (name) {
                      save((c) => {
                        c.rgb.profiles = [
                          ...c.rgb.profiles.filter((p) => p.name !== name),
                          {
                            name,
                            mode: rgbCfg.mode,
                            staticColor: rgbCfg.staticColor,
                            animationSpeed: rgbCfg.animationSpeed,
                          },
                        ];
                      });
                    }
                    setProfileNaming(false);
                  }}
                >
                  <input
                    autoFocus
                    value={profileNameVal}
                    onChange={(e) => setProfileNameVal(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setProfileNaming(false)}
                    placeholder="Profile name"
                    className="w-36 rounded-lg border border-[rgb(var(--glow)/0.4)] bg-[var(--panel-strong)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text)] outline-none"
                  />
                  <Btn variant="primary" onClick={() => {}}>
                    Save
                  </Btn>
                </form>
              ) : (
                <Btn onClick={promptProfileName}>
                  <IconPlus className="h-4 w-4" />
                  Save current
                </Btn>
              )}
            </div>
            {(rgbCfg.profiles?.length ?? 0) === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--line-strong)] px-4 py-5 text-center text-xs text-[var(--text-faint)]">
                No profiles yet — tune the lights, then save the look.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {rgbCfg.profiles.map((p) => {
                  const activeNow =
                    p.mode === rgbCfg.mode &&
                    p.staticColor.join() === rgbCfg.staticColor.join() &&
                    Math.abs(p.animationSpeed - rgbCfg.animationSpeed) < 0.01;
                  return (
                    <div
                      key={p.name}
                      className={`group flex items-center gap-2 rounded-xl py-1.5 pl-1.5 pr-2 ${
                        activeNow
                          ? "border border-[rgb(var(--glow)/0.5)] bg-[rgb(var(--glow)/0.12)]"
                          : "border border-[var(--line)] bg-[var(--panel-strong)] hover:border-[var(--line-strong)]"
                      }`
                    }
                    >
                      <button
                        onClick={() =>
                          save((c) => {
                            const src = c.rgb.profiles.find((x) => x.name === p.name);
                            if (!src) return;
                            c.rgb.mode = src.mode;
                            c.rgb.staticColor = src.staticColor;
                            c.rgb.animationSpeed = src.animationSpeed;
                          })
                        }
                        className="flex items-center gap-2"
                        title={`Apply "${p.name}"`}
                      >
                        <span
                          className="h-4 w-4 shrink-0 rounded-full border border-white/20"
                          style={{ background: rgbToHex(p.staticColor) }}
                        />
                        <span className="text-xs font-semibold text-[var(--text)]">{p.name}</span>
                        <span className="font-mono text-[10px] text-[var(--text-faint)]">
                          {p.mode === "audioReactive" ? "audio" : p.mode} · {p.animationSpeed.toFixed(1)}×
                        </span>
                      </button>
                      <button
                        aria-label={`Delete profile ${p.name}`}
                        onClick={() =>
                          save((c) => {
                            c.rgb.profiles = c.rgb.profiles.filter((x) => x.name !== p.name);
                          })
                        }
                        className="hidden text-[var(--text-faint)] transition-colors hover:text-red-400 group-hover:block"
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {/* ---- mode-specific options + mixer: two-column disposition ---- */}
          {(rgbCfg.mode === "static" || rgbCfg.mode === "breathe" || rgbCfg.mode === "audioReactive") && (
            <ColorInput
              label={rgbCfg.mode === "static" ? "Static color" : rgbCfg.mode === "breathe" ? "Breath color" : "Base color"}
              value={rgbCfg.staticColor}
              onChange={(v) => save((c) => (c.rgb.staticColor = v))}
            />
          )}
          <div className="space-y-1">
            {/* mode options */}
            <Section title="Mode options" defaultOpen>
            <div className="space-y-1">
              {rgbCfg.mode === "cycle" && (
                <Slider
                  label="Rainbow spread"
                  value={rgbCfg.cycleSpread}
                  min={30}
                  max={720}
                  step={10}
                  onChange={(v) => save((c) => (c.rgb.cycleSpread = v))}
                  format={(v) => `${Math.round(v)}°`}
                />
              )}
              {rgbCfg.mode === "wave" && (
                <div className="py-2.5">
                  <div className="kicker mb-2">Direction</div>
                  <Segmented
                    options={[
                      { id: "1", label: "Forward" },
                      { id: "-1", label: "Reverse" },
                    ]}
                    value={String(rgbCfg.waveDirection)}
                    onChange={(v) => save((c) => { c.rgb.waveDirection = Number(v) as 1 | -1; })}
                  />
                </div>
              )}
              {rgbCfg.mode === "audioReactive" && (
                <>
                  <div className="py-2.5">
                  <div className="kicker mb-2">Audio source</div>
                  <Segmented
                    options={[
                      { id: "system", label: "System audio" },
                      { id: "microphone", label: "Microphone" },
                    ]}
                    value={rgbCfg.audioSource}
                    onChange={(v) => save((c) => { c.rgb.audioSource = v; })}
                  />
                  </div>
                  <div className="py-2.5">
                    <div className="kicker mb-2">Audio level</div>
                    <div className="relative h-3 overflow-hidden rounded-full bg-[var(--panel)]">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-75"
                        style={{
                          width: `${Math.round(audioLevel.volume * 100)}%`,
                          background: audioLevel.beat
                            ? "rgb(var(--glow))"
                            : "linear-gradient(90deg, rgb(var(--glow)), rgb(167 139 250))",
                          boxShadow: audioLevel.beat
                            ? "0 0 12px rgb(var(--glow) / 0.6)"
                            : undefined,
                        }}
                      />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="font-mono text-[10px] text-[var(--text-faint)]">
                        {Math.round(audioLevel.volume * 100)}%
                      </span>
                      {audioLevel.beat && (
                        <span className="font-mono text-[10px] text-[rgb(var(--glow))]">beat</span>
                      )}
                    </div>
                    {audioLevel.deviceName && (
                      <div className="mt-1 truncate text-[11px] text-[var(--text-dim)]" title={audioLevel.deviceName}>
                        {audioLevel.deviceName}
                      </div>
                    )}
                  </div>
                  <Slider
                    label="Audio sensitivity"
                    min={0.1}
                    max={3}
                    step={0.1}
                    value={rgbCfg.audioSensitivity}
                    format={(v) => `${v.toFixed(1)}x`}
                    onChange={(v) => save((c) => (c.rgb.audioSensitivity = v))}
                  />
                  <Slider
                    label="Audio smoothing"
                    min={0}
                    max={0.95}
                    step={0.05}
                    value={rgbCfg.audioSmoothing}
                    format={(v) => (v === 0 ? "snap" : `${Math.round(v * 100)}%`)}
                    onChange={(v) => save((c) => (c.rgb.audioSmoothing = v))}
                  />
                </>
              )}
              {rgbCfg.mode === "zone" && (
                <p className="my-2 rounded-xl border border-[rgb(var(--glow)/0.25)] bg-[rgb(var(--glow)/0.07)] px-3 py-2 text-xs leading-relaxed text-[var(--text-dim)]">
                  Draw zones on the Wallpaper tab — each zone can be mapped to devices there.
                </p>
              )}
              {isAnimated && (
                <Slider
                  label="Animation speed"
                  min={0.1}
                  max={5}
                  step={0.1}
                  value={rgbCfg.animationSpeed}
                  format={(v) => `${v.toFixed(1)}×`}
                  onChange={(v) => save((c) => (c.rgb.animationSpeed = v))}
                />
              )}
              {!isAnimated && (
                <Slider
                  label="Transition smoothing"
                  min={0}
                  max={0.95}
                  step={0.05}
                  value={rgbCfg.mixer.smoothing}
                  format={(v) => (v === 0 ? "snap" : `${Math.round(v * 100)}%`)}
                  onChange={(v) => save((c) => (c.rgb.mixer.smoothing = v))}
                />
              )}
            </div>
            </Section>

            {/* output mixer */}
            <Section title="Output mixer" defaultOpen>
            <div className="space-y-1">
              <Slider
                label="Brightness"
                min={0.1}
                max={1.5}
                step={0.05}
                value={rgbCfg.mixer.brightness}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => save((c) => (c.rgb.mixer.brightness = v))}
              />
              <Slider
                label="Saturation"
                min={0}
                max={2}
                step={0.05}
                value={rgbCfg.mixer.saturation}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => save((c) => (c.rgb.mixer.saturation = v))}
              />
              <Slider
                label="Gamma"
                min={0.4}
                max={2.5}
                step={0.05}
                value={rgbCfg.mixer.gamma}
                format={(v) => v.toFixed(2)}
                onChange={(v) => save((c) => (c.rgb.mixer.gamma = v))}
              />
              {!isAnimated && (
                <Slider
                  label="Min update interval"
                  min={30}
                  max={1000}
                  step={10}
                  value={rgbCfg.minUpdateMs}
                  format={(v) => `${v} ms`}
                  onChange={(v) => save((c) => (c.rgb.minUpdateMs = v))}
                />
              )}
            </div>
            </Section>
          </div>
        </Card>
      </div>
      </div>
    </div>
  );
}