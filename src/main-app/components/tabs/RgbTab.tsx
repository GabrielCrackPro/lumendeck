import { useEffect, useRef } from "react";
import { useStore } from "../../store";
import { Card, Toggle, Slider, Btn, ColorInput } from "../ui";
import { IconRefresh, IconZap, IconWave } from "../icons";
import { RGB_MODES, ANIMATION_MODES } from "@shared/constants";
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

const TOTAL_U = KEY_ROWS.reduce(
  (max, row) => Math.max(max, row.reduce((s, k) => s + k[1], 0)),
  0,
);

/**
 * Live keyboard mock with a real ANSI layout: correct key labels, stagger,
 * and widths, painted from the colors actually pushed to OpenRGB (rgb-frame
 * events) so the preview shows real device output in any mode.
 */
export function KeyboardPreview() {
  const { rgb, deviceColors, rgb: { devices } } = useStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = 2;
    const W = (canvas.width = canvas.offsetWidth * dpr);
    const H = (canvas.height = canvas.offsetHeight * dpr);
    ctx.clearRect(0, 0, W, H);

    const live = Object.keys(deviceColors).length > 0;
    const animated = Object.values(deviceColors)
      .sort((a, b) => a.id - b.id)
      .find((d) => (d.ledColors?.length ?? 0) > 0);
    const leds: [number, number, number][] | null = animated?.ledColors ?? null;

    const pad = 8 * dpr;
    const gap = 3 * dpr;
    const keyU = (W - pad * 2) / TOTAL_U;
    const keyH = Math.min((H - pad * 2) / KEY_ROWS.length - gap, keyU * 1.0);
    const labelSize = Math.max(7 * dpr, keyU * 0.24);

    const idleColor = (rowIdx: number): [number, number, number] => {
      if (!live) return [26, 27, 33];
      const dev = devices[rowIdx % Math.max(1, devices.length)];
      return deviceColors[dev?.id ?? 0]?.rgb ?? [26, 27, 33];
    };

    KEY_ROWS.forEach((row, ri) => {
      let x = pad;
      const y = pad + ri * (keyH + gap);
      const rowColor = idleColor(ri);
      for (const [label, w, home] of row) {
        const kw = w * keyU - gap;
        const idx = KEY_ROWS.slice(0, ri).reduce((n, r) => n + r.length, 0) + row.indexOf([label, w, home] as Key);
        const color = leds?.[idx % leds.length] ?? rowColor;
        const [cr, cg, cb] = color;
        // Under-key shadow.
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 2 * dpr * 0.6, kw, keyH, 4 * dpr);
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fill();
        // Keycap body.
        ctx.beginPath();
        ctx.roundRect(x, y, kw, keyH, 4 * dpr);
        ctx.fillStyle = `rgb(${Math.round(0.78 * cr)},${Math.round(0.78 * cg)},${Math.round(0.78 * cb)})`;
        ctx.fill();
        // Top highlight.
        const grad = ctx.createLinearGradient(0, y, 0, y + keyH * 0.5);
        grad.addColorStop(0, "rgba(255,255,255,0.2)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 1, kw - 2, keyH * 0.45, 3 * dpr);
        ctx.fillStyle = grad;
        ctx.fill();
        // Edge.
        ctx.beginPath();
        ctx.roundRect(x, y, kw, keyH, 4 * dpr);
        ctx.strokeStyle = "rgba(0,0,0,0.2)";
        ctx.lineWidth = 1;
        ctx.stroke();
        // Home-row nub on F/J.
        if (home) {
          ctx.beginPath();
          ctx.ellipse(x + kw / 2, y + keyH - 3 * dpr, 3.5 * dpr, 1.4 * dpr, 0, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.fill();
        }
        // Key label.
        if (label && kw > labelSize * 1.6) {
          ctx.font = `600 ${labelSize}px "JetBrains Mono", ui-monospace, monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "rgba(255,255,255,0.55)";
          ctx.fillText(label, x + kw / 2, y + keyH / 2 + labelSize * 0.05);
        }
        x += w * keyU;
      }
    });

    if (animated) {
      ctx.font = `600 ${Math.round(keyU * 0.5)}px ui-sans-serif, system-ui`;
      ctx.textBaseline = "top";
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      const label = "ANIMATION";
      const tw = ctx.measureText(label).width;
      ctx.beginPath();
      ctx.roundRect(W - tw - 16 * dpr, pad, tw + 12 * dpr, keyU * 0.5 + 8 * dpr, 6 * dpr);
      ctx.fill();
      ctx.fillStyle = `rgb(${deviceColors[animated.id]!.rgb.join(",")})`;
      ctx.fillText(label, W - 10 * dpr, pad + 4 * dpr);
    }
  }, [deviceColors, devices]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel-strong)] p-3.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]">
      {/* desk mat: a soft glow pool the keyboard sits in */}
      <div className="pointer-events-none absolute -bottom-3 left-1/2 h-14 w-[84%] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(50%_50%_at_50%_50%,rgb(var(--glow)/0.28),transparent_70%)] blur-md" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_0%,rgb(255_255_255/0.06),transparent_55%)]" />
      <canvas ref={canvasRef} className="relative z-10 h-40 w-full" />
      <div className="relative z-10 mt-2 flex items-center justify-between">
        <span className="kicker">ansi layout · live feed</span>
        <div className="flex items-center gap-1.5">
          <span className="h-1 w-1 rounded-full bg-[rgb(var(--glow))] shadow-[0_0_6px_rgb(var(--glow))]" />
          <span className="h-1 w-1 rounded-full bg-[var(--line-strong)]" />
          <span className="h-1 w-1 rounded-full bg-[var(--line-strong)]" />
        </div>
      </div>
      {!rgb.connected && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--bg)_75%,transparent)] text-xs font-medium tracking-wide text-[var(--text-dim)] backdrop-blur-[2px]">
          Connect OpenRGB to see live colors
        </div>
      )}
    </div>
  );
}

/** Mini art-strip painted per lighting mode (shares the room's glow). */
function MODE_ART(mode: RgbMode, staticColor: [number, number, number]): string {
  const g = "rgb(var(--glow))";
  switch (mode) {
    case "ambient":
      return `radial-gradient(120% 100% at 50% 120%, ${g} / 0.85, transparent 62%), radial-gradient(70% 70% at 18% 0%, rgb(129 140 248 / 0.5), transparent 62%), #0a101d`;
    case "zone":
      return `conic-gradient(from 90deg at 50% 50%, transparent 0 25%, ${g} / 0.5 25% 50%, transparent 50% 75%, ${g} / 0.25 75%), radial-gradient(120% 120% at 50% 0%, rgb(255 255 255 / 0.06), transparent 60%)`;
    case "pulse":
      return `radial-gradient(55% 55% at 50% 48%, ${g} 0 16%, ${g} / 0.4 42%, transparent 72%)`;
    case "static": {
      const [r, gr, b] = staticColor;
      return `linear-gradient(135deg, rgb(${r} ${gr} ${b}), rgb(${r} ${gr} ${b} / 0.4))`;
    }
    case "cycle":
      return "linear-gradient(90deg, hsl(0 92% 58%), hsl(45 92% 58%), hsl(95 82% 52%), hsl(160 82% 50%), hsl(215 90% 58%), hsl(270 90% 60%), hsl(330 92% 58%))";
    case "wave":
      return `repeating-linear-gradient(115deg, ${g} / 0.65 0 7px, transparent 7px 14px), linear-gradient(180deg, ${g} / 0.9, rgb(167 139 250 / 0.65))`;
    case "breathe":
      return `radial-gradient(50% 50% at 50% 50%, ${g} 0 10%, ${g} / 0.5 28%, transparent 55%), radial-gradient(90% 90% at 50% 8%, ${g} / 0.22, transparent 70%)`;
  }
}

export default function RgbTab() {
  const { cfg, rgb, save } = useStore();
  if (!cfg) return null;
  const rgbCfg = cfg.rgb;
  const isAnimated = (ANIMATION_MODES as ReadonlySet<RgbMode>).has(rgbCfg.mode);

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Card
          title="OpenRGB connection"
          right={
            rgb.connected ? (
              <span className="font-mono text-[10px] tracking-wide text-[var(--text-faint)]">
                v{rgb.protocolVersion ?? "?"}
              </span>
            ) : (
              <span className="font-mono text-[10px] tracking-wide text-[var(--text-faint)]">
                offline
              </span>
            )
          }
        >
          <KeyboardPreview />
          {rgb.connected ? (
            <ul className="mt-5 space-y-2.5">
              {rgb.devices.map((d) => {
                const c = useStore.getState().deviceColors[d.id]?.rgb;
                return (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel-strong)] px-3.5 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)]">
                        <span
                          className={`absolute inset-0 ${c ? "" : "animate-[lpulse_2.6s_ease-in-out_infinite]"}`}
                          style={
                            c
                              ? {
                                  background: `radial-gradient(60% 60% at 50% 35%, rgb(${c[0]} ${c[1]} ${c[2]}), rgb(${c[0]} ${c[1]} ${c[2]} / 0.25) 70%, rgb(0 0 0 / 0.2))`,
                                  boxShadow: `inset 0 0 10px -2px rgb(${c[0]} ${c[1]} ${c[2]} / 0.7)`,
                                }
                              : { background: "radial-gradient(60% 60% at 50% 35%, #2a2a30, #17171c 75%)" }
                          }
                        />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--text)]">
                          {d.name || `Device ${d.id}`}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="truncate text-[11px] text-[var(--text-faint)]">
                            {d.typeName}
                          </span>
                          <span className="h-0.5 w-0.5 rounded-full bg-[var(--line-strong)]" />
                          <span className="font-mono text-[11px] text-[var(--text-dim)]">
                            {d.leds} LEDs
                          </span>
                        </div>
                      </div>
                    </div>
                    <Toggle
                      label=""
                      checked={!rgbCfg.excludedDevices.includes(d.id)}
                      onChange={(on) =>
                        save((c) => {
                          c.rgb.excludedDevices = on
                            ? c.rgb.excludedDevices.filter((x) => x !== d.id)
                            : [...c.rgb.excludedDevices, d.id];
                        })
                      }
                    />
                  </li>
                );
              })}
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
          <div className="mt-5 border-t border-[var(--line)] pt-4">
            <Toggle
              label="RGB sync enabled"
              checked={rgbCfg.enabled}
              onChange={(v) => save((c) => (c.rgb.enabled = v))}
            />
          </div>
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
          </div>
        </Card>
      </div>

      <div className="space-y-5">
        <Card
          title="Lighting mode"
          right={
            isAnimated ? (
              <span className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-[rgb(var(--glow))]">
                <IconWave className="h-3.5 w-3.5" />
                live animation
              </span>
            ) : undefined
          }
        >
          {(["reactive", "animation"] as const).map((group) => (
            <div key={group}>
              <div className="kicker mb-2.5 mt-6 first:mt-0">
                {group === "reactive" ? "Reactive to wallpaper" : "Animated"}
              </div>
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
                {RGB_MODES.filter((m) => m.group === group).map((m) => {
                  const active = rgbCfg.mode === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => save((c) => (c.rgb.mode = m.id as RgbMode))}
                      className={`group relative overflow-hidden rounded-2xl border text-left transition-all duration-200 ${
                        active
                          ? "border-[rgb(var(--glow)/0.55)] shadow-[0_10px_30px_-12px_rgb(var(--glow)/0.45)] ring-2 ring-[rgb(var(--glow)/0.18)]"
                          : "border-[var(--line)] bg-[var(--panel-strong)] hover:border-[var(--line-strong)] hover:brightness-[1.03]"
                      }`}
                    >
                      <div className="relative h-11 w-full overflow-hidden border-b border-[var(--line)]">
                        <span
                          className="absolute inset-0 transition-transform duration-500 group-hover:scale-110"
                          style={{ background: MODE_ART(m.id, rgbCfg.staticColor) }}
                        />
                        <span className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_0%,rgb(255_255_255/0.12),transparent_60%)]" />
                      </div>
                      <div className="flex items-center justify-between gap-2 px-3 py-2">
                        <span className="min-w-0">
                          <span
                            className={`block truncate text-sm font-semibold ${
                              active ? "text-[rgb(var(--glow))]" : "text-[var(--text)]"
                            }`}
                          >
                            {m.label}
                          </span>
                          <span className="block truncate text-[10px] text-[var(--text-faint)]">
                            {m.hint}
                          </span>
                        </span>
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            active
                              ? "bg-[rgb(var(--glow))] shadow-[0_0_8px_rgb(var(--glow))]"
                              : "bg-[var(--line-strong)]"
                          }`}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {(rgbCfg.mode === "static" || rgbCfg.mode === "breathe") && (
            <ColorInput
              label={rgbCfg.mode === "breathe" ? "Breath color" : "Static color"}
              value={rgbCfg.staticColor}
              onChange={(v) => save((c) => (c.rgb.staticColor = v))}
            />
          )}
          {rgbCfg.mode === "zone" && (
            <p className="rounded-xl border border-[rgb(var(--glow)/0.25)] bg-[rgb(var(--glow)/0.07)] px-3 py-2 text-xs leading-relaxed text-[var(--text-dim)]">
              Draw zones on the Wallpaper tab — each zone can be mapped to devices
              there by clicking a zone, then toggling devices.
            </p>
          )}
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
          {isAnimated ? (
            <>
              <Slider
                label="Animation speed"
                min={0.1}
                max={5}
                step={0.1}
                value={rgbCfg.animationSpeed}
                format={(v) => `${v.toFixed(1)}×`}
                onChange={(v) => save((c) => (c.rgb.animationSpeed = v))}
              />
              <p className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-xs leading-relaxed text-[var(--text-dim)]">
                Animation modes run at up to 30 fps regardless of the wallpaper and
                ignore the update interval below.
              </p>
            </>
          ) : (
            <>
              <Slider
                label="Transition smoothing"
                min={0}
                max={0.95}
                step={0.05}
                value={rgbCfg.mixer.smoothing}
                format={(v) => (v === 0 ? "snap" : `${Math.round(v * 100)}%`)}
                onChange={(v) => save((c) => (c.rgb.mixer.smoothing = v))}
              />
              <Slider
                label="Min update interval"
                min={30}
                max={1000}
                step={10}
                value={rgbCfg.minUpdateMs}
                format={(v) => `${v} ms`}
                onChange={(v) => save((c) => (c.rgb.minUpdateMs = v))}
              />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}