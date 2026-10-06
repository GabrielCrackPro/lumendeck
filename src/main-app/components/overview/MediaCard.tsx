// The Now playing card's body: wallpaper stage, track identity, transport,
// progress and volume. The Card wrapper stays in OverviewTab (its header chip
// reads the same `media` the body does); everything inside it lives here.
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
import { ICON_BTN, ICON_BTN_IDLE, ICON_BTN_ACTIVE, ICON_BTN_PRIMARY } from "../ui";
import {
  formatDuration,
  nextSeekAnchor,
  positionFromFraction,
  progressFraction,
  sampleAgreesWithSeek,
  seekTarget,
  skewedPosition,
  type SeekKey,
} from "../player/mediaTime";
import { waitForChange, type MediaSnapshot, type TransportAction } from "../player/mediaPending";
import { volumeGlyph, type VolumeGlyph } from "../player/volumeGlyph";
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
  const mediaUrl = toMediaSrc(source, (path) => convertFileSrc(path, "media"));
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

/**
 * Top stage of the Now playing card: the live wallpaper, full-bleed, with the
 * wallpaper name and its quick-actions in a row beneath it.
 *
 * The name and the two actions used to be chrome over the picture, revealed by
 * hover and by focus-within. That treatment is right for artwork and wrong for
 * a name: a label that vanishes when the pointer leaves is a hover hint, and
 * the one thing a reader could not do without it was answer "which wallpaper
 * is this" while looking at it. The scrim that existed to make an overlaid
 * chip legible went with the overlay — it darkened the top third of an image
 * the user chose for the rest of the time, for nothing.
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
    <>
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
        {/* One badge, in one place: a frozen picture is otherwise
            indistinguishable from a still frame, and the old thumb reported a
            paused wallpaper three other ways on three other screens. */}
        {paused && (
          <span className="absolute left-3 top-3 rounded-md bg-black/55 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-amber-300 backdrop-blur-sm">
            {t("common.paused")}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <IconImage className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" />
        {/* The chip is `truncate`, so the tooltip is the only way to read a long
            filename in full. It is the app's tooltip rather than the browser's
            grey system box, and the name stays a label: it is not a control, so
            a hover state would promise an action it does not have. */}
        <span
          className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-[var(--text-dim)]"
          data-tip={wallpaperName}
        >
          {wallpaperName}
        </span>
        <button
          onClick={onTogglePause}
          aria-label={paused ? t("common.resume-wallpaper") : t("common.pause-wallpaper")}
          data-tip={paused ? t("common.resume-wallpaper") : t("common.pause-wallpaper")}
          className={`${ICON_BTN} ${ICON_BTN_IDLE}`}
        >
          {paused ? <IconPlay className="h-4 w-4" /> : <IconPause className="h-4 w-4" />}
        </button>
        <button
          onClick={onChange}
          aria-label={t("common.change-wallpaper")}
          data-tip={t("common.change-wallpaper")}
          className={`${ICON_BTN} ${ICON_BTN_IDLE}`}
        >
          {/* Not IconImage, which is the glyph naming this same wallpaper at the
              left of this same row: the same glyph twice on one surface reads as
              one button drawn twice. And not IconNext either, which the transport
              row of the card this sits in uses for the next *track*. A chevron
              says "go there", which is exactly what this does. */}
          <IconChevronRight className="h-4 w-4" />
        </button>
      </div>
    </>
  );
}

/**
 * Inline equalizer bars. Each bar reads its own `--eq0..--eq3` variable,
 * which the audio loop writes from the transient engine every frame. There is
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

/** CSS variable each equalizer bar reads, bass first. */
const EQ_BAR_VARS = ["--eq0", "--eq1", "--eq2", "--eq3"] as const;

/**
 * The speaker glyph per volume state.
 *
 * A lookup rather than a ternary chain because the two states are chosen by a
 * tested function elsewhere; this only says which icon draws which answer.
 */
