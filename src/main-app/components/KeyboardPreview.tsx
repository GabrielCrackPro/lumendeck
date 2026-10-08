import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { Dropdown } from "./ui";
import { deviceName } from "./DeviceRow";
import { t } from "../i18n";
import type { DeviceColor } from "@shared/types";
import {
  DARK_LED,
  frameSignature,
  paintLedGlow,
  previewDpr,
  roundRectPath,
} from "./ledPaint";
import { paintCase, paintKeycap, paintZoneSeam } from "./keycap";
import {
  buildKeyboardPlates,
  caseRect,
  disposition,
  dispositionLabel,
  plateAt,
  plateBounds,
  type DispositionLabel,
  type Plate,
  type Rect,
} from "./keyboardLayout";

const DISPOSITION_LABEL_KEYS: Record<DispositionLabel, string> = {
  fullSize: "lighting.full-size-ansi-live",
  tkl: "lighting.tkl-ansi-live",
  ansi: "lighting.ansi-layout-live",
  zonedBoard: "lighting.ansi-layout-zones",
  lightbar: "lighting.n-zones-live",
  leds: "lighting.n-leds-live",
  none: "lighting.no-device",
};

interface Dot {
  x: number;
  y: number;
  size: number;
  index: number;
}

function buildDotGrid(
  w: number,
  h: number,
  count: number,
  dpr: number,
): Dot[] {
  const cols = Math.min(count, Math.ceil(w / (14 * dpr)));
  const rows = Math.ceil(count / cols);
  const dotGap = 5 * dpr;
  const size = Math.min(
    (w - dotGap * (cols + 1)) / cols,
    (h - dotGap * (rows + 1)) / rows,
  );
  const oy = (h - (rows * size + dotGap * (rows - 1))) / 2;
  const dots: Dot[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const rowCols = Math.min(cols, count - r * cols);
    const ox = (w - (rowCols * size + (rowCols - 1) * dotGap)) / 2;
    dots.push({
      x: ox + c * (size + dotGap),
      y: oy + r * (size + dotGap),
      size,
      index: i,
    });
  }
  return dots;
}

