import { useStore } from "../store";
import { AppMark, AppWordmark, ComboCaps } from "./ui";
import type { Glyph } from "./icons";
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
import { anim } from "./icons";
import { t } from "../i18n";

export type TabId = "overview" | "rgb" | "wallpaper" | "stickers" | "general";

export interface NavDef {
  id: TabId;
  label: string;
  blurb: string;
  icon: Glyph;
  hotkey: number;
}

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

export const ALL_TABS: NavDef[] = [...TABS, SETTINGS_TAB];

export function isTabId(id: string): id is TabId {
  return ALL_TABS.some((tab) => tab.id === id);
}

export const TAB_ANCHORS: Record<TabId, readonly string[]> = {
  overview: [],
  rgb: ["devices", "automation", "lighting-mode"],
  wallpaper: ["vault"],
  stickers: [],
  general: [],
};

export const ANCHOR_FRAMES = 60;

export const ALL_ANCHORS: readonly string[] = ALL_TABS.flatMap((tab) =>
  TAB_ANCHORS[tab.id].map((a) => `${tab.id}/${a}`),
);

export function isAnchorFor(tab: TabId, anchor: string): boolean {
  return TAB_ANCHORS[tab].includes(anchor);
}

export function anchorSelector(anchor: string): string {
  return `[data-anchor="${anchor.replace(/["\\]/g, "\\$&")}"]`;
}

type EngineState = {
  tone: "off" | "offline" | "idle" | "live";
  label: string;
  detail: string;
};

function useEngineState(): EngineState {
  const enabled = useStore((s) => s.cfg?.rgb.enabled ?? false);
  const connected = useStore((s) => s.rgb.connected);
  const lastError = useStore((s) => s.rgb.lastError);
  const devices = useStore((s) => s.rgb.devices.length);
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
  live: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] pulse-base",
};

