import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { Dropdown } from "./ui";
import { deviceName } from "./DeviceRow";
import { t } from "../i18n";
import type { DeviceColor } from "@shared/types";
import {
  buildKeyboardPlates,
  disposition,
  dispositionLabel,
  plateAt,
  type DispositionLabel,
  type Plate,
} from "./keyboardLayout";

/**
 * Caption per board variant.
 *
 * A named map rather than literals inside the component so the i18n checker
 * can see every key it is responsible for. `n-leds-live` and `no-device` are
 * here too, for the same reason.
 */
const DISPOSITION_LABEL_KEYS: Record<DispositionLabel, string> = {
  fullSize: "lighting.full-size-ansi-live",
  tkl: "lighting.tkl-ansi-live",
  ansi: "lighting.ansi-layout-live",
  zonedBoard: "lighting.ansi-layout-zones",
  lightbar: "lighting.n-zones-live",
  leds: "lighting.n-leds-live",
  none: "lighting.no-device",
};

/**
 * Live preview of a connected RGB device.
 *
 * Keyboards render a real ANSI layout, with a nav cluster and numpad appearing
 * when the reported LED count suggests them. Everything else — strips,
 * mousemats, RAM — renders as a dot-matrix sized to its LED count.
 *
 * The geometry lives in `keyboardLayout`, which is pure and unit-tested. This
 * file only knows how to paint a keycap. The layout maths used to live inline
 * here, where it could be neither tested nor hit-tested, and it carried three
 * live defects: zones were divided by the main-block key count while nav and
 * numpad were still being drawn (so those blocks came out as a run of identical
 * trailing keys), the boundary test ran modulo on a fraction, and the canvas
 * backing store was only sized when colours arrived, so resizing the window
 * left a stretched bitmap.
 */
