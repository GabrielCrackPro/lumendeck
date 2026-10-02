import { useEffect, useRef, useState } from "react";
import { IconDevice, IconEye, IconEyeOff, IconPencil } from "./icons";
import { rgbToHex } from "../utilities";
import type { DeviceColor, RgbDeviceInfo } from "@shared/types";
import { t } from "../i18n";
import { AliasHint, CopyHexButton } from "./ui";
import { useStore } from "../store";
import {
  DARK_LED,
  emitterColor,
  ledRadius,
  paintLedGlow,
  previewDpr,
  roundRectPath,
} from "./ledPaint";

/**
 * OpenRGB type names are CamelCase with a trailing index: "LEDStrip1",
 * "CoolerFan", "Keyboard". Split on both the acronym and the word boundary,
 * drop the index, and lowercase — "led strip", "cooler fan", "keyboard".
 */
function typeLabel(typeName: string): string {
  return typeName
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[0-9]+$/, "")
    .trim()
    .toLowerCase();
}

/** What to call a device, in order of preference: the user's alias, the
 * driver's own name, then the device type. Shared by every place a device is
 * named so the accent picker and the zone lists cannot disagree with the row. */
export function deviceName(
  d: RgbDeviceInfo,
  deviceNames: Record<string, string> = {},
): string {
  const alias = deviceNames[String(d.id)]?.trim();
  if (alias) return alias;
  const fallback = typeLabel(d.typeName);
  if (d.name?.trim()) return d.name.trim();
  if (!fallback) return t("lighting.device-{id}", { id: d.id });
  return fallback[0]!.toUpperCase() + fallback.slice(1);
}

/**
 * A device's LEDs drawn as discrete glowing dots, sampled from the engine's
 * live per-LED colors — reads as hardware rather than a gradient slab.
 *
 * Muted devices render dark. `fallback` is the device's representative color
 * for engines that push one color instead of a per-LED array (ambient, static);
 * without it those modes preview as a dead grey strip even though the hardware
 * is demonstrably lit.
 *//** Tightest spacing between dots, in CSS px, for a densely packed strip. */
const MIN_GAP = 2;

