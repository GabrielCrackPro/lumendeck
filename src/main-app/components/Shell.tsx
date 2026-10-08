import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { IconPause, IconCheck, IconAlert, IconInfo, IconChevronDown } from "./icons";
import { useAccent } from "../useAccent";
import TitleBar from "./TitleBar";
import { AppMark, ComboCaps } from "./ui";
import Sidebar, {
  ANCHOR_FRAMES,
  SETTINGS_TAB,
  TABS,
  anchorSelector,
  isAnchorFor,
  isTabId,
  shortcutRows,
} from "./Sidebar";
import type { TabId } from "./Sidebar";
import { t } from "../i18n";
import { ConfigAvatar } from "./ConfigAvatar";
import { ConfigPickerModal } from "./ConfigPickerModal";
import { useConfigPicker } from "./useConfigPicker";
import { isLiveStatus } from "./liveStatus";
import { installDelegatedTooltips } from "./Tooltip";

function currentGlow(): [number, number, number] | null {
  const raw = document.documentElement.style.getPropertyValue("--glow").trim();
  const parts = raw.split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((v) => !Number.isFinite(v))) return null;
  return parts as [number, number, number];
}
const CommandPalette = lazy(() => import("./CommandPalette"));

const OverviewTab = lazy(() => import("./tabs/OverviewTab"));
const RgbTab = lazy(() => import("./tabs/RgbTab"));
const WallpaperTab = lazy(() => import("./tabs/WallpaperTab"));
const StickersTab = lazy(() => import("./tabs/StickersTab"));
const GeneralTab = lazy(() => import("./tabs/GeneralTab"));

function useGlow() {
  return useAccent().rgb;
}

function BootSplash() {
  return (
    <div className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-5">
      <AppMark size={56} pulse />
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1 w-8 rounded-full pulse-slow bg-[rgb(var(--glow))] shadow-[0_0_6px_rgb(var(--glow))]"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
        <div className="kicker">{t("shell.initializing-engine")}</div>
      </div>
    </div>
  );
}

