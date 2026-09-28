import { useShallow } from "zustand/react/shallow";
import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { Card, Chip, DisplaysCard, IconBox, RefreshBtn, Btn } from "../ui";
import { IconBulb, IconImage, IconSticker, IconGlobe, IconLayers, IconPlay, IconPause, IconNext, IconPrevious } from "../icons";
import { SHADERS, SHADER_ART } from "@shared/constants";
import type { Config, MediaInfo } from "@shared/types";
import { convertFileSrc } from "@tauri-apps/api/core";
import { basename } from "../../utilities";
import { api } from "../../ipc";

/** Compact wallpaper thumb: video plays muted, image static, shader art. */
function WallpaperThumb({
  kind,
  source,
  paused,
}: {
  kind: string;
  source: string;
  paused: boolean;
}) {
  const mediaUrl = convertFileSrc(source, "media");
  return (
    <div className="relative h-full min-h-32 w-full overflow-hidden rounded-lg border border-[var(--line)] bg-black">
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
 * The Now playing thumbnail. When the media slideshow is enabled (Settings)
 * and a track with album art is playing, it crossfades between the wallpaper
 * preview and the album art; otherwise it's just the wallpaper thumb.
 */
function MediaSlideshow({
  cfg,
  media,
  paused,
}: {
  cfg: Config;
  media: MediaInfo | null;
  paused: boolean;
}) {
  const [slide, setSlide] = useState(0);
  const showArt =
    cfg.general.mediaSlideshow && !!media?.art;
  const intervalSec = Math.min(30, Math.max(2, cfg.general.mediaSlideshowSec || 5));

  useEffect(() => {
    if (!showArt) {
      setSlide(0);
      return;
    }
    const id = setInterval(() => setSlide((s) => s + 1), intervalSec * 1000);
    return () => clearInterval(id);
  }, [showArt, intervalSec]);

  const showMediaArt = showArt && slide % 2 === 1;
  return (
    <div className="relative h-full min-h-32 w-full">
      <div className={`absolute inset-0 transition-opacity duration-700 ${showMediaArt ? "opacity-0" : "opacity-100"}`}>
        <WallpaperThumb
          kind={cfg.wallpaper.kind}
          source={cfg.wallpaper.source}
          paused={paused}
        />
      </div>
      {showArt && (
        <div className={`absolute inset-0 overflow-hidden rounded-lg border border-[var(--line)] bg-black transition-opacity duration-700 ${showMediaArt ? "opacity-100" : "opacity-0"}`}>
          {media?.art ? (
            <img src={media.art} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[var(--text-faint)]">
              <IconImage className="h-6 w-6" />
            </div>
          )}
          {/* Slide dots — subtle, only when the slideshow is actually cycling. */}
          <div className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 gap-1">
            {[0, 1].map((i) => (
              <span
                key={i}
                className={`h-1 w-3 rounded-full ${slide % 2 === i ? "bg-white/85" : "bg-white/30"}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Play/prev/next that drive the OS media session (SMTC) — Spotify, browsers,
 * whatever is playing. Hidden entirely when no session exists.
 */
function TransportButtons({ playing }: { playing: boolean }) {
  const [busy, setBusy] = useState(false);
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
    "flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line-strong)] bg-[var(--panel-strong)] text-[var(--text-dim)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[rgb(var(--glow))] disabled:opacity-40";
  return (
    <div className="mt-3 flex items-center gap-1.5">
      <button aria-label="Previous track" className={btn} disabled={busy} onClick={() => send("previous")}>
        <IconPrevious className="h-4 w-4" />
      </button>
      <button
        aria-label={playing ? "Pause" : "Play"}
        className={`${btn} !border-[rgb(var(--glow)/0.4)] !text-[rgb(var(--glow))]`}
        disabled={busy}
        onClick={() => send("toggle")}
      >
        {playing ? <IconPause className="h-4 w-4" /> : <IconPlay className="h-4 w-4" />}
      </button>
      <button aria-label="Next track" className={btn} disabled={busy} onClick={() => send("next")}>
        <IconNext className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Technical readout: tiny uppercase label over a mono value. */
function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="kicker">{label}</div>
      <div
        className={`lednum mt-1 truncate text-[15px] leading-tight ${
          accent ? "text-[rgb(var(--glow))]" : "text-[var(--text)]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** One row in the engine's device table: live color + name + LED count. */
function DeviceRow({
  name,
  typeName,
  leds,
  color,
  excluded,
}: {
  name: string;
  typeName: string;
  leds: number;
  color?: [number, number, number];
  excluded: boolean;
}) {
  const c = color;
  return (
    <div className="flex items-center gap-3 border-t border-[var(--line)] py-2 first:border-t-0">
      <span
        className="h-6 w-6 shrink-0 rounded-md border border-[var(--line-strong)] transition-colors duration-500"
        style={{
          background: c && !excluded ? `rgb(${c[0]} ${c[1]} ${c[2]})` : "var(--panel-sunken)",
          boxShadow:
            c && !excluded ? `inset 0 0 8px -2px rgb(${c[0]} ${c[1]} ${c[2]})` : undefined,
        }}
      />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[13px] font-medium ${excluded ? "text-[var(--text-faint)] line-through" : "text-[var(--text)]"}`}>
          {name}
        </div>
        <div className="font-mono text-[10px] text-[var(--text-faint)]">{typeName}</div>
      </div>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--text-dim)]">
        {leds.toLocaleString()} LED{leds === 1 ? "" : "s"}
      </span>
    </div>
  );
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
        {/* Now playing — spans 5 */}
        <Card title="Now playing" className="xl:col-span-5" right={
          <Chip tone={paused ? "warn" : "ok"} pulse={!paused}>
            {paused ? "paused" : "live"}
          </Chip>
        }>
          <div className="flex gap-4">
            <div className="w-44 shrink-0 self-stretch">
              <MediaSlideshow
                cfg={cfg}
                media={media}
                paused={paused}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              {media ? (
                <>
                  <div
                    className="lednum truncate text-base text-[var(--text)]"
                    title={`${media.title} — ${media.artist}`}
                  >
                    {media.title}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 font-mono text-[10.5px] text-[var(--text-faint)]">
                    {media.appIcon && (
                      <img src={media.appIcon} alt="" className="h-3.5 w-3.5 rounded-[3px]" />
                    )}
                    <span className="truncate">
                      {media.artist || "Unknown artist"}
                      {media.appId && ` · ${media.appId}`}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="lednum truncate text-base text-[var(--text)]">{wallpaperName}</div>
                  <div className="mt-1 font-mono text-[10.5px] capitalize text-[var(--text-faint)]">
                    {cfg.wallpaper.kind}
                    {pmCount > 0 && ` · ${pmCount} override${pmCount === 1 ? "" : "s"}`}
                  </div>
                </>
              )}
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
                <Metric label="vault" value={`${cfg.gallery.length}`} />
                <Metric label="playlist" value={playlistOn ? "rotating" : "off"} />
              </div>
              {media && <TransportButtons playing={media.playing} />}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
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
          </div>
        </Card>

        {/* Engine — spans 7: mode header, device table, live spectrum */}
        <Card
          title="Lighting engine"
          className="xl:col-span-7"
          right={
            <div className="flex items-center gap-2">
              <Chip tone={rgb.connected ? "ok" : "danger"} pulse={rgb.connected}>
                {rgb.connected ? "connected" : "offline"}
              </Chip>
              <button
                onClick={() => onNavigate("rgb")}
                className="rounded-md border border-[var(--line-strong)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-dim)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[rgb(var(--glow))]"
              >
                configure
              </button>
            </div>
          }
        >
          {/* mode headline */}
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <span className="lednum text-lg capitalize text-[var(--text)]">
                {cfg.rgb.enabled ? cfg.rgb.mode : "off"}
              </span>
              {cfg.rgb.enabled && rgb.connected && (
                <span className="font-mono text-[10px] text-[var(--text-faint)]">
                  {Math.round(cfg.rgb.mixer.brightness * 100)}% bright
                </span>
              )}
            </div>
            <div className="flex gap-1.5">
              {nightOn && (
                <Chip tone="accent">
                  night {cfg.rgb.nightStart}–{cfg.rgb.nightEnd}
                </Chip>
              )}
              {idleOn && <Chip tone="idle">idle {cfg.rgb.idleTimeoutSec}s</Chip>}
            </div>
          </div>

          {/* device table */}
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
                  color={deviceColors[d.id]?.rgb}
                  excluded={excluded.has(d.id)}
                />
              ))
            )}
          </div>

          {/* footer metrics + activity spectrum */}
          <div className="mt-3 flex items-end justify-between gap-4">
            <div className="grid flex-1 grid-cols-3 gap-x-4">
              <Metric
                label="devices"
                value={rgb.connected ? `${activeDevices.length}/${rgb.devices.length}` : "—"}
              />
              <Metric label="leds live" value={ledActive.toLocaleString()} accent />
              <Metric label="of total" value={ledTotal.toLocaleString()} />
            </div>
            {/* live spectrum strip: one cell per device, fills by share of LEDs */}
            {rgb.connected && rgb.devices.length > 0 && (
              <div className="flex h-9 w-40 shrink-0 items-end gap-[3px]">
                {rgb.devices.map((d) => {
                  const c = deviceColors[d.id]?.rgb;
                  const share = ledTotal ? Math.max(6, Math.round((d.leds / ledTotal) * 100)) : 10;
                  return (
                    <span
                      key={d.id}
                      title={`${d.name} · ${d.leds} LEDs`}
                      className="min-w-0 flex-1 rounded-[3px] border border-[var(--line)] transition-all duration-500"
                      style={{
                        height: `${excluded.has(d.id) ? 20 : share}%`,
                        background: c && !excluded.has(d.id) ? `rgb(${c[0]} ${c[1]} ${c[2]})` : "var(--panel-sunken)",
                      }}
                    />
                  );
                })}
              </div>
            )}
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
                className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-[var(--line-strong)] py-6 text-[var(--text-faint)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[rgb(var(--glow))]"
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
              className="rounded-md border border-[var(--line-strong)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-dim)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[rgb(var(--glow))]"
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
                  className="rounded-lg border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--text-dim)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[rgb(var(--glow))]"
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
              className="mt-4 rounded-lg border border-dashed border-[var(--line-strong)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-dim)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[rgb(var(--glow))]"
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
              <span className="block text-sm font-semibold text-[var(--text)]">{label}</span>
              <span className="block truncate text-[11px] text-[var(--text-faint)]">{detail}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="flex justify-end">
        <RefreshBtn />
      </div>
    </div>
  );
}
