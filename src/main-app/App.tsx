import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore, bindEvents } from "./store";
import { api } from "./ipc";
import { useLocale, applyLocale, t } from "./i18n";
import { useUpdateWatcher } from "./updater";
import Shell from "./components/Shell";
import Onboarding from "./components/Onboarding";
import { IconRefresh } from "./components/icons";
import { AppMark, AppWordmark } from "./components/ui";
import { GLOW_TEXT_DARK } from "@shared/constants";

/**
 * Boot readiness gates. The splash stays up until ALL of these pass so the
 * user never sees a half-built interface (empty cards, stale counters):
 *   1. config + RGB status loaded from the backend
 *   2. the first RGB frame arrived (engine is actually streaming)
 *   3. a short beat for the window to settle
 * If the engine never streams a frame (no OpenRGB, all devices excluded),
 * gate 2 falls away after a grace period instead of blocking forever.
 */
const FIRST_FRAME_GRACE_MS = 2500;
const MIN_SPLASH_MS = 700; // avoids a jarring flash of the splash

type Stage = 0 | 1 | 2 | 3;
const STAGE_LABEL: Record<Stage, string> = {
  0: "connecting to the engine",
  1: "reading your setup",
  2: "waking the lights",
  3: "polishing the glass",
};

/**
 * Warm the lazy tab chunks while the splash is still up, so the first tab
 * click (and the Overview's first paint) never sits on a skeleton. Idle
 * scheduling keeps this off the critical path; failures are harmless because
 * Suspense retry handles them on demand.
 */
function preloadTabs() {
  const kick = () => {
    void import("./components/tabs/OverviewTab");
    void import("./components/tabs/RgbTab");
    void import("./components/tabs/WallpaperTab");
    void import("./components/tabs/StickersTab");
    void import("./components/tabs/GeneralTab");
    void import("./components/CommandPalette");
  };
  if ("requestIdleCallback" in window) {
    requestIdleCallback(kick, { timeout: 1500 });
  } else {
    setTimeout(kick, 200);
  }
}