const MAX_TOASTS = 4;

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
  const shown = toasts.slice(-MAX_TOASTS);
  const hidden = toasts.length - shown.length;
  return (
    <div
      role="region"
      aria-label={t("shell.notifications")}
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
              <span className="relative mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full ${tone.chip}`}
                >
                  <ToneIcon className="h-4 w-4" />
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
                {

 }
                {t.link && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      t.link!.run();
                    }}
                    className="mt-1.5 text-[11px] font-medium text-[var(--text-faint)] underline underline-offset-2 transition-colors hover:text-[var(--text-dim)]"
                  >
                    {t.link.label}
                  </button>
                )}
              </div>
            </div>
            {t.progress != null && (
              <div className="h-1 w-full bg-[var(--panel-sunken)]">
                <div
                  className="h-full bg-[rgb(var(--glow))] shadow-[0_0_8px_rgb(var(--glow)/0.7)] transition-[width] duration-[var(--motion-base)] ease-[var(--ease-standard)]"
                  style={{ width: `${Math.max(2, Math.min(100, t.progress))}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
      {hidden > 0 && (
        <div className="pointer-events-auto self-end rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-2.5 py-1 font-mono text-[10px] text-[var(--text-faint)]">
          {`+${hidden} ${t("shell.older")}`}
        </div>
      )}
    </div>
  );
}

function HeaderConfigAvatar() {
  const picker = useConfigPicker();
  const rgbConnected = useStore((s) => s.rgb.connected);
  const wallpaperPaused = useStore((s) => s.wallpaperPaused);
  const wallpaperEnabled = useStore((s) => s.cfg?.general.wallpaperEnabled ?? false);
  const rgbEnabled = useStore((s) => s.cfg?.rgb.enabled ?? false);

  return (
    <>
      <ConfigAvatar
        scene={picker.activeScene}
        onClick={picker.openBrowse}
        overlay={<IconChevronDown className="h-4 w-4" />}
        live={isLiveStatus({
          rgbConnected,
          rgbEnabled,
          wallpaperRunning: wallpaperEnabled && !wallpaperPaused,
        })}
      />
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
    </>
  );
}


function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = shortcutRows();

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("shell.keyboard-shortcuts")}
        className="page-enter-header w-full max-w-sm overflow-hidden rounded-xl border border-[var(--line-strong)] bg-[color-mix(in_srgb,var(--bg)_95%,transparent)] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--panel-sunken)] px-4 py-2.5">
          <h2 className="kicker !text-[var(--text-dim)]">{t("shell.keyboard")}</h2>
          <button
            onClick={onClose}
            aria-label={t("shell.close")}
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
              <ComboCaps keys={r.keys} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

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

export default function Shell() {
  useEffect(() => installDelegatedTooltips(), []);
  const [tab, setTab] = useState<TabId>("overview");
  const navRequest = useStore((s) => s.navRequest);
  const clearNavRequest = useStore((s) => s.clearNavRequest);
  const paneRef = useRef<HTMLDivElement>(null);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  useEffect(() => {
    if (!navRequest) return;
    if (isTabId(navRequest.tab)) {
      setTab(navRequest.tab);
      const anchor = navRequest.anchor;
      setPendingAnchor(
        anchor && isAnchorFor(navRequest.tab, anchor) ? anchor : null,
      );
    }
    clearNavRequest();
  }, [navRequest, clearNavRequest]);

  useEffect(() => {
    if (!pendingAnchor) return;
    let tries = 0;
    let raf = requestAnimationFrame(function attempt() {
      const el = paneRef.current?.querySelector(anchorSelector(pendingAnchor!));
      if (el) {
        (el as HTMLElement).scrollIntoView({ block: "start" });
        setPendingAnchor(null);
        return;
      }
      if (++tries >= ANCHOR_FRAMES) {
        setPendingAnchor(null);
        return;
      }
      raf = requestAnimationFrame(attempt);
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingAnchor, tab]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onOpen = () => setShortcutsOpen(true);
    window.addEventListener("lumendeck:open-shortcuts", onOpen);
    return () => window.removeEventListener("lumendeck:open-shortcuts", onOpen);
  }, []);
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
    root.style.setProperty("--glow", cur.join(" "));
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [glow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((v) => !v);
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
      { }
      <TitleBar />
      <div className="flex min-h-0 flex-1 p-2 pt-0">

      { }
      {saving && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
          <div className="saving-bar h-full w-1/3 bg-[rgb(var(--glow))] shadow-[0_0_10px_rgb(var(--glow))]" />
        </div>
      )}

      <div className="relative z-10 flex min-h-0 w-full flex-1 gap-2">
        { }
        <Sidebar
          tab={tab}
          onNavigate={setTab}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((v) => !v)}
          onSearch={() => setPaletteOpen(true)}
          onShortcuts={() => setShortcutsOpen(true)}
        />

        { }
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_60%,var(--panel))] shadow-[var(--shadow)] backdrop-blur-xl">
          {!loaded ? (
            <BootSplash />
          ) : (
          <>
          <header className="flex min-h-[52px] shrink-0 items-center justify-between gap-4 border-b border-[var(--line)] bg-[var(--panel-sunken)] px-5">
            <div key={tab} className="page-enter-header flex min-w-0 items-center gap-3">
              <h1 className="lednum shrink-0 text-[15px] leading-none text-[var(--text)]">{t(current.label)}</h1>
              <span className="hidden h-3.5 w-px bg-[var(--line-strong)] sm:block" />
              <div className="kicker hidden truncate sm:block">
                {t(current.blurb)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <HeaderConfigAvatar />
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {


 }
            <div
              key={tab}
              ref={paneRef}
              className="page-enter mx-auto w-full max-w-[2600px]"
            >
              <Suspense fallback={<TabSkeleton />}>
                {tab === "overview" && (
                  <OverviewTab
                    onNavigate={(id) => setTab(id as TabId)}
                  />
                )}
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

      { }
      <Suspense fallback={null}>
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onNavigate={(t) => setTab(t as TabId)}
          currentTab={tab}
          onShowShortcuts={() => setShortcutsOpen(true)}
        />
      </Suspense>

      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}

      <Toasts />

      { }
      {cfg?.general.wallpaperEnabled && wallpaperPaused && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-20 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 font-mono text-[11px] tracking-wide text-amber-200 shadow-[0_12px_30px_-10px_rgba(245,158,11,0.4)] backdrop-blur">
            <IconPause className="h-4 w-4" />
            {t("shell.wallpaper-paused-by-system")}
          </div>
        </div>
      )}
    </div>
  );
}