function NavItem({
  item,
  index,
  active,
  collapsed,
  onClick,
}: {
  item: NavDef;
  index: number;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  const IconAdapted = anim(Icon, "rail");
  const title = collapsed ? `${t(item.label)} — ${t(item.blurb)}` : t(item.blurb);
  return (
    <button
      onClick={onClick}
      data-tip={title}
      aria-label={t(item.label)}
      aria-current={active ? "page" : undefined}
      className={`group relative flex w-full items-center gap-2.5 overflow-hidden rounded-lg py-2 text-left transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] ${
        collapsed ? "justify-center px-1" : "px-2.5"
      } ${
        active
          ? "bg-[rgb(var(--glow)/0.13)] text-[rgb(var(--glow))] shadow-[inset_0_0_0_1px_rgb(var(--glow)/0.18)] rail-active"
          : "text-[var(--text-dim)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
      }`}
    >
      {active && (
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-sm bg-[rgb(var(--glow))]" />
      )}
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
          active
            ? "bg-[rgb(var(--glow)/0.12)]"
            : "bg-transparent group-hover:bg-[var(--panel)]"
        }`}
      >
        <IconAdapted
          className={`h-[17px] w-[17px] ${active ? "" : "opacity-80"}`}
        />
      </span>
      <span
        style={{ transitionDelay: `${index * 24}ms` }}
        className={`min-w-0 flex-1 truncate text-[13px] font-medium tracking-tight transition-[opacity,transform,filter] duration-[var(--motion-base)] ease-[var(--ease-standard)] ${
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
      data-tip={t("nav.search-commands-ctrl-k")}
      aria-label={t("nav.search-commands")}
      className="flex h-8 w-full items-center gap-2 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)] px-2.5 text-[var(--text-faint)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[var(--text-dim)]"
    >
      <IconSearch className="h-4 w-4 shrink-0" />
      <span
        className={`min-w-0 flex-1 truncate text-left text-[12px] transition-[opacity,transform] duration-[var(--motion-base)] ease-[var(--ease-standard)] ${
          collapsed ? "-translate-x-2 opacity-0" : "translate-x-0 opacity-100"
        }`}
      >
        {t("nav.search")}
      </span>
      <span
        className={`shrink-0 transition-opacity duration-[var(--motion-fast)] ease-[var(--ease-standard)] ${
          collapsed ? "opacity-0" : "opacity-100"
        }`}
      >

        <ComboCaps keys={t("nav.ctrl-k").split(/[+\s]+/)} />
      </span>
    </button>
  );
}

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
    <div
      className={`flex items-center border-t border-[var(--line)] py-2 ${
        collapsed ? "gap-0 px-1" : "gap-1 px-1.5"
      }`}
    >
      <button
        onClick={onOpenLighting}
        data-tip={t(engine.detail)}
        aria-label={t(engine.label)}
        className={`flex items-center rounded-lg text-left transition-colors hover:bg-[var(--panel-strong)] ${
          collapsed
            ? "h-6 w-6 flex-none justify-center px-0"
            : "h-9 min-w-[22px] flex-1 gap-2 px-2"
        }`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${ENGINE_DOT[engine.tone]}`} />
        {!collapsed && (
          <span className="min-w-0 truncate text-[11px] font-medium text-[var(--text-dim)]">
            {t(engine.label)}
          </span>
        )}
      </button>

      <button
        onClick={onShortcuts}
        data-tip={collapsed ? undefined : t("nav.keyboard-shortcuts")}
        aria-label={t("nav.keyboard-shortcuts-2")}
        aria-hidden={collapsed}
        tabIndex={collapsed ? -1 : 0}
        className={`flex h-7 shrink-0 items-center justify-center overflow-hidden rounded-md text-[var(--text-faint)] transition-[opacity,width] duration-[var(--motion-base)] ease-[var(--ease-standard)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)] ${
          collapsed ? "w-0 opacity-0" : "w-7 opacity-100"
        }`}
      >
        <IconKeyboard className="h-[15px] w-[15px] shrink-0" />
      </button>
      <button
        onClick={onToggleCollapsed}
        data-tip={t(
          collapsed
            ? "nav.expand-sidebar-shortcut"
            : "nav.collapse-sidebar-shortcut",
        )}
        aria-label={t(collapsed ? "nav.expand-sidebar" : "nav.collapse-sidebar")}
        aria-expanded={!collapsed}
        className={`flex shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)] rail-toggle ${
          collapsed ? "h-6 w-6" : "h-7 w-7"
        }`}
      >
        <span className="absolute inset-0 m-auto h-5 w-5 rounded-full rail-toggle-fan" />
        <IconRailCollapse
          className={`relative h-[14px] w-[14px] transition-transform duration-[var(--motion-base)] ease-[var(--ease-standard)] ${
            collapsed ? "rotate-180" : ""
          }`}
        />
      </button>
    </div>
  );
}

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
  const rows = ALL_TABS;
  return (
    <nav
      aria-label={t("nav.sections")}
      className={`flex shrink-0 flex-col rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow)] backdrop-blur-xl transition-[width] duration-[var(--motion-base)] ease-[var(--ease-standard)] ${
        collapsed ? "w-[60px]" : "w-[216px]"
      }`}
    >
      <div
        className={`flex min-h-12 items-center border-b border-[var(--line)] py-2.5 ${
          collapsed ? "px-1.5" : "px-2.5"
        } ${
          collapsed ? "justify-center" : "gap-2"
        }`}
      >
        <AppMark size={26} />
        <AppWordmark
          size={26}
          className={`min-w-0 flex-1 transition-[opacity,transform,filter] duration-[var(--motion-base)] ease-[var(--ease-standard)] ${
            collapsed ? "-translate-x-2 opacity-0 blur-[1.5px]" : ""
          }`}
        />
      </div>

      <div className="px-2 pt-2">
        <SearchButton collapsed={collapsed} onClick={onSearch} />
      </div>

      <div className="flex flex-col gap-0.5 px-2 py-2">
        {rows.map((item, i) => (
          <div
            key={item.id}
            className={
              item.id === SETTINGS_TAB.id
                ? "mt-2 border-t border-[var(--line)] pt-2"
                : ""
            }
          >
            {item.id === SETTINGS_TAB.id && !collapsed && (
              <div className="mb-1 px-2.5 pt-0.5 text-[9px] font-semibold uppercase tracking-[0.15em] text-[var(--text-faint)]">
                {t("nav.preferences")}
              </div>
            )}
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

export function shortcutRows(): { keys: string[]; what: string }[] {
  return [
    { keys: ["Ctrl", "K"], what: t("common.command-palette") },
    ...[...TABS, SETTINGS_TAB].map((tab) => ({
      keys: ["Ctrl", String(tab.hotkey)],
      what: t(tab.label),
    })),
    { keys: ["Ctrl", "B"], what: t("common.collapse-sidebar") },
    { keys: ["?"], what: t("common.shortcut-list") },
    { keys: ["Esc"], what: t("common.close-or-go-back") },
  ];
}
