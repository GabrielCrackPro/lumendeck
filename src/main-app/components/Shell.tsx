import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { api } from "../ipc";
import { IconBulb, IconImage, IconSticker, IconGear, IconPause, IconZap, IconRailCollapse, IconSearch, IconCheck, IconAlert, IconInfo } from "./icons";
import { DEFAULT_GLOW } from "@shared/constants";
import { readableOnTheme } from "../accent";
import TitleBar from "./TitleBar";

/** Read the --glow triplet currently on :root, or null when unparsable. */
function currentGlow(): [number, number, number] | null {
  const raw = document.documentElement.style.getPropertyValue("--glow").trim();
  const parts = raw.split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((v) => !Number.isFinite(v))) return null;
  return parts as [number, number, number];
}
const CommandPalette = lazy(() => import("./CommandPalette"));

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
 * Every branch passes through readableOnTheme(): source colors are chosen for
 * hardware/screens, not for legibility on the dashboard, so a near-black
 * wallpaper tone or a dim static shade gets lifted to a readable shade of
 * the same hue instead of smearing into the panels.
 */
function useGlow() {
  const deviceColors = useStore((s) => s.deviceColors);
  const mode = useStore((s) => s.cfg?.rgb.mode);
  const staticColor = useStore((s) => s.cfg?.rgb.staticColor);
  const excluded = useStore((s) => s.cfg?.rgb.excludedDevices);
  const devices = useStore((s) => s.rgb.devices);
  const accentDevice = useStore((s) => s.cfg?.rgb.accentDevice);
  const accentLive = useStore((s) => s.cfg?.general.accentLive);
  const theme = useStore((s) => s.cfg?.general.theme ?? "dark");
  const autoShade = useStore((s) => s.cfg?.general.accentAutoShade ?? 1);
  const wallpaperColor = useStore((s) => s.wallpaperColor);
  // The user's Windows accent color, seeded once via IPC and kept live by the
  // backend watcher (SYSTEM_ACCENT). This is the deep fallback for every
  // config-less case, so a fresh install themes itself from the OS instead of
  // wearing a hardcoded blue, and mid-session OS accent changes retheme the
  // dashboard without a restart.
  const sysAccent = useStore((s) => s.systemAccent);
  useEffect(() => {
    if (sysAccent) return;
    let disposed = false;
    api.systemAccent().then((c) => {
      if (!disposed && c) useStore.getState().setSystemAccent(c);
    }).catch(() => {});
    return () => {
      disposed = true;
    };
  }, [sysAccent]);
  // Prefer a wallpaper color that is visibly non-black: a dark scene must not
  // tint the whole UI unreadably dark. Smooth toward it; the broadcast is
  // already rate-limited (1/s, meaningful deltas only) backend-side.
  const wpColor =
    wallpaperColor && wallpaperColor.some((v) => v > 24)
      ? wallpaperColor
      : null;
  return useMemo<[number, number, number]>(() => {
    // One readability pass for every source: the raw color keeps its identity
    // (hue, character) when it already clears the contrast floor; otherwise it
    // steps toward white/black until the accent is legible on this theme.
    // Strength is user-tunable (Settings > Appearance); 0 = raw colors.
    const pick = (c: [number, number, number]) =>
      readableOnTheme(c, theme === "light" ? "light" : "dark", Math.max(0, Math.min(1, autoShade)));
    const fallback =
      mode === "static" || mode === "breathe" ? staticColor : undefined;
    // Wallpaper color leads when present: the interface IS the wallpaper's
    // mood. (wallpaperPaused frames freeze too — fine, color stays coherent.)
    if (accentLive && wpColor) return pick(wpColor);
    // Default: UI accent is calm — the OS accent leads (staticColor carries
    // a factory default that would otherwise always win and pin the UI to
    // that blue regardless of the user's Windows theme).
    if (!accentLive) {
      return pick(sysAccent ?? staticColor ?? fallback ?? DEFAULT_GLOW);
    }
    // "Off" (-1): freeze the accent to the configured static color.
    if (accentDevice === -1) {
      return pick(staticColor ?? fallback ?? sysAccent ?? DEFAULT_GLOW);
    }
    // Manual pick wins outright (even if black — the user chose it).
    if (accentDevice != null) {
      const picked = deviceColors[accentDevice]?.rgb;
      if (picked) return pick(picked);
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
    return pick(live ?? wpColor ?? fallback ?? sysAccent ?? DEFAULT_GLOW);
  }, [deviceColors, mode, staticColor, excluded, devices, accentDevice, accentLive, wpColor, sysAccent, theme, autoShade]);
}

/** Full-window boot splash shown until the backend hands us the config. */
function BootSplash() {
  return (
    <div className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-5">
      <img
        src="/app-icon.png"
        alt=""
        className="h-14 w-14 animate-[lbreath_2.4s_ease-in-out_infinite] rounded-xl border border-[rgb(var(--glow)/0.5)]"
      />
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1 w-8 rounded-full animate-[lpulse_1.4s_ease-in-out_infinite] bg-[rgb(var(--glow))] shadow-[0_0_6px_rgb(var(--glow))]"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
        <div className="kicker">initializing engine</div>
      </div>
    </div>
  );
}

/** Bottom-right transient notifications. */
const MAX_TOASTS = 4;

/**
 * One look per tone. The panel stays neutral so the icon chip and the
 * title carry the meaning — a fully tinted card shouted over the glass.
 */
const TONE = {
  ok: {
    icon: IconCheck,
    shell: "border-emerald-500/25 bg-[color-mix(in_srgb,var(--panel-strong)_92%,transparent)]",
    chip: "bg-emerald-500/15 text-emerald-400",
    title: "text-emerald-300",
  },
  error: {
    icon: IconAlert,
    shell: "border-red-500/30 bg-[color-mix(in_srgb,var(--panel-strong)_92%,transparent)]",
    chip: "bg-red-500/15 text-red-400",
    title: "text-red-300",
  },
  info: {
    icon: IconInfo,
    shell: "border-[var(--line-strong)] bg-[color-mix(in_srgb,var(--panel-strong)_92%,transparent)]",
    chip: "bg-[rgb(var(--glow)/0.15)] text-[rgb(var(--glow))]",
    title: "text-[rgb(var(--glow))]",
  },
} as const;

function Toasts() {
  const { toasts, dismissToast } = useStore(
    useShallow((s) => ({ toasts: s.toasts, dismissToast: s.dismissToast })),
  );
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      // An actionable toast needs room to actually be read and clicked;
      // a sticky one (an update waiting) does not go on its own at all.
      t.sticky
        ? undefined
        : setTimeout(
            () => dismissToast(t.id),
            t.action ? 12000 : t.tone === "error" ? 7000 : 4000,
          ),
    );
    return () => timers.forEach((t) => t && clearTimeout(t));
  }, [toasts, dismissToast]);

  if (toasts.length === 0) return null;
  // Oldest first, capped: a burst of device connect/disconnect notices
  // should never wallpaper the dashboard.
  const shown = toasts.slice(-MAX_TOASTS);
  const hidden = toasts.length - shown.length;
  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-[21rem] flex-col gap-2"
    >
      {shown.map((t) => {
        const tone = TONE[t.tone];
        const ToneIcon = tone.icon;
        return (
          <div
            key={t.id}
            role="status"
            className={`page-enter-header pointer-events-auto relative overflow-hidden rounded-xl border shadow-[0_16px_40px_-12px_rgb(0_0_0/0.6)] backdrop-blur ${tone.shell}`}
          >
            <div
              onClick={() => dismissToast(t.id)}
              className="flex cursor-pointer items-start gap-3 px-3.5 py-3"
            >
              <span className="relative mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-lg">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-lg ${tone.chip}`}
                >
                  <ToneIcon className="h-3.5 w-3.5" />
                </span>
                {(t.count ?? 1) > 1 && (
                  <span
                    title={`${t.count} times`}
                    className="absolute -right-1.5 -top-1.5 min-w-[15px] rounded-full bg-[var(--panel-strong)] px-1 font-mono text-[9px] font-bold leading-[15px] text-[var(--text)] ring-1 ring-[var(--line-strong)]"
                  >
                    {t.count}
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                {t.title && (
                  <div
                    className={`text-[13px] font-semibold leading-snug ${tone.title}`}
                  >
                    {t.title}
                  </div>
                )}
                <div
                  className={`text-[13px] leading-relaxed ${t.title ? "mt-0.5 text-[var(--text-dim)]" : tone.title}`}
                >
                  {t.msg}
                </div>
                {t.action && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      t.action!.run();
                    }}
                    disabled={t.action.disabled}
                    className={`mt-2.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      t.action.disabled
                        ? "cursor-default border-[var(--line)] text-[var(--text-faint)]"
                        : "border-[rgb(var(--glow)/0.45)] text-[rgb(var(--glow))] hover:bg-[rgb(var(--glow)/0.15)]"
                    }`}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
            </div>
            {t.progress != null && (
              <div className="h-1 w-full bg-[var(--panel-sunken)]">
                <div
                  className="h-full bg-[rgb(var(--glow))] shadow-[0_0_8px_rgb(var(--glow)/0.7)] transition-[width] duration-200"
                  style={{ width: `${Math.max(2, Math.min(100, t.progress))}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
      {hidden > 0 && (
        <div className="pointer-events-auto self-end rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-2.5 py-1 font-mono text-[10px] text-[var(--text-faint)]">
          +{hidden} older
        </div>
      )}
    </div>
  );
}

/** Live status readout pinned to the right of the header. */
function HeaderStatus() {
  const wallpaperPaused = useStore((s) => s.wallpaperPaused);
  // Quiet mono readout: one dot + label. Device/LED counts live in the
  // Lighting tab and Overview — the header stays calm.
  return (
    <div className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          wallpaperPaused
            ? "bg-amber-400"
            : "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
        }`}
      />
      {wallpaperPaused ? "paused" : "live"}
    </div>
  );
}

/** "?" overlay: the keyboard map, since the hints only show on hover. */
function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows: { keys: string[]; what: string }[] = [
    { keys: ["Ctrl", "K"], what: "Command palette" },
    ...TABS.map((t, i) => ({
      keys: ["Ctrl", String(i + 1)],
      what: t.label,
    })),
    { keys: ["Ctrl", "5"], what: SETTINGS_TAB.label },
    { keys: ["?"], what: "This list" },
    { keys: ["Esc"], what: "Close / go back" },
  ];

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="page-enter-header w-full max-w-sm overflow-hidden rounded-xl border border-[var(--line-strong)] bg-[color-mix(in_srgb,var(--bg)_95%,transparent)] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--panel-sunken)] px-4 py-2.5">
          <h2 className="kicker !text-[var(--text-dim)]">Keyboard</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
          >
            ✕
          </button>
        </header>
        <ul className="p-2">
          {rows.map((r) => (
            <li
              key={r.what}
              className="flex items-center justify-between gap-4 rounded-lg px-2.5 py-2"
            >
              <span className="text-sm text-[var(--text-dim)]">{r.what}</span>
              <span className="flex shrink-0 gap-1">
                {r.keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded-[4px] border border-[var(--line-strong)] bg-[var(--panel-strong)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text)]"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Skeleton matching a tab's card rhythm while a lazy chunk streams in.
 * Mimics the Overview grid (hero band + two-column cards) so the swap from
 * skeleton to content moves the least amount of pixels possible.
 */
function TabSkeleton() {
  return (
    <div className="stagger space-y-5">
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <div className="glass h-6 w-52 rounded-md" />
          <div className="glass h-3 w-72 rounded-md" />
        </div>
        <div className="glass h-7 w-20 rounded-lg" />
      </div>
      <div className="grid gap-5 xl:grid-cols-12">
        <div className="glass h-72 xl:col-span-5" />
        <div className="glass h-72 xl:col-span-7" />
      </div>
      <div className="grid gap-5 xl:grid-cols-12">
        <div className="glass h-48 xl:col-span-7" />
        <div className="glass h-48 xl:col-span-5" />
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });

  // Other tabs can open the overlay without owning its state (e.g. the
  // Overview shortcut card).
  useEffect(() => {
    const onOpen = () => setShortcutsOpen(true);
    window.addEventListener("lumendeck:open-shortcuts", onOpen);
    return () => window.removeEventListener("lumendeck:open-shortcuts", onOpen);
  }, []);
  // Scoped so the shell does not re-render on every RGB frame — only the
  // children that actually read device colors need that rate.
  const { wallpaperPaused, cfg, loaded, saving } = useStore(
    useShallow((s) => ({
      wallpaperPaused: s.wallpaperPaused,
      cfg: s.cfg,
      loaded: s.loaded,
      saving: s.saving,
    })),
  );
  const glow = useGlow();

  useEffect(() => {
    try {
      localStorage.setItem("sidebar-collapsed", String(collapsed));
    } catch {}
  }, [collapsed]);

  // Ease the accent instead of snapping. --glow changes its source constantly
  // (OS accent at boot, then the wallpaper's dominant color, then live drift
  // as the wallpaper plays). Snapping between sources reads as a hard flash;
  // a short exponential chase keeps the theme continuous. Done in JS because
  // CSS transitions can't interpolate a space-triplet custom property, and
  // the rAF cost is one string write per frame while converging.
  const glowRef = useRef(glow);
  useEffect(() => {
    glowRef.current = glow;
    const root = document.documentElement;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.style.setProperty("--glow", glow.join(" "));
      return;
    }
    let raf = 0;
    const cur = currentGlow() ?? glow;
    const tick = () => {
      const target = glowRef.current;
      const now = currentGlow() ?? target;
      let settled = true;
      const next = target.map((t, i) => {
        const c = now[i] ?? t;
        const v = c + (t - c) * 0.14;
        if (Math.abs(t - v) > 0.5) settled = false;
        return Math.round(v * 10) / 10;
      }) as [number, number, number];
      root.style.setProperty("--glow", next.join(" "));
      if (!settled) raf = requestAnimationFrame(tick);
      else root.style.setProperty("--glow", target.join(" "));
    };
    // Start from wherever the property actually is (survives HMR/reparent).
    root.style.setProperty("--glow", cur.join(" "));
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [glow]);

  // Keyboard navigation: Ctrl+1..5 jump between tabs. The dashboard is used
  // alongside games/media where the mouse is busy — instant tab switching
  // makes the tray-open flow feel native.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // "?" lists the shortcuts — no modifier, and not while typing.
      if (e.key === "?" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const el = e.target as HTMLElement | null;
        const typing =
          el?.tagName === "INPUT" ||
          el?.tagName === "TEXTAREA" ||
          el?.isContentEditable;
        if (!typing) {
          e.preventDefault();
          setShortcutsOpen((v) => !v);
        }
        return;
      }
      if (e.key === "Escape" && shortcutsOpen) {
        setShortcutsOpen(false);
        return;
      }
      if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > TABS.length + 1) return;
      e.preventDefault();
      setTab(n <= TABS.length ? TABS[n - 1]!.id : SETTINGS_TAB.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcutsOpen]);

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
                  <div className="kicker mt-0.5 flex items-center gap-1.5">
                    v{__APP_VERSION__}
                    {__APP_BUILD_MODE__ === "dev" && (
                      <span className="rounded-sm bg-amber-500/20 px-1 font-mono text-[8.5px] tracking-[0.15em] text-amber-400">
                        DEV
                      </span>
                    )}
                  </div>
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
              {!collapsed && (
                <button
                  onClick={() => setShortcutsOpen(true)}
                  title="Keyboard shortcuts (?)"
                  className="ml-auto rounded px-1 font-mono text-[10px] text-[var(--text-faint)] transition-colors hover:text-[rgb(var(--glow))]"
                >
                  ?
                </button>
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
            <div className="flex shrink-0 items-center gap-3">
              <HeaderStatus />
              {/* Command palette trigger: same actions as Ctrl+K, visible for
                  discoverability (the shortcut still works everywhere). */}
              <button
                onClick={() => setPaletteOpen(true)}
                title="Search commands (Ctrl+K)"
                className="flex h-7 w-44 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--panel-sunken)] px-2.5 text-[var(--text-faint)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[var(--text-dim)]"
              >
                <IconSearch className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 truncate text-left text-[11px]">Search…</span>
                <kbd className="shrink-0 font-mono text-[9px] tracking-widest">CTRL K</kbd>
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {/* Fluid, not a fixed 1400px island: on a maximized 1440p/4K
                window a hard cap left a dead gutter wider than the sidebar
                beside it. The cap still stops an ultrawide from stretching a
                single column across three feet of glass. */}
            <div key={tab} className="page-enter mx-auto w-full max-w-[2600px]">
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

      {/* Command palette (Ctrl+K): quick navigation, wallpaper, scenes. */}
      <Suspense fallback={null}>
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onNavigate={(t) => setTab(t as TabId)}
        />
      </Suspense>

      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}

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