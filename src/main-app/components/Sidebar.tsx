import { useStore } from "../store";
import { AppMark, AppWordmark } from "./ui";
import {
  IconBulb,
  IconGear,
  IconImage,
  IconKeyboard,
  IconRailCollapse,
  IconSearch,
  IconSticker,
  IconZap,
} from "./icons";
import { t } from "../i18n";

export type TabId = "overview" | "rgb" | "wallpaper" | "stickers" | "general";

export interface NavDef {
  id: TabId;
  label: string;
  blurb: string;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  /** Ctrl+N — the shortcuts overlay's rows come from here, not from index. */
  hotkey: number;
}

// Labels and blurbs are catalog keys, resolved at render. The command palette
// and the shortcut overlay both read this same list, so a tab cannot be called
// "Lighting" in the rail and "Iluminación" in the palette — there is one key.
export const TABS: NavDef[] = [
  { id: "overview", label: "nav.overview", blurb: "nav.at-a-glance", icon: IconZap, hotkey: 1 },
  { id: "rgb", label: "nav.lighting", blurb: "nav.rgb-engine", icon: IconBulb, hotkey: 2 },
  { id: "wallpaper", label: "nav.wallpaper", blurb: "nav.sources-and-zones", icon: IconImage, hotkey: 3 },
  { id: "stickers", label: "nav.stickers", blurb: "nav.overlays", icon: IconSticker, hotkey: 4 },
];

export const SETTINGS_TAB: NavDef = {
  id: "general",
  label: "nav.settings",
  blurb: "nav.app-and-system",
  icon: IconGear,
  hotkey: 5,
};

type EngineState = {
  tone: "off" | "offline" | "idle" | "live";
  label: string;
  detail: string;
};

/**
 * The one piece of state the rail carries. A dot alone would be ambiguous, so
 * the label stays — but it lives on a hover, not on the face of the rail: the
 * header already says live/paused and every tab states its own health, so a
 * third always-on caption was noise. The click target stays because "why is
 * that dot red?" always ends in the Lighting tab.
 */
function useEngineState(): EngineState {
  const enabled = useStore((s) => s.cfg?.rgb.enabled ?? false);
  const connected = useStore((s) => s.rgb.connected);
  const lastError = useStore((s) => s.rgb.lastError);
  const devices = useStore((s) => s.rgb.devices.length);
  // Primitive on purpose: read ~30x/s by the RGB frame stream, so it must only
  // wake React when the answer actually changes.
  const lit = useStore((s) => {
    for (const c of Object.values(s.deviceColors)) {
      if (c.rgb.some((v) => v > 0)) return true;
    }
    return false;
  });
  if (!enabled) {
    return {
      tone: "off",
      label: t("nav.lighting-is-off"),
      detail: t("nav.lighting-is-disabled-open-the-lighting-tab-to-tu"),
    };
  }
  if (!connected) {
    return {
      tone: "offline",
      label: t("nav.lighting-offline"),
      detail: lastError
        ? t("nav.openrgb-is-not-reachable-{error}", { error: lastError })
        : t("nav.openrgb-is-not-reachable-open-the-lighting-tab"),
    };
  }
  return {
    tone: lit ? "live" : "idle",
    label: lit ? t("nav.lighting-live") : t("nav.lighting-idle"),
    detail:
      devices === 0
        ? t("nav.connected-but-no-devices-have-reported-yet")
        : lit
          ? t("nav.pushing-colors-to-openrgb-open-the-lighting-tab")
          : t("nav.every-device-is-black-right-now"),
  };
}

const ENGINE_DOT: Record<EngineState["tone"], string> = {
  off: "bg-[var(--text-faint)]",
  offline: "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]",
  idle: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]",
  live: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-[lpulse_2s_ease-in-out_infinite]",
};

/** One rail row. Labels are the only permanent content — everything else is a
 *  hover, so a five-item rail reads as five items and nothing else.
 *
 *  The label stays mounted when the rail folds and fades out of the way, and
 *  the icon keeps the first flex cell in both states, so nothing jumps: the
 *  rows used to re-center their icons the instant the width transition began,
 *  which is exactly the kind of reflow that makes a collapse feel cheap. The
 *  per-row delay staggers the fade into a short cascade. */
