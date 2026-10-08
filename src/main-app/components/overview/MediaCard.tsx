import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useStore } from "../../store";
import { api } from "../../ipc";
import { usePending } from "../../pending";
import { toMediaSrc } from "../mediaSrc";
import { convertFileSrc } from "@tauri-apps/api/core";
import { SHADER_ART } from "@shared/constants";
import type { Config, MediaInfo } from "@shared/types";
import {
  IconImage,
  IconPlay,
  IconPause,
  IconNext,
  IconPrevious,
  IconWave,
  IconChevronRight,
  IconMediaApp,
  IconShuffle,
  IconRepeat,
  IconSpinner,
  IconGlobe,
  IconLayers,
  IconVolumeOff,
  IconVolumeLow,
  IconVolumeHigh,
} from "../icons";
import { ICON_BTN, ICON_BTN_ACTIVE, ICON_BTN_PRIMARY, OVERLAY_ICON_BTN_ACCENT } from "../ui";
import {
  formatDuration,
  nextSeekAnchor,
  positionFromFraction,
  progressFraction,
  sampleAgreesWithSeek,
  seekTarget,
  seekTipPercent,
  skewedPosition,
  totalTimeLabel,
  type SeekKey,
} from "../player/mediaTime";
import { waitForChange, type MediaSnapshot, type TransportAction } from "../player/mediaPending";
import { volumeGlyph, type VolumeGlyph } from "../player/volumeGlyph";
import { t } from "../../i18n";

function WallpaperThumb({
  kind,
  source,
  paused,
  bare = false,
}: {
  kind: string;
  source: string;
  paused: boolean;
  bare?: boolean;
}) {
  const mediaUrl = toMediaSrc(source, (path) => convertFileSrc(path, "media"));
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onVis = () => {
      if (document.hidden) {
        if (!el.paused) {
          el.dataset.autoplaying = "1";
          el.pause();
        }
      } else if (!paused && el.dataset.autoplaying === "1") {
        delete el.dataset.autoplaying;
        el.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);
    if (document.hidden && !el.paused) el.pause();
    else if (!paused && el.paused) el.play().catch(() => {});
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [mediaUrl, paused]);
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
    </div>
  );
}

function WallpaperStage({
  cfg,
  paused,
  wallpaperName,
  onTogglePause,
  onChange,
  children,
}: {
  cfg: Config;
  paused: boolean;
  wallpaperName: string;
  onTogglePause: () => void;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <div className="group relative -m-4 h-[clamp(14rem,26cqw,22rem)] overflow-hidden rounded-b-[var(--radius-xl)] bg-black">
      <WallpaperThumb kind={cfg.wallpaper.kind} source={cfg.wallpaper.source} paused={paused} bare />

      <div
        className="absolute inset-x-0 top-0 flex items-center gap-2 bg-transparent px-3 py-2 opacity-0 transition-opacity duration-[var(--motion-slow)] ease-[var(--ease-standard)] group-hover:opacity-100 group-focus-within:opacity-100"
      >

        <span data-tip={wallpaperName}>
          <IconImage className="h-3.5 w-3.5 shrink-0 text-[rgb(var(--glow))] drop-shadow-[0_1px_2px_rgb(0_0_0/0.9)]" />
        </span>

        {paused && (
          <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-amber-300">
            {t("common.paused")}
          </span>
        )}

        <button
          onClick={onTogglePause}
          aria-label={paused ? t("common.resume-wallpaper") : t("common.pause-wallpaper")}
          data-tip={paused ? t("common.resume-wallpaper") : t("common.pause-wallpaper")}
          className={`ml-auto ${OVERLAY_ICON_BTN_ACCENT}`}
        >
          {paused ? <IconPlay className="h-4 w-4" /> : <IconPause className="h-4 w-4" />}
        </button>
        <button
          onClick={onChange}
          aria-label={t("common.change-wallpaper")}
          data-tip={t("common.change-wallpaper")}
          className={OVERLAY_ICON_BTN_ACCENT}
        >

          <IconChevronRight className="h-4 w-4" />
        </button>
      </div>

      {children && (
        <div className="absolute inset-x-0 bottom-0 p-3 bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] shadow-[inset_0_0_0_999px_rgb(var(--glow)/0.06)] backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-x-0 bottom-full h-16 bg-[linear-gradient(to_top,color-mix(in_srgb,var(--bg)_92%,transparent),transparent)]" />
          {children}
        </div>
      )}
    </div>
  );
}

