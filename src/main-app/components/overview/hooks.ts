// Overview tab hooks: history (what changed, when), clocks, and the
// audio-reactive CSS-variable loop. Extracted from OverviewTab.tsx verbatim
// so the tab file can read as composition rather than a thousand lines.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useStore } from "../../store";
import { greetingKeyForHour, recencyBucket, recencyValue } from "../overviewCards";
import { fpsFromTimestamps, formatFps, pushTimestamp, FPS_WINDOW } from "../fpsMeter";
import { EqEngine } from "../../eq";
import { t } from "../../i18n";

/**
 * The changes worth dating, and the sentence each one prints.
 *
 * Written as a map rather than interpolated at the call site so that both forms
 * of every label sit together and are visible to `i18n-check` — a
 * template-literal key would leave the named half looking dead.
 */
const CHANGE_LABEL = {
  wallpaper: "overview.wallpaper-changed",
  track: "overview.track-changed",
  profile: "overview.profile-applied",
} as const;

/**
 * How long ago a change happened, in the words the header strip prints.
 * `recencyBucket` decides which sentence applies, `recencyValue` the number
 * inside it — split so the thresholds have exactly one home.
 */
function recencyText(at: number, now: number): string {
  const bucket = recencyBucket(now - at);
  if (bucket === "now") return t("common.just-now");
  const { value, unit } = recencyValue(now - at);
  return unit === "seconds"
    ? t("common.{n}-seconds-ago", { n: value })
    : unit === "minutes"
      ? t("common.{n}-minutes-ago", { n: value })
      : t("common.{n}-hours-ago", { n: value });
}

/**
 * The most recent thing on this tab that visibly changed.
 *
 * Compares each watched value against the last one it saw and reports the
 * label of whichever moved, with the time it moved — the header strip turns
 * that into "the wallpaper changed 4 minutes ago", which is the answer to the
 * question a frozen desktop actually raises. The comparison runs in an effect
 * keyed on the joined values, so a re-render that changes nothing dates
 * nothing.
 */
function useLastChange(
  watched: ReadonlyArray<{
    value: string;
    labelKey: (typeof CHANGE_LABEL)[keyof typeof CHANGE_LABEL];
  }>,
): { labelKey: string; at: number } | null {
  const [last, setLast] = useState<{ labelKey: string; at: number } | null>(null);
  const seen = useRef(new Map<string, string>());
  const fingerprint = watched.map((w) => w.value).join("\u0000");
  // Read through a ref so the effect does not need the array identity, which
  // changes every render even when the values inside it have not.
  const latest = useRef(watched);
  latest.current = watched;
  useEffect(() => {
    const now = Date.now();
    for (const w of latest.current) {
      const prev = seen.current.get(w.labelKey);
      if (prev !== undefined && prev !== w.value) setLast({ labelKey: w.labelKey, at: now });
    }
    seen.current = new Map(latest.current.map((w) => [w.labelKey, w.value]));
  }, [fingerprint]);
  return last;
}

/**
 * A clock, running only while something is being timed.
 *
 * The recency sentence needs a moving `now` to age against, but a timer that
 * runs while nothing has changed would re-render the header once a minute to
 * say the same thing. `active` is the tab's own "there is a change to date":
 * the interval starts when that becomes true and dies with it.
 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * The salutation key, kept current across an all-day session.
 *
 * Re-derived on an interval, not read at render: the tab no longer re-renders
 * on the old 12Hz frame loop, so a greeting read once would say "Good morning"
 * until something else happened to re-render the tab. The interval fires at
 * the next hour boundary — waking up exactly when the answer changes — rather
 * than polling every minute.
 */
function useGreetingKey() {
  const [key, setKey] = useState(() => greetingKeyForHour(new Date().getHours()));
  useEffect(() => {
    let timer: number | undefined;
    const arm = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(now.getHours() + 1, 0, 0, 0);
      timer = window.setTimeout(() => {
        setKey(greetingKeyForHour(new Date().getHours()));
        arm();
      }, next.getTime() - now.getTime());
    };
    arm();
    return () => window.clearTimeout(timer);
  }, []);
  return key;
}

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

export {
  useLastChange,
  CHANGE_LABEL,
  recencyText,
  useNow,
  useGreetingKey,
  useFps,
  useAudioVars,
};
