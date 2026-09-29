import { useShallow } from "zustand/react/shallow";
import { useEffect, useState, useRef, type CSSProperties, type ReactNode } from "react";
import { useStore } from "../../store";
import { Card, Chip, DisplaysCard, IconBox, RefreshBtn, ItemTitle, SwitchBtn, chipStyle, ICON_BTN, ICON_BTN_IDLE, ICON_BTN_ACTIVE, ICON_BTN_PRIMARY, MINI_BTN } from "../ui";
import { IconBulb, IconImage, IconSticker, IconGlobe, IconLayers, IconPlay, IconPause, IconNext, IconPrevious, IconWave, IconSun, IconZap, IconChevronRight, IconMediaApp, IconShuffle, IconRepeat } from "../icons";
import { SHADERS, SHADER_ART, RGB_MODES, ANIMATION_MODES } from "@shared/constants";
import type { Config, MediaInfo, RgbDeviceInfo, DeviceColor } from "@shared/types";
import { convertFileSrc } from "@tauri-apps/api/core";
import { basename } from "../../utilities";
import { api } from "../../ipc";
import { EqEngine } from "../../eq";

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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Perf: a playing <video> decodes every frame even while the app sits in
  // the tray (thumbnails don't get the browser's occlusion optimization for
  // media). Pause decode when hidden, resume when shown — unless the user
  // paused the wallpaper themselves.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onVis = () => {
      if (document.hidden) {
        if (!el.paused) {
          el.dataset.autoplaying = "1";
          el.pause();
        }
      } else if (el.dataset.autoplaying === "1") {
        delete el.dataset.autoplaying;
        el.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);
    if (document.hidden && !el.paused) el.pause();
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [mediaUrl]);
  return (
    <div className={`relative h-full w-full overflow-hidden bg-black ${bare ? "" : "min-h-32 rounded-lg border border-[var(--line)]"}`}>
      {kind === "video" && source ? (
        <video
          key={mediaUrl}
          ref={videoRef}
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
 * Wraps the Now playing stage with a subtle audio-reactive glow, and drives
 * the equalizer beside the artwork from the same loop.
 *
 * The rAF loop feeds the level stream into `EqEngine` and writes the result
 * straight to CSS custom properties on the DOM node — nothing up the tree
 * re-renders at frame rate. Two details matter:
 *
 *  - The loop *parks* when the engine reports itself settled, so a tray-only
 *    session is not burning a 60Hz timer over silence. Any new audio sample
 *    or a return from a hidden tab restarts it.
 *  - Frames carry real elapsed time, so the animation is identical on a 60Hz
 *    and a 240Hz display (see eq.ts).
 */
function AudioPulse({
  children,
  playing,
}: {
  children: ReactNode;
  playing: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const engine = new EqEngine();
    let raf = 0;
    let lastFrame = 0;
    // The store holds only the newest level, so detect "a new sample arrived"
    // by watching for a change. Reading it per frame instead would re-run
    // onset detection on the same held value and invent beats.
    let lastVolume = -1;
    let lastPulse = -1;

    const paint = (now: number) => {
      const { volume, pulse } = useStore.getState().audioLevel;
      if (volume !== lastVolume || pulse !== lastPulse) {
        engine.sample(volume, pulse, now);
        lastVolume = volume;
        lastPulse = pulse;
      }
      const dt = lastFrame === 0 ? 1000 / 60 : now - lastFrame;
      lastFrame = now;
      const bars = engine.frame(now, dt, playing);
      const el = ref.current;
      if (el) {
        el.style.setProperty("--al", volume.toFixed(3));
        el.style.setProperty("--beat", engine.beat.toFixed(3));
        for (let i = 0; i < bars.length; i++) {
          el.style.setProperty(`--eq${i}`, (bars[i] ?? 0).toFixed(3));
        }
      }
      if (engine.settled) {
        // Park the loop. Nothing is moving, and any new audio reading (or a
        // return from a hidden tab) restarts it, so there is no reason to hold
        // a 60Hz timer open over silence.
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(paint);
    };

    const start = () => {
      if (raf === 0) {
        lastFrame = 0;
        raf = requestAnimationFrame(paint);
      }
    };
    start();
    // Any new audio reading wakes the loop back up.
    const unsub = useStore.subscribe((s, prev) => {
      if (s.audioLevel !== prev.audioLevel) start();
    });
    const onVisible = () => {
      if (!document.hidden) start();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVisible);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [playing]);
  return (
    <div
      ref={ref}
      className="relative"
      style={
        {
          "--al": 0,
          "--beat": 0,
          "--eq0": 0,
          "--eq1": 0,
          "--eq2": 0,
          "--eq3": 0,
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}

/**
 * Top stage of the Now playing card: the live wallpaper, full-bleed, with its
 * name chip pinned top-left and the wallpaper quick-actions (pause/resume,
 * change) pinned top-right. Media lives in its own row below.
 */
function WallpaperStage({
  cfg,
  paused,
  wallpaperName,
  onTogglePause,
  onChange,
}: {
  cfg: Config;
  paused: boolean;
  wallpaperName: string;
  onTogglePause: () => void;
  onChange: () => void;
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

      <div className="absolute left-3 top-3 flex max-w-[calc(100%-13rem)] items-center gap-2 rounded-lg bg-black/45 px-2.5 py-1.5 backdrop-blur-sm">
        <IconImage className="h-3.5 w-3.5 shrink-0 text-white/75" />
        <span className="truncate font-mono text-[10px] text-white/90" title={wallpaperName}>
          {wallpaperName}
        </span>
      </div>

      {/* wallpaper quick-actions, over the scrim, top-right */}
      <div className="absolute right-3 top-3 flex items-center gap-1.5">
        <button
          onClick={onTogglePause}
          title={paused ? "Resume wallpaper" : "Pause wallpaper"}
          className="flex h-7 items-center gap-1.5 rounded-lg bg-black/45 px-2.5 font-mono text-[10px] uppercase tracking-wider text-white/85 backdrop-blur-sm transition-all hover:bg-black/60 hover:text-white active:scale-95"
        >
          {paused ? (
            <>
              <IconPlay className="h-3 w-3" />
              Resume
            </>
          ) : (
            <>
              <IconPause className="h-3 w-3" />
              Pause
            </>
          )}
        </button>
        <button
          onClick={onChange}
          title="Change wallpaper"
          className="flex h-7 items-center gap-1.5 rounded-lg bg-[rgb(var(--glow)/0.85)] px-2.5 font-mono text-[10px] uppercase tracking-wider text-black/90 backdrop-blur-sm transition-all hover:bg-[rgb(var(--glow))] active:scale-95"
        >
          <IconImage className="h-3 w-3" />
          Change
        </button>
      </div>
    </div>
  );
}

/**
 * Compact inline slider for card headers: icon + percent readout + bare
 * range input. Tracks the pointer 1:1 locally; commits on release, like the
 * settings Slider. Used for the engine card's brightness quick-control.
 */
function QuickSlider({
  icon,
  value,
  onChange,
  title,
}: {
  icon: ReactNode;
  value: number;
  onChange: (v: number) => void;
  title: string;
}) {
  const [live, setLive] = useState<number | null>(null);
  const shown = live ?? value;
  return (
    <div className="flex w-44 shrink-0 items-center gap-2" title={title}>
      {icon}
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={shown}
        style={{ "--fill": `${shown}%` } as CSSProperties}
        onChange={(e) => setLive(Number(e.target.value))}
        onPointerUp={() => {
          if (live != null) onChange(live);
          setLive(null);
        }}
        onKeyUp={() => {
          if (live != null) onChange(live);
          setLive(null);
        }}
        onBlur={() => {
          if (live != null) onChange(live);
          setLive(null);
        }}
      />
      <span className="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--text-dim)]">
        {shown}%
      </span>
    </div>
  );
}

/**
 * Inline equalizer bars. Each bar reads its own `--eq0..--eq3` variable,
 * which `AudioPulse` writes from the transient engine every frame. There is
 * deliberately no height transition here: the engine already smooths the
 * values, and a CSS transition layered on top would lag a frame behind every
 * write and blur the attack.
 *
 * Always mounted: `playing` collapses/expands the bars smoothly (width +
 * opacity transition) instead of popping the block in and out of the layout.
 */
function EqBars({ playing }: { playing: boolean }) {
  return (
    <span
      className="flex shrink-0 items-end gap-[2px] overflow-hidden transition-all duration-300 ease-out"
      style={{
        width: playing ? "22px" : "0px",
        opacity: playing ? 1 : 0,
      }}
    >
      {EQ_BAR_VARS.map((v) => (
        <span
          key={v}
          className="w-[3px] shrink-0 rounded-sm bg-[rgb(var(--glow))]"
          style={{
            height: `clamp(3px, calc(var(${v}, 0) * 16px), 16px)`,
            opacity: "calc(0.5 + var(--al, 0) * 0.5)",
          }}
        />
      ))}
    </span>
  );
}

/** CSS variable each equalizer bar reads, bass first. */
const EQ_BAR_VARS = ["--eq0", "--eq1", "--eq2", "--eq3"] as const;

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
    <div className="track-slide flex min-w-0 flex-1 items-center gap-3 rounded-lg">
      {/* Song image with the playing app's icon woven into the corner:
          the icon sits inset on the art with a ring that separates it from
          any artwork. Playing state reads from the EqBars next to the tile,
          so no status dot is needed on the image itself. */}
      <div
        className="relative shrink-0"
        style={{ transform: beatScale }}
        title={media.appId}
      >
        {media.art ? (
          <img
            src={media.art}
            alt=""
            className="h-16 w-16 rounded-xl border border-[var(--line-strong)] object-cover shadow-[0_4px_14px_-6px_rgb(0_0_0/0.55)]"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-[var(--line-strong)] bg-[var(--panel-sunken)]">
            <IconWave className="h-6 w-6 text-[var(--text-faint)]" />
          </div>
        )}
        {(media.appIcon || media.appId) && (
          <span className="absolute -bottom-1 -right-1">
            {media.appIcon ? (
              <img
                src={media.appIcon}
                alt=""
                className="h-7 w-7 rounded-[7px] border border-[var(--panel-strong)] object-contain shadow-[0_1px_5px_rgb(0_0_0/0.45)]"
              />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-[var(--panel-strong)] bg-black/60 shadow-[0_1px_5px_rgb(0_0_0/0.45)]">
                <IconMediaApp app={media.appId} aria-label={media.appId} className="h-4 w-4 text-white/90" />
              </span>
            )}
          </span>
        )}
      </div>
      <EqBars playing={media.playing} />
      <div className="min-w-0">
        <div
          className="truncate text-[14px] font-semibold leading-tight text-[var(--text)]"
          title={`${media.title} — ${media.artist}`}
        >
          {media.title}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] text-[var(--text-faint)]">
          <span className="truncate">{media.artist || "Unknown artist"}</span>
          <span
            className="shrink-0 text-[10px] text-[var(--text-faint)]/70"
            title={media.appId}
          >
            {media.album && `· ${media.album}`}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Track progress bar: elapsed / total with a filling accent line. The backend
 * samples the SMTC timeline at ~1Hz; between samples the position advances
 * locally (a CSS transform on a rAF, no React re-renders), and each fresh
 * sample snaps the bar back to ground truth — so seek/track changes show
 * immediately. Hidden when the sender reports no duration (radio, some web
 * players), when paused it freezes rather than disappearing.
 */
function ProgressBar({ media }: { media: MediaInfo }) {
  const fillRef = useRef<HTMLSpanElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const duration = media.durationSec;
  const trackKey = `${media.title}—${media.artist}`;
  // Scrubbing: while dragging, the rAF stops owning the fill and the pointer
  // does; a seek is sent once on release. Skew-compensated play resumes from
  // the next backend sample, which snaps the bar back to ground truth.
  const [scrub, setScrub] = useState<number | null>(null);
  const barRef = useRef<HTMLSpanElement | null>(null);
  const posFromEvent = (e: PointerEvent | React.PointerEvent) => {
    const bar = barRef.current;
    if (!bar || duration <= 0) return 0;
    const rect = bar.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return f * duration;
  };
  useEffect(() => {
    if (duration <= 0) return;
    let raf = 0;
    const start = performance.now();
    // The sample may already be a beat old by the time it reaches us —
    // include that skew so the bar starts at the true position.
    const basePos = media.positionSec + (media.playing ? Math.max(0, (Date.now() - (media.positionUpdatedMs || Date.now())) / 1000) : 0);
    const fmt = (s: number) => {
      const total = Math.max(0, Math.floor(s));
      const m = Math.floor(total / 60);
      return `${m}:${String(total % 60).padStart(2, "0")}`;
    };
    const paint = (pos: number) => {
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${duration > 0 ? pos / duration : 0})`;
      }
      if (timeRef.current) {
        const next = fmt(pos);
        if (timeRef.current.textContent !== next) timeRef.current.textContent = next;
      }
    };
    const tick = () => {
      const elapsed = media.playing ? (performance.now() - start) / 1000 : 0;
      paint(Math.min(duration, basePos + elapsed));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Re-arm on every sample: each MEDIA_SESSION event carries a fresh
    // position anchor. media.playing is intentionally read via closure —
    // the object identity changes whenever anything meaningful changes.
  }, [trackKey, duration, media]);
  // The fill follows the pointer while scrubbing (own effect so it wins
  // over the rAF without racing it every frame).
  useEffect(() => {
    if (scrub == null) return;
    const onMove = (e: PointerEvent) => {
      const pos = posFromEvent(e);
      setScrub(pos);
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${duration > 0 ? pos / duration : 0})`;
      }
      if (timeRef.current) {
        const total = Math.floor(pos);
        timeRef.current.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
      }
    };
    const onUp = (e: PointerEvent) => {
      const pos = posFromEvent(e);
      setScrub(null);
      void api.mediaSeek(pos).catch(() => {});
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrub != null, duration]);
  if (duration <= 0) return null;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <span
        ref={timeRef}
        className={`w-9 shrink-0 text-right font-mono text-[10px] tabular-nums ${
          scrub != null ? "text-[rgb(var(--glow))]" : "text-[var(--text-faint)]"
        }`}
      >
        0:00
      </span>
      <span
        ref={barRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(scrub ?? media.positionSec)}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setScrub(posFromEvent(e));
        }}
        onKeyDown={(e) => {
          const step = duration * 0.02;
          if (e.key === "ArrowRight") {
            void api.mediaSeek(Math.min(duration, media.positionSec + step)).catch(() => {});
          } else if (e.key === "ArrowLeft") {
            void api.mediaSeek(Math.max(0, media.positionSec - step)).catch(() => {});
          }
        }}
        className="group relative h-1 min-w-0 flex-1 cursor-pointer rounded-full bg-[var(--line-strong)] transition-[height] hover:h-1.5"
      >
        <span
          ref={fillRef}
          className="absolute inset-0 origin-left rounded-full bg-[rgb(var(--glow))] shadow-[0_0_6px_rgb(var(--glow)/0.6)]"
          style={{ transform: "scaleX(0)" }}
        />
        {/* thumb: hidden until hover or scrub */}
        <span
          className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgb(var(--glow))] shadow-[0_0_8px_rgb(var(--glow)/0.8)] transition-opacity ${
            scrub != null ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
          style={{ left: `${duration > 0 ? ((scrub ?? media.positionSec) / duration) * 100 : 0}%` }}
        />
      </span>
      <span className="w-9 shrink-0 font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
        {fmtDuration(duration)}
      </span>
    </div>
  );
}

function fmtDuration(s: number): string {
  const total = Math.max(0, Math.floor(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Player controls use the app's canonical icon-button tokens (ICON_BTN_*)
 * from ui.tsx — the same accent values as the shared chip language, just
 * round and borderless at rest. No local style constants here anymore.
 */

/**
 * System master volume: speaker button (click = mute toggle) + compact
 * slider. This is the default render endpoint's volume — the same knob the
 * taskbar speaker controls — because SMTC has no per-app volume. State is
 * read on mount and after each local change; other apps' volume changes
 * sync on the next mount/reopen of the tab (no global volume polling).
 */
function VolumeControl() {
  // `systemVolume` is seeded on mount (the watcher may not have fired yet)
  // and then kept live by the backend's WASAPI change notifications, so
  // keyboard/taskbar/other-app volume edits mirror here in real time.
  const event = useStore((s) => s.systemVolume);
  const [vol, setVol] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [live, setLive] = useState<number | null>(null);
  const shown = live ?? vol;
  useEffect(() => {
    let disposed = false;
    api.volumeGet()
      .then(([v, m]) => {
        if (!disposed) {
          setVol(Math.round(v));
          setMuted(m > 0.5);
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    if (!event) return;
    const [v, m] = event;
    setVol(Math.round(v));
    setMuted(m > 0.5);
    // A live event means our scrub is stale — external change wins.
    setLive(null);
  }, [event]);
  const commit = (v: number) => {
    setVol(v);
    void api.volumeSet(v).catch(() => {});
  };
  const toggleMute = () => {
    void api.volumeMuteToggle()
      .then((next) => setMuted(next))
      .catch(() => {});
  };
  if (shown == null) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5" title="System volume">
      <button
        aria-label={muted ? "Unmute" : "Mute"}
        onClick={toggleMute}
        className={`${ICON_BTN} ${
          muted
            ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
            : ICON_BTN_IDLE
        }`}
      >
        {muted || shown === 0 ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H3v6h3l5 4V5Z" />
            <path d="m16 9 5 5m0-5-5 5" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H3v6h3l5 4V5Z" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
          </svg>
        )}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={shown}
        style={{ "--fill": `${shown}%`, width: "72px" } as CSSProperties}
        className="h-1"
        onChange={(e) => setLive(Number(e.target.value))}
        onPointerUp={() => {
          if (live != null) commit(live);
          setLive(null);
        }}
        onKeyUp={() => {
          if (live != null) commit(live);
          setLive(null);
        }}
        onBlur={() => {
          if (live != null) commit(live);
          setLive(null);
        }}
      />
      <span className="w-7 shrink-0 font-mono text-[9px] tabular-nums text-[var(--text-faint)]">
        {shown}%
      </span>
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
  shuffle,
  repeat,
}: {
  playing: boolean;
  trackKey: string;
  /** undefined = sender has no shuffle control (button hidden). */
  shuffle?: boolean | null;
  /** undefined = sender has no repeat control (button hidden). */
  repeat?: 0 | 1 | 2 | null;
}) {
  // Capability vs state: a `null` state with a known capability means the
  // button renders disabled rather than showing a possibly-wrong state.
  const shuffleSupported = shuffle !== null;
  const repeatSupported = repeat !== null;
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
  // Remounting the row (key=pulseId) replays the ripple on every track
  // change; the ring starts at the button, so no fill-mode is wanted.
  // Must compose the same idle style as the other buttons — the base token
  // alone leaves the border color unset (Tailwind default = near-white).
  const ripple = (delayMs: number) =>
    pulseId > 0
      ? { className: `${ICON_BTN} ${ICON_BTN_IDLE} transport-pulse`, style: { animationDelay: `${delayMs}ms` } }
      : { className: `${ICON_BTN} ${ICON_BTN_IDLE}` };
  return (
    <div key={pulseId} className="flex items-center gap-2">
      {/* Shuffle: shown whenever the sender exposes it; disabled (dimmed)
          when the capability exists but the UI hasn't received state yet. */}
      {shuffle !== undefined && (
        <button
          aria-label="Toggle shuffle"
          title={shuffleSupported ? "Shuffle" : "Shuffle not available in this app"}
          disabled={!shuffleSupported || busy}
          onClick={() => void api.mediaShuffle(!shuffle).catch(() => {})}
          className={`${ICON_BTN} ${shuffle ? ICON_BTN_ACTIVE : ICON_BTN_IDLE}`}
        >
          <span key={String(shuffle)} className={shuffle ? "player-toggle-pop flex" : "flex"}>
            <IconShuffle className="h-3.5 w-3.5" />
          </span>
        </button>
      )}
      <button aria-label="Previous track" disabled={busy} onClick={() => send("previous")} {...ripple(90)}>
        <IconPrevious className="h-4 w-4" />
      </button>
      <button
        aria-label={playing ? "Pause" : "Play"}
        className={`${ICON_BTN} ${ICON_BTN_PRIMARY} ${pulseId > 0 ? "transport-pulse" : ""}`}
        disabled={busy}
        onClick={() => send("toggle")}
      >
        {/* key re-mounts the glyph on state flip, replaying the swap spin */}
        <span key={playing ? "pause" : "play"} className="player-icon-swap flex">
          {playing ? <IconPause className="h-5 w-5" /> : <IconPlay className="h-5 w-5" />}
        </span>
      </button>
      <button aria-label="Next track" disabled={busy} onClick={() => send("next")} {...ripple(180)}>
        <IconNext className="h-4 w-4" />
      </button>
      {/* Repeat: cycles off -> track -> list. `on` = list repeat (accent);
          track repeat adds the "1" superscript, like every music app. */}
      {repeat !== undefined && (
        <button
          aria-label="Cycle repeat mode"
          title={repeatSupported ? (repeat === 1 ? "Repeat track" : repeat === 2 ? "Repeat queue" : "Repeat off") : "Repeat not available in this app"}
          disabled={!repeatSupported || busy}
          onClick={() => void api.mediaRepeat(repeat).catch(() => {})}
          className={`relative ${ICON_BTN} ${(repeat ?? 0) > 0 ? ICON_BTN_ACTIVE : ICON_BTN_IDLE}`}
        >
          <span key={String(repeat)} className={(repeat ?? 0) > 0 ? "player-toggle-pop flex" : "flex"}>
            <IconRepeat className="h-3.5 w-3.5" />
          </span>
          {repeat === 1 && (
            <span className="absolute -right-0 -top-0.5 font-mono text-[8px] font-bold leading-none text-[rgb(var(--glow))]">
              1
            </span>
          )}
        </button>
      )}
    </div>
  );
}

/**
 * Per-device LED lanes: each device gets its own row of discrete glowing
 * dots sampled from the engine's live per-LED colors — reads as hardware,
 * not a gradient slab. Muted devices render dark dots.
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
  return (
    <div className="flex h-full w-full flex-col justify-center gap-1.5 px-3 py-2.5">
      {devices.map((d) => (
        <LedLaneRow
          key={d.id}
          name={d.typeName}
          leds={d.leds}
          ledColors={colors[d.id]?.ledColors ?? null}
          muted={excluded.has(d.id)}
        />
      ))}
    </div>
  );
}

/** One device lane: name + a row of discrete LED dots (sampled, capped). */
function LedLaneRow({
  name,
  leds,
  ledColors,
  muted,
}: {
  name: string;
  leds: number;
  ledColors: [number, number, number][] | null;
  muted: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // Cap the dot count per lane: 64 dots read as an LED strip while staying
  // cheap; devices with more LEDs just get a denser row.
  const DOTS = Math.min(64, Math.max(12, leds));
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Perf: the preview only needs ~30fps (the store coalesces frames to
    // 12.5Hz anyway), and a redraw is pointless when the color data hasn't
    // changed. Skipping unchanged frames keeps N device lanes from repainting
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
      }:${muted}`;
      if (sig === lastSig && canvas.offsetWidth === lastW) return;
      lastDraw = now;
      lastSig = sig;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      lastW = canvas.offsetWidth;
      const W = (canvas.width = lastW * dpr);
      const H = (canvas.height = canvas.offsetHeight * dpr);
      ctx.clearRect(0, 0, W, H);
      const gap = 2 * dpr;
      const dot = Math.min((W - (DOTS - 1) * gap) / DOTS, H);
      const rowW = DOTS * dot + (DOTS - 1) * gap;
      const x0 = (W - rowW) / 2;
      const y = (H - dot) / 2;
      for (let i = 0; i < DOTS; i++) {
        // Sample the engine's per-LED colors evenly across the row. A
        // single-entry array means a flat reactive color — every dot the
        // same; a multi-entry array is a gradient/animation to sample.
        const src = ledColors && ledColors.length > 0
          ? ledColors.length === 1
            ? ledColors[0]
            : ledColors[Math.min(ledColors.length - 1, Math.floor((i / DOTS) * ledColors.length))]
          : null;
        const [r, g, b] = muted || !src ? [30, 32, 36] : src;
        const cx = x0 + i * (dot + gap) + dot / 2;
        // glow halo
        ctx.beginPath();
        ctx.arc(cx, y + dot / 2, dot * 0.85, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${r} ${g} ${b} / 0.28)`;
        ctx.fill();
        // dot body
        ctx.beginPath();
        ctx.arc(cx, y + dot / 2, dot * 0.46, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${r} ${g} ${b})`;
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [ledColors, muted, DOTS]);
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`w-20 shrink-0 truncate text-right font-mono text-[9px] uppercase tracking-wider ${
          muted ? "text-[var(--text-faint)] line-through" : "text-[var(--text-dim)]"
        }`}
      >
        {name}
      </span>
      <canvas ref={ref} className="h-3.5 min-w-0 flex-1" />
      <span className="w-10 shrink-0 font-mono text-[9px] tabular-nums text-[var(--text-faint)]">
        {leds.toLocaleString()}
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
  const isAnimatedMode = (ANIMATION_MODES as ReadonlySet<string>).has(cfg.rgb.mode);
  const paused = !cfg.general.wallpaperEnabled || wallpaperPaused;
  const idleOn = cfg.rgb.idleTimeoutSec > 0;
  const nightOn = !!cfg.rgb.nightStart && !!cfg.rgb.nightEnd;
  const playlistOn = (cfg.playlists ?? []).some((p) => p.enabled);
  const scenes = cfg.scenes ?? [];
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

  const hour = new Date().getHours();
  const greeting =
    hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const issues: string[] = [];
  if (!rgb.connected) issues.push("OpenRGB offline");
  if (paused) issues.push("wallpaper paused");
  if (!issues.length && !cfg.rgb.enabled) issues.push("lighting off");

  return (
    <div className="stagger space-y-5">
      {/* ===== greeting strip: salutation + live system pulse ===== */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <div className="lednum text-2xl leading-tight text-[var(--text)]">{greeting}</div>
          <div className="mt-0.5 font-mono text-[11px] text-[var(--text-faint)]">
            {issues.length > 0 ? (
              <span className="text-amber-400">{issues.join(" · ")}</span>
            ) : (
              <span>
                everything running · {activeDevices.length} device{activeDevices.length === 1 ? "" : "s"} ·{" "}
                {ledActive.toLocaleString()} LEDs · {stickers.length} sticker{stickers.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RefreshBtn />
        </div>
      </div>
      {/* ===== row 1: now playing + engine ===== */}
      <div className="grid gap-5 xl:grid-cols-12">
        {/* Now playing — spans 5. Wallpaper stage on top, media + transport
            below, wallpaper context strip last. */}
        <Card
          title="Now playing"
          icon={<IconWave />}
          className="xl:col-span-5"
          right={
            <Chip tone={media ? (media.playing ? "ok" : "idle") : paused ? "warn" : "idle"} pulse={!!media?.playing}>
              {media ? (media.playing ? "playing" : "paused track") : paused ? "wallpaper paused" : "idle"}
            </Chip>
          }
        >
          <AudioPulse playing={!!media?.playing}>
            <WallpaperStage
              cfg={cfg}
              paused={paused}
              wallpaperName={wallpaperName}
              onTogglePause={togglePause}
              onChange={() => onNavigate("wallpaper")}
            />

            {media ? (
              <div
                key={`${media.title}—${media.artist}`}
                className="track-swap mt-3.5 flex min-w-0 items-center gap-3.5"
              >
                <TrackIdentity media={media} beatScale="scale(calc(1 + var(--beat, 0) * 0.045))" />
                <TransportButtons
                  playing={media.playing}
                  trackKey={`${media.title}—${media.artist}`}
                  shuffle={media.shuffle}
                  repeat={media.repeat}
                />
              </div>
            ) : (
              <div className="mt-3.5 flex min-w-0 items-center gap-2 font-mono text-[10.5px] text-[var(--text-faint)]">
                <IconWave className="h-3.5 w-3.5 shrink-0" />
                no media playing
              </div>
            )}

            {/* Progress line with system volume at the right end: the two
                read as one "playback state" strip. Progress hides for
                senders without a timeline; volume is always relevant. */}
            <div className="mt-2.5 flex min-w-0 items-center gap-4">
              {media && (
                <ProgressBar key={`${media.title}—${media.artist}`} media={media} />
              )}
              <VolumeControl />
            </div>
          </AudioPulse>
        </Card>

        {/* Engine — spans 7. SignalRGB-style: hero LED preview with device
            labels, one control bar (brightness + speed), mode pills, and
            devices as compact mute-chips. */}
        <Card
          title="Lighting engine"
          icon={<IconBulb />}
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
            </div>
          }
        >
          {/* hero LED preview: one lane of glowing dots per device */}
          <div
            className="relative w-full overflow-hidden rounded-xl border border-[var(--line)] bg-black"
            style={{
              // Audio-reactive halo, matching the wallpaper stage.
              boxShadow:
                "0 0 calc(6px + var(--al, 0) * 34px) rgb(var(--glow) / calc(0.05 + var(--al, 0) * 0.26 + var(--beat, 0) * 0.2))",
            }}
          >
            {rgb.connected && rgb.devices.length > 0 ? (
              <LedBand devices={rgb.devices} colors={deviceColors} excluded={excluded} />
            ) : (
              <div className="flex h-20 w-full items-center justify-center text-[var(--text-faint)]">
                <IconBulb className="h-5 w-5" />
              </div>
            )}
            {!cfg.rgb.enabled && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-[2px]">
                <span className="flex items-center gap-1.5 rounded-md bg-black/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-300">
                  lighting off
                </span>
              </div>
            )}
          </div>

          {/* automation flags: inline under the lanes */}
          {(nightOn || idleOn) && (
            <div className="mt-2 flex gap-1.5">
              {nightOn && (
                <Chip tone="accent">
                  night {cfg.rgb.nightStart}–{cfg.rgb.nightEnd}
                </Chip>
              )}
              {idleOn && <Chip tone="idle">idle {cfg.rgb.idleTimeoutSec}s</Chip>}
            </div>
          )}

          {/* control bar: brightness + speed sliders share one row */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
            {cfg.rgb.enabled ? (
              <>
                <QuickSlider
                  icon={<IconSun className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" />}
                  value={Math.round(cfg.rgb.mixer.brightness * 100)}
                  onChange={(v) => save((c) => (c.rgb.mixer.brightness = v / 100))}
                  title="Brightness"
                />
                {isAnimatedMode && (
                  <QuickSlider
                    icon={<IconZap className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" />}
                    value={Math.round(cfg.rgb.animationSpeed * 50)}
                    onChange={(v) => save((c) => (c.rgb.animationSpeed = v / 50))}
                    title="Animation speed"
                  />
                )}
              </>
            ) : (
              <span className="font-mono text-[10.5px] text-[var(--text-faint)]">
                engine off — flip the switch to wake your lights
              </span>
            )}
            <span className="font-mono text-[10px] text-[var(--text-faint)]">
              {activeDevices.length}/{rgb.devices.length} devices · {ledActive.toLocaleString()} LEDs
            </span>
          </div>

          {/* mode pills: one-click switch between all 8 modes. Uses the
              shared chip language (chipStyle) — same selected look as every
              other selectable control in the app. */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {RGB_MODES.map((m) => {
              const active = cfg.rgb.enabled && cfg.rgb.mode === m.id;
              return (
                <button
                  key={m.id}
                  title={m.hint}
                  onClick={() => save((c) => { c.rgb.enabled = true; c.rgb.mode = m.id; })}
                  className={chipStyle(active) + " rounded-lg px-2.5 py-1 text-[11px]"}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* devices: compact mute-chips instead of a tall list */}
          {rgb.devices.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {rgb.devices.map((d) => {
                const muted = excluded.has(d.id);
                const c = deviceColors[d.id]?.rgb;
                return (
                  <button
                    key={d.id}
                    title={`${muted ? "Include" : "Mute"} ${d.name} (${d.leds} LEDs)`}
                    onClick={() =>
                      save((cc) => {
                        const set = new Set(cc.rgb.excludedDevices);
                        if (set.has(d.id)) set.delete(d.id);
                        else set.add(d.id);
                        cc.rgb.excludedDevices = [...set];
                      })
                    }
                    className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium ${chipStyle(false)}`}                   
                    style={muted ? { opacity: 0.55 } : undefined}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full transition-colors duration-500"
                      style={{
                        background: c && !muted ? `rgb(${c[0]} ${c[1]} ${c[2]})` : "var(--panel-sunken)",
                        boxShadow: c && !muted ? `0 0 6px rgb(${c[0]} ${c[1]} ${c[2]} / 0.8)` : undefined,
                      }}
                    />
                    <span className={`max-w-36 truncate ${muted ? "line-through" : ""}`}>{d.name}</span>
                    <span className="font-mono text-[9px] text-[var(--text-faint)]">{d.leds}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ===== row 2: displays + stickers ===== */}
      <div className="grid gap-5 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <DisplaysCard compact />
        </div>
        <div className="xl:col-span-5">
          <Card title="Stickers" icon={<IconSticker />} right={
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
                {stickers.slice(0, 4).map((s) => (
                  <button
                    key={s.id}
                    title={s.visible ? "Click to hide this sticker" : "Click to show this sticker"}
                    onClick={() =>
                      api.updateSticker({ ...s, visible: !s.visible }).catch(console.error)
                    }
                    className="flex w-full items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)] px-3 py-2 text-left transition-all hover:border-[var(--line-strong)] active:scale-[0.99]"
                  >
                    <img
                      src={s.url}
                      alt=""
                      className={`h-8 w-8 shrink-0 rounded-md border border-[var(--line)] bg-black/30 object-contain transition-opacity ${
                        s.visible ? "" : "opacity-35 grayscale"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-[13px] font-medium ${
                          s.visible ? "text-[var(--text)]" : "text-[var(--text-faint)]"
                        }`}
                      >
                        {s.name}
                      </div>
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
                  </button>
                ))}
                {stickers.length > 4 && (
                  <button
                    onClick={() => onNavigate("stickers")}
                    className="px-1 text-xs font-semibold text-[var(--text-faint)] transition-colors hover:text-[rgb(var(--glow))]"
                  >
                    +{stickers.length - 4} more — manage stickers
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
          <Card title="Scenes" icon={<IconLayers />} className="xl:col-span-7" right={
            <button
              onClick={() => onNavigate("general")}
              className={MINI_BTN}
            >
              manage
            </button>
          }>
            <div className="flex flex-wrap gap-2">
              {scenes.slice(0, 6).map((s) => (
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
                  className="group flex items-center gap-1.5 rounded-lg border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--text-dim)] hover-glow active:scale-[0.97]"
                >
                  <IconLayers className="h-3.5 w-3.5 text-[var(--text-faint)] transition-colors group-hover:text-[rgb(var(--glow))]" />
                  {s.name}
                </button>
              ))}
            </div>
          </Card>
          <Card title="Shortcuts" icon={<IconZap />} className="xl:col-span-5" right={
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
            className="glass group flex items-center gap-3.5 p-4 text-left transition-all hover:border-[rgb(var(--glow)/0.5)] active:scale-[0.99]"
          >
            <IconBox variant="neutral" size="md">
              <Icon className="h-5 w-5 text-[rgb(var(--glow))]" />
            </IconBox>
            <span className="min-w-0 flex-1">
              <ItemTitle as="span">{label}</ItemTitle>
              <span className="block truncate text-dim-sm">{detail}</span>
            </span>
            <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--text-faint)] transition-all group-hover:translate-x-0.5 group-hover:text-[rgb(var(--glow))]" />
          </button>
        ))}
      </div>
    </div>
  );
}
