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
/** One LED in a non-keyboard preview. */
interface Dot {
  x: number;
  y: number;
  size: number;
  index: number;
}

/**
 * The dot-matrix a non-keyboard device is drawn as: strips, mousemats, RAM.
 *
 * Wrapped rows sized to the canvas, each row centred on its own so a short
 * final row is not left-ragged. Extracted from the paint function because the
 * case is now sized from this — the board has to exist before the case around
 * it can be, and that is the same reason `plateBounds` exists for keys.
 */
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

/** The rectangle a dot grid occupies, for sizing the case around it. */
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
      // The map's identity only changes when a device is renamed, so a shallow
      // compare keeps this from re-rendering on every config write.
      deviceNames: s.cfg?.rgb.deviceNames ?? {},
    })),
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  /**
   * The keycap under the cursor: its legend and, on a zoned board, which zone
   * owns it. The zone is the point of a zoned preview — the user is trying to
   * work out which region drives which colour — and showing only the legend
   * left the seams doing the explaining on their own.
   */
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

    // The board is laid out before anything is drawn, because the case is sized
    // from what the layout produced. Drawing the case first meant it could only
    // ever be the canvas, and a 60% board then sat in a band across the top of
    // a full-size slab with dead space beneath it.
    const plates = isKeyboard
      ? buildKeyboardPlates(W, H, { pad, gap, disposition: disp, colorCount })
      : [];
    const dots = isKeyboard
      ? []
      : buildDotGrid(W, H, Math.max(1, Math.min(ledCount || 16, 240)), dpr);

    // The case: the board plus a bezel, centred, and no bigger than the canvas.
    const bounds = caseRect(
      isKeyboard ? plateBounds(plates) : dotBounds(dots),
      { w: W, h: H },
    );
    const { x: caseX, y: caseY, w: caseW, h: caseH } = bounds;
    // Corner radius follows the case, so a short 60% case and a tall full-size
    // one are rounded the same amount rather than one looking bulbous. The
    // floor matters for the thin case a strip gets, which a purely
    // proportional radius would leave with razor edges.
    const caseR = Math.max(4 * dpr, Math.min(caseW, caseH) * 0.055);

    // The case, shared with the device list so a keyboard in a card and the
    // same keyboard in the stage are one object at two sizes.
    paintCase(ctx, caseX, caseY, caseW, caseH, caseR, dpr);

    /** Light bleed: a halo under the cap, so the plate glows like real caps. */
    const drawGlow = (
      x: number, y: number, w: number, h: number,
      color: [number, number, number],
    ) => {
      // The shared policy, so a keyboard cap and a strip LED throw the same
      // halo for the same colour. This formula was already luma-scaled; the
      // device strip's was not, and the two are what made the previews read as
      // different products.
      paintLedGlow(ctx, x + w / 2, y + h / 2, Math.max(w, h), color);
    };

    /**
     * The cap body colour.
     *
     * Caps keep a shading curve rather than the shared emitter overdrive: a
     * keycap is a physical shell with a lit edge, not a bare package, and the
     * gloss below only reads against a body that falls off vertically.
     */
    const shade = (cr: number, cg: number, cb: number) =>
      `rgb(${Math.round(0.78 * cr)},${Math.round(0.78 * cg)},${Math.round(0.78 * cb)})`;

    const colorAt = (i: number): [number, number, number] => leds?.[i] ?? base;


  // Caps and their glows, clipped to the case. The haloes are drawn wider than
    // the caps by design, so without this they bleed past the case's rounded
    // corners and onto the panel behind it, which puts a smear of key colour in
    // the bezel — most visible top-right, where a bright zone sits next to the
    // corner radius.
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

    // Hit-testing reads the plates from this frame's layout, which is now
    // computed above rather than inside the keyboard branch.
    platesRef.current = plates;
    ctx.restore();
  }, [kb, kbColors, isKeyboard, disp, colorCount, ledCount, hovered]);

  /**
   * Perf: frames arrive at 12.5Hz as fresh objects even when the pushed
   * colours are identical, and the full repaint is expensive (per-key
   * gradients plus a radial glow each). Skip when nothing actually changed.
   *
   * The signature is a rolling hash over every LED rather than a sample of a
   * few, because sampling was the defect: on a zoned board zone 2 can change
   * while zone 0 holds still, and the canvas sat there showing the old colour
   * until some unrelated LED moved. Hover rides along in `extra`, since the
   * highlight is itself a visible change.
   */
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
    if (label !== hovered) {
      setHover(label == null ? null : { label, zone: hit!.zone });
    }
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
    <div className="relative flex h-full flex-col justify-center overflow-hidden panel-inset p-3.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_0%,rgb(255_255_255/0.06),transparent_55%)]" />
      {/* Canvas and caption are one centred group rather than two children of
          a fixed-height box: the stage's two columns are the same height, and
          centring is what makes that read as a deliberate rectangle instead of
          a panel that ran out of content. */}
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
          {/* What the cursor is over, or the device name when there is no picker
              to name it. It used to always show the name, which put "AcerHID…"
              on screen next to a dropdown reading "AcerHID… · 96" — the same
              fact twice, in two different sizes, side by side.
              On a zoned board the zone rides alongside, because "G" alone does
              not say which of the engine's regions owns that key, and on that
              hardware the key's own colour cannot say it either. */}
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
