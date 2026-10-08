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

const FIRST_FRAME_GRACE_MS = 2500;
const MIN_SPLASH_MS = 700;

const THEME_FADE_MS = 380;

let paletteSeeded = false;

type Stage = 0 | 1 | 2 | 3;
const STAGE_LABEL_KEYS: Record<Stage, string> = {
  0: "shell.connecting-to-the-engine",
  1: "shell.reading-your-setup",
  2: "shell.waking-the-lights",
  3: "shell.polishing-the-glass",
};

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
  const { cfg, loaded, loadError, load } = useStore(
    useShallow((s) => ({
      cfg: s.cfg,
      loaded: s.loaded,
      loadError: s.loadError,
      load: s.load,
    })),
  );

  const locale = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
    applyLocale(locale);
  }, [locale]);
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

  useUpdateWatcher(loaded && !!cfg?.general.onboarded, cfg?.general.updateCheckMinutes);

  useEffect(() => {
    if (stage === 0 && loaded) setStage(1);
    const t = window.setTimeout(
      () => setStage((s) => Math.max(s, 2) as Stage),
      FIRST_FRAME_GRACE_MS,
    );
    return () => window.clearTimeout(t);
  }, [loaded, stage]);

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

    let timer = 0;
    const key = (dark: boolean, black: boolean) => `${dark}|${black}`;
    const apply = (dark: boolean, black: boolean) => {
      const before = key(
        root.classList.contains("dark"),
        root.classList.contains("amoled"),
      );
      root.classList.toggle("dark", dark);
      root.classList.toggle("amoled", black);
      const animate = paletteSeeded && before !== key(dark, black);
      if (!animate) return;
      root.classList.add("theme-anim");
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => root.classList.remove("theme-anim"),
        THEME_FADE_MS,
      );
    };
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      const onSystem = () => apply(!mq.matches, amoled && !mq.matches);
      onSystem();
      paletteSeeded = true;
      mq.addEventListener("change", onSystem);
      return () => {
        mq.removeEventListener("change", onSystem);
        window.clearTimeout(timer);
        root.classList.remove("theme-anim");
      };
    }
    apply(theme !== "light", amoled && theme !== "light");
    paletteSeeded = true;
    return () => {
      window.clearTimeout(timer);
      root.classList.remove("theme-anim");
    };
  }, [cfg?.general.theme, cfg?.general.amoled]);

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

function Splash({ stage, streaming }: { stage: Stage; streaming: boolean }) {
  const pct = ((stage + 1) / 4) * 100;
  return (
    <div className="grain relative flex h-screen items-center justify-center overflow-hidden">
      <div className="aura" />
      <div className="relative z-10 flex flex-col items-center gap-7">
        <AppMark size={80} pulse />
        <div className="flex flex-col items-center">
          <AppWordmark size={44} />
          <div className="kicker mt-1.5 h-4 transition-all" key={stage}>
            {t(STAGE_LABEL_KEYS[stage])}
          </div>
        </div>

        <div
          role="progressbar"
          aria-label={t(STAGE_LABEL_KEYS[stage])}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          className="h-1.5 w-60 overflow-hidden rounded-full bg-[var(--panel-strong)] shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)]"
        >
          <div
            className="relative h-full overflow-hidden rounded-full bg-[rgb(var(--glow))] shadow-[0_0_12px_rgb(var(--glow)/0.7)] transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-standard)]"
            style={{ width: `${pct}%` }}
          >
            <span className="saving-bar absolute inset-y-0 left-0 w-1/3 bg-white/30" />
          </div>
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

function LoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
  const [retrying, setRetrying] = useState(false);
  const retry = () => {
    setRetrying(true);
    onRetry();
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
