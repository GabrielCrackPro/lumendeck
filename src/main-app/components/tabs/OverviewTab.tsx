import { useShallow } from "zustand/react/shallow";
import { useEffect, useState, useRef, type CSSProperties, type ReactNode } from "react";
import { useStore } from "../../store";
import { Card, Chip, DisplaysCard, IconBox, RefreshBtn, ItemTitle, SwitchBtn, Segmented, ICON_BTN, ICON_BTN_IDLE, ICON_BTN_ACTIVE, ICON_BTN_PRIMARY, MINI_BTN, OVERLAY_ICON_BTN } from "../ui";
import { DeviceRow } from "../DeviceRow";
import { IconBulb, IconImage, IconSticker, IconGlobe, IconLayers, IconPlay, IconPause, IconNext, IconPrevious, IconWave, IconSun, IconZap, IconChevronRight, IconMediaApp, IconShuffle, IconRepeat, IconSpinner } from "../icons";
import { SHADERS, SHADER_ART, RGB_MODES, ANIMATION_MODES } from "@shared/constants";
import type { Config, MediaInfo, RgbMode } from "@shared/types";
import { convertFileSrc } from "@tauri-apps/api/core";
import { basename } from "../../utilities";
import { api } from "../../ipc";
import { usePending } from "../../pending";
import { EqEngine } from "../../eq";
import {
  formatDuration,
  positionFromFraction,
  progressFraction,
  skewedPosition,
} from "../player/mediaTime";
import { waitForChange, type MediaSnapshot, type TransportAction } from "../player/mediaPending";
import { t } from "../../i18n";

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
            {t("shell.paused")}
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
      // `group/stage` rather than `group`: the hover target for the actions is
      // the whole picture, not the two buttons, or the pointer has to find a
      // 28px target before the buttons it is aiming at become visible. Named so
      // it cannot be shadowed by an ancestor `group` — `AudioPulse` is one.
      className="group/stage relative h-44 w-full overflow-hidden rounded-xl border border-[var(--line)] bg-black"
      style={{
        // Audio-reactive halo: volume widens and brightens a glow ring around
        // the stage; a detected beat adds a short bright flash on top.
        boxShadow:
          "0 0 calc(6px + var(--al, 0) * 34px) rgb(var(--glow) / calc(0.05 + var(--al, 0) * 0.26 + var(--beat, 0) * 0.2))",
      }}
    >
      <WallpaperThumb kind={cfg.wallpaper.kind} source={cfg.wallpaper.source} paused={paused} bare />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0.3),transparent_35%)]" />

      <div className="absolute left-3 top-3 flex max-w-[calc(100%-6.5rem)] items-center gap-2 rounded-lg bg-black/45 px-2.5 py-1.5 backdrop-blur-sm">
        <IconImage className="h-4 w-4 shrink-0 text-white/75" />
        <span className="truncate font-mono text-[10px] text-white/90" title={wallpaperName}>
          {wallpaperName}
        </span>
      </div>

      {/* Wallpaper quick-actions.

          Hover-only, because this is a picture and these are not the point of
          it. Two uppercase mono labels permanently pinned over the top-right of
          a wallpaper is the loudest thing on the card, and the card is called
          "Now playing" — the picture is the content, the buttons are a
          utility. The gallery tiles set the precedent: the same reveal on
          hover, on keyboard focus, and while the tile is selected.

          `focus-within` rather than hover alone. `opacity-0` does not remove a
          button from the tab order, so without it these two would be reachable
          by Tab and completely invisible while focused — the one state a control
          must never be in.

          `OVERLAY_ICON_BTN` rather than a local style. It is the app's token for
          a control drawn over a picture, and its own comment records that the
          hand-rolled versions had drifted to two hit areas and three radii.
          These two were part of that drift: `rounded-lg` at one height, a
          `bg-black/45` scrim of their own, and an uppercase mono label that
          belongs to the card-header language, not the over-media one.

          The hierarchy is the other half of it. Pause takes the accent on
          hover, because pausing is the act you perform on this surface and it
          is reversible. Change is navigation — it leaves for the wallpaper tab
          — so it stays a plain scrim button. It used to be the filled accent
          one, which made the least-committal action in the row the loudest. */}
      <div className="absolute right-3 top-3 flex items-center gap-1.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/stage:opacity-100">
        <button
          onClick={onTogglePause}
          aria-label={paused ? t("common.resume-wallpaper") : t("common.pause-wallpaper")}
          title={paused ? t("common.resume-wallpaper") : t("common.pause-wallpaper")}
          className={`${OVERLAY_ICON_BTN} hover:!border-transparent hover:!bg-[rgb(var(--glow))] hover:!text-[#06121f]`}
        >
          {paused ? <IconPlay className="h-4 w-4" /> : <IconPause className="h-4 w-4" />}
        </button>
        <button
          onClick={onChange}
          aria-label={t("common.change-wallpaper")}
          title={t("common.change-wallpaper")}
          className={OVERLAY_ICON_BTN}
        >
          {/* Not IconImage, which is the chip on the left of this same row:
              the same glyph twice on one surface reads as one button drawn
              twice. And not IconNext either, which the transport row directly
              below uses for the next *track*. A chevron says "go there", which
              is exactly what this does. */}
          <IconChevronRight className="h-4 w-4" />
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
          <span className="truncate">
            {media.artist || t("overview.unknown-artist")}
          </span>
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
    const f = (e.clientX - rect.left) / rect.width;
    return positionFromFraction(f, duration);
  };
  useEffect(() => {
    if (duration <= 0) return;
    let raf = 0;
    const start = performance.now();
    // The sample may already be a beat old by the time it reaches us —
    // include that skew so the bar starts at the true position.
    const basePos = skewedPosition(
      media.positionSec,
      duration,
      media.playing,
      Date.now() - (media.positionUpdatedMs || Date.now()),
    );
    const paint = (pos: number) => {
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${progressFraction(pos, duration)})`;
      }
      if (timeRef.current) {
        const next = formatDuration(pos);
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
        aria-label={t("common.seek")}
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
        {formatDuration(duration)}
      </span>
    </div>
  );
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
  const { pending, run } = usePending();
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
  // A scrub produces a legitimate run of successive writes (pointerup, keyup,
  // blur all commit), so this one is deliberately *not* guarded: refusing the
  // second write would leave the slider showing a volume the system never got.
  const commit = (v: number) => {
    setVol(v);
    void api.volumeSet(v).catch(() => {});
  };
  // The mute button is a discrete press, so it takes the guard: two clicks in
  // one frame means mute-then-unmute, which is not what anyone means.
  const toggleMute = () => {
    void run("mute", () => api.volumeMuteToggle().then((next) => setMuted(next)));
  };
  if (shown == null) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5" title={t("common.system-volume")}>
      <button
        aria-label={t(muted ? "common.unmute" : "common.mute")}
        onClick={toggleMute}
        aria-busy={pending.has("mute") || undefined}
        className={`${ICON_BTN} ${
          muted
            ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
            : ICON_BTN_IDLE
        }`}
      >
        {pending.has("mute") ? (
          <IconSpinner className="h-3.5 w-3.5" />
        ) : muted || shown === 0 ? (
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
        // No height override. `h-1` made the input 4px tall, but the shared
        // range CSS sizes the input to 22px precisely so the 16px thumb, hung
        // on the 3px track with `margin-top: -6.5px`, has somewhere to sit. At
        // 4px the thumb was clipped into a cropped square — which read as a
        // broken control rather than a compact one.
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
  // One control at a time across the whole row: a second press while the
  // first is unresolved reads as the key sticking, not as a queue, and SMTC
  // answers slowly enough that two in flight can land in the wrong order.
  const { pending, run } = usePending({ exclusive: true });
  // Mirror of the props for the confirmation wait, which outlives the render
  // that started it: the SMTC sampler ticks at 1 Hz, so the state that proves
  // the command landed arrives long after `send` captured its "before".
  const latest = useRef<MediaSnapshot>({ playing, trackKey, shuffle, repeat });
  latest.current = { playing, trackKey, shuffle, repeat };
  const [pulseId, setPulseId] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setPulseId((n) => n + 1);
  }, [trackKey]);
  // The pressed button drops its glyph for a spinner, and stays lit: the
  // disabled treatment is 30% opacity, which a hairline arc cannot survive. It
  // is not `disabled` either -- `run` already refuses the second click, and a
  // real disabled button would also lose its focus ring mid-press.
  const busy = pending.size > 0;
  const send = (action: TransportAction, call: () => Promise<unknown>) => {
    // Snapshot *now*: this is the state the command is meant to move.
    const before: MediaSnapshot = { playing, trackKey, shuffle, repeat };
    // The key stays held until the player proves it acted, not merely until the
    // OS accepted the request — so the guard and the spinner both mean "still
    // working". `waitForChange` always settles, so a sender that ignores the
    // command cannot wedge the row.
    void run(action, async () => {
      await call();
      await waitForChange(action, before, () => latest.current);
    });
  };
  const inert = (action: TransportAction) => busy && !pending.has(action);
  const glyph = (action: TransportAction, idle: ReactNode, size: string) =>
    pending.has(action) ? <IconSpinner className={size} /> : idle;
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
          aria-label={t("common.toggle-shuffle")}
          title={t(shuffleSupported ? "common.shuffle" : "common.shuffle-unavailable")}
          disabled={!shuffleSupported || inert("shuffle")}
          aria-busy={pending.has("shuffle")}
          onClick={() => void send("shuffle", () => api.mediaShuffle(!shuffle))}
          className={`${ICON_BTN} ${shuffle ? ICON_BTN_ACTIVE : ICON_BTN_IDLE}`}
        >
          <span key={String(shuffle)} className={shuffle ? "player-toggle-pop flex" : "flex"}>
            {glyph("shuffle", <IconShuffle className="h-4 w-4" />, "h-4 w-4")}
          </span>
        </button>
      )}
      <button
        aria-label={t("common.previous-track")}
        disabled={inert("previous")}
        aria-busy={pending.has("previous")}
        onClick={() => void send("previous", () => api.mediaTransport("previous"))}
        {...ripple(90)}
      >
        {glyph("previous", <IconPrevious className="h-4 w-4" />, "h-4 w-4")}
      </button>
      <button
        aria-label={t(playing ? "common.pause" : "common.play")}
        className={`${ICON_BTN} ${ICON_BTN_PRIMARY} ${pulseId > 0 ? "transport-pulse" : ""}`}
        disabled={inert("toggle")}
        aria-busy={pending.has("toggle")}
        onClick={() => void send("toggle", () => api.mediaTransport("toggle"))}
      >
        {/* key re-mounts the glyph on state flip, replaying the swap spin */}
        <span key={playing ? "pause" : "play"} className="player-icon-swap flex">
          {glyph("toggle", playing ? <IconPause className="h-5 w-5" /> : <IconPlay className="h-5 w-5" />, "h-5 w-5")}
        </span>
      </button>
      <button
        aria-label={t("common.next-track")}
        disabled={inert("next")}
        aria-busy={pending.has("next")}
        onClick={() => void send("next", () => api.mediaTransport("next"))}
        {...ripple(180)}
      >
        {glyph("next", <IconNext className="h-4 w-4" />, "h-4 w-4")}
      </button>
      {/* Repeat: cycles off -> track -> list. `on` = list repeat (accent);
          track repeat adds the "1" superscript, like every music app. */}
      {repeat !== undefined && (
        <button
          aria-label={t("common.cycle-repeat-mode")}
          title={t(
            repeatSupported
              ? repeat === 1
                ? "common.repeat-track"
                : repeat === 2
                  ? "common.repeat-queue"
                  : "common.repeat-off"
              : "common.repeat-unavailable",
          )}
          disabled={!repeatSupported || inert("repeat")}
          aria-busy={pending.has("repeat")}
          onClick={() => void send("repeat", () => api.mediaRepeat(repeat))}
          className={`relative ${ICON_BTN} ${(repeat ?? 0) > 0 ? ICON_BTN_ACTIVE : ICON_BTN_IDLE}`}
        >
          <span key={String(repeat)} className={(repeat ?? 0) > 0 ? "player-toggle-pop flex" : "flex"}>
            {glyph("repeat", <IconRepeat className="h-4 w-4" />, "h-4 w-4")}
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
 * The eight lighting modes, split into the two families they actually belong
 * to. As one flat row of eight pills they read as a wall of labels with no
 * hint of what any of them do; grouped, the split is the useful one — the
 * first group tracks the wallpaper, the second runs on its own.
 */
function ModePicker({
  mode,
  onSelect,
}: {
  mode: string;
  onSelect: (m: (typeof RGB_MODES)[number]["id"]) => void;
}) {
  const groups = [
    { id: "reactive", label: "lighting.follows-the-wallpaper" },
    { id: "animation", label: "lighting.runs-on-its-own" },
  ] as const;
  const active = RGB_MODES.find((m) => m.id === mode);
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.id}>
          <div className="kicker mb-1.5">{t(g.label)}</div>
          <Segmented
            label={t("common.{mode}-lighting-modes", { mode: t(g.label) })}
            // Only the group holding the active mode shows a pressed button;
            // the other has nothing selected, which is the honest state.
            value={active?.group === g.id ? active.id : ""}
            onChange={(v) => onSelect(v as RgbMode)}
            options={RGB_MODES.filter((m) => m.group === g.id).map((m) => ({
              id: m.id as string,
              label: t(m.label),
            }))}
          />
        </div>
      ))}
      {active && (
        <p className="text-xs leading-relaxed text-[var(--text-faint)]">{t(active.hint)}</p>
      )}
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
  // The list rows below each drive one IPC call, keyed by entity so two rows
  // can be in flight without blocking one another.
  const { pending, run } = usePending();

  if (!cfg) return null;

  const stickers = cfg.stickers;
  const visibleStickers = stickers.filter((s) => s.visible);
  const excluded = new Set(cfg.rgb.excludedDevices);
  const activeDevices = rgb.devices.filter((d) => !excluded.has(d.id));
  const ledActive = activeDevices.reduce((n, d) => n + d.leds, 0);
  const ledTotal = rgb.devices.reduce((n, d) => n + d.leds, 0);
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
        : t("common.nothing-applied");

  const togglePause = () => {
    if (!cfg) return;
    save((c) => (c.general.wallpaperEnabled = !c.general.wallpaperEnabled));
  };

  const hour = new Date().getHours();
  const greeting = t(
    hour < 5
      ? "overview.up-late"
      : hour < 12
        ? "overview.good-morning"
        : hour < 18
          ? "overview.good-afternoon"
          : "overview.good-evening",
  );
  const issues: string[] = [];
  if (!rgb.connected) issues.push(t("overview.openrgb-offline"));
  if (paused) issues.push(t("overview.wallpaper-paused"));
  if (!issues.length && !cfg.rgb.enabled)
    issues.push(t("overview.lighting-off"));

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
                {t("common.everything-running-{n}-devices-{leds}-leds-{st}", {
                  n: activeDevices.length,
                  leds: ledActive.toLocaleString(),
                  st: stickers.length,
                })}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RefreshBtn />
        </div>
      </div>
      {/* ===== row 1: now playing + engine ===== */}
      <div className="grid min-w-0 gap-5 xl:grid-cols-12">
        {/* Now playing — spans 5. Wallpaper stage on top, media + transport
            below, wallpaper context strip last. */}
        <Card
          title={t("common.now-playing")}
          icon={<IconWave />}
          className="xl:col-span-5"
          right={
            <Chip tone={media ? (media.playing ? "ok" : "idle") : paused ? "warn" : "idle"} pulse={!!media?.playing}>
              {t(
                media
                  ? media.playing
                    ? "overview.playing"
                    : "overview.paused-track"
                  : paused
                    ? "overview.wallpaper-paused"
                    : "overview.idle",
              )}
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
                <IconWave className="h-4 w-4 shrink-0" />
                {t("common.no-media-playing")}
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

        {/* Engine — spans 7. The device list is the hero: it carries the live
            LEDs, the device identity and the mute control in one place, so no
            other part of the card has to repeat the same counts. */}
        <Card
          title={t("common.lighting-engine")}
          icon={<IconBulb />}
          className="xl:col-span-7"
          right={
            <div className="flex min-w-0 shrink items-center gap-2.5">
              {rgb.devices.length > 0 && (
                <span className="hidden min-w-0 truncate font-mono text-[10px] text-[var(--text-faint)] lg:inline">
                  {t("common.{active}-{total}-devices-{led}-{totalleds}-leds", {
                    active: activeDevices.length,
                    total: rgb.devices.length,
                    led: ledActive.toLocaleString(),
                    totalLeds: ledTotal.toLocaleString(),
                  })}
                </span>
              )}
              <Chip tone={rgb.connected ? "ok" : "danger"} pulse={rgb.connected}>
                {rgb.connected ? t("common.connected") : t("common.offline")}
              </Chip>
              {/* Bare here on purpose. The card header already says
                  "Lighting engine", so a visible label would only repeat it —
                  and that repetition is what overflowed the header and made
                  the card clip every switch down its right edge. The
                  accessible name comes from the tooltip instead, and it is
                  this switch rather than a device's mute switch because the
                  header and the chip beside it describe the whole engine. */}
              <SwitchBtn
                checked={cfg.rgb.enabled}
                onChange={(v) => save((c) => (c.rgb.enabled = v))}
                disabled={!rgb.connected}
                title={t("common.master-lighting-switch")}
              />
            </div>
          }
        >
          <div
            // `min-w-0` down this chain: a grid or flex item's automatic
            // minimum size is its content width, so without a zero minimum
            // anywhere on the path the device list can widen the whole card
            // and the panel's `overflow-hidden` clips the switch off the end.
            className="relative min-w-0"
            style={{
              // Audio-reactive halo, matching the wallpaper stage.
              boxShadow: cfg.rgb.enabled
                ? "0 0 calc(6px + var(--al, 0) * 34px) rgb(var(--glow) / calc(0.05 + var(--al, 0) * 0.26 + var(--beat, 0) * 0.2))"
                : undefined,
            }}
          >
            {rgb.devices.length > 0 ? (
              <ul className="min-w-0 space-y-2">
                {rgb.devices.map((d) => (
                  <DeviceRow
                    key={d.id}
                    device={d}
                    live={deviceColors[d.id]}
                    muted={excluded.has(d.id)}
                    onToggleMute={() =>
                      save((cc) => {
                        const set = new Set(cc.rgb.excludedDevices);
                        if (set.has(d.id)) set.delete(d.id);
                        else set.add(d.id);
                        cc.rgb.excludedDevices = [...set];
                      })
                    }
                    deviceNames={cfg.rgb.deviceNames}
                    onRename={(name) =>
                      save((cc) => {
                        const names = { ...cc.rgb.deviceNames };
                        if (name) names[String(d.id)] = name;
                        else delete names[String(d.id)];
                        cc.rgb.deviceNames = names;
                      })
                    }
                  />
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--line-strong)] py-8 text-[var(--text-faint)]">
                <IconBulb className="h-5 w-5" />
                <span className="text-xs">
                  {rgb.connected
                    ? t("common.connected-but-no-devices-reported-yet")
                    : t("common.openrgb-is-offline")}
                </span>
                {!rgb.connected && (
                  <span className="font-mono text-[10px]">
                    {t("common.start-openrgb-then-refresh-from-the-lighting-tab")}
                  </span>
                )}
              </div>
            )}

            {!cfg.rgb.enabled && rgb.devices.length > 0 && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/45 backdrop-blur-[2px]">
                <span className="rounded-md bg-black/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-300">
                  {t("common.lighting-off")}
                </span>
              </div>
            )}
          </div>

          {/* control bar: brightness + speed sliders share one row */}
          <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-2">
            {cfg.rgb.enabled ? (
              <>
                <QuickSlider
                  icon={<IconSun className="h-4 w-4 shrink-0 text-[var(--text-faint)]" />}
                  value={Math.round(cfg.rgb.mixer.brightness * 100)}
                  onChange={(v) => save((c) => (c.rgb.mixer.brightness = v / 100))}
                  title={t("common.brightness")}
                />
                {isAnimatedMode && (
                  <QuickSlider
                    icon={<IconZap className="h-4 w-4 shrink-0 text-[var(--text-faint)]" />}
                    value={Math.round(cfg.rgb.animationSpeed * 50)}
                    onChange={(v) => save((c) => (c.rgb.animationSpeed = v / 50))}
                    title={t("common.animation-speed")}
                  />
                )}
              </>
            ) : (
              <span className="font-mono text-[10.5px] text-[var(--text-faint)]">
                {t("common.engine-off-flip-the-switch-to-wake-your-lights")}
              </span>
            )}

            {(nightOn || idleOn) && (
              <div className="ml-auto flex gap-1.5">
                {nightOn && (
                  <Chip tone="accent">
                    {`${t("common.night")} ${cfg.rgb.nightStart}–${cfg.rgb.nightEnd}`}
                  </Chip>
                )}
                {idleOn && (
                  <Chip tone="idle">
                    {t("common.idle-{n}s", { n: cfg.rgb.idleTimeoutSec })}
                  </Chip>
                )}
              </div>
            )}
          </div>

          {/* modes: grouped into the two families they belong to, with the
              active mode's description always visible rather than hover-only. */}
          <div className="mt-3.5">
            <ModePicker
              mode={cfg.rgb.mode}
              onSelect={(m) => save((c) => { c.rgb.enabled = true; c.rgb.mode = m; })}
            />
          </div>
        </Card>
      </div>

      {/* ===== row 2: displays + stickers ===== */}
      <div className="grid min-w-0 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <DisplaysCard compact />
        </div>
        <div className="xl:col-span-5">
          <Card title={t("common.stickers")} icon={<IconSticker />} right={
            stickers.length > 0 ? (
              <span className="font-mono text-[10px] text-[var(--text-faint)]">
                {t("common.{visible}-{total}-visible", {
                  visible: visibleStickers.length,
                  total: stickers.length,
                })}
              </span>
            ) : undefined
          }>
            {stickers.length === 0 ? (
              <button
                onClick={() => onNavigate("stickers")}
                className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-[var(--line-strong)] py-6 text-[var(--text-faint)] hover-glow"
              >
                <IconSticker className="h-5 w-5" />
                <span className="text-xs font-semibold">{t("common.place-your-first-sticker")}</span>
              </button>
            ) : (
              <div className="space-y-1.5">
                {stickers.slice(0, 4).map((s) => (
                  <button
                    key={s.id}
                    title={t(s.visible ? "overview.hide-this-sticker" : "overview.show-this-sticker")}
                    onClick={() => {
                      void run(`sticker-${s.id}`, () =>
                        api.updateSticker({ ...s, visible: !s.visible }),
                      );
                    }}
                    aria-busy={pending.has(`sticker-${s.id}`) || undefined}
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
                        {`${Math.round(s.w)}×${Math.round(s.h)} · ${t(s.onTop ? "overview.on-top" : "overview.wallpaper-layer")}`}
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
                    {t("common.{n}-more-manage-stickers", { n: stickers.length - 4 })}
                  </button>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ===== row 3: scenes + shortcuts ===== */}
      {scenes.length > 0 && (
        <div className="grid min-w-0 gap-5 xl:grid-cols-12">
          <Card title={t("common.scenes")} icon={<IconLayers />} className="xl:col-span-7" right={
            <button
              onClick={() => onNavigate("general")}
              className={MINI_BTN}
            >
              {t("common.manage")}
            </button>
          }>
            <div className="flex flex-wrap gap-2">
              {scenes.slice(0, 6).map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    void run(
                      `scene-${s.id}`,
                      () => api.sceneApply(s.id),
                      () => useStore.getState().toast("error", t("common.apply-failed")),
                    ).then((ok) => {
                      if (ok) {
                        useStore
                          .getState()
                          .toast("ok", t("common.scene-applied", { name: s.name }));
                      }
                    });
                  }}
                  aria-busy={pending.has(`scene-${s.id}`) || undefined}
                  className="group flex items-center gap-1.5 rounded-lg border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--text-dim)] hover-glow active:scale-[0.97]"
                >
                  <IconLayers className="h-4 w-4 text-[var(--text-faint)] transition-colors group-hover:text-[rgb(var(--glow))]" />
                  {s.name}
                </button>
              ))}
            </div>
          </Card>
          <Card title={t("common.shortcuts")} icon={<IconZap />} className="xl:col-span-5" right={
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)]">
              {t("common.press")}
            </span>
          }>
            <p className="mb-4 text-sm leading-relaxed text-[var(--text-dim)]">
              {t("common.every-corner-of-the-app-is-one-keystroke-away-no")}
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                t("common.ctrl-k-palette"),
                t("common.ctrl-1-4-tabs"),
                t("common.all-shortcuts"),
              ].map((s) => (
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
              {t("common.view-all-shortcuts")}
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
              label: t("common.lighting"),
              detail: rgb.connected
                ? t("common.{mode}-{leds}-leds", {
                    mode: cfg.rgb.mode,
                    leds: ledActive.toLocaleString(),
                  })
                : t("common.connect-openrgb"),
              Icon: IconBulb,
            },
            {
              id: "wallpaper",
              label: t("common.wallpaper"),
              detail: t("common.{n}-in-vault-{name}", {
                n: cfg.gallery.length,
                name: playlistOn ? t("common.rotating") : wallpaperName,
              }),
              Icon: IconImage,
            },
            {
              id: "stickers",
              label: t("common.stickers"),
              detail: stickers.length
                ? t("common.{visible}-{total}-visible", {
                    visible: visibleStickers.length,
                    total: stickers.length,
                  })
                : t("common.none-placed-yet"),
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