export function LedStrip({
  leds,
  ledColors,
  muted,
  fallback,
  className = "",
}: {
  leds: number;
  ledColors: [number, number, number][] | null;
  muted: boolean;
  fallback?: [number, number, number] | null;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // Cap the dot count: 64 dots read as an LED strip while staying cheap.
  // Devices with more LEDs just get a denser row.
  const DOTS = Math.min(64, Math.max(12, leds));
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Perf: the preview only needs ~30fps (the store coalesces frames to
    // 12.5Hz anyway), and a redraw is pointless when the color data hasn't
    // changed. Skipping unchanged frames keeps N device strips from repainting
    // 60x/second while the engine pushes a static color.
    let raf = 0;
    let lastDraw = 0;
    let lastSig = "";
    let lastW = 0;
    const FRAME_MS = 1000 / 30;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - lastDraw < FRAME_MS) return;
      const sig = `${ledColors?.length ?? 0}:${ledColors?.[0]?.join(",") ?? ""}:${
        ledColors?.length ? ledColors[Math.floor(ledColors.length / 2)]!.join(",") : ""
      }:${
        ledColors?.length ? ledColors[ledColors.length - 1]!.join(",") : ""
      }:${fallback?.join(",") ?? ""}:${muted}`;
      if (sig === lastSig && canvas.offsetWidth === lastW) return;
      lastDraw = now;
      lastSig = sig;
      const dpr = previewDpr();
      lastW = canvas.offsetWidth;
      const W = (canvas.width = lastW * dpr);
      const H = (canvas.height = canvas.offsetHeight * dpr);
      ctx.clearRect(0, 0, W, H);
      // The track's chrome (surface, border, radius) is CSS, using the same
      // tokens as the card around it. The canvas draws only light — a
      // diffuser wash, the falloff around each LED, and the packages
      // themselves. The previous version painted its own extruded housing in
      // three hardcoded greys, which is why the strip read as a foreign
      // object dropped into the panel rather than part of it.
      const cy = H / 2;
      const minGap = MIN_GAP * dpr;
      // Pitch is bounded by the track height, so a device with few LEDs ends
      // up with wide gaps; leftover width becomes spacing (capped, past which
      // packages stop reading as a strip) so the lane always fills evenly.
      const pitch = Math.max(
        0,
        Math.min((W - (DOTS - 1) * minGap) / DOTS, H * 0.9),
      );
      const packed = DOTS * pitch + (DOTS - 1) * minGap;
      const gap =
        DOTS > 1 && packed < W
          ? minGap + Math.min(pitch * 6, (W - packed) / (DOTS - 1))
          : minGap;
      const rowW = DOTS * pitch + (DOTS - 1) * gap;
      const x0 = (W - rowW) / 2;
      const glow = Math.max(0, Math.min(pitch * 1.6, H * 0.5));
      const pkgW = Math.max(1, Math.min(pitch * 0.5, H * 0.4));
      const pkgH = Math.max(1, Math.min(H * 0.42, pitch * 0.5));

      // Sample the engine's per-LED colors across the row. A single-entry
      // array means a flat reactive color; a multi-entry array is a
      // gradient/animation to sample.
      const lit = !muted && ledColors && ledColors.length > 0;
      const sampleAt = (t: number): [number, number, number] => {
        if (lit) {
          if (ledColors.length === 1) return ledColors[0]!;
          const i = Math.min(ledColors.length - 1, Math.floor(t * ledColors.length));
          return ledColors[i]!;
        }
        return fallback ?? DARK_LED;
      };
      const on = !muted && (lit || !!fallback);

      ctx.save();
      roundRectPath(ctx, 0, 0, W, H, H * 0.3);
      ctx.clip();

      // The diffuser itself: the row's own colours, so the gaps between
      // packages are lit too rather than being dead track.
      if (on) {
        const g = ctx.createLinearGradient(x0, 0, x0 + rowW, 0);
        const stops = Math.min(24, Math.max(2, DOTS));
        for (let s = 0; s <= stops; s++) {
          const [r, gg, b] = sampleAt(s / stops);
          g.addColorStop(s / stops, `rgb(${r} ${gg} ${b} / 0.26)`);
        }
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      for (let i = 0; i < DOTS; i++) {
        const color = muted ? DARK_LED : sampleAt(DOTS === 1 ? 0 : i / (DOTS - 1));
        const cx = x0 + i * (pitch + gap) + pitch / 2;
        if (glow > 0 && pkgW > 0 && pkgH > 0) {
          // Halo and package both come from the shared policy, so this strip
          // and the mode tiles and the keyboard draw the same LED. The glow
          // used to be a constant 0.5 alpha regardless of colour, which made a
          // black LED throw as much light as a white one.
          const [r, g, b] = emitterColor(color, muted ? 0 : undefined);
          paintLedGlow(ctx, cx, cy, Math.max(pkgW, pkgH), [r, g, b]);
          roundRectPath(
            ctx,
            cx - pkgW / 2,
            cy - pkgH / 2,
            pkgW,
            pkgH,
            ledRadius(pkgH),
          );
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fill();
        }
      }

      // A recessed top edge, so the light reads as coming out of the track
      // rather than sitting on top of the panel.
      const recess = ctx.createLinearGradient(0, 0, 0, H * 0.5);
      recess.addColorStop(0, "rgba(0,0,0,0.28)");
      recess.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = recess;
      ctx.fillRect(0, 0, W, H * 0.5);
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [ledColors, fallback, muted, DOTS]);
  return (
    <span
      className={`block overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)] ${className}`}
    >
      <canvas ref={ref} className="block h-5 w-full" />
    </span>
  );
}

/**
 * One RGB device: identity, live color, live LEDs, and its mute control.
 *
 * Muted devices stay in the list. The previous Lighting-tab version filtered
 * them out entirely, so excluding a device made it unreachable — the empty
 * state could only say "toggle them back on from Settings".
 */
export function DeviceRow({
  device,
  live,
  muted,
  onToggleMute,
  onRename,
  deviceNames = {},
}: {
  device: RgbDeviceInfo;
  live?: DeviceColor;
  muted: boolean;
  onToggleMute: () => void;
  /** Omit to render the row read-only, with no rename affordance. */
  onRename?: (name: string) => void;
  deviceNames?: Record<string, string>;
}) {
  const name = deviceName(device, deviceNames);
  // Whether the name on screen is the user's, rather than the driver's. Drives
  // the "renamed" hint, which is the only thing distinguishing the two.
  const aliased = !!deviceNames[String(device.id)]?.trim();
  const type = typeLabel(device.typeName);
  // When the name is just the type back (an unnamed device), repeating it in
  // the meta line reads as a stutter: "Mouse / Mouse · 12 LEDs".
  const showType = !!type && type !== name.toLowerCase();
  const rgb = live?.rgb ?? null;
  const hex = rgb ? rgbToHex(rgb) : null;
  // Primitive selector, so a row only re-renders when this flag itself flips,
  // not on every colour frame the engine pushes.
  const showHex = useStore((s) => s.cfg?.general.showColorHex ?? true);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  // OpenRGB re-reports its device list at any time, so a row can be recycled
  // onto a different device mid-edit. Remembering which device the draft was
  // started for is what stops an alias being written onto the wrong hardware.
  const renameFor = useRef<number | null>(null);

  useEffect(() => {
    if (renameFor.current !== null && renameFor.current !== device.id) {
      renameFor.current = null;
      setRenaming(false);
      setDraft("");
    }
  }, [device.id]);

  function startRename() {
    renameFor.current = device.id;
    setDraft(deviceNames[String(device.id)] ?? "");
    setRenaming(true);
  }
  function commitRename() {
    setRenaming(false);
    renameFor.current = null;
    const next = draft.trim();
    // An empty box means "forget my name", not "call it nothing": an absent
    // entry falls back to whatever the driver said.
    if (next === (deviceNames[String(device.id)] ?? "").trim()) return;
    onRename?.(next);
  }
  function cancelRename() {
    setRenaming(false);
    renameFor.current = null;
    setDraft("");
  }

  return (
    <li
      className={`rounded-xl border px-3.5 py-3 transition-colors duration-200 ${
        muted
          ? "border-[var(--line)] bg-[var(--panel-sunken)] opacity-60"
          : "border-[var(--line)] bg-[var(--panel-sunken)] hover:border-[var(--line-strong)]"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border"
          style={
            rgb && !muted
              ? {
                  color: `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`,
                  borderColor: `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / 0.45)`,
                  background: `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / 0.12)`,
                  boxShadow: `0 0 12px -3px rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / 0.7)`,
                }
              : {
                  color: "var(--text-faint)",
                  borderColor: "var(--line)",
                  background: "var(--panel)",
                }
          }
        >
          <IconDevice type={device.typeName} className="h-[18px] w-[18px]" />
        </span>

        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              value={draft}
              autoFocus
              maxLength={64}
              placeholder={name}
              aria-label={t("lighting.rename-device", { name })}
              // Preselect so typing replaces the old name instead of appending
              // to it, which is what renaming usually means.
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              className="w-full rounded-md border border-[rgb(var(--glow)/0.5)] bg-[var(--panel-strong)] px-1.5 py-0.5 text-sm font-semibold text-[var(--text)] outline-none"
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <div
                className={`truncate text-sm font-semibold ${
                  muted ? "text-[var(--text-faint)] line-through" : "text-[var(--text)]"
                }`}
              >
                {name}
              </div>
              {onRename && (
                <button
                  onClick={startRename}
                  title={t("lighting.rename-device", { name })}
                  aria-label={t("lighting.rename-device", { name })}
                  className="shrink-0 rounded p-0.5 text-[var(--text-faint)] transition-colors hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
                >
                  <IconPencil className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-[var(--text-faint)]">
            {showType && (
              <>
                <span className="truncate capitalize">{type}</span>
                <span className="h-0.5 w-0.5 rounded-full bg-[var(--line-strong)]" />
              </>
            )}
            <span className="font-mono tabular-nums">
              {t("lighting.{n}-leds", { n: device.leds })}
            </span>
            {device.zones.length > 0 && (
              <>
                <span className="h-0.5 w-0.5 rounded-full bg-[var(--line-strong)]" />
                <span className="truncate">
                  {t("lighting.{n}-zones", { n: device.zones.length })}
                </span>
              </>
            )}
            {aliased && (
              <>
                <span className="h-0.5 w-0.5 rounded-full bg-[var(--line-strong)]" />
                {/* Reverting is the point: the hint is also the undo. */}
                <AliasHint onReset={() => onRename?.("")} />
              </>
            )}
          </div>
        </div>

        {hex && !muted && (
          <span className="group hidden shrink-0 items-center gap-1.5 sm:flex">
            {/* The swatch stays when the hex is hidden: it is the colour, not a
                label describing it. Hiding the row entirely would leave a
                muted-looking gap where the live colour used to be. */}
            {showHex && (
              <span className="font-mono text-[10px] uppercase text-[var(--text-faint)]">
                {hex}
              </span>
            )}
            <span
              className="h-4 w-4 rounded-md border border-white/15"
              style={{ background: hex, boxShadow: "0 0 10px -3px rgb(255 255 255 / 0.3)" }}
            />
            <CopyHexButton value={rgb!} className="h-5 w-5" />
          </span>
        )}

        <button
          onClick={onToggleMute}
          aria-pressed={muted}
          title={muted ? t("lighting.include-{name}", { name }) : t("lighting.mute-{name}", { name })}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${
            muted
              ? "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
              : "border-[var(--line)] bg-[var(--panel)] text-[var(--text-dim)] hover:border-[var(--line-strong)] hover:text-[var(--text)]"
          }`}
        >
          {muted ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
          {muted ? t("common.muted") : t("common.live")}
        </button>
      </div>

      <LedStrip
        leds={device.leds}
        ledColors={live?.ledColors ?? null}
        muted={muted}
        fallback={rgb}
        className="mt-2.5"
      />
    </li>
  );
}
