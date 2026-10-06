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

/**
 * The colour the `--glow` variable is painted with.
 *
 * The decision behind it — which source wins, and therefore what the Overview's
 * provenance chip should say — lives in `useAccent`, shared with the tab that
 * names the source. This wrapper stays so the call site keeps reading as "the
 * glow", which is all Shell does with it.
 */
function useGlow() {
  return useAccent().rgb;
}

/** Full-window boot splash shown until the backend hands us the config. */
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
                {/* The reading link, under the action: two intentions, two
                    weights. A toast has no room for two equal buttons, and
                    installing is the one that should look like the default. */}
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
                  className="h-full bg-[rgb(var(--glow))] shadow-[0_0_8px_rgb(var(--glow)/0.7)] transition-[width] var(--motion-base) var(--ease-standard)"
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

/**
 * The config avatar, and the only place configs are switched from.
 *
 * It lives in the header rather than on a tab because it describes the machine
 * rather than the screen: the previous version sat beside the greeting and
 * therefore disappeared the moment you opened the Lighting tab, which is
 * exactly when you might want to leave a setup.
 */
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
        // A caret over the face on hover: the one cue that this mark opens a
        // switcher rather than being the profile's portrait.
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


/** "?" overlay: the keyboard map, since the hints only show on hover. */
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

export default function Shell() {
  // One delegated listener covers every `data-tip` in the tree, which is how
  // the long tail of controls that used to set a native `title` now get the
  // app's own tooltip without each one being wrapped.
  useEffect(() => installDelegatedTooltips(), []);
  const [tab, setTab] = useState<TabId>("overview");
  // Navigation requested from outside the dashboard — the update toast sends
  // the user to the changelog this way. The tab lives here rather than in the
  // store because it is the one piece of navigation state no store consumer
  // needs, which leaves a module-level toast unable to change it. The request
  // is cleared as it is applied so it cannot re-fire on a later render.
  //
  // Checked rather than cast, because the store holds a plain string: a request
  // naming a tab that does not exist would set the pane to an id nothing
  // renders, leaving the dashboard blank with no error.
  const navRequest = useStore((s) => s.navRequest);
  const clearNavRequest = useStore((s) => s.clearNavRequest);
  const paneRef = useRef<HTMLDivElement>(null);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  useEffect(() => {
    if (!navRequest) return;
    // Split in two on purpose. `setTab` commits a render in which the pane may
    // still be suspended, so the anchor is looked for on the next frame rather
    // than in this one, and dropped if the tab has no such anchor -- landing on
    // the right screen is worth doing even when the spot does not exist.
    if (isTabId(navRequest.tab)) {
      setTab(navRequest.tab);
      const anchor = navRequest.anchor;
      setPendingAnchor(
        anchor && isAnchorFor(navRequest.tab, anchor) ? anchor : null,
      );
    }
    clearNavRequest();
  }, [navRequest, clearNavRequest]);

  // Scroll the anchor into view once the pane has actually rendered.
  //
  // Retried across frames because every tab is `lazy()`: the first frame after a
  // switch is the Suspense skeleton, and an anchor found -- or given up on --
  // there would be a decision made about markup that did not exist yet. The
  // budget is bounded so a genuinely absent anchor cannot leave a frame loop
  // running for the life of the window.
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
      // Ctrl+B folds the rail away — the sidebar eats ~216px of a laptop
      // screen, and folding it is a two-finger keypress away.
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
        <Sidebar
          tab={tab}
          onNavigate={setTab}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((v) => !v)}
          onSearch={() => setPaletteOpen(true)}
          onShortcuts={() => setShortcutsOpen(true)}
        />

        {/* ---------- workspace ---------- */}
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
            {/* Fluid, not a fixed 1400px island: on a maximized 1440p/4K
                window a hard cap left a dead gutter wider than the sidebar
                beside it. The cap still stops an ultrawide from stretching a
                single column across three feet of glass. */}
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
            <IconPause className="h-4 w-4" />
            {t("shell.wallpaper-paused-by-system")}
          </div>
        </div>
      )}
    </div>
  );
}