function NavItem({
  item,
  index,
  active,
  collapsed,
  onClick,
}: {
  item: NavDef;
  /** Position in the rail, used only to stagger the collapse animation. */
  index: number;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  // Collapsed, the label is gone — so the tooltip has to carry it. It used to
  // show only the blurb ("At a glance"), which told a hovering user nothing
  // about which of five identical icons they were pointing at.
  // Labels stay English in the nav model and are translated where they are
  // shown, so the model keeps working as data (hotkey numbers, tooltips) and
  // one dictionary entry covers both the rail and the shortcut sheet.
  const title = collapsed ? `${t(item.label)} — ${t(item.blurb)}` : t(item.blurb);
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={t(item.label)}
      aria-current={active ? "page" : undefined}
      className={`group relative flex w-full items-center gap-2.5 overflow-hidden rounded-lg py-2 text-left transition-colors duration-150 ${
        collapsed ? "px-3" : "px-2.5"
      } ${
        active
          ? "bg-[rgb(var(--glow)/0.13)] text-[rgb(var(--glow))] shadow-[inset_0_0_0_1px_rgb(var(--glow)/0.18)]"
          : "text-[var(--text-dim)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
      }`}
    >
      {/* active marker: full-height accent bar on the left edge */}
      {active && (
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-sm bg-[rgb(var(--glow))]" />
      )}
      <Icon className={`h-[17px] w-[17px] shrink-0 ${active ? "" : "opacity-80"}`} />
      <span
        style={{ transitionDelay: `${index * 24}ms` }}
        className={`min-w-0 flex-1 truncate text-[13px] font-medium tracking-tight transition-[opacity,transform,filter] duration-200 ease-out ${
          collapsed
            ? "-translate-x-2 opacity-0 blur-[1.5px]"
            : "translate-x-0 opacity-100 blur-0"
        }`}
      >
        {t(item.label)}
      </span>
    </button>
  );
}

/** Search trigger. Same command as Ctrl+K, always on screen. One button in
 *  both states: the glyph never moves, only the text and the shortcut hint
 *  dissolve, so the field narrows with the rail instead of swapping shapes. */
function SearchButton({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={t("nav.search-commands-ctrl-k")}
      aria-label={t("nav.search-commands")}
      className="flex h-8 w-full items-center gap-2 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)] px-2.5 text-[var(--text-faint)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[var(--text-dim)]"
    >
      <IconSearch className="h-4 w-4 shrink-0" />
      <span
        className={`min-w-0 flex-1 truncate text-left text-[12px] transition-[opacity,transform] duration-200 ease-out ${
          collapsed ? "-translate-x-2 opacity-0" : "translate-x-0 opacity-100"
        }`}
      >
        {t("nav.search")}
      </span>
      <kbd
        className={`shrink-0 font-mono text-[9px] tracking-widest transition-opacity duration-150 ${
          collapsed ? "opacity-0" : "opacity-100"
        }`}
      >
        CTRL K
      </kbd>
    </button>
  );
}

/**
 * Status bar: engine heartbeat, shortcut sheet, and the one collapse toggle.
 *
 * The toggle used to live in the header and swap places with the rail's
 * layout when it folded (row one way, column the other), which shoved the app
 * mark sideways mid-animation. One row, one home, no reflow — the header is
 * now identity only.
 */
