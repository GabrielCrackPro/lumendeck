import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { IconBulb, IconImage, IconSticker, IconSliders, IconPause, IconZap } from "./icons";
import GeneralTab from "./tabs/GeneralTab";
import RgbTab from "./tabs/RgbTab";
import WallpaperTab from "./tabs/WallpaperTab";
import StickersTab from "./tabs/StickersTab";
import OverviewTab from "./tabs/OverviewTab";

type TabId = "overview" | "rgb" | "wallpaper" | "stickers" | "general";

const TABS: {
  id: TabId;
  label: string;
  blurb: string;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
}[] = [
  { id: "overview", label: "Overview", blurb: "At a glance", icon: IconZap },
  { id: "rgb", label: "Lighting", blurb: "RGB engine", icon: IconBulb },
  { id: "wallpaper", label: "Wallpaper", blurb: "Sources & zones", icon: IconImage },
  { id: "stickers", label: "Stickers", blurb: "Overlays", icon: IconSticker },
  { id: "general", label: "General", blurb: "System", icon: IconSliders },
];

/** Resolve the accent glow from whatever is live on the devices. */
function useGlow() {
  const deviceColors = useStore((s) => s.deviceColors);
  const mode = useStore((s) => s.cfg?.rgb.mode);
  const staticColor = useStore((s) => s.cfg?.rgb.staticColor);
  return useMemo<[number, number, number]>(() => {
    const live = Object.values(deviceColors)[0]?.rgb;
    const fallback =
      mode === "static" || mode === "breathe" ? staticColor : undefined;
    return live ?? fallback ?? [56, 189, 248];
  }, [deviceColors, mode, staticColor]);
}

export default function Shell() {
  const [tab, setTab] = useState<TabId>("overview");
  const { rgb, wallpaperPaused, cfg } = useStore();
  const glow = useGlow();

  useEffect(() => {
    document.documentElement.style.setProperty("--glow", glow.join(" "));
  }, [glow]);

  // Uplift the LED total from the device registry.
  const ledTotal = useMemo(
    () => rgb.devices.reduce((n, d) => n + d.leds, 0),
    [rgb.devices],
  );

  const current = TABS.find((t) => t.id === tab) ?? TABS[0]!;

  return (
    <div className="grain relative flex h-screen overflow-hidden">
      <div className="aura" />

      <div className="relative z-10 flex h-full w-full">
        {/* ---------- glass rail ---------- */}
        <nav className="flex w-[200px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--panel)] backdrop-blur-xl">
          <div className="px-5 pb-6 pt-6">
            <div className="flex items-center gap-2.5">
              <img
                src="/app-icon.png"
                alt="LumenDeck"
                className="h-9 w-9 rounded-xl border border-[rgb(var(--glow)/0.4)] shadow-[0_0_24px_-6px_rgb(var(--glow)/0.8)]"
              />
              <div className="min-w-0">
                <div className="lednum truncate text-[13px] tracking-[0.08em] text-[var(--text)]">
                  LUMEN&nbsp;DECK
                </div>
                <div className="kicker mt-0.5">light platform</div>
              </div>
            </div>
          </div>

          <div className="space-y-1 px-3">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  title={t.blurb}
                  className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-left transition-all duration-200 ${
                    active
                      ? "bg-[linear-gradient(90deg,rgb(var(--glow)/0.16),rgb(var(--glow)/0.03))] text-[rgb(var(--glow))]"
                      : "text-[var(--text-dim)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
                  }`}
                >
                  {active && (
                    <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-[rgb(var(--glow))] shadow-[0_0_10px_rgb(var(--glow))]" />
                  )}
                  <Icon className="h-[17px] w-[17px] shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
                    {t.label}
                  </span>
                  <span
                    className={`h-1 w-1 shrink-0 rounded-full transition-opacity ${
                      active
                        ? "bg-[rgb(var(--glow))] opacity-100 shadow-[0_0_6px_rgb(var(--glow))]"
                        : "opacity-0"
                    }`
                  }
                  />
                </button>
              );
            })}
          </div>

          <div className="mt-auto border-t border-[var(--line)] px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-mono text-[11px] text-[var(--text-dim)]">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    rgb.connected
                      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                      : "bg-[var(--line-strong)]"
                  }`}
                />
                openrgb
              </span>
              <span
                className={`font-mono text-[11px] ${
                  rgb.connected ? "text-emerald-300" : "text-[var(--text-faint)]"
                }`}
              >
                {rgb.connected ? `${rgb.devices.length}·${ledTotal.toLocaleString()}` : "off"}
              </span>
            </div>
          </div>
        </nav>

        {/* ---------- workspace ---------- */}
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--panel)_75%,transparent)] px-8 py-5 backdrop-blur-xl">
          <div className="min-w-0">
              <div className="kicker mb-1">{current.blurb}</div>
              <h1 className="lednum truncate text-xl text-[var(--text)]">{current.label}</h1>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div key={tab} className="page-enter mx-auto w-full max-w-[1400px]">
              {tab === "overview" && <OverviewTab onNavigate={(t) => setTab(t as TabId)} />}
              {tab === "rgb" && <RgbTab />}
              {tab === "wallpaper" && <WallpaperTab />}
              {tab === "stickers" && <StickersTab />}
              {tab === "general" && <GeneralTab />}
            </div>
          </div>
        </main>
      </div>

      {/* Pause pill when the engine is idle but enabled */}
      {cfg?.general.wallpaperEnabled && wallpaperPaused && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-20 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 font-mono text-[11px] tracking-wide text-amber-200 shadow-[0_12px_30px_-10px_rgba(245,158,11,0.4)] backdrop-blur">
            <IconPause className="h-3.5 w-3.5" />
            wallpaper paused by system
          </div>
        </div>
      )}
    </div>
  );
}