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
import { ICON_BTN, ICON_BTN_IDLE, ICON_BTN_ACTIVE, ICON_BTN_PRIMARY, OVERLAY_ICON_BTN_ACCENT } from "../ui";
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
 * Top stage of the Now playing card: the live wallpaper as the card's whole
 * surface, with the wallpaper's own identity and controls sitting over the top
 * edge and the player docked at the bottom.
 *
 * The picture and the player used to be separate stacked bands, which read as
 * a list of rows rather than one thing. Both strips now sit ON the picture —
 * the player at its bottom (always drawn), and the wallpaper identity rail at
 * its top, which is the one strip that hides until the reader asks for it.
 *
 * The wallpaper name is not printed on the picture at all. It used to ride the
 * rail in 10.5px of accent type and it lost: over a bright frame no amount of halo
 * makes a filename readable, and the fix for that — a scrim — darkens a picture the
 * user chose for the rest of the time. What is left of the name is its tooltip on
 * the rail's glyph (dark panel, legible, one hover away) and the jump link at the
 * foot of the tab; the card itself stays clear. The track identity lower down is
 * the opposite call and deliberately so — a reader should be able to scan the dock
 * for a title without parking a pointer on one glyph, so that rail is always drawn
 * and the dock has a frosted surface to print on.
 *
 * The rail itself is transparent: no frost of --bg, no blur, no accent wash, so a
 * reader sees the picture through it untouched until it is fully revealed and the
 * picture's own colour reaches the glyph and the controls directly rather than
 * through a tint. That is the trade the design accepts — nothing on the rail is
 * made legible by a scrim, which is affordable now that nothing on it is copy.
 * The rail's own seam gradient went for the same reason — read from the page it
 * was a shadow band drawn across the wallpaper, not a transition. The dock keeps
 * its dissolve because it is a filled strip meeting the picture; copy never sits
 * on a gradient.
 *
 * The reveal is a single shared transition: opacity on the rail, driven by one
 * `group` on the frame, so hover on the picture and focus-within on the stage both
 * pull it in together.
 *
 * The frame is not a panel *inside* the card: it cancels the Card primitive's
 * p-4 with a -m-4 so its edges meet the card's own border, carries no border
 * of its own, and rounds only its bottom corners to match. A bordered, rounded
 * box sitting in the card's padding is what makes one card read as two — the
 * card this lives in is already the frame.
 */
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
  /** The docked player: identity, transport, timeline and volume. */
  children: ReactNode;
}) {
  return (
    // Deliberately no halo on this stage. It bleeds to the card's own edge via
    // `-m-4`, so the audio-reactive glow it used to draw now lands *outside*
    // the card and reads as a drop shadow on it. The engine card keeps its halo
    // because its box sits inside the card's padding; bringing that glow back
    // here is what made the top card look like it had a shadow.
    <div className="group relative -m-4 h-[350px] overflow-hidden rounded-b-[var(--radius-xl)] bg-black">
      <WallpaperThumb kind={cfg.wallpaper.kind} source={cfg.wallpaper.source} paused={paused} bare />
      {/* Wallpaper identity rail, revealed on hover over the picture and on
          focus-within (keyboard). The rail is the picture's own chrome — the glyph
          carrying its filename as a tooltip, the paused badge, and the two controls
          that belong to the wallpaper rather than the track — so it lives with the
          picture rather than in the track dock lower down.

          Hidden at rest on purpose: it is a strip of controls the hero earns on
          hover/focus, not furniture the card carries regardless. The track identity
          lower in the dock is the always-drawn one, because a reader needs a title
          to scan for without parking a pointer on one glyph.

          Single shared transition on the rail itself (opacity), driven by one `group`
          on the frame, so hover on the picture and focus-within on the stage both pull
          it in together. No seam follows the rail out: the gradient that used to
          hang below it read as a shadow band across the picture, so the strip now
          ends where it ends.

          The rail's glyph and its two controls take the accent rather than the panel's
          faint/dim greys: there is no panel chrome over the picture to read against, so
          the strip borrows the colour the rest of the UI uses for "this is what you are
          acting on" — the glyph and both buttons in one accent register. The
          paused badge stays amber: it reports a state, not an identity, and an accent
          badge would read as "the wallpaper is on" rather than "it stopped". */}
      <div
        className="absolute inset-x-0 top-0 flex items-center gap-2 bg-transparent px-3 py-2 opacity-0 transition-opacity duration-[var(--motion-slow)] ease-[var(--ease-standard)] group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {/* The name rides the glyph rather than the picture. The printed label went
            because 10.5px of accent type over a bright wallpaper is not readable, and
            this tooltip is: dark panel, full filename, no length limit. It is the
            app's tooltip rather than the browser's grey box, and the span stays a
            label: it is not a control, so a hover state would promise an action it
            does not have. */}
        <span data-tip={wallpaperName}>
          <IconImage className="h-3.5 w-3.5 shrink-0 text-[rgb(var(--glow))] drop-shadow-[0_1px_2px_rgb(0_0_0/0.9)]" />
        </span>
        {/* One badge, in one place: a frozen picture is otherwise
            indistinguishable from a still frame, and the old thumb reported a
            paused wallpaper three other ways on three other screens. */}
        {paused && (
          <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-amber-300">
            {t("common.paused")}
          </span>
        )}
        {/* The wallpaper's own controls are the only buttons in this strip.
            The track is moved elsewhere, so the pause/play glyphs that belong to
            the picture stay with the picture. */}
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
          {/* Not IconImage, which is the glyph naming this same wallpaper at the
              left of this same row: the same glyph twice on one surface reads as
              one button drawn twice. And not IconNext either, which the transport
              row of the card this sits in uses for the next *track*. A chevron
              says "go there", which is exactly what this does. */}
          <IconChevronRight className="h-4 w-4" />
        </button>
      </div>
      {/* Player dock, docked onto the picture's bottom edge and dissolved into
          it: the gradient above this box carries the picture down into the
          frost so the dock grows out of the wallpaper instead of being pasted
          on. The inset glow wash is the accent bleeding into the player's own
          surface — half of the fusion, with the blur behind it. This is the only
          player surface in the card; the identity rail and the transport row both
          live inside it, so the dock is the frame for the track rather than a
          second framed box.

          p-3 is load-bearing for the timeline below: its side margins cancel the
          padding so the progress row runs the frame's full width, and its bottom
          margin gives four of the twelve back — the eight left over are the air
          that lets the row sit on the bottom edge without touching it. With no
          padding on the dock those negative margins would push the row past the
          stage's bottom, where this frame's own `overflow-hidden` clips it: the bar
          and both time labels would paint outside the frame and the reader would
          see nothing. */}
      <div className="absolute inset-x-0 bottom-0 p-3 bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] shadow-[inset_0_0_0_999px_rgb(var(--glow)/0.06)] backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-x-0 bottom-full h-16 bg-[linear-gradient(to_top,color-mix(in_srgb,var(--bg)_92%,transparent),transparent)]" />
        {children}
      </div>
    </div>
  );
}

