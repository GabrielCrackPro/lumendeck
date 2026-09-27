import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { IconBulb, IconImage, IconSticker, IconGear, IconPause, IconZap, IconRailCollapse } from "./icons";
import { DEFAULT_GLOW } from "@shared/constants";
import TitleBar from "./TitleBar";

// Tab code is split so the initial bundle only carries the Overview; other
// tabs stream in on first visit (Tauri serves chunks locally, so it's fast).
const OverviewTab = lazy(() => import("./tabs/OverviewTab"));
const RgbTab = lazy(() => import("./tabs/RgbTab"));
const WallpaperTab = lazy(() => import("./tabs/WallpaperTab"));
const StickersTab = lazy(() => import("./tabs/StickersTab"));
const GeneralTab = lazy(() => import("./tabs/GeneralTab"));

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
];

const SETTINGS_TAB: {
  id: TabId;
  label: string;
  blurb: string;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
} = { id: "general", label: "Settings", blurb: "App & system", icon: IconGear };

/**
 * Resolve the UI accent glow. Priority: the wallpaper's own dominant color
 * (the UI breathes with the wallpaper — the whole point of the app), then the
 * user's explicit device pick, then static color, then the default.
 */
function useGlow() {
  const deviceColors = useStore((s) => s.deviceColors);
  const mode = useStore((s) => s.cfg?.rgb.mode);
  const staticColor = useStore((s) => s.cfg?.rgb.staticColor);
  const excluded = useStore((s) => s.cfg?.rgb.excludedDevices);
  const devices = useStore((s) => s.rgb.devices);
  const accentDevice = useStore((s) => s.cfg?.rgb.accentDevice);
  const accentLive = useStore((s) => s.cfg?.general.accentLive);
  const wallpaperColor = useStore((s) => s.wallpaperColor);
  // Prefer a wallpaper color that is visibly non-black: a dark scene must not
  // tint the whole UI unreadably dark. Smooth toward it; the broadcast is
  // already rate-limited (1/s, meaningful deltas only) backend-side.
  const wpColor =
    wallpaperColor && wallpaperColor.some((v) => v > 24)
      ? wallpaperColor
      : null;
  return useMemo<[number, number, number]>(() => {
    const fallback =
      mode === "static" || mode === "breathe" ? staticColor : undefined;
    // Wallpaper color leads when present: the interface IS the wallpaper's
    // mood. (wallpaperPaused frames freeze too — fine, color stays coherent.)
    if (accentLive && wpColor) return wpColor;
    // Default: UI accent is calm — frozen to the static color (animation and
    // audio-reactive modes get a stable accent instead of flickering).
    if (!accentLive) {
      return staticColor ?? fallback ?? DEFAULT_GLOW;
    }
    // "Off" (-1): freeze the accent to the configured static color.
    if (accentDevice === -1) {
      return staticColor ?? fallback ?? DEFAULT_GLOW;
    }
    // Manual pick wins outright (even if black — the user chose it).
    if (accentDevice != null) {
      const picked = deviceColors[accentDevice]?.rgb;
      if (picked) return picked;
    }
    // Otherwise prefer a device actually in the loop: the keyboard first,
    // then any non-excluded device, so an excluded/black device never tints
    // the whole interface black.
    const excludedSet = new Set(excluded ?? []);
    const activeIds = devices
      .filter((d) => !excludedSet.has(d.id))
      .sort((a, b) => {
        const kb = (x: typeof a) => (/keyboard/i.test(x.typeName) ? 0 : 1);
        return kb(a) - kb(b);
      })
      .map((d) => d.id);
    const live =
      activeIds.map((id) => deviceColors[id]?.rgb).find((c) => c != null) ??
      Object.values(deviceColors).find((c) => c.rgb.some((v) => v > 0))?.rgb;
    return live ?? wpColor ?? fallback ?? DEFAULT_GLOW;
  }, [deviceColors, mode, staticColor, excluded, devices, accentDevice, accentLive, wpColor]);
}

/** Full-window boot splash shown until the backend hands us the config. */
function BootSplash() {
  return (
    <div className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-4">
      <img
        src="/app-icon.png"
        alt=""
        className="h-14 w-14 animate-[lpage_0.6s_ease-out_both] rounded-xl border border-[rgb(var(--glow)/0.5)]"
      />
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 w-4 animate-[lpulse_1.4s_ease-in-out_infinite] rounded-[2px] bg-[rgb(var(--glow))]"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>
      <div className="kicker">initializing engine</div>
    </div>
  );
}

