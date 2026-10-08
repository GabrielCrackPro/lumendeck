import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useStore } from "../../store";
import { greetingKeyForHour, recencyBucket, recencyValue } from "../overviewCards";
import { fpsFromTimestamps, formatFps, pushTimestamp, FPS_WINDOW } from "../fpsMeter";
import { EqEngine } from "../../eq";
import { t } from "../../i18n";

const CHANGE_LABEL = {
  wallpaper: "overview.wallpaper-changed",
  track: "overview.track-changed",
  profile: "overview.profile-applied",
} as const;

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

function useLastChange(
  watched: ReadonlyArray<{
    value: string;
    labelKey: (typeof CHANGE_LABEL)[keyof typeof CHANGE_LABEL];
  }>,
): { labelKey: string; at: number } | null {
  const [last, setLast] = useState<{ labelKey: string; at: number } | null>(null);
  const seen = useRef(new Map<string, string>());
  const fingerprint = watched.map((w) => w.value).join("\u0000");
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

function useFps(): number {
  const [fps, setFps] = useState(0);
  useEffect(() => {
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

function useAudioVars(playing: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const engine = new EqEngine();
    let raf = 0;
    let lastFrame = 0;
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
