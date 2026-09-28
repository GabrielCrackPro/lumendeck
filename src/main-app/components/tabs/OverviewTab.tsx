import { useShallow } from "zustand/react/shallow";
import { useEffect, useState, useRef, type CSSProperties, type ReactNode } from "react";
import { useStore } from "../../store";
import { Card, Chip, DisplaysCard, IconBox, RefreshBtn, Btn, Stat, ItemTitle, SwitchBtn } from "../ui";
import { IconBulb, IconImage, IconSticker, IconGlobe, IconLayers, IconPlay, IconPause, IconNext, IconPrevious, IconWave } from "../icons";
import { SHADERS, SHADER_ART } from "@shared/constants";
import type { Config, MediaInfo, RgbDeviceInfo, DeviceColor } from "@shared/types";
import { convertFileSrc } from "@tauri-apps/api/core";
import { basename } from "../../utilities";
import { api } from "../../ipc";

/** Compact wallpaper thumb: video plays muted, image static, shader art. */
function WallpaperThumb({
  kind,
  source,
  paused,
  bare = false,
}: {
  kind: string;
  source: string;
  paused: boolean;
  /** Borderless, full-bleed — for layering inside the MediaStage frame. */
  bare?: boolean;
}) {
  const mediaUrl = convertFileSrc(source, "media");
  return (
    <div className={`relative h-full w-full overflow-hidden bg-black ${bare ? "" : "min-h-32 rounded-lg border border-[var(--line)]"}`}>
      {kind === "video" && source ? (
        <video
          key={mediaUrl}
          src={mediaUrl}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
      ) : kind === "image" && source ? (
        <img src={mediaUrl} alt="" className="h-full w-full object-cover" />
      ) : kind === "shader" ? (
        <div className="h-full w-full" style={{ background: SHADER_ART[source] ?? SHADER_ART.aurora }} />
      ) : kind === "web" ? (
        <div className="flex h-full w-full items-center justify-center text-[var(--text-faint)]">
          <IconGlobe className="h-6 w-6" />
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[var(--text-faint)]">
          <IconLayers className="h-6 w-6" />
        </div>
      )}
      {paused && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
          <span className="flex items-center gap-1.5 rounded-md bg-black/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-300">
            paused
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Wraps the Now playing stage with a subtle audio-reactive glow. Reads the
 * frame-rate audio level from the store inside a rAF loop and drives two CSS
 * variables (`--al` volume, `--beat` decaying beat flash) directly on the DOM
 * node, so nothing up the tree ever re-renders at frame rate.
 */
function AudioPulse({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let raf = 0;
    let beat = 0;
    const tick = () => {
      const { volume, beat: hit } = useStore.getState().audioLevel;
      beat = Math.max(beat * 0.88, hit ? 1 : 0);
      const el = ref.current;
      if (el) {
        el.style.setProperty("--al", volume.toFixed(3));
        el.style.setProperty("--beat", beat.toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={ref} className="relative" style={{ "--al": 0, "--beat": 0 } as CSSProperties}>
      {children}
    </div>
  );
}

/**
 * Top stage of the Now playing card: the live wallpaper, full-bleed, with its
 * name chip pinned top-left. Media lives in its own row below — no art
 * crossfade here.
 */
function WallpaperStage({
  cfg,
  paused,
  wallpaperName,
}: {
  cfg: Config;
  paused: boolean;
  wallpaperName: string;
}) {
  return (
    <div
      className="relative h-44 w-full overflow-hidden rounded-xl border border-[var(--line)] bg-black"
      style={{
        // Audio-reactive halo: volume widens and brightens a glow ring around
        // the stage; a detected beat adds a short bright flash on top.
        boxShadow:
          "0 0 calc(6px + var(--al, 0) * 34px) rgb(var(--glow) / calc(0.05 + var(--al, 0) * 0.26 + var(--beat, 0) * 0.2))",
      }}
    >
      <WallpaperThumb kind={cfg.wallpaper.kind} source={cfg.wallpaper.source} paused={paused} bare />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0.3),transparent_35%)]" />

      <div className="absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg bg-black/45 px-2.5 py-1.5 backdrop-blur-sm">
        <IconImage className="h-3.5 w-3.5 shrink-0 text-white/75" />
        <span className="truncate font-mono text-[10px] text-white/90" title={wallpaperName}>
          {wallpaperName}
        </span>
      </div>
    </div>
  );
}

/**
 * Track identity for the media row. Keyed by title+artist, so a track change
 * remounts the block and replays the swap animation: the row flashes with the
 * accent while the new title slides in.
 */
function TrackIdentity({
  media,
  beatScale,
}: {
  media: MediaInfo;
  beatScale: string;
}) {
  return (
    <div key={`${media.title}—${media.artist}`} className="track-swap flex min-w-0 flex-1 items-center gap-3 rounded-lg">
      {media.art && (
        <img
          src={media.art}
          alt=""
          className="track-slide h-12 w-12 shrink-0 rounded-lg border border-[var(--line-strong)] object-cover"
          style={{ transform: beatScale }}
        />
      )}
      <div className="track-slide min-w-0">
        <div
          className="truncate text-[14px] font-semibold leading-tight text-[var(--text)]"
          title={`${media.title} — ${media.artist}`}
        >
          {media.title}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] text-[var(--text-faint)]">
          {media.appIcon && (
            <img src={media.appIcon} alt="" className="h-3.5 w-3.5 shrink-0 rounded-[3px]" />
          )}
          <span className="truncate">
            {media.artist || "Unknown artist"}
            {media.appId && ` · ${media.appId}`}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Play/prev/next that drive the OS media session (SMTC) — Spotify, browsers,
 * whatever is playing. Hidden entirely when no session exists. When `trackKey`
 * changes (auto-advance, or any transport action that lands a new track), the
 * buttons replay a staggered press-ripple so the handoff reads as intentional.
 */
function TransportButtons({
  playing,
  trackKey,
}: {
  playing: boolean;
  trackKey: string;
}) {
  const [busy, setBusy] = useState(false);
  const [pulseId, setPulseId] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setPulseId((n) => n + 1);
  }, [trackKey]);
  const send = async (action: "toggle" | "next" | "previous") => {
    if (busy) return;
    setBusy(true);
    try {
      await api.mediaTransport(action);
    } finally {
      setBusy(false);
    }
  };
  const btn =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line-strong)] bg-[var(--panel-strong)] text-[var(--text-dim)] hover-glow disabled:opacity-40";
  // Remounting the row (key=pulseId) replays the ripple on every track
  // change; the ring starts at the button, so no fill-mode is wanted.
  const ripple = (delayMs: number) =>
    pulseId > 0 ? { className: `${btn} transport-pulse`, style: { animationDelay: `${delayMs}ms` } } : { className: btn };
  return (
    <div key={pulseId} className="flex items-center gap-1.5">
      <button aria-label="Previous track" disabled={busy} onClick={() => send("previous")} {...ripple(90)}>
        <IconPrevious className="h-4 w-4" />
      </button>
      <button
        aria-label={playing ? "Pause" : "Play"}
        className={`${btn} !border-[rgb(var(--glow)/0.4)] !text-[rgb(var(--glow))] ${pulseId > 0 ? "transport-pulse" : ""}`}
        disabled={busy}
        onClick={() => send("toggle")}
      >
        {playing ? <IconPause className="h-4 w-4" /> : <IconPlay className="h-4 w-4" />}
      </button>
      <button aria-label="Next track" disabled={busy} onClick={() => send("next")} {...ripple(180)}>
        <IconNext className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * One row in the engine's device list: a live color lane that draws the
 * device's actual per-LED colors (falling back to its average), the name,
 * and a bar showing its share of the total LED budget.
 */
function DeviceRow({
  name,
  typeName,
  leds,
  totalLeds,
  color,
  excluded,
}: {
  name: string;
  typeName: string;
  leds: number;
  totalLeds: number;
  color?: DeviceColor;
  excluded: boolean;
}) {
  const rgb = color?.rgb ?? null;
  const ledColors = color?.ledColors ?? null;
  return (
    <div className="flex items-center gap-3 border-t border-[var(--line)] py-2 first:border-t-0">
      {/* live color lane */}
      <span
        className={`h-6 w-16 shrink-0 overflow-hidden rounded-md border transition-opacity duration-500 ${
          excluded ? "border-[var(--line)] opacity-40" : "border-[var(--line-strong)]"
        }`}
      >
        {rgb && !excluded ? (
          <LedLane ledColors={ledColors} fallback={rgb} />
        ) : (
          <span className="block h-full w-full bg-[var(--panel)]" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[13px] font-medium ${excluded ? "text-[var(--text-faint)] line-through" : "text-[var(--text)]"}`}>
          {name}
        </div>
        <div className="font-mono text-[10px] text-[var(--text-faint)]">{typeName}</div>
      </div>
      <span className="hidden w-24 shrink-0 sm:block">
        <span className="block h-1 overflow-hidden rounded-full bg-[var(--panel)]">
          <span
            className="block h-full rounded-full transition-[width] duration-500"
            style={{
              width: totalLeds ? `${Math.max(3, Math.round((leds / totalLeds) * 100))}%` : "0%",
              background: rgb && !excluded ? `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})` : "var(--text-faint)",
            }}
          />
        </span>
      </span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--text-dim)]">
        {leds.toLocaleString()} LED{leds === 1 ? "" : "s"}
      </span>
    </div>
  );
}

/** Tiny horizontal gradient strip showing one device's per-LED colors. */
function LedLane({
  ledColors,
  fallback,
}: {
  ledColors: [number, number, number][] | null;
  fallback: [number, number, number] | null;
}) {
  if (!ledColors || ledColors.length === 0) {
    return (
      <span
        className="block h-full w-full"
        style={{
          background: fallback ? `rgb(${fallback[0]} ${fallback[1]} ${fallback[2]})` : "var(--panel)",
        }}
      />
    );
  }
  const stops = ledColors
    .map(([r, g, b]) => `rgb(${r} ${g} ${b})`)
    .join(", ");
  return (
    <span
      className="block h-full w-full"
      style={{ background: `linear-gradient(90deg, ${stops})` }}
    />
  );
}

/**
 * Full-width live LED band: each device's LEDs are drawn to scale, side by
 * side, using the exact per-LED colors the engine is streaming. Animated
 * modes render as moving gradients. Off/missing devices render dark.
 */
function LedBand({
  devices,
  colors,
  excluded,
}: {
  devices: RgbDeviceInfo[];
  colors: Record<number, DeviceColor>;
  excluded: Set<number>;
}) {
  const total = devices.reduce((n, d) => n + d.leds, 0);
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = (canvas.width = canvas.offsetWidth * dpr);
      const H = (canvas.height = canvas.offsetHeight * dpr);
      ctx.clearRect(0, 0, W, H);
      let x = 0;
      for (const d of devices) {
        const w = total > 0 ? (d.leds / total) * W : 0;
        const dc = colors[d.id];
        const off = excluded.has(d.id) || !dc;
        const leds = dc?.ledColors;
        const grad = ctx.createLinearGradient(x, 0, x + w, 0);
        if (off || !leds || leds.length === 0) {
          grad.addColorStop(0, "rgb(28 30 34)");
          grad.addColorStop(1, "rgb(22 24 28)");
        } else {
          leds.forEach(([r, g, b], i) =>
            grad.addColorStop(i / (leds.length - 1), `rgb(${r} ${g} ${b})`),
          );
        }
        ctx.fillStyle = grad;
        ctx.fillRect(x, 0, w, H);
        x += w;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [devices, colors, excluded, total]);
  return <canvas ref={ref} className="h-full w-full" />;
}

export default function OverviewTab({ onNavigate }: { onNavigate: (t: string) => void }) {
  // deviceColors is the one field that changes at frame rate; scoping keeps
  // this tab off every *other* store write (toasts, accent, config saves).
  const { cfg, rgb, wallpaperPaused, deviceColors, save, media } = useStore(
    useShallow((s) => ({
      cfg: s.cfg,
      rgb: s.rgb,
      wallpaperPaused: s.wallpaperPaused,
      deviceColors: s.deviceColors,
      save: s.save,
      media: s.media,
    })),
  );

  if (!cfg) return null;

  const stickers = cfg.stickers;
  const visibleStickers = stickers.filter((s) => s.visible);
  const excluded = new Set(cfg.rgb.excludedDevices);
  const activeDevices = rgb.devices.filter((d) => !excluded.has(d.id));
  const ledActive = activeDevices.reduce((n, d) => n + d.leds, 0);
  const ledTotal = rgb.devices.reduce((n, d) => n + d.leds, 0);
  const paused = !cfg.general.wallpaperEnabled || wallpaperPaused;
  const idleOn = cfg.rgb.idleTimeoutSec > 0;
  const nightOn = !!cfg.rgb.nightStart && !!cfg.rgb.nightEnd;
  const playlistOn = (cfg.playlists ?? []).some((p) => p.enabled);
  const scenes = cfg.scenes ?? [];
  const pmCount = Object.keys(cfg.wallpaper.perMonitor ?? {}).length;
  const wallpaperName =
    cfg.wallpaper.kind === "shader"
      ? (SHADERS.find((s) => s.id === cfg.wallpaper.source)?.label ?? cfg.wallpaper.source)
      : cfg.wallpaper.source
        ? basename(cfg.wallpaper.source)
        : "Nothing applied";

  const togglePause = () => {
    if (!cfg) return;
    save((c) => (c.general.wallpaperEnabled = !c.general.wallpaperEnabled));
  };

  return (
    <div className="stagger space-y-5">
      {/* ===== row 1: now playing + engine ===== */}
      <div className="grid gap-5 xl:grid-cols-12">
        {/* Now playing — spans 5. Wallpaper stage on top, media + transport
            below, wallpaper context strip last. */}
        <Card title="Now playing" className="xl:col-span-5" right={
          <Chip tone={paused ? "warn" : "ok"} pulse={!paused}>
            {paused ? "paused" : "live"}
          </Chip>
        }>
          <AudioPulse>
            <WallpaperStage cfg={cfg} paused={paused} wallpaperName={wallpaperName} />

            {/* Media row: track identity left, transport right. */}
            <div className="mt-3.5 flex flex-wrap items-center gap-3">
              {media ? (
                <TrackIdentity
                  media={media}
                  beatScale="scale(calc(1 + var(--beat, 0) * 0.045))"
                />
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[10.5px] text-[var(--text-faint)]">
                  <IconWave className="h-3.5 w-3.5 shrink-0" />
                  no media playing
                </div>
              )}
              <TransportButtons
                playing={media?.playing ?? false}
                trackKey={`${media?.title ?? ""}—${media?.artist ?? ""}`}
              />
            </div>

            {/* Wallpaper context strip: the card is "now playing" for the
                whole desktop — what's on the wallpaper matters too. */}
            <div className="mt-3.5 flex flex-wrap items-center gap-2.5 border-t border-[var(--line)] pt-3">
            <div className="h-7 w-11 shrink-0 overflow-hidden rounded-[5px] border border-[var(--line)]">
              <WallpaperThumb kind={cfg.wallpaper.kind} source={cfg.wallpaper.source} paused={paused} bare />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[11px] font-medium text-[var(--text-dim)]" title={wallpaperName}>
                {wallpaperName}
              </div>
              <div className="font-mono text-[9.5px] text-[var(--text-faint)]">
                wallpaper
                {playlistOn && " · playlist rotating"}
                {pmCount > 0 && ` · ${pmCount} override${pmCount === 1 ? "" : "s"}`}
              </div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-x-4">
              <Stat label="vault" value={`${cfg.gallery.length}`} />
              <Stat label="playlist" value={playlistOn ? "rotating" : "off"} />
              <Btn size="sm" variant="primary" onClick={() => onNavigate("wallpaper")}>
                Change
              </Btn>
              <Btn size="sm" onClick={togglePause}>
                {paused ? (
                  <>
                    <IconPlay className="h-3.5 w-3.5" />
                    Resume
                  </>
                ) : (
                  <>
                    <IconPause className="h-3.5 w-3.5" />
                    Pause
                  </>
                )}
              </Btn>
            </div>
            </div>
          </AudioPulse>
        </Card>

        {/* Engine — spans 7. Master switch, live per-LED canvas strip fed
            by real engine frames, mode headline, LED-lane device rows. */}
        <Card
          title="Lighting engine"
          className="xl:col-span-7"
          right={
            <div className="flex items-center gap-2">
              <Chip tone={rgb.connected ? "ok" : "danger"} pulse={rgb.connected}>
                {rgb.connected ? "connected" : "offline"}
              </Chip>
              <SwitchBtn
                checked={cfg.rgb.enabled}
                onChange={(v) => save((c) => (c.rgb.enabled = v))}
                title="Master lighting switch"
              />
              <button
                onClick={() => onNavigate("rgb")}
                className="rounded-md border border-[var(--line-strong)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-dim)] hover-glow"
              >
                configure
              </button>
            </div>
          }
        >
          {/* live per-LED strip: the actual frames the engine sends, not a mock */}
          <div className="relative h-16 w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel-sunken)]">
            {rgb.connected && rgb.devices.length > 0 ? (
              <LedBand devices={rgb.devices} colors={deviceColors} excluded={excluded} />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[var(--text-faint)]">
                <IconBulb className="h-5 w-5" />
              </div>
            )}
            {/* status flags over the band */}
            <div className="absolute left-2.5 top-2.5 flex gap-1.5">
              {nightOn && (
                <Chip tone="accent">
                  night {cfg.rgb.nightStart}–{cfg.rgb.nightEnd}
                </Chip>
              )}
              {idleOn && <Chip tone="idle">idle {cfg.rgb.idleTimeoutSec}s</Chip>}
            </div>
            {!cfg.rgb.enabled && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-[2px]">
                <span className="flex items-center gap-1.5 rounded-md bg-black/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-300">
                  lighting off
                </span>
              </div>
            )}
          </div>

          {/* mode headline */}
          <div className="mt-3.5 flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <span className="lednum text-lg capitalize text-[var(--text)]">
                {cfg.rgb.enabled ? cfg.rgb.mode : "off"}
              </span>
              {cfg.rgb.enabled && rgb.connected && (
                <span className="font-mono text-[10px] text-[var(--text-faint)]">
                  {Math.round(cfg.rgb.mixer.brightness * 100)}% bright · {Math.round(cfg.rgb.mixer.saturation * 100)}% sat
                </span>
              )}
            </div>
          </div>

          {/* device rows: live color lane + name + LED share bar */}
          <div className="mt-3 max-h-[172px] overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)] px-3 py-1">
            {rgb.devices.length === 0 ? (
              <div className="py-6 text-center text-xs text-[var(--text-faint)]">
                {rgb.connected ? "No devices reported" : "Start OpenRGB and hit refresh"}
              </div>
            ) : (
              rgb.devices.map((d) => (
                <DeviceRow
                  key={d.id}
                  name={d.name}
                  typeName={d.typeName}
                  leds={d.leds}
                  totalLeds={ledTotal}
                  color={deviceColors[d.id]}
                  excluded={excluded.has(d.id)}
                />
              ))
            )}
          </div>

          {/* footer metrics */}
          <div className="mt-3 flex items-end justify-between gap-4">
            <div className="grid flex-1 grid-cols-3 gap-x-4">
              <Stat
                label="devices"
                value={rgb.connected ? `${activeDevices.length}/${rgb.devices.length}` : "—"}
              />
              <Stat label="leds live" value={ledActive.toLocaleString()} accent />
              <Stat label="of total" value={ledTotal.toLocaleString()} />
            </div>
          </div>
        </Card>
      </div>

      {/* ===== row 2: displays + stickers ===== */}
      <div className="grid gap-5 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <DisplaysCard compact />
        </div>
        <div className="xl:col-span-5">
          <Card title="Stickers" right={
            stickers.length > 0 ? (
              <span className="font-mono text-[10px] text-[var(--text-faint)]">
                {visibleStickers.length}/{stickers.length} visible
              </span>
            ) : undefined
          }>
            {stickers.length === 0 ? (
              <button
                onClick={() => onNavigate("stickers")}
                className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-[var(--line-strong)] py-6 text-[var(--text-faint)] hover-glow"
              >
                <IconSticker className="h-5 w-5" />
                <span className="text-xs font-semibold">Place your first sticker</span>
              </button>
            ) : (
              <div className="space-y-1.5">
                {stickers.slice(0, 3).map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)] px-3 py-2"
                  >
                    <img
                      src={s.url}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-md border border-[var(--line)] bg-black/30 object-contain"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-[var(--text)]">{s.name}</div>
                      <div className="font-mono text-[10px] text-[var(--text-faint)]">
                        {Math.round(s.w)}×{Math.round(s.h)} · {s.onTop ? "on top" : "wallpaper layer"}
                      </div>
                    </div>
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        s.visible
                          ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
                          : "bg-[var(--text-faint)]"
                      }`}
                    />
                  </div>
                ))}
                {stickers.length > 3 && (
                  <button
                    onClick={() => onNavigate("stickers")}
                    className="px-1 text-xs font-semibold text-[var(--text-faint)] transition-colors hover:text-[rgb(var(--glow))]"
                  >
                    +{stickers.length - 3} more — manage stickers
                  </button>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ===== row 3: scenes + shortcuts ===== */}
      {scenes.length > 0 && (
        <div className="grid gap-5 xl:grid-cols-12">
          <Card title="Scenes" className="xl:col-span-7" right={
            <button
              onClick={() => onNavigate("general")}
              className="rounded-md border border-[var(--line-strong)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-dim)] hover-glow"
            >
              manage
            </button>
          }>
            <div className="flex flex-wrap gap-2">
              {scenes.slice(0, 5).map((s) => (
                <button
                  key={s.id}
                  onClick={async () => {
                    try {
                      const { api } = await import("../../ipc");
                      await api.sceneApply(s.id);
                      useStore.getState().toast("ok", `Scene "${s.name}" applied`);
                    } catch {
                      useStore.getState().toast("error", "Apply failed");
                    }
                  }}
                  className="rounded-lg border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--text-dim)] hover-glow"
                >
                  {s.name}
                </button>
              ))}
            </div>
          </Card>
          <Card title="Keyboard" className="xl:col-span-5" right={
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
              press ?
            </span>
          }>
            <p className="mb-4 text-sm leading-relaxed text-[var(--text-dim)]">
              Every corner of the app is one keystroke away — no mouse required.
            </p>
            <div className="flex flex-wrap gap-2">
              {["Ctrl K — palette", "Ctrl 1-4 — tabs", "? — all shortcuts"].map((s) => (
                <span
                  key={s}
                  className="rounded-lg border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--text-dim)]"
                >
                  {s}
                </span>
              ))}
            </div>
            <button
              onClick={() => window.dispatchEvent(new Event("lumendeck:open-shortcuts"))}
              className="mt-4 rounded-lg border border-dashed border-[var(--line-strong)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-dim)] hover-glow"
            >
              View all shortcuts
            </button>
          </Card>
        </div>
      )}

      {/* jump links */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {(
          [
            {
              id: "rgb",
              label: "Lighting",
              detail: rgb.connected
                ? `${cfg.rgb.mode} · ${ledActive.toLocaleString()} LEDs`
                : "Connect OpenRGB",
              Icon: IconBulb,
            },
            {
              id: "wallpaper",
              label: "Wallpaper",
              detail: `${cfg.gallery.length} in vault · ${playlistOn ? "rotating" : wallpaperName}`,
              Icon: IconImage,
            },
            {
              id: "stickers",
              label: "Stickers",
              detail: stickers.length
                ? `${visibleStickers.length}/${stickers.length} visible`
                : "none placed yet",
              Icon: IconSticker,
            },
          ] as const
        ).map(({ id, label, detail, Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className="glass group flex items-center gap-3.5 p-4 text-left transition-all hover:border-[rgb(var(--glow)/0.5)]"
          >
            <IconBox variant="neutral" size="md">
              <Icon className="h-5 w-5 text-[rgb(var(--glow))]" />
            </IconBox>
            <span className="min-w-0">
              <ItemTitle as="span">{label}</ItemTitle>
              <span className="block truncate text-dim-sm">{detail}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-end border-t border-[var(--line)] pt-4">
        <RefreshBtn />
      </div>
    </div>
  );
}