function dotBounds(dots: readonly Dot[]): Rect | null {
  if (dots.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const d of dots) {
    x0 = Math.min(x0, d.x);
    y0 = Math.min(y0, d.y);
    x1 = Math.max(x1, d.x + d.size);
    y1 = Math.max(y1, d.y + d.size);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function KeyboardPreview({ className }: { className?: string } = {}) {
  const { rgb, deviceColors, deviceNames } = useStore(
    useShallow((s) => ({
      rgb: s.rgb,
      deviceColors: s.deviceColors,
      deviceNames: s.cfg?.rgb.deviceNames ?? {},
    })),
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [hover, setHover] = useState<{ label: string; zone: number } | null>(
    null,
  );
  const hovered = hover?.label ?? null;

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

  const platesRef = useRef<Plate[]>([]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !kb) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = previewDpr();
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW <= 0 || cssH <= 0) return;

    const W = (canvas.width = Math.round(cssW * dpr));
    const H = (canvas.height = Math.round(cssH * dpr));
    ctx.clearRect(0, 0, W, H);

    const base = kbColors?.rgb ?? DARK_LED;
    const leds = kbColors?.ledColors ?? null;
    const pad = 15 * dpr;
    const gap = 2.5 * dpr;

    const plates = isKeyboard
      ? buildKeyboardPlates(W, H, { pad, gap, disposition: disp, colorCount })
      : [];
    const dots = isKeyboard
      ? []
      : buildDotGrid(W, H, Math.max(1, Math.min(ledCount || 16, 240)), dpr);

    const bounds = caseRect(
      isKeyboard ? plateBounds(plates) : dotBounds(dots),
      { w: W, h: H },
    );
    const { x: caseX, y: caseY, w: caseW, h: caseH } = bounds;
    const caseR = Math.max(4 * dpr, Math.min(caseW, caseH) * 0.055);

    paintCase(ctx, caseX, caseY, caseW, caseH, caseR, dpr);

    const drawGlow = (
      x: number, y: number, w: number, h: number,
      color: [number, number, number],
    ) => {
      paintLedGlow(ctx, x + w / 2, y + h / 2, Math.max(w, h), color);
    };

    const shade = (cr: number, cg: number, cb: number) =>
      `rgb(${Math.round(0.78 * cr)},${Math.round(0.78 * cg)},${Math.round(0.78 * cb)})`;

    const colorAt = (i: number): [number, number, number] => leds?.[i] ?? base;


    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, caseX, caseY, caseW, caseH, caseR);
    ctx.clip();

    for (const p of plates) {
      paintKeycap(ctx, p.x, p.y, p.w, p.h, colorAt(p.ledIndex), {
        label: p.label,
        home: p.home,
        hover: p.label === hovered,
        dpr,
      });
      if (p.boundary) paintZoneSeam(ctx, p.x, p.y, p.h, dpr);
    }

    for (const d of dots) {
      const color = colorAt(d.index);
      drawGlow(d.x, d.y, d.size, d.size, color);
      ctx.beginPath();
      roundRectPath(ctx, d.x, d.y, d.size, d.size, d.size * 0.3);
      ctx.fillStyle = shade(color[0], color[1], color[2]);
      ctx.fill();
    }

    platesRef.current = plates;
    ctx.restore();
  }, [kb, kbColors, isKeyboard, disp, colorCount, ledCount, hovered]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sig = frameSignature(
      kbColors?.rgb ?? DARK_LED,
      kbColors?.ledColors ?? [],
      hovered ?? "",
    );
    if (canvas.dataset.sig === sig) return;
    canvas.dataset.sig = sig;
    paint();
  }, [kbColors, hovered, paint]);

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

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isKeyboard) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const hit = plateAt(platesRef.current, x, y);
    const label = hit && hit.label.trim() ? hit.label : null;
    if (label !== hovered) {
      setHover(label == null ? null : { label, zone: hit!.zone });
    }
  };

  const labelKey = kb
    ? isKeyboard
      ? DISPOSITION_LABEL_KEYS[dispositionLabel(ledCount, colorCount)]
      : DISPOSITION_LABEL_KEYS.leds
    : DISPOSITION_LABEL_KEYS.none;
  const labelVars =
    isKeyboard && disp.zoned
      ? { n: colorCount }
      : !isKeyboard && kb
        ? { n: ledCount }
        : undefined;

  return (
    <div className="relative flex h-full flex-col justify-center overflow-hidden panel-inset p-3.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_0%,rgb(255_255_255/0.06),transparent_55%)]" />
      {


 }
      <div className="relative z-10 mx-auto flex w-full max-w-[760px] flex-col justify-center">
        <canvas
          ref={canvasRef}
          className={`w-full ${className ?? "h-52"}`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        />
      <div className="mt-2 flex items-center gap-3">
          <span className="kicker shrink-0">
            {t(labelKey, labelVars)}
          </span>
          {





 }
          <span className="ml-auto flex min-w-0 items-baseline justify-end gap-2">
            {isKeyboard && hover && disp.zoned && (
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--text-faint)]/70">
                {t("lighting.zone-{n}", { n: hover.zone + 1 })}
              </span>
            )}
            <span className="min-w-0 truncate font-mono text-[10px] text-[var(--text-faint)]">
              {isKeyboard && hover
                ? hover.label
                : rgb.devices.length > 1
                  ? ""
                  : (kb?.name ?? "")}
            </span>
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
      </div>
      {!rgb.connected && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--bg)_75%,transparent)] text-xs font-medium tracking-wide text-[var(--text-dim)] backdrop-blur-[2px]">
          {t("common.connect-openrgb-to-see-live-colors")}
        </div>
      )}
    </div>
  );
}