export function KeyboardPreview() {
  const { rgb, deviceColors, deviceNames } = useStore(
    useShallow((s) => ({
      rgb: s.rgb,
      deviceColors: s.deviceColors,
      // The map's identity only changes when a device is renamed, so a shallow
      // compare keeps this from re-rendering on every config write.
      deviceNames: s.cfg?.rgb.deviceNames ?? {},
    })),
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  /** Label of the keycap under the cursor, shown in the readout. */
  const [hovered, setHovered] = useState<string | null>(null);

  const kbDevice =
    rgb.devices.find((d) => /keyboard/i.test(d.typeName)) ?? rgb.devices[0];
  const kb =
    previewId != null && rgb.devices.some((d) => d.id === previewId)
      ? rgb.devices.find((d) => d.id === previewId)!
      : kbDevice;
  const kbColors: DeviceColor | undefined = kb ? deviceColors[kb.id] : undefined;
  const isKeyboard = kb != null && /keyboard/i.test(kb.typeName);
  const ledCount = kb?.leds ?? 0;
  const colorCount = kbColors?.ledColors.length ?? 0;
  const disp = disposition(ledCount, colorCount);

  /** Plates from the last frame, so hit-testing uses the drawn geometry. */
  const platesRef = useRef<Plate[]>([]);

  /**
   * Paint one frame. Returns nothing; callers read `platesRef` afterwards.
   *
   * Split out of the effect so the resize observer can repaint without
   * provoking a re-render — resizing is not a state change, and treating it as
   * one would re-run the whole effect on every drag of the window edge.
   */
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !kb) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Real device pixel ratio, capped: a 3x display would quadruple the fill
    // cost of a canvas that is redrawn 12.5 times a second.
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW <= 0 || cssH <= 0) return;

    const W = (canvas.width = Math.round(cssW * dpr));
    const H = (canvas.height = Math.round(cssH * dpr));
    ctx.clearRect(0, 0, W, H);

    const base = kbColors?.rgb ?? ([10, 11, 16] as [number, number, number]);
    const leds = kbColors?.ledColors ?? null;
    const pad = 8 * dpr;
    const gap = 2.5 * dpr;

    // Brushed-metal plate behind the keys: vertical sheen, soft vignette.
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

    /** Light bleed: a halo under the cap, so the plate glows like real caps. */
    const drawGlow = (
      x: number, y: number, w: number, h: number,
      color: [number, number, number],
    ) => {
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

    const shade = (cr: number, cg: number, cb: number) =>
      `rgb(${Math.round(0.78 * cr)},${Math.round(0.78 * cg)},${Math.round(0.78 * cb)})`;

    const colorAt = (i: number): [number, number, number] => leds?.[i] ?? base;

    const drawCap = (
      x: number, y: number, w: number, h: number,
      color: [number, number, number],
      opts: { label?: string; home?: boolean; hover?: boolean } = {},
    ) => {
      const { label, home, hover } = opts;
      const [cr, cg, cb] = color;
      const radius = 4 * dpr;
      drawGlow(x, y, w, h, color);

      // Drop shadow under the cap.
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1.2 * dpr, w, h, radius);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fill();

      // Cap body with a vertical shade, so taller caps read as convex.
      const bodyGrad = ctx.createLinearGradient(0, y, 0, y + h);
      bodyGrad.addColorStop(
        0,
        shade(
          Math.min(255, cr * 1.06),
          Math.min(255, cg * 1.06),
          Math.min(255, cb * 1.06),
        ),
      );
      bodyGrad.addColorStop(1, shade(cr * 0.72, cg * 0.72, cb * 0.72));
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.fillStyle = bodyGrad;
      ctx.fill();

      // Top gloss.
      const gloss = ctx.createLinearGradient(0, y, 0, y + h * 0.5);
      gloss.addColorStop(0, "rgba(255,255,255,0.22)");
      gloss.addColorStop(1, "rgba(255,255,255,0)");
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, w - 2, h * 0.45, 3 * dpr);
      ctx.fillStyle = gloss;
      ctx.fill();

      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.strokeStyle = hover ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.25)";
      ctx.lineWidth = hover ? 1.5 * dpr : 1;
      ctx.stroke();

      if (home) {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h - 3 * dpr, 3.5 * dpr, 1.4 * dpr, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.fill();
      }

      // Legends only on keys wide enough to hold text. The old guard was
      // `w > max(7, 0.24 * w) * 1.6`, which is a tautology for any sane width,
      // so single-character legends spilled across half-unit modifier keys.
      const fontSize = Math.max(7 * dpr, h * 0.22);
      if (label && label.trim() && w > fontSize * 2.1) {
        ctx.font = `600 ${fontSize}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillText(label, x + w / 2, y + h / 2 + h * 0.045);
      }
    };

    if (isKeyboard) {
      const plates = buildKeyboardPlates(W, H, {
        pad,
        gap,
        disposition: disp,
        colorCount,
      });
      for (const p of plates) {
        drawCap(p.x, p.y, p.w, p.h, colorAt(p.ledIndex), {
          label: p.label,
          home: p.home,
          hover: p.label === hovered,
        });
        if (p.boundary) {
          // Zone divider on the leading edge of the key.
          ctx.beginPath();
          ctx.roundRect(p.x, p.y, 1.6 * dpr, p.h, 1 * dpr);
          ctx.fillStyle = "rgba(255,255,255,0.65)";
          ctx.fill();
        }
      }
      platesRef.current = plates;
    } else {
      // Non-keyboard: dot-matrix of the device's LEDs, wrapped rows.
      const count = Math.max(1, Math.min(ledCount || 16, 240));
      const cols = Math.min(count, Math.ceil(W / (14 * dpr)));
      const rows = Math.ceil(count / cols);
      const dotGap = 5 * dpr;
      const dot = Math.min(
        (W - dotGap * (cols + 1)) / cols,
        (H - dotGap * (rows + 1)) / rows,
      );
      const oy = (H - (rows * dot + dotGap * (rows - 1))) / 2;
      for (let i = 0; i < count; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        // Centre each row on its own, so a short final row is not left-ragged.
        const rowCols = Math.min(cols, count - r * cols);
        const ox = (W - (rowCols * dot + (rowCols - 1) * dotGap)) / 2;
        const color = colorAt(i);
        const dx = ox + c * (dot + dotGap);
        const dy = oy + r * (dot + dotGap);
        drawGlow(dx, dy, dot, dot, color);
        ctx.beginPath();
        ctx.roundRect(dx, dy, dot, dot, dot * 0.3);
        ctx.fillStyle = shade(color[0], color[1], color[2]);
        ctx.fill();
      }
      platesRef.current = [];
    }
  }, [kb, kbColors, isKeyboard, disp, colorCount, ledCount, hovered]);

  /**
   * Perf: frames arrive at 12.5Hz as fresh objects even when the pushed
   * colours are identical, and the full repaint is expensive (per-key
   * gradients plus a radial glow each). Skip when nothing actually changed.
   *
   * The signature summarises rather than serialising every LED: hashing all
   * ~140 colours on every frame is itself measurable at that rate. Hover is
   * part of the key, because the highlight is a visible change.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sig = kbColors
      ? `${kbColors.rgb.join(",")}:${colorCount}:${kbColors.ledColors[0]?.join(",") ?? ""}:${hovered ?? ""}`
      : `none:${hovered ?? ""}`;
    if (canvas.dataset.sig === sig) return;
    canvas.dataset.sig = sig;
    paint();
  }, [kbColors, colorCount, hovered, paint]);

  /**
   * Keep the bitmap matched to the element.
   *
   * The backing store was only ever sized when colours arrived, so dragging
   * the window edge left the keyboard stretched and soft until the next colour
   * change happened to land. Repainting on resize costs nothing when the user
   * is not resizing.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    let last = `${canvas.clientWidth}x${canvas.clientHeight}`;
    const ro = new ResizeObserver(() => {
      const size = `${canvas.clientWidth}x${canvas.clientHeight}`;
      if (size === last) return;
      last = size;
      canvas.dataset.sig = "";
      paint();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [paint]);

  /** Cursor position to keycap, using the geometry of the last frame. */
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isKeyboard) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    // Canvas pixels are not CSS pixels once devicePixelRatio is in play.
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const hit = plateAt(platesRef.current, x, y);
    const label = hit && hit.label.trim() ? hit.label : null;
    if (label !== hovered) setHovered(label);
  };

  const labelKey = kb
    ? isKeyboard
      ? DISPOSITION_LABEL_KEYS[dispositionLabel(ledCount, colorCount)]
      : DISPOSITION_LABEL_KEYS.leds
    : DISPOSITION_LABEL_KEYS.none;
  // Only the zone/numpad captions interpolate a count.
  const labelVars =
    isKeyboard && disp.zoned
      ? { n: colorCount }
      : !isKeyboard && kb
        ? { n: ledCount }
        : undefined;

  return (
    <div className="relative overflow-hidden panel-inset p-3.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_0%,rgb(255_255_255/0.06),transparent_55%)]" />
      <div className="relative z-10 mx-auto w-full max-w-[760px]">
        <canvas
          ref={canvasRef}
          className="h-52 w-full"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHovered(null)}
        />
      </div>
      <div className="relative z-10 mx-auto mt-2 flex w-full max-w-[760px] items-center gap-3">
        <span className="kicker shrink-0">
          {t(labelKey, labelVars)}
        </span>
        {/* What the cursor is over. Only shown when there is something to say,
            so the caption does not jitter as the pointer crosses a gap. */}
        <span className="ml-auto min-w-0 flex-1 truncate text-right font-mono text-[10px] text-[var(--text-faint)]">
          {isKeyboard && hovered ? hovered : kb?.name ?? ""}
        </span>
        {rgb.devices.length > 1 && (
          <Dropdown
            className="min-w-0 shrink-0"
            value={kb?.id ?? ""}
            options={rgb.devices.map((d) => ({
              id: d.id,
              label: `${deviceName(d, deviceNames)} · ${d.leds}`,
            }))}
            onChange={(v) => setPreviewId(Number(v))}
          />
        )}
      </div>
      {!rgb.connected && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--bg)_75%,transparent)] text-xs font-medium tracking-wide text-[var(--text-dim)] backdrop-blur-[2px]">
          {t("common.connect-openrgb-to-see-live-colors")}
        </div>
      )}
    </div>
  );
}
