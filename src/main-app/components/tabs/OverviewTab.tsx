import { useShallow } from "zustand/react/shallow";
import { useEffect, useState, useRef, type CSSProperties, type ReactNode } from "react";
import { useStore } from "../../store";
import { Card, Chip, Btn, ComboCaps, DisplaysCard, IconBox, RefreshBtn, ItemTitle, SwitchBtn, Segmented, ICON_BTN, ICON_BTN_IDLE, ICON_BTN_ACTIVE, ICON_BTN_PRIMARY, MINI_BTN, OVERLAY_ICON_BTN } from "../ui";
import { ConfigPickerModal } from "../ConfigPickerModal";
import { useConfigPicker } from "../useConfigPicker";
import { shortcutRows } from "../Sidebar";
import {
  visibleProfiles,
  profileSummary,
  condenseWindowShortcuts,
  globalHotkeyState,
} from "../overviewCards";
import { toMediaSrc } from "../mediaSrc";
import SystemCard from "../SystemCard";
import { DeviceRow } from "../DeviceRow";
import { deviceWindow, DEVICE_ROWS_COLLAPSED } from "../deviceList";
import { fpsFromTimestamps, formatFps, pushTimestamp, FPS_WINDOW } from "../fpsMeter";
import { versionLabel } from "../buildIdentity";
import { IconBulb, IconImage, IconSticker, IconGlobe, IconLayers, IconPlay, IconPause, IconNext, IconPrevious, IconWave, IconSun, IconZap, IconChevronRight, IconChevronDown, IconMediaApp, IconShuffle, IconRepeat, IconSpinner, IconCheck, IconKeyboard, IconVolumeOff, IconVolumeLow, IconVolumeHigh } from "../icons";
import { SHADERS, SHADER_ART, RGB_MODES, ANIMATION_MODES } from "@shared/constants";
import type { Config, MediaInfo, RgbMode } from "@shared/types";
import { convertFileSrc } from "@tauri-apps/api/core";
import { basename } from "../../utilities";
import { api } from "../../ipc";
import { usePending } from "../../pending";
import { EqEngine } from "../../eq";
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
 * Wraps the row holding the Now playing and Lighting Engine cards with a
 * subtle audio-reactive glow, and drives the equalizer beside the artwork
 * from the same loop.
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
 *
 * The properties are written to the row that holds *both* the Now playing and
 * the Lighting Engine cards, because both read them. This used to be a wrapper
 * component around the Now playing card alone, which quietly broke the engine
 * card's halo: custom properties inherit downward, the engine card is a
 * sibling rather than a descendant, and every `var(--al, 0)` in it fell back
 * to its default. The glow looked like it worked because a constant faint
 * shadow is indistinguishable from a very quiet one.
 */