const VOLUME_GLYPHS: Record<VolumeGlyph, typeof IconVolumeHigh> = {
  off: IconVolumeOff,
  low: IconVolumeLow,
  high: IconVolumeHigh,
};

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
    // `aria-live` on the title only: this block is re-keyed per track, so the
    // swap is announced without touching the artist, the artwork or the
    // equalizer, which would otherwise read as several separate changes.
    <div className="track-slide flex min-w-0 flex-1 items-center gap-3 rounded-lg">
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {media.title}
      </span>
      {/* Song image with the playing app's icon woven into the corner:
          the icon sits inset on the art with a ring that separates it from
          any artwork. Playing state reads from the EqBars next to the tile,
          so no status dot is needed on the image itself. */}
      <div
        className="relative shrink-0"
        style={{ transform: beatScale }}
        data-tip={media.appId}
      >
        {media.art ? (
          <img
            src={media.art}
            alt=""
            /* 72 rather than 64: the art is the only image in the player, and
               the player is the focal block under the stage, so the tile it
               leads with should read at that size. */
            className="h-[72px] w-[72px] rounded-[var(--radius-lg)] border border-[var(--line-strong)] object-cover shadow-[0_4px_14px_-6px_rgb(0_0_0/0.55)]"
          />
        ) : (
          <div className="flex h-[72px] w-[72px] items-center justify-center rounded-[var(--radius-lg)] border border-[var(--line-strong)] bg-[var(--panel)]">
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
  // The thumb follows the fill's own painted position rather than the last
  // sample. Both used to be positioned independently: the fill advanced every
  // frame while the thumb sat on `media.positionSec`, which is a ~1 Hz sample
  // and does not move between them -- so on hover the ball appeared at the
  // playhead and then fell behind it, never reaching the end of the bar.
  const thumbRef = useRef<HTMLSpanElement | null>(null);
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
  // Where keyboard seeks are measured from.
  //
  // Not the sampled position: SMTC ticks at 1 Hz, so every press in a held-key
  // burst would be computed from the same stale sample and the playhead would
  // move one step however many times the key went down. The anchor advances as
  // the presses land, and a fresh sample re-anchors it -- see `reanchor`.
  const seekAnchor = useRef(0);
  const reanchor = (pos: number) => {
    seekAnchor.current = nextSeekAnchor(pos, duration);
  };
  // A seek we have sent but the player has not reported back yet.
  const pendingSeek = useRef<{ pos: number; at: number } | null>(null);
  // Paints outside the rAF, so a seek moves the bar on the press rather than
  // up to a second later when the next sample lands.
  const paintRef = useRef<((pos: number) => void) | null>(null);
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
    // Each fresh sample is ground truth, so the keyboard anchor follows it --
    // but only once it has caught up with a seek we just sent. The OS player
    // applies the seek, not this app, so the next sample can still describe the
    // position from before it; re-anchoring on that would pull the anchor back
    // mid-burst and a held arrow key would stutter.
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
    };
    paintRef.current = paint;
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
      // Same owner as the fill: while the pointer is down the scrub decides,
      // and leaving the thumb to the rAF would let the two disagree mid-drag.
      if (thumbRef.current) {
        thumbRef.current.style.left = `${duration > 0 ? (pos / duration) * 100 : 0}%`;
      }
      if (timeRef.current) {
        const total = Math.floor(pos);
        timeRef.current.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
      }
    };
    const onUp = (e: PointerEvent) => {
      const pos = posFromEvent(e);
      setScrub(null);
      // Same reasoning as the keyboard path: the release should already look
      // like it landed, and the next sample should not yank the bar backwards.
      pendingSeek.current = { pos, at: Date.now() };
      reanchor(pos);
      paintRef.current?.(pos);
      void api.mediaSeek(pos).catch(() => {});
    };
    // A cancelled drag -- the window losing the pointer, a touch being taken
    // over by a scroll -- never reaches `pointerup`. Without this the row stayed
    // stuck in scrubbing for the rest of the session: the thumb pinned wherever
    // it was left, the elapsed time tinted as though held, and the bar refusing
    // to look like the track it is describing. Dropping the scrub lets the rAF
    // repaint from ground truth, and seeks nothing, because the gesture was
    // abandoned rather than completed.
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
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <span
        ref={timeRef}
        // w-11, not the w-9 it was: `formatDuration` emits "1:02:03" for an
        // hour-long track -- the case that module's comment calls out by name --
        // and seven monospace characters do not fit in thirty-six pixels. The
        // column was clipping the leading hour of exactly the tracks most likely
        // to be scrubbed through.
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
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(scrub ?? media.positionSec)}
        // Without this a screen reader announces the bare number of seconds --
        // "742" -- where every other player in the OS announces "12:22 of
        // 48:03". `aria-valuenow` stays for the range semantics.
        aria-valuetext={`${formatDuration(scrub ?? media.positionSec)} / ${formatDuration(duration)}`}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setScrub(posFromEvent(e));
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
          // The bar scrolls the page sideways on an unmodified arrow press, which
          // on a dashboard this size means the whole layout shifting under a
          // keyboard user who cannot see why.
          e.preventDefault();
          const target = seekTarget(seekAnchor.current, duration, key);
          reanchor(target);
          // Record it before sending, and paint it now: waiting for the next
          // sample left the bar where it was for up to a second, so the key read
          // as unresponsive even though the seek had already been sent.
          pendingSeek.current = { pos: target, at: Date.now() };
          paintRef.current?.(target);
          void api.mediaSeek(target).catch(() => {});
        }}
        // The focus ring is the reason this is not a bare div: it is focusable
        // and answers the keyboard, so it has to show where the keyboard is.
        // `focus-visible` keeps it off mouse presses, which already have the
        // hover growth to show they landed.
        className="group relative h-1 min-w-0 flex-1 cursor-pointer rounded-full bg-[var(--line-strong)] outline-none transition-[height] before:absolute before:-inset-y-3 before:inset-x-0 before:content-[''] hover:h-1.5 focus-visible:h-1.5 focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.6)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel)]"
      >
        <span
          ref={fillRef}
          className="absolute inset-0 origin-left rounded-full bg-[rgb(var(--glow))] shadow-[0_0_6px_rgb(var(--glow)/0.6)]"
          style={{ transform: "scaleX(0)" }}
        />
        {/* Thumb: hidden until hover or scrub. Positioned by the same code that
            paints the fill, so it always sits at the end of the bar it is
            riding rather than at the last backend sample. */}
        <span
          ref={thumbRef}
          className={`absolute left-0 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgb(var(--glow))] shadow-[0_0_8px_rgb(var(--glow)/0.8)] transition-opacity ${
            scrub != null ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        />
      </span>
      <span className="w-11 shrink-0 font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
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
    <div className="flex shrink-0 items-center gap-1.5" data-tip={t("common.system-volume")}>
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
        ) : (
          (() => {
            const Glyph = VOLUME_GLYPHS[volumeGlyph(muted, shown)];
            // h-3.5 rather than the hard-coded 14px the hand-drawn paths used:
            // the icon library sizes from its container, and every sibling icon
            // in this row is already on the h-3.5/h-4 scale.
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
          data-tip={t(shuffleSupported ? "common.shuffle" : "common.shuffle-unavailable")}
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
          data-tip={t(
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
 * The Now playing card's body, extracted so OverviewTab reads as composition.
 *
 * Props, not store reads: the parent already holds every value, and a second
 * subscription per card is how the tab ends up repainting itself on state the
 * header strip also renders.
 */
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
    <>
          <WallpaperStage
            cfg={cfg}
            paused={paused}
            wallpaperName={wallpaperName}
            onTogglePause={onTogglePause}
            onChange={onChange}
          />

            {/* The player, inside this card rather than boxed inside it.

                It was given a bordered, filled "console" of its own, which made
                one card look like two: a small panel sitting inside a larger one,
                with its own radius and its own border, competing with the card's
                rather than joining it. The card is already titled "Now playing
                and live wallpaper" -- it is one thing, and the player is part of
                it.

                So the chrome is gone and the grouping is carried by space and one
                hairline instead. A timeline pinned to the card's bottom edge is
                what finally makes it read as one surface: it spans the same width
                as the stage above it, which is the alignment that says these
                belong together. */}
            <div className="mt-3">
              {media ? (
                /* Vertical, so the transport centres under the identity instead
                   of trailing off to the right of it. The card is five columns
                   of twelve; side by side, the buttons had nowhere to go.
                   `track-swap` stays on the wrapper so the track-change flash
                   still crosses both, which is what made it read as one event
                   rather than a title changing behind some buttons. */
                <div
                  key={`${media.title}—${media.artist}`}
                  className="track-swap flex min-w-0 flex-col gap-3"
                >
                  <TrackIdentity
                    media={media}
                    beatScale="scale(calc(1 + var(--beat, 0) * 0.045))"
                  />
                  <div className="flex items-center justify-center">
                    <TransportButtons
                      playing={media.playing}
                      trackKey={`${media.title}—${media.artist}`}
                      shuffle={media.shuffle}
                      repeat={media.repeat}
                    />
                  </div>
                </div>
              ) : (
                /* Centred and padded rather than left-aligned on an empty line,
                   so the player keeps its height when nothing is playing
                   instead of collapsing to a stray sentence under the stage. */
                <div className="flex min-w-0 items-center justify-center gap-2 py-2 font-mono text-[10.5px] text-[var(--text-faint)]">
                  <IconWave className="h-4 w-4 shrink-0" />
                  {t("common.no-media-playing")}
                </div>
              )}

              {/* The timeline gets the whole width. It is the one control here
                  whose precision matters, and it previously gave up 72px to the
                  volume slider sitting beside it. Hidden for senders with no
                  duration. */}
              {media && (
                <div className="mt-3">
                  <ProgressBar
                    key={`${media.title}—${media.artist}`}
                    media={media}
                  />
                </div>
              )}

              {/* System volume on its own line under a hairline, labelled on the
                  left. It is the only control in here that is not about the
                  track, and mixing it in with the playback row is what made that
                  row unreadable.

                  The label earns the width: right-aligned on its own it left a
                  band of dead space to the left of the button, so the row read as
                  an unfinished strip rather than a control. The string was
                  already in the catalog as the button's tooltip, so naming it
                  costs no new copy. */}
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
                <span className="truncate text-[11px] text-[var(--text-faint)]">
                  {t("common.system-volume")}
                </span>
                <VolumeControl />
              </div>
            </div>
    </>
  );
}