function EqBars({ playing }: { playing: boolean }) {
  return (
    <span
      className="flex shrink-0 items-end gap-[2px] overflow-hidden transition-all duration-[var(--motion-slow)] ease-[var(--ease-standard)]"
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

const EQ_BAR_VARS = ["--eq0", "--eq1", "--eq2", "--eq3"] as const;

const VOLUME_GLYPHS: Record<VolumeGlyph, typeof IconVolumeHigh> = {
  off: IconVolumeOff,
  low: IconVolumeLow,
  high: IconVolumeHigh,
};

const PLAYER_BTN_IDLE =
  "border-transparent bg-transparent text-[var(--text-dim)] hover:border-[var(--line)] hover:bg-[var(--panel)] hover:text-[var(--text)]";

function TrackIdentity({
  media,
  beatScale,
}: {
  media: MediaInfo;
  beatScale: string;
}) {
  const [failedArt, setFailedArt] = useState<string | null>(null);
  const hasArt = !!media.art && failedArt !== media.art;
  return (
    <div className="track-slide flex min-w-0 flex-1 items-center gap-3 rounded-lg">
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {media.title}
      </span>

      <div
        className="relative h-16 w-16 shrink-0 overflow-visible"
        style={{ transform: beatScale }}
        data-tip={media.appId}
      >
        <div
          aria-hidden="true"
          className="relative h-full w-full overflow-hidden rounded-xl border border-[var(--line-strong)] bg-[radial-gradient(ellipse_at_75%_15%,rgb(var(--glow)/0.32),transparent_52%),linear-gradient(145deg,var(--panel-strong),var(--panel-sunken))] shadow-[0_5px_16px_-7px_rgb(0_0_0/0.7)]"
        >
          {hasArt ? (
            <img
              src={media.art ?? undefined}
              alt=""
              onError={() => setFailedArt(media.art ?? null)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <IconWave className="h-7 w-7 text-[rgb(var(--glow)/0.8)]" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgb(255_255_255/0.12),transparent_42%,rgb(0_0_0/0.18))]" />
        </div>
        {(media.appIcon || media.appId) && (
          <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center overflow-hidden rounded-md border border-[var(--panel-strong)] bg-[var(--panel)] shadow-[0_2px_7px_rgb(0_0_0/0.55)]">
            {media.appIcon ? (
              <img
                src={media.appIcon}
                alt=""
                className="h-full w-full object-contain"
              />
            ) : (
              <IconMediaApp app={media.appId} aria-label={media.appId} className="h-4 w-4 text-[var(--text)]" />
            )}
          </span>
        )}
      </div>
      <EqBars playing={media.playing} />
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              media.playing ? "bg-emerald-400" : "bg-[var(--text-faint)]"
            }`}
          />
          <span className="kicker">
            {t(media.playing ? "overview.now-playing" : "overview.paused-track")}
          </span>
        </div>
        <div
          className="truncate text-[15px] font-semibold leading-tight text-[var(--text)]"
          data-tip={`${media.title} — ${media.artist}`}
        >
          {media.title}
        </div>
        <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-[var(--text-faint)]">
          <span className="truncate">
            {media.artist || t("overview.unknown-artist")}
          </span>
          <span
            className="shrink-0 truncate text-[10.5px] text-[var(--text-faint)]/70"
            data-tip={media.appId}
          >
            {media.album && `· ${media.album}`}
          </span>
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ media }: { media: MediaInfo }) {
  const fillRef = useRef<HTMLSpanElement | null>(null);
  const thumbRef = useRef<HTMLSpanElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const totalRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const duration = media.durationSec;
  const trackKey = `${media.title}—${media.artist}`;
  const [scrub, setScrub] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(false);
  const remainingRef = useRef(false);
  remainingRef.current = remaining;
  const barRef = useRef<HTMLSpanElement | null>(null);
  const posFromEvent = (e: PointerEvent | React.PointerEvent) => {
    const bar = barRef.current;
    if (!bar || duration <= 0) return 0;
    const rect = bar.getBoundingClientRect();
    const f = (e.clientX - rect.left) / rect.width;
    return positionFromFraction(f, duration);
  };
  const seekAnchor = useRef(0);
  const reanchor = (pos: number) => {
    seekAnchor.current = nextSeekAnchor(pos, duration);
  };
  const pendingSeek = useRef<{ pos: number; at: number } | null>(null);
  const paintRef = useRef<((pos: number) => void) | null>(null);
  useEffect(() => {
    if (duration <= 0) return;
    let raf = 0;
    const start = performance.now();
    const basePos = skewedPosition(
      media.positionSec,
      duration,
      media.playing,
      Date.now() - (media.positionUpdatedMs || Date.now()),
    );
    const pending = pendingSeek.current;
    if (
      sampleAgreesWithSeek(basePos, pending?.pos ?? null, Date.now() - (pending?.at ?? 0))
    ) {
      reanchor(basePos);
    }
    const paint = (pos: number) => {
      const fraction = progressFraction(pos, duration);
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${fraction})`;
      }
      if (thumbRef.current) {
        thumbRef.current.style.left = `${fraction * 100}%`;
      }
      if (timeRef.current) {
        const next = formatDuration(pos);
        if (timeRef.current.textContent !== next) timeRef.current.textContent = next;
      }
      if (totalRef.current) {
        const nextTotal = totalTimeLabel(duration, pos, remainingRef.current);
        if (totalRef.current.textContent !== nextTotal) {
          totalRef.current.textContent = nextTotal;
        }
      }
    };
    paintRef.current = paint;
    const tick = () => {
      const elapsed = media.playing ? (performance.now() - start) / 1000 : 0;
      paint(Math.min(duration, basePos + elapsed));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [trackKey, duration, media]);
  useEffect(() => {
    if (scrub == null) return;
    const onMove = (e: PointerEvent) => {
      const pos = posFromEvent(e);
      setScrub(pos);
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${duration > 0 ? pos / duration : 0})`;
      }
      if (thumbRef.current) {
        thumbRef.current.style.left = `${duration > 0 ? (pos / duration) * 100 : 0}%`;
      }
      if (timeRef.current) {
        const total = Math.floor(pos);
        timeRef.current.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
      }
      if (totalRef.current) {
        totalRef.current.textContent = totalTimeLabel(
          duration,
          pos,
          remainingRef.current,
        );
      }
    };
    const onUp = (e: PointerEvent) => {
      const pos = posFromEvent(e);
      setScrub(null);
      pendingSeek.current = { pos, at: Date.now() };
      reanchor(pos);
      paintRef.current?.(pos);
      void api.mediaSeek(pos).catch(() => {});
    };
    const onCancel = () => setScrub(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrub != null, duration]);
  if (duration <= 0) return null;
  return (
    <div className="flex w-full min-w-0 items-center gap-2.5">
      <span
        ref={timeRef}
        className={`w-11 shrink-0 text-right font-mono text-[10px] tabular-nums ${
          scrub != null ? "text-[rgb(var(--glow))]" : "text-[var(--text-faint)]"
        }`}
      >
        0:00
      </span>
      <span
        ref={barRef}
        role="slider"
        aria-label={t("common.seek")}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(scrub ?? media.positionSec)}
        aria-valuetext={`${formatDuration(scrub ?? media.positionSec)} / ${formatDuration(duration)}`}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setScrub(posFromEvent(e));
        }}
        onPointerMove={(e) => {
          const tip = tipRef.current;
          if (!tip) return;
          const pos = posFromEvent(e);
          tip.textContent = formatDuration(pos);
          tip.style.left = `${seekTipPercent(progressFraction(pos, duration))}%`;
        }}
        onKeyDown={(e) => {
          const key: SeekKey | null =
            e.key === "ArrowRight"
              ? "right"
              : e.key === "ArrowLeft"
                ? "left"
                : e.key === "Home"
                  ? "home"
                  : e.key === "End"
                    ? "end"
                    : null;
          if (!key) return;
          e.preventDefault();
          const target = seekTarget(seekAnchor.current, duration, key);
          reanchor(target);
          pendingSeek.current = { pos: target, at: Date.now() };
          paintRef.current?.(target);
          void api.mediaSeek(target).catch(() => {});
        }}
        className="group relative h-7 min-w-0 flex-1 touch-none cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.6)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel)]"
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full transition-[height,background-color] duration-[var(--motion-fast)] ${
            scrub != null
              ? "h-2 bg-[var(--line-strong)]"
              : "h-1 bg-[var(--line)] group-hover:h-2 group-hover:bg-[var(--line-strong)] group-focus-visible:h-2 group-focus-visible:bg-[var(--line-strong)]"
          }`}
        >
          <span
            ref={fillRef}
            className={`absolute inset-0 origin-left rounded-full bg-[rgb(var(--glow))] transition-shadow duration-[var(--motion-fast)] ${
              scrub != null
                ? "shadow-[0_0_6px_rgb(var(--glow)/0.6)]"
                : "group-hover:shadow-[0_0_6px_rgb(var(--glow)/0.6)] group-focus-visible:shadow-[0_0_6px_rgb(var(--glow)/0.6)]"
            }`}
            style={{ transform: "scaleX(0)" }}
          />
        </span>

        <span
          ref={thumbRef}
          aria-hidden="true"
          className={`pointer-events-none absolute left-0 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--panel)] bg-[rgb(var(--glow))] shadow-[0_0_8px_rgb(var(--glow)/0.8)] transition-opacity ${
            scrub != null
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          }`}
        />

        <span
          ref={tipRef}
          aria-hidden="true"
          style={{ left: "50%" }}
          className={`pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--line-strong)] bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[var(--text)] shadow-[0_4px_12px_rgb(0_0_0/0.4)] backdrop-blur-md transition-opacity ${
            scrub != null ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          0:00
        </span>
      </span>

      <button
        type="button"
        onClick={() => setRemaining((v) => !v)}
        aria-label={t("common.toggle-remaining-time")}
        data-tip={t("common.toggle-remaining-time")}
        className={`w-11 shrink-0 cursor-pointer text-right font-mono text-[10px] tabular-nums underline underline-offset-2 transition-colors focus-glow ${
          remaining
            ? "text-[rgb(var(--glow))]"
            : "text-[var(--text-faint)] hover:text-[var(--text)]"
        }`}
      >
        <span ref={totalRef}>
          {totalTimeLabel(duration, media.positionSec, remaining)}
        </span>
      </button>
    </div>
  );
}


function VolumeControl() {
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
    setLive(null);
  }, [event]);
  const commit = (v: number) => {
    setVol(v);
    void api.volumeSet(v).catch(() => {});
  };
  const toggleMute = () => {
    void run("mute", () => api.volumeMuteToggle().then((next) => setMuted(next)));
  };
  if (shown == null) return null;
  return (
    <div
      role="group"
      aria-label={t("common.system-volume")}
      className="flex shrink-0 items-center gap-2"
      data-tip={t("common.system-volume")}
    >
      <button
        aria-label={t(muted ? "common.unmute" : "common.mute")}
        data-tip={t(muted ? "common.unmute" : "common.mute")}
        aria-pressed={muted}
        onClick={toggleMute}
        aria-busy={pending.has("mute") || undefined}
        className={`${ICON_BTN} h-9 w-9 ${
          muted
            ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
            : PLAYER_BTN_IDLE
        }`}
      >
        {pending.has("mute") ? (
          <IconSpinner className="h-3.5 w-3.5" />
        ) : (
          (() => {
            const Glyph = VOLUME_GLYPHS[volumeGlyph(muted, shown)];
            return <Glyph className="h-3.5 w-3.5" />;
          })()
        )}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={shown}
        aria-label={t("common.system-volume")}
        aria-valuetext={`${shown}%`}
        style={{ "--fill": `${shown}%`, width: "clamp(5.5rem, 10cqw, 7rem)" } as CSSProperties}
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
      <span className="min-w-9 shrink-0 rounded-md px-1 text-right font-mono text-[10px] font-medium tabular-nums text-[var(--text-dim)]">
        {shown}%
      </span>
    </div>
  );
}

function TransportButtons({
  playing,
  trackKey,
  shuffle,
  repeat,
}: {
  playing: boolean;
  trackKey: string;
  shuffle?: boolean | null;
  repeat?: 0 | 1 | 2 | null;
}) {
  const shuffleSupported = shuffle !== null;
  const repeatSupported = repeat !== null;
  const { pending, run } = usePending({ exclusive: true });
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
  const busy = pending.size > 0;
  const send = (action: TransportAction, call: () => Promise<unknown>) => {
    const before: MediaSnapshot = { playing, trackKey, shuffle, repeat };
    void run(action, async () => {
      await call();
      await waitForChange(action, before, () => latest.current);
    });
  };
  const inert = (action: TransportAction) => busy && !pending.has(action);
  const glyph = (action: TransportAction, idle: ReactNode, size: string) =>
    pending.has(action) ? <IconSpinner className={size} /> : idle;
  const ripple = (delayMs: number) =>
    pulseId > 0
      ? { style: { animationDelay: `${delayMs}ms` } }
      : {};
  return (
    <div
      key={pulseId}
      role="group"
      aria-label={t("overview.playback-controls")}
      className="flex min-w-0 items-center gap-1.5"
    >
      {shuffle !== undefined && (
        <button
          aria-label={t("common.toggle-shuffle")}
          data-tip={t(shuffleSupported ? "common.shuffle" : "common.shuffle-unavailable")}
          aria-pressed={shuffleSupported ? shuffle : undefined}
          disabled={!shuffleSupported || inert("shuffle")}
          aria-busy={pending.has("shuffle")}
          onClick={() => void send("shuffle", () => api.mediaShuffle(!shuffle))}
          className={`${ICON_BTN} h-9 w-9 ${shuffle ? ICON_BTN_ACTIVE : PLAYER_BTN_IDLE}`}
        >
          <span key={String(shuffle)} className={shuffle ? "player-toggle-pop flex" : "flex"}>
            {glyph("shuffle", <IconShuffle className="h-4 w-4" />, "h-4 w-4")}
          </span>
        </button>
      )}
      <button
        aria-label={t("common.previous-track")}
        data-tip={t("common.previous-track")}
        disabled={inert("previous")}
        aria-busy={pending.has("previous")}
        onClick={() => void send("previous", () => api.mediaTransport("previous"))}
        {...ripple(90)}
        className={`${ICON_BTN} h-9 w-9 ${PLAYER_BTN_IDLE} ${pulseId > 0 ? "transport-pulse" : ""}`}
      >
        {glyph("previous", <IconPrevious className="h-4 w-4" />, "h-4 w-4")}
      </button>
      <button
        aria-label={t(playing ? "common.pause" : "common.play")}
        data-tip={t(playing ? "common.pause" : "common.play")}
        className={`${ICON_BTN} h-10 w-10 ${ICON_BTN_PRIMARY} ${pulseId > 0 ? "transport-pulse" : ""}`}
        disabled={inert("toggle")}
        aria-busy={pending.has("toggle")}
        onClick={() => void send("toggle", () => api.mediaTransport("toggle"))}
      >

        <span key={playing ? "pause" : "play"} className="player-icon-swap flex">
          {glyph("toggle", playing ? <IconPause className="h-5 w-5" /> : <IconPlay className="h-5 w-5" />, "h-5 w-5")}
        </span>
      </button>
      <button
        aria-label={t("common.next-track")}
        data-tip={t("common.next-track")}
        disabled={inert("next")}
        aria-busy={pending.has("next")}
        onClick={() => void send("next", () => api.mediaTransport("next"))}
        {...ripple(180)}
        className={`${ICON_BTN} h-9 w-9 ${PLAYER_BTN_IDLE} ${pulseId > 0 ? "transport-pulse" : ""}`}
      >
        {glyph("next", <IconNext className="h-4 w-4" />, "h-4 w-4")}
      </button>

      {repeat !== undefined && (
        <button
          aria-label={t("common.cycle-repeat-mode")}
          data-tip={t(
            repeatSupported
              ? repeat === 1
                ? "common.repeat-track"
                : repeat === 2
                  ? "common.repeat-queue"
                  : "common.repeat-off"
              : "common.repeat-unavailable",
          )}
          aria-pressed={repeatSupported ? repeat > 0 : undefined}
          disabled={!repeatSupported || inert("repeat")}
          aria-busy={pending.has("repeat")}
          onClick={() => void send("repeat", () => api.mediaRepeat(repeat))}
          className={`relative ${ICON_BTN} h-9 w-9 ${(repeat ?? 0) > 0 ? ICON_BTN_ACTIVE : PLAYER_BTN_IDLE}`}
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

export default function MediaCardBody({
  cfg,
  paused,
  wallpaperName,
  media,
  onTogglePause,
  onChange,
}: {
  cfg: Config;
  paused: boolean;
  wallpaperName: string;
  media: MediaInfo | null;
  onTogglePause: () => void;
  onChange: () => void;
}) {
  return (
    <WallpaperStage
      cfg={cfg}
      paused={paused}
      wallpaperName={wallpaperName}
      onTogglePause={onTogglePause}
      onChange={onChange}
    >

      {media && (
        <div className="flex min-w-0 flex-col gap-2">

          <div
            key={`${media.title}—${media.artist}`}
            className="track-swap flex min-w-0"
          >
            <TrackIdentity
              media={media}
              beatScale="scale(calc(1 + var(--beat, 0) * 0.045))"
            />
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <TransportButtons
              playing={media.playing}
              trackKey={`${media.title}—${media.artist}`}
              shuffle={media.shuffle}
              repeat={media.repeat}
            />
            <VolumeControl />
          </div>
          {media.durationSec > 0 && (
            <div className="-mx-3 -mb-1 mt-2 px-2">
              <ProgressBar
                key={`${media.title}—${media.artist}`}
                media={media}
              />
            </div>
          )}
        </div>
      )}
    </WallpaperStage>
  );
}