/** Bottom-right transient notifications. */
function Toasts() {
  const { toasts, dismissToast } = useStore();
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      setTimeout(() => dismissToast(t.id), t.tone === "error" ? 7000 : 4000),
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismissToast]);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className={`pointer-events-auto flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm shadow-[0_16px_40px_-12px_rgb(0_0_0/0.6)] backdrop-blur transition-all page-enter-header ${
            t.tone === "error"
              ? "border-red-500/30 bg-red-500/12 text-red-200"
              : t.tone === "ok"
                ? "border-emerald-500/30 bg-emerald-500/12 text-emerald-200"
                : "border-[var(--line)] bg-[var(--panel-strong)] text-[var(--text)]"
          }`}
        >
          <span
            className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
              t.tone === "error"
                ? "bg-red-400"
                : t.tone === "ok"
                  ? "bg-emerald-400"
                  : "bg-[rgb(var(--glow))]"
            }`}
          />
          <span className="min-w-0 flex-1 leading-relaxed">{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

/** Live status readout pinned to the right of the header. */
function HeaderStatus() {
  const rgb = useStore((s) => s.rgb);
  const wallpaperPaused = useStore((s) => s.wallpaperPaused);
  const excluded = useStore((s) => s.cfg?.rgb.excludedDevices);
  const active = rgb.devices.filter((d) => !(excluded ?? []).includes(d.id));
  const ledCount = active.reduce((n, d) => n + d.leds, 0);
  // Quiet mono readout instead of pills: dot + text, separated by hairlines.
  return (
    <div className="flex shrink-0 items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
      <span className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            wallpaperPaused
              ? "bg-amber-400"
              : "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
          }`}
        />
        {wallpaperPaused ? "paused" : "live"}
      </span>
      <span className="h-3 w-px bg-[var(--line-strong)]" />
      <span className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            rgb.connected
              ? "bg-emerald-400"
              : "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.7)]"
          }`}
        />
        {rgb.connected ? `${active.length}/${rgb.devices.length} · ${ledCount.toLocaleString()} leds` : "openrgb offline"}
      </span>
    </div>
  );
}

/** Skeleton matching a tab's card rhythm while a lazy chunk streams in. */
function TabSkeleton() {
  return (
    <div className="stagger space-y-6">
      <div className="glass h-44" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass h-64" />
        <div className="glass h-64" />
      </div>
    </div>
  );
}

/** One sidebar entry — shared by the main tabs and the pinned Settings item. */
function NavItem({
  item,
  active,
  collapsed,
  dim,
  onClick,
}: {
  item: (typeof TABS)[number];
  active: boolean;
  collapsed: boolean;
  dim: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      title={item.blurb}
      className={`group relative flex w-full items-center gap-2.5 overflow-hidden rounded-md px-2.5 py-[7px] text-left transition-all duration-150 ${
        active
          ? "bg-[rgb(var(--glow)/0.13)] text-[rgb(var(--glow))]"
          : dim
            ? "text-[var(--text-faint)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
            : "text-[var(--text-dim)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
      } ${collapsed ? "justify-center" : ""}`}
    >
      {/* active marker: full-height accent bar on the left edge */}
      {active && (
        <span className="absolute inset-y-[3px] left-0 w-[3px] rounded-r-sm bg-[rgb(var(--glow))]" />
      )}
      <Icon className={`h-[16px] w-[16px] shrink-0 ${active ? "" : "opacity-80"}`} />
      {!collapsed && (
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-tight">
          {item.label}
        </span>
      )}
      {!collapsed && (
        <kbd className="rounded-[3px] border border-[var(--line)] px-1 font-mono text-[9px] text-[var(--text-faint)] opacity-0 transition-opacity group-hover:opacity-100">
          {(TABS.findIndex((t) => t.id === item.id) + 1) || 5}
        </kbd>
      )}
    </button>
  );
}

/** Rail footer pulse: a heartbeat that proves the engine loop is streaming. */
function EnginePulse() {
  const rgb = useStore((s) => s.rgb);
  const live = Object.values(useStore((s) => s.deviceColors)).some(
    (c) => c.rgb.some((v) => v > 0),
  );
  const tone = !rgb.connected
    ? "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]"
    : live
      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-[lpulse_2s_ease-in-out_infinite]"
      : "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} />;
}

export default function Shell() {
  const [tab, setTab] = useState<TabId>("overview");
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const { wallpaperPaused, cfg, loaded, saving } = useStore();
  const glow = useGlow();

  useEffect(() => {
    try {
      localStorage.setItem("sidebar-collapsed", String(collapsed));
    } catch {}
  }, [collapsed]);

  useEffect(() => {
    document.documentElement.style.setProperty("--glow", glow.join(" "));
  }, [glow]);

  // Keyboard navigation: Ctrl+1..5 jump between tabs. The dashboard is used
  // alongside games/media where the mouse is busy — instant tab switching
  // makes the tray-open flow feel native.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > TABS.length + 1) return;
      e.preventDefault();
      setTab(n <= TABS.length ? TABS[n - 1]!.id : SETTINGS_TAB.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = TABS.find((t) => t.id === tab) ?? (tab === SETTINGS_TAB.id ? SETTINGS_TAB : TABS[0])!;

  return (
    <div className="grain relative flex h-screen flex-col overflow-hidden">
      <div className="aura" />
      {/* custom frame: drag region + window controls (window is frameless) */}
      <TitleBar />
      <div className="flex min-h-0 flex-1 p-2 pt-0">

      {/* config-save in flight: hairline progress under the header */}
      {saving && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
          <div className="saving-bar h-full w-1/3 bg-[rgb(var(--glow))] shadow-[0_0_10px_rgb(var(--glow))]" />
        </div>
      )}

      <div className="relative z-10 flex min-h-0 w-full flex-1 gap-2">
        {/* ---------- floating glass rail ---------- */}
        <nav
          className={`flex shrink-0 flex-col rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow)] backdrop-blur-xl transition-[width] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] ${
            collapsed ? "w-[60px]" : "w-[200px]"
          }`}
        >
          {/* brand + collapse toggle */}
          <div className={`flex items-center justify-between border-b border-[var(--line)] px-3 py-3 ${collapsed ? "flex-col gap-2" : ""}`}>
            <div className={`flex items-center gap-2.5 ${collapsed ? "justify-center" : ""}`}>
              <img
                src="/app-icon.png"
                alt="LumenDeck"
                className="h-8 w-8 shrink-0 rounded-lg border border-[var(--line-strong)]"
              />
              {!collapsed && (
                <div className="min-w-0">
                  <div className="lednum truncate text-[12px] tracking-[0.1em] text-[var(--text)]">
                    LUMENDECK
                  </div>
                  <div className="kicker mt-0.5">v{__APP_VERSION__}</div>
                </div>
              )}
            </div>
            {!collapsed && (
              <button
                onClick={() => setCollapsed((v) => !v)}
                title="Collapse sidebar"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] transition-colors hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
              >
                <IconRailCollapse
                  className={`h-[14px] w-[14px] transition-transform duration-300 ${
                    collapsed ? "rotate-180" : ""
                  }`}
                />
              </button>
            )}
          </div>

          {/* nav: grouped sections (spaces the eye; finds things faster) */}
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2">
            {!collapsed && <div className="kicker px-1 pb-1.5 pt-2">overview</div>}
            <NavItem
              item={TABS[0]!}
              active={tab === TABS[0]!.id}
              collapsed={collapsed}
              dim={false}
              onClick={() => setTab(TABS[0]!.id)}
            />
            {!collapsed && <div className="kicker px-1 pb-1.5 pt-3">customize</div>}
            {TABS.filter((t) => t.id !== "overview").map((t) => (
              <NavItem
                key={t.id}
                item={t}
                active={tab === t.id}
                collapsed={collapsed}
                dim={false}
                onClick={() => setTab(t.id)}
              />
            ))}
            {!collapsed && <div className="kicker px-1 pb-1.5 pt-3">system</div>}
            <NavItem
              item={SETTINGS_TAB}
              active={tab === SETTINGS_TAB.id}
              collapsed={collapsed}
              dim
              onClick={() => setTab(SETTINGS_TAB.id)}
            />
          </div>
          {/* rail footer: live engine pulse — glanceable without the header */}
          <div className="border-t border-[var(--line)]">
            <div
              className={`flex items-center gap-2 px-4 py-2.5 ${
                collapsed ? "justify-center" : ""
              }`}
            >
              <EnginePulse />
              {!collapsed && (
                <span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
                  engine live
                </span>
              )}
            </div>
            {collapsed && (
              <button
                onClick={() => setCollapsed((v) => !v)}
                title="Expand sidebar"
                className="flex w-full items-center justify-center pb-2.5 text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
              >
                <IconRailCollapse className="h-[14px] w-[14px] rotate-180" />
              </button>
            )}
          </div>
        </nav>

        {/* ---------- workspace ---------- */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_60%,var(--panel))] shadow-[var(--shadow)] backdrop-blur-xl">
          {!loaded ? (
            <BootSplash />
          ) : (
          <>
          <header className="flex min-h-[52px] shrink-0 items-center justify-between gap-4 border-b border-[var(--line)] bg-[var(--panel-sunken)] px-5">
            <div key={tab} className="page-enter-header flex min-w-0 items-center gap-3">
              <h1 className="lednum shrink-0 text-[15px] leading-none text-[var(--text)]">{current.label}</h1>
              <span className="hidden h-3.5 w-px bg-[var(--line-strong)] sm:block" />
              <div className="kicker hidden truncate sm:block">{current.blurb}</div>
            </div>
            <HeaderStatus />
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div key={tab} className="page-enter mx-auto w-full max-w-[1400px]">
              <Suspense fallback={<TabSkeleton />}>
                {tab === "overview" && <OverviewTab onNavigate={(t) => setTab(t as TabId)} />}
                {tab === "rgb" && <RgbTab />}
                {tab === "wallpaper" && <WallpaperTab />}
                {tab === "stickers" && <StickersTab />}
                {tab === "general" && <GeneralTab />}
              </Suspense>
            </div>
          </div>
          </>
          )}
        </main>
      </div>
      </div>

      <Toasts />

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