/**
 * Inline equalizer bars. Each bar reads its own `--eq0..--eq3` variable, which the
 * audio loop writes from the transient engine every frame. There is deliberately no
 * height transition here: the engine already smooths the values, and a CSS transition
 * layered on top would lag a frame behind every write and blur the attack.
 *
 * Always mounted: `playing` collapses/expands the bars smoothly (width + opacity
 * transition) instead of popping the block in and out of the layout.
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
 * Track identity: artwork, app mark, title, artist and the EQ bars that read the
 * playing state. Keyed by title+artist, so a track change remounts the block and
 * replays the swap animation — the row flashes with the accent while the new title
 * slides in, and the rest of the dock does not get re-rendered for the same change.
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
            /* 56 rather than the 72 it was: the wallpaper is this card's hero
               image now, so the art is the tile beside the track's name — big
               enough to recognise an album, not so tall it inflates the dock. */
            className="h-14 w-14 rounded-[var(--radius-lg)] border border-[var(--line-strong)] object-cover shadow-[0_4px_14px_-6px_rgb(0_0_0/0.55)]"
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--line-strong)] bg-[var(--panel)]">
            <IconWave className="h-5 w-5 text-[var(--text-faint)]" />
          </div>
        )}
        {(media.appIcon || media.appId) && (
          <span className="absolute -bottom-1 -right-1">
            {media.appIcon ? (
              <img
                src={media.appIcon}
                alt=""
                className="h-6 w-6 rounded-md border border-[var(--panel-strong)] object-contain shadow-[0_1px_5px_rgb(0_0_0/0.45)]"
              />
            ) : (
              <span className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--panel-strong)] bg-black/60 shadow-[0_1px_5px_rgb(0_0_0/0.45)]">
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
 * samples the SMTC timeline at ~1Hz; between samples the position advances locally
 * (a CSS transform on a rAF, no React re-renders), and each fresh sample snaps the
 * bar back to ground truth — so seek/track changes show immediately. Hidden when the
 * sender reports no duration (radio, some web players); when paused it freezes
 * rather than disappearing.
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
  // The countdown label and the seek bubble. Both are written imperatively
  // from the rAF loop and the pointer handlers below, for the same reason
  // `timeRef` is: a React state per frame would re-render the row sixty times
  // a second to change two text nodes.
  const totalRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const duration = media.durationSec;
  const trackKey = `${media.title}—${media.artist}`;
  // Scrubbing: while dragging, the rAF stops owning the fill and the pointer
  // does; a seek is sent once on release. Skew-compensated play resumes from
  // the next backend sample, which snaps the bar back to ground truth.
  const [scrub, setScrub] = useState<number | null>(null);
  // Which the right-hand label reads: the track's total, or what is left of
  // it. The ref mirror exists because the rAF paint loop and the scrub handler
  // outlive the render that started them and would otherwise hold the first
  // answer for the whole track.
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
      // Same owner as the elapsed label: while the pointer is down the scrub
      // decides the countdown too, or the two labels disagree mid-drag.
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
    <div className="flex w-full min-w-0 items-center gap-2.5">
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
        // The bubble follows the pointer even at rest, so a hover can aim a
        // click at a second instead of guessing. Written straight to the DOM:
        // pointermove fires at the display's rate, and a React state here
        // would re-render the row that many times per second to move one node.
        // During a drag the same handler keeps firing — the pointer capture
        // above retargets the events to this element.
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
        // Thin at rest — h-1, half the height it grows to — so the row reads as
        // two times and a hairline at a glance and only becomes the scrubber when
        // the pointer or the keyboard asks for it: the growth *is* the affordance.
        // The pointer target does not shrink with it — `before:-inset-y-3` keeps it
        // at least 28px tall either way — so thin costs nothing to aim at.
        //
        // The focus ring is the reason this is not a bare div: it is focusable
        // and answers the keyboard, so it has to show where the keyboard is.
        // `focus-visible` keeps it off mouse presses, which already have the
        // hover growth to show they landed.
        className="group relative h-1 min-w-0 flex-1 cursor-pointer rounded-full bg-[var(--line-strong)] outline-none transition-[height] before:absolute before:-inset-y-3 before:inset-x-0 before:content-[''] hover:h-2 focus-visible:h-2 focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.6)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel)]"
      >
        <span
          ref={fillRef}
          className="absolute inset-0 origin-left rounded-full bg-[rgb(var(--glow))] shadow-[0_0_6px_rgb(var(--glow)/0.6)]"
          style={{ transform: "scaleX(0)" }}
        />
        {/* Thumb: riding the playhead while the track plays, and on hover or scrub
            otherwise — hidden only for a paused bar, where nothing is moving to point
            at. Positioned by the same code that paints the fill, so it always sits at
            the end of the bar it is riding rather than at the last backend sample. */}
        <span
          ref={thumbRef}
          className={`absolute left-0 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgb(var(--glow))] shadow-[0_0_8px_rgb(var(--glow)/0.8)] transition-opacity ${
            scrub != null || media.playing
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100"
          }`}
        />
        {/* The seek bubble: the timestamp under the pointer, riding above the
            bar like every scrubber that respects a precise click. Hidden at rest
            on purpose, unlike the thumb, which does ride the playhead: a bubble
            that was always there would sit on the elapsed label it duplicates.
            It is decorative for a reader: the slider's aria-valuetext already
            speaks the position. */}
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
      {/* The total doubles as the countdown switch, and it is underlined at rest
          because hover used to be the only thing saying it was a control — nobody
          clicks a clock they cannot see is a button. The underline is the same cue
          the gallery's text actions carry, so it reads as clickable in this app's own
          vocabulary rather than as a link borrowed from a browser, and unlike a
          bordered chip it costs no width: `w-11` is already the measure that fits a
          seven-character time, and padding would clip "1:02:03". Accent while the
          countdown is on — the state an underline cannot show — and the tooltip plus
          the screen-reader name still say what the control does. */}
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

/**
 * Player controls use the app's canonical icon-button tokens (ICON_BTN_*)
 * from ui.tsx — the same accent values as the shared chip language, just
 * round and borderless at rest. No local style constants here anymore.
 */

/**
 * System master volume: speaker button (click = mute toggle) + compact slider.
 * This is the default render endpoint's volume — the same knob the taskbar speaker
 * controls — because SMTC has no per-app volume.
 *
 * The slider keeps its own local value while the pointer is down so the thumb tracks
 * the press 1:1; the change is only committed on release, key-up or blur, which is
 * what keeps one stray pointer event from writing a whole stream of volume IPC calls.
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
        // The row prints no visible "System volume" label beside the slider, so
        // the name has to live on the control itself: the tooltip on the wrapper
        // above is hover copy, which is not an accessible name.
        aria-label={t("common.system-volume")}
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
 * Play/prev/next plus shuffle and repeat, grouped as one transport cluster.
 * All five controls come from the same icon-button tokens (`ICON_BTN_*`) so the
 * row reads as one cluster rather than five unrelated glyphs. The only thing that
 * is emphasized is the play/pause button, which is allowed one PRIMARY token; the
 * rest stay on the shared idle/active language.
 *
 * Hidden entirely when no session exists. When `trackKey` changes (auto-advance,
 * or any transport action that lands a new track), the buttons replay a staggered
 * press-ripple so the handoff reads as intentional rather than as a row that
 * re-rendered one glyph at a time.
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
  // Capability vs state: a `null` state with a known capability means the button
  // renders disabled rather than showing a possibly-wrong state.
  const shuffleSupported = shuffle !== null;
  const repeatSupported = repeat !== null;
  // One control at a time across the whole cluster: a second press while the first
  // is unresolved reads as the key sticking, not as a queue, and SMTC answers slowly
  // enough that two in flight can land in the wrong order.
  const { pending, run } = usePending({ exclusive: true });
  // Mirror of the props for the confirmation wait, which outlives the render that
  // started it: the SMTC sampler ticks at 1 Hz, so the state that proves the command
  // landed arrives long after `send` captured its "before".
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
  // The pressed button drops its glyph for a spinner, and stays lit: the disabled
  // treatment is 30% opacity, which a hairline arc cannot survive. It is not
  // `disabled` either -- `run` already refuses the second click, and a real
  // disabled button would also lose its focus ring mid-press.
  const busy = pending.size > 0;
  const send = (action: TransportAction, call: () => Promise<unknown>) => {
    // Snapshot *now*: this is the state the command is meant to move.
    const before: MediaSnapshot = { playing, trackKey, shuffle, repeat };
    // The key stays held until the player proves it acted, not merely until the OS
    // accepted the request — so the guard and the spinner both mean "still working".
    // `waitForChange` always settles, so a sender that ignores the command cannot wedge
    // the cluster.
    void run(action, async () => {
      await call();
      await waitForChange(action, before, () => latest.current);
    });
  };
  const inert = (action: TransportAction) => busy && !pending.has(action);
  const glyph = (action: TransportAction, idle: ReactNode, size: string) =>
    pending.has(action) ? <IconSpinner className={size} /> : idle;
  // Remounting the row (key=pulseId) replays the ripple on every track change; the
  // ring starts at the button, so no fill-mode is wanted. Must compose the same idle
  // style as the other buttons — the base token alone leaves the border color unset
  // (Tailwind default = near-white).
  const ripple = (delayMs: number) =>
    pulseId > 0
      ? { className: `${ICON_BTN} ${ICON_BTN_IDLE} transport-pulse`, style: { animationDelay: `${delayMs}ms` } }
      : { className: `${ICON_BTN} ${ICON_BTN_IDLE}` };
  return (
    <div key={pulseId} className="flex items-center gap-2">
      {/* Shuffle: shown whenever the sender exposes it; disabled (dimmed) when the
          capability exists but the UI hasn't received state yet. */}
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
      {/* Repeat: cycles off -> track -> list. `on` = list repeat (accent); track
          repeat adds the "1" superscript, like every music app. */}
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
    <WallpaperStage
      cfg={cfg}
      paused={paused}
      wallpaperName={wallpaperName}
      onTogglePause={onTogglePause}
      onChange={onChange}
    >
      {/* The player owns everything below the hero: identity, transport, timeline
          and volume, all inside one dock. The doc comment above explains why the
          player strip is always drawn while the identity rail hides, and why the
          dock's seam dissolves instead of ending on a line. */}
      {media ? (
        <div className="flex min-w-0 flex-col gap-2">
          {/* Identity: keyed on the track so a change remounts it and replays the
              swap flash. Artwork, app mark, track title, artist and the EQ bars
              that read the playing state without another status dot on the art.
              The key lives here rather than on the whole block so the volume below
              keeps its mount: VolumeControl seeds itself from one IPC call, and
              remounting it per track would blank the slider until the answer came
              back. */}
          <div
            key={`${media.title}—${media.artist}`}
            className="track-swap flex min-w-0"
          >
            <TrackIdentity
              media={media}
              beatScale="scale(calc(1 + var(--beat, 0) * 0.045))"
            />
          </div>
          {/* One control row, not two: the transport cluster centred in the middle
              column, the system volume parked at the right end of the third. They
              used to be separate bands, which cost the picture a whole row of dock
              height to park a lone slider under an already-centred cluster — the
              half-empty strip this row exists to avoid, rebuilt one row down.

              A grid and not a flex row with two `flex-1` spacers. While the columns
              fit their share, equal columns centre the cluster exactly; when the card
              narrows, the middle column refuses to shrink below the cluster and the
              row gives the volume's side its width instead, nudging the cluster
              toward it. Spacers would keep the maths prettier at one width and do
              the worse thing at another: the volume would overflow its spacer and
              paint over the transport below ~480px. Measured both ways, and the grid
              is the one that never overlaps. The transport keeps its own band inside
              its column, so the five controls still do not read as one even line of
              circles and the play button stays the obvious one. */}
          <div className="grid min-w-0 grid-cols-3 items-center gap-3">
            <div className="col-start-2 flex items-center justify-center">
              <TransportButtons
                playing={media.playing}
                trackKey={`${media.title}—${media.artist}`}
                shuffle={media.shuffle}
                repeat={media.repeat}
              />
            </div>
            {/* System volume: part of the dock, not a detached panel pasted below the
                player, and no visible "System volume" label beside it — the speaker
                glyph names the control and the tooltip on the row says it in words.
                What a sighted reader used to get from that span, a screen reader gets
                from the slider's own name (asserted with the rest of this card's
                controls): a span only ever named it for people who could see it. */}
            <div className="col-start-3 justify-self-end">
              <VolumeControl />
            </div>
          </div>
        </div>
      ) : (
        /* The message and the volume share a row so an idle dock reads as one band
           rather than a stray sentence with a slider under it. Padded so the dock
           keeps its height when nothing is playing instead of collapsing. */
        <div className="flex min-w-0 items-center justify-between gap-3 py-2">
          <span className="flex min-w-0 items-center gap-2 font-mono text-[10.5px] text-[var(--text-faint)]">
            <IconWave className="h-4 w-4 shrink-0" />
            {t("common.no-media-playing")}
          </span>
          <VolumeControl />
        </div>
      )}

      {/* The timeline runs the width of the card: the negative side margins pull it
          out of the dock's padding so it spans the frame, which is the alignment the
          old card's comment called "what finally makes it read as one surface". The
          control row above it carries the volume now, as in every video player — the
          timeline gets the edge.

          -mb-1 rather than -mb-3 is the breathing room. Full bleed cancelled the
          dock's padding outright, so the row's bottom sat flush against the frame
          and the times had nothing between them and the edge. Giving four of the
          padding's twelve back leaves eight points of air below the row — the same
          as the gap above it — so the timeline still owns the bottom without
          touching it.

          px-2 is the inset that keeps the thumb inside the frame at the ends of the
          bar: it hangs half past its own position by design, and at 0:00 that half
          would otherwise sit outside the card. It also finishes what the bottom gap
          starts — flush to the side, the 16px radius would still reach the first
          glyph.

          The duration check lives here as well as inside ProgressBar, so a sender
          that reports no duration cannot leave the control row hanging off an empty
          bottom, and the negative bottom margin only exists while the row does. */}
      {media && media.durationSec > 0 && (
        <div className="-mx-3 -mb-1 mt-2 px-2">
          <ProgressBar
            key={`${media.title}—${media.artist}`}
            media={media}
          />
        </div>
      )}
    </WallpaperStage>
  );
}