function useAudioVars(playing: boolean) {
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
  return {
    ref,
    // Seeded so the first paint reads a defined zero rather than leaning on the
    // `var(--al, 0)` defaults scattered through the consumers.
    style: {
      "--al": 0,
      "--beat": 0,
      "--eq0": 0,
      "--eq1": 0,
      "--eq2": 0,
      "--eq3": 0,
    } as CSSProperties,
  };
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
      // it cannot be shadowed by an ancestor `group`.
      className="group/stage relative h-44 w-full overflow-hidden rounded-xl border border-[var(--line)] bg-black"
      style={{
        // Audio-reactive halo: volume widens and brightens a glow ring around
        // the stage; a detected beat adds a short bright flash on top.
        boxShadow:
          "0 0 calc(6px + var(--al, 0) * 34px) rgb(var(--glow) / calc(0.05 + var(--al, 0) * 0.26 + var(--beat, 0) * 0.2))",
      }}
    >
      <WallpaperThumb kind={cfg.wallpaper.kind} source={cfg.wallpaper.source} paused={paused} bare />
      {/* The scrim exists to make the name chip legible against a bright frame, so
          it shares the chip's reveal rather than darkening the top third of the
          wallpaper permanently. Left always-on it was a cost with nothing to
          show for it most of the time — and the top of a wallpaper is usually
          the part the user picked. */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0.3),transparent_35%)] opacity-0 transition-opacity duration-150 group-hover/stage:opacity-100 group-focus-within/stage:opacity-100" />

      {/* The name, over the picture, in the app's own tooltip rather than the
          browser's. It is `truncate`, so the tooltip is the only way to read a
          long filename in full — and a native one is a grey system box on a
          delay, on the one surface in the card where a mismatched tooltip is
          most obvious. The chip itself stays a label: it is not a control, so
          its hover state is not promising an action.

          Hidden at rest, with the rest of the chrome. It was the only thing
          permanently drawn over the picture, and a card whose headline is a
          live wallpaper should show the wallpaper.

          `group-focus-within/stage` rather than hover alone, and this is the
          part that is easy to get wrong. The chip is not focusable, so a
          keyboard user tabbing to Pause or Change would never see it — the name
          would simply be gone for them. Revealing on focus anywhere in the
          stage means Tab reaches the controls and the name comes with them. */}
      <div className="absolute left-3 top-3 flex max-w-[calc(100%-6.5rem)] items-center gap-2 rounded-lg bg-black/45 px-2.5 py-1.5 opacity-0 backdrop-blur-sm transition-opacity duration-150 group-hover/stage:opacity-100 group-focus-within/stage:opacity-100">
        <IconImage className="h-4 w-4 shrink-0 text-white/75" />
        <span
          className="truncate font-mono text-[10px] text-white/90"
          data-tip={wallpaperName}
        >
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
          data-tip={paused ? t("common.resume-wallpaper") : t("common.pause-wallpaper")}
          className={`${OVERLAY_ICON_BTN} hover:!border-transparent hover:!bg-[rgb(var(--glow))] hover:!text-[#06121f]`}
        >
          {paused ? <IconPlay className="h-4 w-4" /> : <IconPause className="h-4 w-4" />}
        </button>
        <button
          onClick={onChange}
          aria-label={t("common.change-wallpaper")}
          data-tip={t("common.change-wallpaper")}
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
    <div className="space-y-3.5">
      {groups.map((g) => {
        const modes = RGB_MODES.filter((m) => m.group === g.id);
        const ownsActive = active?.group === g.id;
        return (
          <div key={g.id}>
            {/* The row states which family this is, how many options it holds,
                and -- only for the family that owns the current mode -- which
                one is live. Naming the active mode next to the buttons is what
                saves a user from inferring it from which pill is pressed. */}
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="kicker">{t(g.label)}</span>
              {ownsActive && active ? (
                <span className="truncate font-mono text-[10px] text-[rgb(var(--glow))]">
                  {t("overview.active-{mode}", { mode: t(active.label) })}
                </span>
              ) : (
                <span className="font-mono text-[10px] text-[var(--text-faint)]">
                  {t("common.{n}-modes", { n: modes.length })}
                </span>
              )}
            </div>
            <Segmented
              label={t("common.{mode}-lighting-modes", { mode: t(g.label) })}
              // Only the group holding the active mode shows a pressed button;
              // the other has nothing selected, which is the honest state.
              value={ownsActive ? active.id : ""}
              onChange={(v) => onSelect(v as RgbMode)}
              options={modes.map((m) => ({
                id: m.id as string,
                label: t(m.label),
              }))}
            />
          </div>
        );
      })}
      {active && (
        <p className="text-xs leading-relaxed text-[var(--text-faint)]">{t(active.hint)}</p>
      )}
    </div>
  );
}

/**
 * The four salutations, each mapped to the same sentence with the account name
 * folded in.
 *
 * Written as a map rather than interpolated at the call site so that both forms
 * of every salutation sit together and are visible to `i18n-check` — a
 * template-literal key would leave the named half looking dead. The pairing is
 * the point: nothing here can end up greeting someone by name with the
 * afternoon's sentence.
 */
