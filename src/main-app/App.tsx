import { useEffect } from "react";
import { useStore, bindEvents } from "./store";
import Shell from "./components/Shell";
import { IconRefresh } from "./components/icons";
import { GLOW_TEXT_DARK } from "@shared/constants";

export default function App() {
  const { cfg, loaded, loadError, load } = useStore();

  useEffect(() => {
    load();
    const unbind = bindEvents();
    return () => {
      unbind.then((f) => f());
    };
  }, [load]);

  useEffect(() => {
    const root = document.documentElement;
    const theme = cfg?.general.theme ?? "dark";
    root.classList.toggle("dark", theme !== "light");
  }, [cfg?.general.theme]);

  if (!loaded) {
    return <Splash />;
  }

  if (loadError) {
    return <LoadError error={loadError} onRetry={() => load()} />;
  }

  return <Shell />;
}

/** Boot splash: the LumenDeck LED mark, softly breathing. */
function Splash() {
  return (
    <div className="grain relative flex h-screen items-center justify-center overflow-hidden">
      <div className="aura" />
      <div className="relative z-10 flex flex-col items-center gap-6">
        <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-3xl border border-[rgb(var(--glow)/0.45)] shadow-[0_0_40px_-4px_rgb(var(--glow)/0.8)]">
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 120% at 50% 0%, rgb(var(--glow) / 0.5), transparent 70%)",
            }}
          />
          <div className="relative h-3 w-3 animate-[lbreath_2.4s_ease-in-out_infinite] rounded-full bg-white shadow-[0_0_16px_4px_rgb(var(--glow))]" />
        </div>
        <div className="flex flex-col items-center">
          <div className="lednum text-lg tracking-[0.14em] text-[var(--text)]">LUMEN DECK</div>
          <div className="kicker mt-1">igniting light engine</div>
        </div>
        <div className="h-[3px] w-36 overflow-hidden rounded-full bg-[var(--line-strong)]">
          <div className="h-full w-1/2 animate-[loadingbar_1.1s_ease-in-out_infinite] rounded-full bg-[rgb(var(--glow))] shadow-[0_0_8px_rgb(var(--glow))]" />
        </div>
      </div>
      <style>{`@keyframes loadingbar{0%{transform:translateX(-110%)}100%{transform:translateX(320%)}}`}</style>
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