function RailFooter({
  collapsed,
  onShortcuts,
  onToggleCollapsed,
  onOpenLighting,
}: {
  collapsed: boolean;
  onShortcuts: () => void;
  onToggleCollapsed: () => void;
  onOpenLighting: () => void;
}) {
  const engine = useEngineState();
  return (
    <div className="flex items-center gap-1 border-t border-[var(--line)] px-1.5 py-1.5">
      {/* Dot only: the header already says live/paused and every tab states its
          own health, so a caption here was a third copy of the same fact. The
          tooltip and the click-through to Lighting carry the meaning. */}
      <button
        onClick={onOpenLighting}
        title={t(engine.detail)}
        aria-label={t(engine.label)}
        className="flex h-7 min-w-[22px] flex-1 items-center justify-start rounded-md pl-1 transition-colors hover:bg-[var(--panel-strong)]"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${ENGINE_DOT[engine.tone]}`} />
      </button>
      {/* Collapsed there is no room for a third control; "?" still opens it. */}
      <button
        onClick={onShortcuts}
        title={t("nav.keyboard-shortcuts")}
        aria-label={t("nav.keyboard-shortcuts-2")}
        aria-hidden={collapsed}
        tabIndex={collapsed ? -1 : 0}
        className={`flex h-7 shrink-0 items-center justify-center overflow-hidden rounded-md text-[var(--text-faint)] transition-[opacity,width] duration-200 hover:bg-[var(--panel-strong)] hover:text-[var(--text)] ${
          collapsed ? "w-0 opacity-0" : "w-7 opacity-100"
        }`}
      >
        <IconKeyboard className="h-[15px] w-[15px] shrink-0" />
      </button>
      <button
        onClick={onToggleCollapsed}
        title={t(collapsed ? "nav.expand-sidebar-shortcut" : "nav.collapse-sidebar-shortcut")}
        aria-label={t(collapsed ? "nav.expand-sidebar" : "nav.collapse-sidebar")}
        aria-expanded={!collapsed}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] transition-colors hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
      >
        <IconRailCollapse
          className={`h-[14px] w-[14px] transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] ${
            collapsed ? "rotate-180" : ""
          }`}
        />
      </button>
    </div>
  );
}

/** The app's floating glass rail: identity, search, five rows, a status bar. */
export default function Sidebar({
  tab,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  onSearch,
  onShortcuts,
}: {
  tab: TabId;
  onNavigate: (t: TabId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSearch: () => void;
  onShortcuts: () => void;
}) {
  // Settings is not one of the things you customize — it is the app itself,
  // so one hairline separates it. Three uppercase headings to introduce five
  // rows was the loudest thing in a rail this small.
  const rows = [TABS[0]!, ...TABS.slice(1), SETTINGS_TAB];
  return (
    <nav
      aria-label={t("nav.sections")}
      className={`flex shrink-0 flex-col rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow)] backdrop-blur-xl transition-[width] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] ${
        collapsed ? "w-[58px]" : "w-[200px]"
      }`}
    >
      {/* Identity only — the collapse toggle lives in the status bar, so this
          row is one flex line in both states and the mark never gets shoved
          sideways while the rail folds. The lockup is the shared AppMark /
          AppWordmark pair, the same one the title bar and both splashes use. */}
      <div
        className={`flex items-center border-b border-[var(--line)] px-2.5 py-2.5 ${
          collapsed ? "justify-center" : "gap-2"
        }`}
      >
        <AppMark size={26} />
        <AppWordmark
          size={26}
          className={`min-w-0 flex-1 transition-[opacity,transform,filter] duration-200 ease-out ${
            collapsed ? "-translate-x-2 opacity-0 blur-[1.5px]" : ""
          }`}
        />
      </div>

      <div className="px-2 pt-2">
        <SearchButton collapsed={collapsed} onClick={onSearch} />
      </div>

      <div className="flex flex-col gap-0.5 px-2 py-2">
        {rows.map((item, i) => (
          <div key={item.id} className={i === 4 ? "mt-2 border-t border-[var(--line)] pt-2" : ""}>
            <NavItem
              item={item}
              index={i}
              active={tab === item.id}
              collapsed={collapsed}
              onClick={() => onNavigate(item.id)}
            />
          </div>
        ))}
      </div>

      {/* The rail's body stays empty on purpose: nav is a short list, and a
          card-sized gap below it reads as space, not as a missing module. */}
      <div className="flex-1" />

      <RailFooter
        collapsed={collapsed}
        onShortcuts={onShortcuts}
        onToggleCollapsed={onToggleCollapsed}
        onOpenLighting={() => onNavigate("rgb")}
      />
    </nav>
  );
}

/** Rows for the "?" sheet, kept beside the numbers that produce them. */
export function shortcutRows(): { keys: string[]; what: string }[] {
  return [
    { keys: ["Ctrl", "K"], what: "Command palette" },
    ...[...TABS, SETTINGS_TAB].map((tab) => ({
      keys: ["Ctrl", String(tab.hotkey)],
      what: t(tab.label),
    })),
    { keys: ["Ctrl", "B"], what: "Collapse / expand sidebar" },
    { keys: ["?"], what: "This list" },
    { keys: ["Esc"], what: "Close / go back" },
  ];
}