/**
 * The dashboard's own frame rate, for the header strip.
 *
 * Sampled from requestAnimationFrame rather than the backend because a webview
 * painting at 30fps is a front-end problem no Rust module can observe. The
 * arithmetic lives in `fpsMeter.ts` so it can be tested without a DOM; this is
 * only the loop that feeds it.
 *
 * Two decisions worth stating:
 *
 *  - The reading is published on a 1Hz timer, not per frame. State that changes
 *    60 times a second re-renders the whole header 60 times a second to move
 *    one number that is only ever read to the nearest frame rate.
 *  - The loop stops while the tab is hidden, because rAF does not fire there
 *    anyway and a dashboard left in the tray overnight should not be holding a
 *    window of timestamps open for it.
 */
function useFps(): number {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    // `frames`, not `window`: shadowing the global inside a DOM effect is a
    // trap that costs whoever edits this next an afternoon.
    let frames: number[] = [];
    let raf = 0;
    let lastPublish = 0;
    let running = true;

    const frame = (now: number) => {
      if (!running) return;
      frames = pushTimestamp(frames, now, FPS_WINDOW);
      if (now - lastPublish >= 1000) {
        lastPublish = now;
        setFps(formatFps(fpsFromTimestamps(frames)));
      }
      raf = requestAnimationFrame(frame);
    };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
        // Cleared rather than kept: timestamps spanning a hidden period would
        // average the gap into a reading describing nothing that was on screen.
        frames = [];
        lastPublish = 0;
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };

    raf = requestAnimationFrame(frame);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return fps;
}

