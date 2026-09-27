import { useEffect, useState } from "react";
import { useStore, bindEvents } from "./store";
import Shell from "./components/Shell";
import Onboarding from "./components/Onboarding";
import { IconRefresh } from "./components/icons";
import { GLOW_TEXT_DARK } from "@shared/constants";

/**
 * Boot readiness gates. The splash stays up until ALL of these pass so the
 * user never sees a half-built interface (empty cards, stale counters):
 *   1. config + RGB status loaded from the backend
 *   2. the first RGB frame arrived (engine is actually streaming)
 *   3. a short beat for lazy tab chunks to warm + the window to settle
 * If the engine never streams a frame (no OpenRGB, all devices excluded),
 * gate 2 falls away after a grace period instead of blocking forever.
 */
const FIRST_FRAME_GRACE_MS = 4000;
const MIN_SPLASH_MS = 900; // avoids a jarring flash of the splash

type Stage = 0 | 1 | 2 | 3;
const STAGE_LABEL: Record<Stage, string> = {
  0: "connecting to the engine",
  1: "reading your setup",
  2: "waking the lights",
  3: "polishing the glass",
};

export default function App() {
  const { cfg, loaded, loadError, load } = useStore();
  // Splash holds until `ready`; `stage` drives the splash's progress copy.
  const [stage, setStage] = useState<Stage>(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    load();
    const unbind = bindEvents();
    return () => {
      unbind.then((f) => f());
    };
  }, [load]);

  // Stage machine: advance as real readiness signals arrive.
  useEffect(() => {
    if (stage === 0 && loaded) setStage(1);
    // Gate 2's grace: don't wait forever for a first frame.
    const t = window.setTimeout(() => setStage((s) => Math.max(s, 2) as Stage), FIRST_FRAME_GRACE_MS);
    return () => window.clearTimeout(t);
  }, [loaded, stage]);

  useEffect(() => {
    if (stage < 2) return;
    const t = window.setTimeout(() => setStage(3), 350);
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
    const theme = cfg?.general.theme ?? "dark";
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

  if (loadError) {
    return <LoadError error={loadError} onRetry={() => load()} />;
  }

  if (!ready) {
    return <Splash stage={stage} />;
  }

  if (cfg && !cfg.general.onboarded) {
    return <Onboarding onDone={() => window.location.reload()} />;
  }

  return <Shell />;
}

/** Boot splash: the LumenDeck LED mark with live staging readout. */
function Splash({ stage }: { stage: Stage }) {
  const steps = [0, 1, 2, 3];
  const pct = ((stage + 1) / 4) * 100;
  return (
    <div className="grain relative flex h-screen items-center justify-center overflow-hidden">
      <div className="aura" />
      <div className="relative z-10 flex flex-col items-center gap-7">
        <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-[1.4rem] border border-[rgb(var(--glow)/0.45)]">
          <img
            src="/app-icon.png"
            alt=""
            className="h-full w-full object-cover animate-[lbreath_2.4s_ease-in-out_infinite]"
          />
        </div>
        <div className="flex flex-col items-center">
          <div className="lednum text-xl tracking-[0.16em] text-[var(--text)]">LUMEN&nbsp;DECK</div>
          <div className="kicker mt-1.5 h-4 transition-all" key={stage}>
            {STAGE_LABEL[stage]}
          </div>
        </div>
        {/* segmented progress: one block per readiness stage */}
        <div className="flex gap-1.5">
          {steps.map((s) => (
            <span
              key={s}
              className={`h-1 w-10 rounded-full transition-all duration-500 ${
                s <= stage
                  ? "bg-[rgb(var(--glow))] shadow-[0_0_8px_rgb(var(--glow))]"
                  : "bg-[var(--line-strong)]"
              }`}
            />
          ))}
        </div>
        <div className="font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
          {pct.toFixed(0)}%
        </div>
      </div>
    </div>
  );
}

/** Backend connect failure — readable reason + a glowing retry. */
function LoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
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
          <h1 className="lednum text-xl text-[var(--text)]">Backend offline</h1>
          <p className="mt-2 text-sm text-[var(--text-dim)]">
            LumenDeck couldn&apos;t reach its Rust engine. Make sure the app wasn&apos;t
            closed and try again.
          </p>
        </div>
        <pre className="w-full overflow-auto rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-3 text-left font-mono text-[11px] leading-relaxed text-[var(--text-dim)]">
          {error}
        </pre>
        <button
          onClick={onRetry}
          className="glow-fill inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-transform active:scale-[0.97]"
          style={{ color: GLOW_TEXT_DARK }}
        >
          <IconRefresh className="h-4 w-4" />
          Retry connection
        </button>
      </div>
    </div>
  );
}