export default function App() {
  // Scoped: a bare useStore() would re-render the whole app on every RGB
  // frame (~12Hz) because the store hands out a new deviceColors object.
  const { cfg, loaded, loadError, load } = useStore(
    useShallow((s) => ({
      cfg: s.cfg,
      loaded: s.loaded,
      loadError: s.loadError,
      load: s.load,
    })),
  );

  // Subscribing here is what makes a language change repaint the app: the
  // translator is a plain function that re-reads the locale on every call, so
  // this render is the signal that reaches every screen. Nothing below is
  // memoized, so one root render is enough.
  const locale = useLocale();

  // Keep the document honest about what language it is in — screen readers
  // announce with it, and the browser picks the right font fallbacks.
  //
  // `applyLocale` is the other half: it points i18next at the catalog, which
  // is what `t` actually reads through. Both have to happen or the tree
  // re-renders in the old language.
  useEffect(() => {
    document.documentElement.lang = locale;
    applyLocale(locale);
  }, [locale]);
  // Splash holds until `ready`; `stage` drives the splash's progress copy.
  const [stage, setStage] = useState<Stage>(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    preloadTabs();
    load();
    const unbind = bindEvents();
    return () => {
      unbind.then((f) => f());
    };
  }, [load]);

  // The Windows display language, fetched once at boot. Only consulted when
  // `general.language` is "auto", but it is cheap and it has to be in the
  // store before the first paint or the splash would flash English on a
  // Spanish machine.
  useEffect(() => {
    let disposed = false;
    api
      .systemLanguage()
      .then((tag) => {
        if (!disposed) useStore.getState().setSystemLanguage(tag);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  // Watches for releases while the app is running, not only at startup: it
  // checks once now, again whenever the window comes back, and then on the
  // interval the user set. Without this, an app left open across a release
  // stayed on the old build until the user happened to restart it.
  useUpdateWatcher(loaded && !!cfg?.general.onboarded, cfg?.general.updateCheckMinutes);

  // Stage machine: advance as real readiness signals arrive.
  useEffect(() => {
    if (stage === 0 && loaded) setStage(1);
    // Gate 2's grace: don't wait forever for a first frame.
    const t = window.setTimeout(
      () => setStage((s) => Math.max(s, 2) as Stage),
      FIRST_FRAME_GRACE_MS,
    );
    return () => window.clearTimeout(t);
  }, [loaded, stage]);

  // Gate 2's real signal: the first RGB frame from the engine. Without this
  // the splash always burned its full grace timeout on every launch —
  // the single biggest "why does this take so long to open" offender. A
  // machine without OpenRGB (or with everything muted) never streams frames,
  // so an offline engine + loaded config also releases the gate immediately;
  // the grace timeout remains as the fallback for a hung connection.
  const gate2Done = useRef(false);
  useEffect(() => {
    if (stage >= 2 || gate2Done.current) return;
    const check = () => {
      const s = useStore.getState();
      const streaming = Object.keys(s.deviceColors).length > 0;
      const engineDown = !s.rgb.connected && s.loaded;
      if (streaming || engineDown) {
        gate2Done.current = true;
        setStage((st) => Math.max(st, 2) as Stage);
      }
    };
    check();
    return useStore.subscribe(check);
  }, [stage]);

  useEffect(() => {
    if (stage < 2) return;
    const t = window.setTimeout(() => setStage(3), 250);
    return () => window.clearTimeout(t);
  }, [stage]);

  useEffect(() => {
    if (stage < 3) return;
    const elapsed = performance.now();
    const wait = Math.max(0, MIN_SPLASH_MS - elapsed);
    const t = window.setTimeout(() => setReady(true), wait);
    return () => window.clearTimeout(t);
  }, [stage]);

  useEffect(() => {
    const root = document.documentElement;
    const theme = cfg?.general.theme ?? "system";
    const amoled = cfg?.general.amoled ?? false;
    // AMOLED only applies to the dark theme — light stays unchanged.
    root.classList.toggle("amoled", amoled && theme !== "light");
    // "system" follows the OS preference live; dark/light are explicit.
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      const apply = () => {
        root.classList.toggle("dark", !mq.matches);
        root.classList.toggle("amoled", amoled && !mq.matches);
      };
      apply();
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    root.classList.toggle("dark", theme !== "light");
  }, [cfg?.general.theme, cfg?.general.amoled]);

  // Theme must be known before ANY chrome paints: applying it after the
  // splash would flash the wrong palette. Seed from the store synchronously
  // (the config may already be in the store from a fast reload).
  if (loadError) {
    return <LoadError error={loadError} onRetry={() => load()} />;
  }

  if (!ready) {
    return <Splash stage={stage} streaming={Object.keys(useStore.getState().deviceColors).length > 0} />;
  }

  if (cfg && !cfg.general.onboarded) {
    return <Onboarding onDone={() => window.location.reload()} />;
  }

  return <Shell />;
}

/** Boot splash: the LumenDeck LED mark with live staging readout. */
function Splash({ stage, streaming }: { stage: Stage; streaming: boolean }) {
  const steps = [0, 1, 2, 3];
  const pct = ((stage + 1) / 4) * 100;
  return (
    <div className="grain relative flex h-screen items-center justify-center overflow-hidden">
      <div className="aura" />
      <div className="relative z-10 flex flex-col items-center gap-7">
        <AppMark size={80} pulse />
        <div className="flex flex-col items-center">
          <AppWordmark size={44} />
          <div className="kicker mt-1.5 h-4 transition-all" key={stage}>
            {STAGE_LABEL[stage]}
          </div>
        </div>
        {/* segmented progress: one block per readiness stage */}
        <div className="flex gap-1.5">
          {steps.map((s) => (
            <span
              key={s}
              className={`h-1 w-10 rounded-full transition-all var(--motion-slow) var(--ease-standard) ${
                s <= stage
                  ? "bg-[rgb(var(--glow))] shadow-[0_0_8px_rgb(var(--glow))]"
                  : "bg-[var(--line-strong)]"
              }`}
            />
          ))}
        </div>
        <div className="font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
          {pct.toFixed(0)}%
          {streaming && (
            <span className="ml-2 text-[rgb(var(--glow))]">{t("shell.live")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Backend connect failure — readable reason + a glowing retry. */
function LoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
  const [retrying, setRetrying] = useState(false);
  const retry = () => {
    setRetrying(true);
    onRetry();
    // onRetry is async (store load); if it fails again the error re-renders
    // and this flag resets via the store update. Optimistic spinner only.
    setTimeout(() => setRetrying(false), 1200);
  };
  return (
    <div className="grain relative flex h-screen items-center justify-center overflow-hidden">
      <div className="aura" />
      <div className="relative z-10 flex max-w-lg flex-col items-center gap-5 px-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-red-500/40 bg-red-500/10 text-red-300 shadow-[0_0_30px_-6px_rgba(239,68,68,0.6)]">
          <svg
            width={20}
            height={20}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M12 8v5M12 16.5v.5" />
            <path d="M10.3 4.3 3 17a2 2 0 0 0 1.7 3h14.6a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
          </svg>
        </div>
        <div>
          <h1 className="lednum text-xl text-[var(--text)]">
            {t("common.backend-offline")}
          </h1>
          <p className="mt-2 text-sm text-[var(--text-dim)]">
            {t("common.lumendeck-couldn't-reach-its-rust-engine-make-su")}
          </p>
        </div>
        <pre className="w-full overflow-auto rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-3 text-left font-mono text-[11px] leading-relaxed text-[var(--text-dim)]">
          {error}
        </pre>
        <button
          onClick={retry}
          disabled={retrying}
          className="glow-fill inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-transform active:scale-[0.97] disabled:opacity-60"
          style={{ color: GLOW_TEXT_DARK }}
        >
          <IconRefresh className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
          {retrying ? t("common.reconnecting") : t("common.retry-connection")}
        </button>
      </div>
    </div>
  );
}