const GREETING_KEYS = {
  "overview.up-late": "overview.up-late-{name}",
  "overview.good-morning": "overview.good-morning-{name}",
  "overview.good-afternoon": "overview.good-afternoon-{name}",
  "overview.good-evening": "overview.good-evening-{name}",
} as const;

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
  // The signed-in Windows account, for the greeting below. Asked once: it
  // cannot change while the app runs. An empty string is a real answer, not a
  // placeholder — Windows sometimes will not say — and it has to fall back to
  // the unnamed salutation rather than print a comma with nothing after it.
  const [accountName, setAccountName] = useState("");
  // Whether the engine card is showing every device. Lived in the card until
  // this: it is a property of how much room the user wants this card to take on
  // the page, not of any one row, and it has to survive the row list changing
  // underneath it when a device connects.
  const [allDevices, setAllDevices] = useState(false);
  useEffect(() => {
    let disposed = false;
    void api
      .accountName()
      .then((name) => {
        if (!disposed) setAccountName(name);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);
  // The list rows below each drive one IPC call, keyed by entity so two rows
  // can be in flight without blocking one another.
  const { pending, run } = usePending();
  const fps = useFps();
  // Written onto the row holding both cards, because both read the variables.
  const audio = useAudioVars(!!media?.playing);

  if (!cfg) return null;

  const stickers = cfg.stickers;
  const visibleStickers = stickers.filter((s) => s.visible);
  const excluded = new Set(cfg.rgb.excludedDevices);
  const activeDevices = rgb.devices.filter((d) => !excluded.has(d.id));
  const ledActive = activeDevices.reduce((n, d) => n + d.leds, 0);
  const ledTotal = rgb.devices.reduce((n, d) => n + d.leds, 0);
  // Which device rows the engine card renders this frame. See deviceList.ts for
  // why the list is capped at all. Not named `window`: this file uses the
  // global in a dozen places, and shadowing it inside one component is the kind
  // of collision that typechecks and then misbehaves at runtime.
  const deviceRows = deviceWindow(rgb.devices, allDevices);
  const isAnimatedMode = (ANIMATION_MODES as ReadonlySet<string>).has(cfg.rgb.mode);
  const paused = !cfg.general.wallpaperEnabled || wallpaperPaused;
  const idleOn = cfg.rgb.idleTimeoutSec > 0;
  const nightOn = !!cfg.rgb.nightStart && !!cfg.rgb.nightEnd;
  const playlistOn = (cfg.playlists ?? []).some((p) => p.enabled);
  // The picker, not a second hand-rolled list: this card must agree with the
  // header avatar about which profile is applied, and `useConfigPicker` is the
  // one derivation of that. Applying from here goes through its `apply`, so
  // the in-flight row and the failure toast behave as they do in Settings --
  // and on success the row itself turns into the "Applied now" tick, which is
  // why the old "profile applied" toast is no longer needed.
  const picker = useConfigPicker();
  // Truncation that keeps the applied profile in view; see `visibleProfiles`.
  const profileList = visibleProfiles(picker.scenes, picker.activeId);
  // This window's own keys, from the same table the "?" sheet renders, so the
  // card cannot advertise a binding the overlay does not have. Folded, because
  // five Ctrl+digit tab rows would push the global keys below the fold of a
  // 5-column card.
  const windowShortcuts = condenseWindowShortcuts(
    shortcutRows(),
    t("common.switch-tab"),
  );
  // The system-wide bindings, which the old card did not mention at all.
  const globalKeys = globalHotkeyState(
    cfg.general.hotkeys,
    cfg.general.hotkeysEnabled ?? true,
  );
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
  // Which of the four salutations this hour earns. Kept as one value so the
  // named and unnamed forms cannot drift onto different branches — picking the
  // key twice is how a greeting ends up saying "Good evening" to Gabriel.
  const greetingKey =
    hour < 5
      ? "overview.up-late"
      : hour < 12
        ? "overview.good-morning"
        : hour < 18
          ? "overview.good-afternoon"
          : "overview.good-evening";
  const greeting = accountName
    ? t(GREETING_KEYS[greetingKey], { name: accountName })
    : t(greetingKey);
  const issues: string[] = [];
  if (!rgb.connected) issues.push(t("overview.openrgb-offline"));
  if (paused) issues.push(t("overview.wallpaper-paused"));
  if (!issues.length && !cfg.rgb.enabled)
    issues.push(t("overview.lighting-off"));
  // The live/attention chip that used to sit here is now a dot on the profile
  // avatar in the header, which is where the state belongs: it describes the
  // machine rather than this screen. The issue strings stay, because the strip
  // below still reads them.

  return (
    <div className="stagger space-y-5">
      {/* ===== header: salutation, live state, and the counted strip ===== */}
      <header className="min-w-0">
        {/* Kicker row: which tab this is, and the version of the engine
            running it. The version is here rather than only in the title bar
            because this is the screen that reports on the engine. */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="kicker">{t("overview.at-a-glance")}</span>
          <span aria-hidden className="text-[var(--text-faint)]">·</span>
          {/* A chip rather than loose text: this is the engine's version, and
              the card header below is the engine. Matching them lets the eye
              connect "what version" with "what is running". */}
          <span className="rounded-md border border-[rgb(var(--glow)/0.35)] bg-[rgb(var(--glow)/0.08)] px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.14em] text-[rgb(var(--glow))]">
            {t("overview.engine", { v: versionLabel(__APP_VERSION__) })}
          </span>
        </div>

        {/* Salutation and the right-hand controls share a baseline, which is
            what makes the row read as one header rather than a heading with
            something parked beside it. */}
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="lednum text-[34px] leading-none text-[var(--text)]">
              {greeting}
            </h1>
            {/* The config avatar lives in the app header now, not here: it is a
                property of the machine rather than of this screen, and it used
                to vanish the moment you opened another tab. */}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <RefreshBtn />
          </div>
        </div>

        {/* The counted strip. Dot separators rather than a grid of boxes: these
            are facts about one system, not independent controls, and six
            bordered chips read as six things you can press. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] text-[var(--text-faint)]">
          {issues.length > 0 ? (
            <span className="text-amber-400">{issues.join(" · ")}</span>
          ) : (
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {t("overview.all-in-sync")}
            </span>
          )}
          <span aria-hidden>·</span>
          <span>
            {t("common.{n}-devices", { n: activeDevices.length })}
          </span>
          <span aria-hidden>·</span>
          <span>
            {t("common.{n}-led-zones-active", { n: ledActive.toLocaleString() })}
          </span>
          <span aria-hidden>·</span>
          <span>{t("common.{n}-stickers", { n: stickers.length })}</span>
          <span aria-hidden>·</span>
          {/* 0 is "still warming up", not "the app is not running": the frame
              loop has nothing to average for its first second, and printing
              0 FPS there would be a stall report about nothing. */}
          {fps > 0 ? (
            <span className="tabular-nums">{t("common.{n}-fps", { n: fps })}</span>
          ) : (
            <span>{t("common.fps-warming-up")}</span>
          )}
        </div>
      </header>
      {/* ===== row 1: now playing + engine ===== */}
      <div
        ref={audio.ref}
        style={audio.style}
        // `items-start`, and it is the whole fix for a card that changes height.
        //
        // A grid row is as tall as its tallest item and every other item is
        // stretched to fill it, so opening a device row grew the engine card and
        // dragged the Now playing card beside it to the same height — 73px of
        // wallpaper and transport stretched across 478px of empty panel,
        // measured. The stretch is invisible while the row's contents happen to
        // be the same height, which is why it only ever showed up as "expanding
        // moves the other thing".
        //
        // `start` and not `self-start` on the card: the cards are direct grid
        // items, and setting it here means a future card in this row inherits
        // the same independence rather than having to remember.
        className="grid min-w-0 items-start gap-5 xl:grid-cols-12"
      >
        {/* Now playing — spans 5. Wallpaper stage on top, media + transport
            below, wallpaper context strip last. */}
        <Card
          title={t("overview.now-playing-and-live-wallpaper")}
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
          <>
            <WallpaperStage
              cfg={cfg}
              paused={paused}
              wallpaperName={wallpaperName}
              onTogglePause={togglePause}
              onChange={() => onNavigate("wallpaper")}
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
        </Card>

        {/* Engine — spans 7. The device list is the hero: it carries the live
            LEDs, the device identity and the mute control in one place, so no
            other part of the card has to repeat the same counts. */}
        <Card
          title={t("overview.lighting-engine")}
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
              <>
                <ul className="min-w-0 space-y-2">
                {deviceRows.visible.map((d) => (
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
                {/* The way out of the cap. Without it the six rows below are not
                    a limit but a disappearance: a seventh device would be
                    unmutable, unrenamable and invisible, which is the same
                    unreachable-because-excluded trap the muted-device decision
                    above exists to avoid. */}
                {deviceRows.collapsible && (
                  <button
                    type="button"
                    onClick={() => setAllDevices(true)}
                    aria-expanded={false}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-[var(--line-strong)] py-1.5 text-[11px] text-[var(--text-faint)] transition-colors hover:border-[rgb(var(--glow)/0.45)] hover:bg-[rgb(var(--glow)/0.07)] hover:text-[var(--text)]"
                  >
                    <IconChevronDown className="h-3 w-3 shrink-0" />
                    {t("lighting.show-{n}-more-devices", {
                      n: deviceRows.hidden,
                    })}
                  </button>
                )}
                {/* The way back. The list is not a one-way trip: a machine with
                    twelve devices leaves a card three times taller than the one
                    beside it, and the way to undo that should not be restarting
                    the app. */}
                {allDevices && rgb.devices.length > DEVICE_ROWS_COLLAPSED && (
                  <button
                    type="button"
                    onClick={() => setAllDevices(false)}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 py-1 text-[11px] text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
                  >
                    {/* Up, because this collapses. `rotate-90` points down,
                        which is what the expand button beside it uses — the
                        two then disagree about which way the list goes. */}
                    <IconChevronRight className="h-3 w-3 shrink-0 -rotate-90" />
                    {t("lighting.show-fewer-devices")}
                  </button>
                )}
              </>
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
      {/* `items-start` for the same reason as the engine row above: these cards
          have independent content, and a grid row otherwise makes the shorter
          one grow to match the taller one. */}
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <DisplaysCard compact />
        </div>
        <div className="xl:col-span-5">
          <Card title={t("overview.stickers-and-desktop-widgets")} icon={<IconSticker />} right={
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

      {/* ===== row 3: system =====
          Its own full-width row rather than a column beside another card. Both
          curves are unreadable at a third of the width -- the shape is the
          whole point of the card, and a squashed sparkline shows only that
          there was some activity, which the header's frame rate already said. */}
      <SystemCard />

      {/* ===== row 4: profiles + shortcuts =====
          Not gated on there being any profiles: the shortcuts half describes
          the keyboard, which exists whether or not anything has been captured
          yet, and the old `scenes.length > 0` took both cards away together. */}
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-12">
        <Card
          title={t("common.profiles")}
          icon={<IconLayers />}
          className="xl:col-span-7"
          right={
            picker.scenes.length > 0 ? (
              <button onClick={() => onNavigate("general")} className={MINI_BTN}>
                {t("common.manage")}
              </button>
            ) : undefined
          }
        >
          {picker.scenes.length === 0 ? (
            /* An empty state rather than a missing card. A card that only
               exists once you have used it teaches nothing about the feature,
               and this is the screen a new user lands on. */
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--line-strong)] px-6 py-8 text-center">
              <IconLayers className="h-5 w-5 text-[var(--text-faint)]" />
              <p className="max-w-sm text-xs leading-relaxed text-[var(--text-faint)]">
                {t("common.no-profiles-yet-set-up-a-look-you-like-then-cap")}
              </p>
              <Btn size="sm" variant="primary" onClick={picker.openSave}>
                {t("common.capture-current-look")}
              </Btn>
            </div>
          ) : (
            <>
              <ul className="-m-1 space-y-0.5">
                {profileList.shown.map((s) => {
                  const isActive = s.id === picker.activeId;
                  const isApplying = picker.applyingId === s.id;
                  const sum = profileSummary(s);
                  return (
                    <li key={s.id}>
                      {/* The whole row is the target, because applying a profile
                          is the only thing a row does here and a card-sized
                          target with no other controls inside it cannot
                          misfire. Management lives in the picker, which is one
                          click away and has room for it. */}
                      <button
                        onClick={() => picker.apply(s.id)}
                        disabled={isActive || isApplying}
                        aria-busy={isApplying || undefined}
                        aria-current={isActive || undefined}
                        className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-default ${
                          isActive
                            ? "border-[rgb(var(--glow)/0.5)] bg-[rgb(var(--glow)/0.1)]"
                            : "border-transparent hover:border-[var(--line)] hover:bg-[var(--panel-strong)]"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-[var(--text)]">
                            {s.name}
                          </span>
                          {/* What the profile holds. A bare list of names
                              cannot tell "Work" from "Work, dimmed", and this
                              is the row that decides which gets applied. */}
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--text-faint)]">
                            {sum.stickers > 0
                              ? `${sum.kind} · ${sum.mode} · ${t("common.{n}-stickers", {
                                  n: sum.stickers,
                                })}`
                              : `${sum.kind} · ${sum.mode}`}
                          </span>
                        </span>
                        {isApplying ? (
                          <IconSpinner className="h-4 w-4 shrink-0 animate-spin text-[rgb(var(--glow))]" />
                        ) : isActive ? (
                          <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[rgb(var(--glow))]">
                            <IconCheck className="h-3.5 w-3.5" />
                            {t("common.profile-applied-now")}
                          </span>
                        ) : (
                          /* Quiet rather than hidden until hover: this row is
                             clickable, and a chevron that only appears under the
                             mouse says nothing to anyone using the keyboard. */
                          <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--text-faint)] opacity-40 transition-opacity group-hover:opacity-100" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {profileList.hidden > 0 && (
                <button
                  onClick={() => onNavigate("general")}
                  className="mt-2.5 px-1 text-xs font-semibold text-[var(--text-faint)] transition-colors hover:text-[rgb(var(--glow))]"
                >
                  {t("common.{n}-more-profiles", { n: profileList.hidden })}
                </button>
              )}
            </>
          )}
        </Card>

        <Card
          title={t("common.shortcuts")}
          icon={<IconKeyboard />}
          className="xl:col-span-5"
        >
          {/* Two lists because they are two different things: these keys only
              work with this window focused, the ones below work from anywhere.
              The old card listed three prose strings and said nothing about the
              eleven global bindings the user had actually set. */}
          <div className="kicker mb-1.5 text-[var(--text-faint)]">
            {t("common.this-window")}
          </div>
          <ul className="mb-4">
            {windowShortcuts.map((r) => (
              <li
                key={r.what}
                className="flex items-center justify-between gap-4 border-b border-[var(--line)] py-1.5 last:border-b-0"
              >
                <span className="min-w-0 truncate text-[13px] text-[var(--text-dim)]">
                  {r.what}
                </span>
                <ComboCaps keys={r.keys} />
              </li>
            ))}
          </ul>

          <div className="kicker mb-1.5 text-[var(--text-faint)]">
            {t("common.anywhere-on-your-pc")}
          </div>
          {globalKeys.boundCount === 0 ? (
            <p className="text-xs leading-relaxed text-[var(--text-faint)]">
              {t("common.no-global-hotkeys-yet-set-them-up")}
            </p>
          ) : (
            <>
              <ul>
                {globalKeys.bound.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-4 border-b border-[var(--line)] py-1.5 last:border-b-0"
                  >
                    <span className="min-w-0 truncate text-[13px] text-[var(--text-dim)]">
                      {t(r.labelKey)}
                    </span>
                    <ComboCaps keys={r.caps} />
                  </li>
                ))}
              </ul>
              {/* The distinction the old card could not draw: stored bindings
                  that the master switch has released are not unbound, and
                  reporting them that way sends a user to rebind keys they
                  already bound. */}
              {globalKeys.dormant && (
                <p className="mt-2.5 text-[11px] leading-relaxed text-amber-300/90">
                  {t("common.keys-released-switch-off")}
                </p>
              )}
            </>
          )}

          <button
            onClick={() => window.dispatchEvent(new Event("lumendeck:open-shortcuts"))}
            className={`${MINI_BTN} mt-3.5`}
          >
            {t("common.view-all-shortcuts")}
          </button>
        </Card>
      </div>

      {/* jump links */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
            {
              // Settings is the fourth tile because every destination the
              // header strip can raise an issue about is fixed from there --
              // OpenRGB offline, wallpaper paused, lighting switched off. A
              // tile that navigates nowhere real would be worse than three.
              id: "general",
              // `nav.settings`, not a new `common.` key: the rail, the command
              // palette and this tile must all call the tab the same thing, and
              // the nav key is the one they already share.
              label: t("nav.settings"),
              detail: t("common.profiles-and-shortcuts"),
              Icon: IconLayers,
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

      {/* The empty-state "Capture current look" opens this, and applying a
          profile from the card goes through the same hook, so the modal has
          to live here rather than only in Settings. */}
      {picker.open && (
        <ConfigPickerModal
          scenes={picker.scenes}
          activeId={picker.activeId}
          applyingId={picker.applyingId}
          startIn={picker.startInSave ? "save" : "browse"}
          onClose={picker.close}
          onApply={picker.apply}
          onSave={picker.save}
          onRename={picker.rename}
          onDelete={picker.remove}
          onChooseLogo={picker.chooseLogo}
          onClearLogo={(id) => picker.setLogo(id, null)}
          canDelete={picker.canDelete}
        />
      )}
    </div>
  );
}
