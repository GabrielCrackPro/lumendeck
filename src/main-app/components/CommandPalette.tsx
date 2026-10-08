import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { api } from "../ipc";
import { truncateError } from "../utilities";
import { ComboCaps, IconBox, KeyCap, MINI_BTN } from "./ui";
import {
  IconZap,
  IconBulb,
  IconImage,
  IconSticker,
  IconGear,
  IconPause,
  IconPin,
  IconPlay,
  IconMonitor,
  IconWave,
  IconSparkle,
  IconStar,
  IconRefresh,
  IconLayers,
  IconSliders,
  IconTrash,
  IconClose,
  IconSearch,
  IconPrevious,
  IconNext,
  IconKeyboard,
  IconHistory,
  IconSun,
  IconPipette,
  IconAlert,
  IconVolumeOff,
  IconVolumeLow,
  IconVolumeHigh,
} from "./icons";
import type { Glyph } from "./icons";
import { t, useLocale } from "../i18n";
import { staggerDelay } from "./motion";
import { parseQuery } from "./paletteScore";
import type { ParsedQuery, QueryPrefix, Range } from "./paletteScore";
import { actionsFor, navDigit, SECTION_TAB, stepClamped, stepIndex } from "./paletteActions";
import { bumpFrecency, parseFrecency, type FrecencyStore } from "./paletteFrecency";
import { rankPaletteCommands, selectPalettePool, type PaletteSubmenu } from "./paletteRanking";
import type { HotkeyActionId } from "@shared/constants";
import type { GalleryEntry } from "@shared/types";
import { GALLERY_KIND_LABEL } from "./gallery/kindLabels";
import { wallpaperSourceLabel } from "./configPicker";

const PINNED_KEY = "palette-pinned";
const FRECENCY_KEY = "palette-frecency";
const PIN_CAP = 8;
const ADJUST_STEP = 0.05;

const runCmd = (
  fn: Promise<unknown>,
  okMsg: string,
  toast: (tone: "ok" | "error", msg: string) => void,
) =>
  fn.then(() => toast("ok", okMsg)).catch((e: unknown) => toast("error", truncateError(e)));

function readIdList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeIdList(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {}
}

function writeFrecency(store: FrecencyStore) {
  try {
    localStorage.setItem(FRECENCY_KEY, JSON.stringify(store));
  } catch {}
}

interface Command {
  id: string;
  label: string;
  group: string;
  icon: Glyph;
  keywords?: string;
  thumb?: string | null;
  active?: boolean;
  disabledReason?: string;
  keepOpen?: boolean;
  hint?: string;
  hotkey?: string;
  adjust?: { pct: number; nudge: (dir: 1 | -1) => void };
  run: () => void;
}

const GROUP_ORDER: [string, string][] = [
  ["navigate", "palette.group-navigate"],
  ["playback", "palette.group-playback"],
  ["wallpaper", "palette.group-wallpaper"],
  ["wallpapers", "palette.group-wallpapers"],
  ["rgb", "palette.group-lighting"],
  ["scene", "palette.group-profiles"],
  ["config", "palette.group-config"],
  ["app", "palette.group-app"],
];
const groupLabel = (g: string) => t(GROUP_ORDER.find(([id]) => id === g)?.[1] ?? g);

type SubMenu = PaletteSubmenu;

const SEARCH_PLACEHOLDER_KEYS: Record<string, string> = {
  root: "palette.type-a-command",
  wallpapers: "palette.search-wallpapers",
  scenes: "palette.search-profiles",
  rgb: "palette.search-modes",
  "mode-#": "palette.mode-wallpapers",
  "mode-@": "palette.mode-profiles",
};
const searchPlaceholderKey = (sub: SubMenu | null, prefix: QueryPrefix | null): string =>
  SEARCH_PLACEHOLDER_KEYS[prefix ? `mode-${prefix}` : sub ?? "root"]!;

function MatchedLabel({ text, ranges }: { text: string; ranges: Range[] }) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end], i) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <span key={i} className="text-[rgb(var(--glow))]">
        {text.slice(start, end)}
      </span>,
    );
    at = end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

const NAV_TABS: [string, string, Glyph][] = [
  ["overview", "palette.go-overview", IconZap],
  ["rgb", "palette.go-lighting", IconBulb],
  ["wallpaper", "palette.go-wallpaper", IconImage],
  ["stickers", "palette.go-stickers", IconSticker],
  ["general", "palette.go-settings", IconGear],
];

const RGB_MODES: [string, string, Glyph][] = [
  ["static", "lighting.static", IconSliders],
  ["cycle", "lighting.color-cycle", IconWave],
  ["wave", "lighting.wave", IconWave],
  ["breathe", "lighting.breathe", IconSparkle],
  ["audioReactive", "lighting.audio-reactive", IconWave],
];

export default function CommandPalette({
  open,
  onClose,
  onNavigate,
  onShowShortcuts,
  currentTab,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: string) => void;
  onShowShortcuts: () => void;
  currentTab: string | null;
}) {
  const locale = useLocale();
  const { cfg, rgb, wallpaperPaused, save, toast } = useStore(
    useShallow((s) => ({
      cfg: s.cfg,
      rgb: s.rgb,
      wallpaperPaused: s.wallpaperPaused,
      save: s.save,
      toast: s.toast,
    })),
  );
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [pinned, setPinned] = useState<string[]>(() => readIdList(PINNED_KEY));
  const [frec, setFrec] = useState<FrecencyStore>(() => {
    try {
      return parseFrecency(localStorage.getItem(FRECENCY_KEY));
    } catch {
      return {};
    }
  });
  const [sub, setSub] = useState<SubMenu | null>(null);
  const [actionsId, setActionsId] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [modesOpen, setModesOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pointerMoving = useRef(false);
  const modesBtnRef = useRef<HTMLButtonElement>(null);
  const modesMenuRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const togglePin = (id: string) => {
    const wasPinned = pinned.includes(id);
    if (!wasPinned && pinned.length >= PIN_CAP) {
      toast("info", t("palette.pin-limit-reached-oldest-unpinned"));
    }
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [id, ...prev].slice(0, PIN_CAP);
      writeIdList(PINNED_KEY, next);
      return next;
    });
  };

  const recordUse = (id: string) => {
    setFrec((prev) => {
      const next = bumpFrecency(prev, id, Date.now());
      writeFrecency(next);
      return next;
    });
  };

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      setSub(null);
      setActionsId(null);
      setConfirmWipe(false);
      previousFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      previousFocus.current?.focus();
      previousFocus.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        const focusable = panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        const activeEl = document.activeElement;
        if (e.shiftKey && (activeEl === first || !panel.contains(activeEl))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && activeEl === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (modesOpen) setModesOpen(false);
        else if (confirmWipe) setConfirmWipe(false);
        else if (actionsId) setActionsId(null);
        else if (sub) setSub(null);
        else onClose();
        return;
      }
      if (e.key === "Backspace" && !query) {
        if (modesOpen) {
          e.preventDefault();
          e.stopPropagation();
          setModesOpen(false);
        } else if (confirmWipe) {
          e.preventDefault();
          e.stopPropagation();
          setConfirmWipe(false);
        } else if (actionsId) {
          e.preventDefault();
          e.stopPropagation();
          setActionsId(null);
        } else if (sub) {
          e.preventDefault();
          e.stopPropagation();
          setSub(null);
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, confirmWipe, actionsId, sub, query, modesOpen, onClose]);

  useEffect(() => setModesOpen(false), [query, sub, actionsId, confirmWipe, open]);
  useEffect(() => {
    if (!modesOpen) return;
    const onDown = (e: PointerEvent) => {
      if (
        !modesMenuRef.current?.contains(e.target as Node) &&
        !modesBtnRef.current?.contains(e.target as Node)
      ) {
        setModesOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [modesOpen]);

  const activeWpId = useMemo(() => {
    if (!cfg) return null;
    return cfg.gallery.find((g) => g.source === cfg.wallpaper.source)?.id ?? null;
  }, [cfg]);

  const commands = useMemo<Command[]>(() => {
    if (!cfg) return [];
    const cmds: Command[] = [];

    const accel = (action: HotkeyActionId): string | undefined =>
      cfg.general.hotkeysEnabled ?? true
        ? cfg.general.hotkeys[action]?.accelerator || undefined
        : undefined;

    for (const [id, label, icon] of NAV_TABS) {
      const digit = navDigit(id);
      cmds.push({
        id: `nav-${id}`,
        label: t(label),
        group: "navigate",
        icon,
        keywords: "tab",
        hotkey: digit === null ? undefined : `Ctrl+${digit}`,
        run: () => onNavigate(id),
      });
    }

    cmds.push({
      id: "toggle-pause",
      label: t(wallpaperPaused ? "palette.resume-wallpaper" : "palette.pause-wallpaper"),
      group: "playback",
      icon: wallpaperPaused ? IconPlay : IconPause,
      keywords: "pause resume stop freeze",
      hotkey: accel("playPause"),
      run: () => api.togglePause().catch((e: unknown) => toast("error", truncateError(e))),
    });
    cmds.push({
      id: "toggle-wallpaper",
      label: t(
        cfg.general.wallpaperEnabled
          ? "palette.disable-wallpaper-engine"
          : "palette.enable-wallpaper-engine",
      ),
      group: "playback",
      icon: IconMonitor,
      keywords: "on off enable disable engine",
      hotkey: accel("toggleWallpaper"),
      run: () => save((c) => { c.general.wallpaperEnabled = !c.general.wallpaperEnabled; }),
    });
    cmds.push({
      id: "toggle-hotkeys",
      label: t(
        (cfg.general.hotkeysEnabled ?? true)
          ? "palette.disable-hotkeys"
          : "palette.enable-hotkeys",
      ),
      group: "playback",
      icon: IconSliders,
      keywords: "hotkeys shortcuts keys keyboard bindings global on off enable disable",
      run: () => save((c) => { c.general.hotkeysEnabled = !(c.general.hotkeysEnabled ?? true); }),
    });

    cmds.push({
      id: "adjust-rgb-brightness",
      label: t("palette.adjust-rgb-brightness"),
      group: "rgb",
      icon: IconSun,
      hint: "⇧↑↓",
      keywords: "brightness brighter dimmer lights led intensity percent",
      adjust: {
        pct: Math.round(cfg.rgb.mixer.brightness * 100),
        nudge: (dir) =>
          save((c) => {
            c.rgb.mixer.brightness = stepClamped(c.rgb.mixer.brightness, dir, ADJUST_STEP, 0, 1);
          }),
      },
      run: () => {},
    });
    cmds.push({
      id: "adjust-rgb-saturation",
      label: t("palette.adjust-rgb-saturation"),
      group: "rgb",
      icon: IconPipette,
      hint: "⇧↑↓",
      keywords: "saturation saturated color colour vivid dull grey gray intensity percent",
      adjust: {
        pct: Math.round(cfg.rgb.mixer.saturation * 100),
        nudge: (dir) =>
          save((c) => {
            c.rgb.mixer.saturation = stepClamped(c.rgb.mixer.saturation, dir, ADJUST_STEP, 0, 2);
          }),
      },
      run: () => {},
    });
    if (cfg.wallpaper.kind === "video") {
      cmds.push({
        id: "adjust-wallpaper-volume",
        label: t("palette.adjust-wallpaper-volume"),
        group: "playback",
        icon:
          cfg.wallpaper.volume <= 0
            ? IconVolumeOff
            : cfg.wallpaper.volume < 0.5
              ? IconVolumeLow
              : IconVolumeHigh,
        hint: "⇧↑↓",
        hotkey: accel("volumeUp"),
        keywords: "volume louder quieter mute sound audio percent",
        adjust: {
          pct: Math.round(cfg.wallpaper.volume * 100),
          nudge: (dir) =>
            save((c) => {
              c.wallpaper.volume = stepClamped(c.wallpaper.volume, dir, ADJUST_STEP, 0, 1);
            }),
        },
        run: () => {},
      });
      cmds.push({
        id: "adjust-playback-speed",
        label: t("palette.adjust-playback-speed"),
        group: "playback",
        icon: IconWave,
        hint: "⇧↑↓",
        keywords: "playback speed slow faster fast rate tempo multiplier video",
        adjust: {
          pct: Math.round(cfg.wallpaper.videoSpeed * 100),
          nudge: (dir) =>
            save((c) => {
              c.wallpaper.videoSpeed = stepClamped(c.wallpaper.videoSpeed, dir, ADJUST_STEP, 0.25, 3);
            }),
        },
        run: () => {},
      });
    } else {
      cmds.push({
        id: "adjust-wallpaper-volume",
        label: t("palette.adjust-wallpaper-volume"),
        group: "playback",
        icon: IconVolumeOff,
        keywords: "volume louder quieter mute sound audio percent",
        hotkey: accel("volumeUp"),
        disabledReason: t("palette.video-only-reason"),
        run: () => {},
      });
    }

    if (cfg.gallery.length > 0) {
      cmds.push({
        id: "wp-set",
        label: t("palette.set-wallpaper"),
        group: "wallpaper",
        icon: IconImage,
        keywords: "apply use change switch gallery background",
        keepOpen: true,
        run: () => setSub("wallpapers"),
      });
      cmds.push({
        id: "next-wallpaper",
        label: t("palette.next-wallpaper"),
        group: "wallpaper",
        icon: IconNext,
        hotkey: accel("nextWallpaper"),
        keywords: "next another cycle switch different wallpaper",
        run: () => {
          const idx = activeWpId ? cfg.gallery.findIndex((g) => g.id === activeWpId) : -1;
          const next = cfg.gallery[stepIndex(idx, cfg.gallery.length)];
          if (next) {
            runCmd(
              api.galleryApply(next.id),
              t("palette.wallpaper-set-{name}", { name: next.name }),
              toast,
            );
          }
        },
      });
    } else {
      cmds.push({
        id: "wp-set",
        label: t("palette.set-wallpaper"),
        group: "wallpaper",
        icon: IconImage,
        keywords: "apply use change switch gallery background",
        disabledReason: t("palette.import-wallpaper-first"),
        run: () => setSub("wallpapers"),
      });
    }

    cmds.push({
      id: "rgb-mode-set",
      label: t("palette.set-lighting"),
      group: "rgb",
      icon: IconBulb,
      keywords: "set change mode rgb led openrgb",
      keepOpen: true,
      run: () => setSub("rgb"),
    });
    cmds.push({
      id: "cycle-lighting-mode",
      label: t("palette.cycle-lighting-mode"),
      group: "rgb",
      icon: IconWave,
      hotkey: accel("cycleLightingMode"),
      keywords: "cycle next mode change lighting switch rotate",
      run: () => {
        const i = RGB_MODES.findIndex(([mode]) => mode === cfg.rgb.mode);
        const next = RGB_MODES[stepIndex(i, RGB_MODES.length)]?.[0];
        if (next) save((c) => { c.rgb.mode = next as typeof c.rgb.mode; });
      },
    });

    cmds.push({
      id: "rgb-refresh",
      label: t(rgb.connected ? "palette.rescan-devices" : "palette.reconnect-openrgb"),
      group: "rgb",
      icon: IconRefresh,
      keywords: "openrgb reconnect rescan refresh devices",
      run: () => runCmd(api.rgbRefresh(), t("palette.rgb-devices-rescanned"), toast),
    });

    if (cfg.scenes.length > 0) {
      cmds.push({
        id: "scene-set",
        label: t("palette.apply-profile"),
        group: "scene",
        icon: IconLayers,
        keywords: "apply use switch scene profile recall",
        keepOpen: true,
        run: () => setSub("scenes"),
      });
      cmds.push({
        id: "next-profile",
        label: t("palette.next-profile"),
        group: "scene",
        icon: IconNext,
        hotkey: accel("nextProfile"),
        keywords: "next another profile scene switch recall",
        run: () => {
          const idx = cfg.general.activeProfileId
            ? cfg.scenes.findIndex((s) => s.id === cfg.general.activeProfileId)
            : -1;
          const next = cfg.scenes[stepIndex(idx, cfg.scenes.length)];
          if (next) {
            runCmd(
              api.sceneApply(next.id),
              t("palette.profile-applied-{name}", { name: next.name }),
              toast,
            );
          }
        },
      });
    } else {
      cmds.push({
        id: "scene-set",
        label: t("palette.apply-profile"),
        group: "scene",
        icon: IconLayers,
        keywords: "apply use switch scene profile recall",
        disabledReason: t("palette.save-profile-first"),
        run: () => setSub("scenes"),
      });
    }

    cmds.push({
      id: "config-reload",
      label: t("palette.reload-config"),
      group: "config",
      icon: IconRefresh,
      keywords: "refresh re-read config.json manual edits",
      run: async () => {
        try {
          const fresh = await api.reloadConfig();
          useStore.setState({ cfg: fresh });
          toast("ok", t("palette.config-reloaded"));
        } catch (e) {
          toast("error", truncateError(e));
        }
      },
    });

    cmds.push({
      id: "show-shortcuts",
      label: t("shell.keyboard-shortcuts"),
      group: "config",
      icon: IconKeyboard,
      keywords: "shortcuts keys hotkeys help reference combos bindings",
      hotkey: "?",
      run: () => onShowShortcuts(),
    });

    cmds.push({
      id: "app-quit",
      label: t("palette.quit-app"),
      group: "app",
      icon: IconGear,
      keywords: "exit close shutdown",
      run: () => {
        toast("info", t("palette.closing-lumendeck"));
        api.quit().catch((e: unknown) => toast("error", truncateError(e)));
      },
    });

    cmds.push({
      id: "app-wipe",
      label: t("palette.wipe-app-data"),
      group: "app",
      icon: IconTrash,
      keywords: "factory reset wipe erase delete all data danger",
      keepOpen: true,
      run: () => setConfirmWipe(true),
    });

    if (Object.keys(frec).length > 0) {
      cmds.push({
        id: "clear-recents",
        label: t("palette.clear-recents"),
        group: "app",
        icon: IconHistory,
        keywords: "clear forget history recent recent list usage",
        keepOpen: true,
        run: () => {
          setFrec({});
          writeFrecency({});
        },
      });
    }

    return cmds;
  }, [cfg, rgb.connected, wallpaperPaused, save, toast, onNavigate, onShowShortcuts, frec, activeWpId, locale]);

  const wpCommands = useMemo<Command[]>(() => {
    if (!cfg) return [];
    return cfg.gallery.map((g) => ({
      id: `wp-${g.id}`,
      label: g.name,
      group: "wallpapers",
      icon: IconImage,
      thumb: g.thumb ?? null,
      active: g.id === activeWpId,
      keywords: `apply use ${g.kind}`,
      run: () =>
        runCmd(api.galleryApply(g.id), t("palette.wallpaper-set-{name}", { name: g.name }), toast),
    }));
  }, [cfg, activeWpId, toast, locale]);

  const sceneCommands = useMemo<Command[]>(() => {
    if (!cfg) return [];
    return cfg.scenes.map((s) => ({
      id: `scene-${s.id}`,
      label: s.name,
      group: "scene",
      icon: IconLayers,
      keywords: "apply use scene profile",
      run: () =>
        runCmd(api.sceneApply(s.id), t("palette.profile-applied-{name}", { name: s.name }), toast),
    }));
  }, [cfg, toast, locale]);

  const rgbCommands = useMemo<Command[]>(() => {
    if (!cfg) return [];
    return RGB_MODES.map(([mode, label, icon]) => ({
      id: `rgb-${mode}`,
      label: t(label),
      group: "rgb",
      icon,
      active: cfg.rgb.mode === mode,
      keywords: "mode lighting",
      run: () => save((c) => { c.rgb.mode = mode as typeof c.rgb.mode; }),
    }));
  }, [cfg, save, locale]);

  const byId = useMemo(() => {
    const m = new Map<string, Command>();
    for (const c of [...commands, ...wpCommands, ...sceneCommands, ...rgbCommands]) m.set(c.id, c);
    return m;
  }, [commands, wpCommands, sceneCommands, rgbCommands]);
  const actionsCmd = actionsId ? (byId.get(actionsId) ?? null) : null;

  const actionItems = useMemo<Command[]>(() => {
    if (!actionsCmd) return [];
    const cmd = actionsCmd;
    const isPinned = pinned.includes(cmd.id);
    const items: Command[] = [];
    for (const id of actionsFor(cmd.group, isPinned)) {
      if (id === "run") {
        items.push({
          id: "act-run",
          label: t("palette.action-run"),
          group: cmd.group,
          icon: IconPlay,
          hint: "↵",
          keepOpen: cmd.keepOpen,
          run: () => {
            recordUse(cmd.id);
            setActionsId(null);
            cmd.run();
          },
        });
      } else if (id === "pin" || id === "unpin") {
        items.push({
          id: "act-pin",
          label: t(id === "pin" ? "common.pin" : "common.unpin"),
          group: cmd.group,
          icon: IconPin,
          keepOpen: true,
          run: () => togglePin(cmd.id),
        });
      } else {
        const tab = SECTION_TAB[cmd.group];
        const nav = tab ? NAV_TABS.find(([navId]) => navId === tab) : undefined;
        if (tab && nav) {
          items.push({
            id: "act-goto",
            label: t(nav[1]),
            group: cmd.group,
            icon: nav[2],
            run: () => onNavigate(tab),
          });
        }
      }
    }
    return items;
  }, [actionsCmd, pinned, onNavigate]);

  const parsed = useMemo<ParsedQuery>(
    () => (!sub && !actionsCmd && !confirmWipe ? parseQuery(query) : { prefix: null, term: query }),
    [query, sub, actionsCmd, confirmWipe],
  );

  const ranked = useMemo(() => {
    const pool = selectPalettePool(
      { commands, wallpapers: wpCommands, scenes: sceneCommands, rgb: rgbCommands, actions: actionItems },
      { actionsOpen: !!actionsCmd, submenu: sub, prefix: parsed.prefix },
    );
    return rankPaletteCommands(pool, {
      term: parsed.term,
      currentTab,
      pinned,
      frecency: frec,
      now: Date.now(),
      groupLabel,
      actionsOpen: !!actionsCmd,
    });
  }, [commands, wpCommands, sceneCommands, rgbCommands, actionItems, parsed, pinned, frec, sub, actionsCmd, currentTab, locale]);

  const results = ranked.items;
  const matchTotal = ranked.total;

  const selectedId = results[sel]?.c.id ?? null;
  const previewEntry: GalleryEntry | null =
    !confirmWipe &&
    !actionsCmd &&
    (sub === "wallpapers" || parsed.prefix === "#") &&
    cfg &&
    selectedId?.startsWith("wp-")
      ? cfg.gallery.find((g) => `wp-${g.id}` === selectedId) ?? null
      : null;

  const rows = useMemo(() => {
    const flat = results.map((r, i) => ({ kind: "cmd" as const, r, i }));
    if (!actionsCmd || !flat.length) return flat;
    return [{ kind: "header" as const, label: actionsCmd.label }, ...flat];
  }, [results, actionsCmd]);

  useEffect(() => setSel(0), [query, sub, actionsId, confirmWipe]);

  useEffect(() => {
    listRef.current?.querySelectorAll("[data-idx]")[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const execute = (i: number) => {
    const item = results[i];
    if (!item) return;
    if (item.c.disabledReason) return;
    if (!actionsCmd) recordUse(item.c.id);
    if (item.c.keepOpen) {
      item.c.run();
      return;
    }
    onClose();
    item.c.run();
  };

  const SUB_META: Record<SubMenu, { title: string; crumb: string }> = {
    wallpapers: { title: t("palette.group-wallpapers"), crumb: t("palette.set-wallcrumb") },
    scenes: { title: t("palette.group-profiles"), crumb: t("palette.apply-profile-crumb") },
    rgb: { title: t("palette.group-lighting"), crumb: t("palette.set-lighting-crumb") },
  };

  const fieldLabel = confirmWipe
    ? t("palette.type-{word}-to-confirm", { word: t("palette.confirm-word") })
    : t(actionsCmd ? "palette.type-an-action" : searchPlaceholderKey(sub, parsed.prefix));

  const emptyKind = t(
    actionsCmd
      ? "palette.kind-actions"
      : sub === "wallpapers" || parsed.prefix === "#"
        ? "palette.kind-wallpapers"
        : sub === "scenes" || parsed.prefix === "@"
          ? "palette.kind-profiles"
          : sub === "rgb"
            ? "palette.kind-modes"
            : "palette.kind-commands",
  );

  return (
    <div
      className="pal-overlay fixed inset-0 z-[100] flex items-start justify-center bg-black/50 pt-[11vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className={`pal-panel w-full ${previewEntry ? "max-w-[760px]" : "max-w-[600px]"} overflow-hidden rounded-xl border border-[var(--line-strong)] bg-[color-mix(in_srgb,var(--bg)_95%,transparent)] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)]`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.command-palette")}
      >

        <div className="relative flex items-center gap-2 border-b border-[var(--line)] bg-[var(--panel-sunken)] px-4 py-3">

          {actionsCmd ? (
            <button
              type="button"
              onClick={() => setActionsId(null)}
              title={actionsCmd.label}
              className={`${MINI_BTN} shrink-0 px-2 py-1`}
            >
              <IconPrevious className="h-3 w-3" />
              {t("palette.actions")}
            </button>
          ) : sub ? (
            <button
              type="button"
              onClick={() => setSub(null)}
              title={t("palette.back-to-all-commands")}
              className={`${MINI_BTN} shrink-0 px-2 py-1`}
            >
              <IconPrevious className="h-3 w-3" />
              {SUB_META[sub].crumb}
            </button>
          ) : null}

          {!sub && !actionsCmd &&
            (parsed.prefix ? (
              <KeyCap>{parsed.prefix}</KeyCap>
            ) : (
              <IconSearch className="h-4 w-4 shrink-0 text-[var(--text-faint)]" />
            ))}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              pointerMoving.current = false;
              const knob = confirmWipe ? undefined : results[sel]?.c.adjust;
              if (knob && e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                knob.nudge(e.key === "ArrowDown" ? -1 : 1);
                return;
              }
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((v) => (results.length ? (v + 1) % results.length : 0)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((v) => (results.length ? (v - 1 + results.length) % results.length : 0)); }
              else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                const item = results[sel];
                if (item && !actionsCmd && !confirmWipe && !item.c.disabledReason) setActionsId(item.c.id);
              }
              else if (e.key === "Enter") {
                e.preventDefault();
                if (confirmWipe) {
                  if (query.trim().toUpperCase() === t("palette.confirm-word").toUpperCase()) {
                    toast("info", t("palette.app-data-wiped-closing-lumendeck"));
                    api.factoryReset().catch((err: unknown) => toast("error", truncateError(err)));
                    onClose();
                  }
                } else execute(sel);
              }
            }}
            placeholder={fieldLabel}
            aria-label={fieldLabel}
            aria-expanded={!confirmWipe}
            aria-controls={confirmWipe ? undefined : "pal-listbox"}
            aria-autocomplete="list"
            aria-activedescendant={
              !confirmWipe && results.length ? `pal-opt-${sel}` : undefined
            }
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent py-1 text-[15px] font-medium text-[var(--text)] outline-none placeholder:font-normal placeholder:text-[var(--text-faint)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              title={t("palette.clear")}
              aria-label={t("palette.clear")}
              className="shrink-0 rounded-full bg-[var(--panel-strong)] p-1 text-[var(--text-faint)] transition-colors hover:text-[var(--text)] focus-glow"
            >
              <IconClose className="h-3 w-3" />
            </button>
          )}

          {!confirmWipe && (
            <button
              ref={modesBtnRef}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setModesOpen((v) => !v)}
              aria-expanded={modesOpen}
              aria-label={t("palette.query-modes")}
              title={t("palette.query-modes")}
              className="shrink-0 rounded-md bg-[var(--panel-strong)] p-1 text-[var(--text-faint)] transition-colors hover:text-[var(--text)] focus-glow"
            >
              <IconKeyboard className="h-3.5 w-3.5" />
            </button>
          )}
          {modesOpen && !confirmWipe && (
            <div
              ref={modesMenuRef}
              role="group"
              aria-label={t("palette.query-modes")}
              className="absolute right-3 top-full z-50 mt-2 w-[264px] rounded-lg border border-[var(--line-strong)] bg-[color-mix(in_srgb,var(--bg)_96%,transparent)] p-1.5 shadow-[0_20px_50px_-16px_rgb(0_0_0/0.7)] backdrop-blur-xl"
            >
              <div className="kicker px-2 pb-1 pt-1.5 text-[var(--text-faint)]">
                {t("palette.query-modes")}
              </div>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setConfirmWipe(false);
                  setActionsId(null);
                  setSub(null);
                  setQuery("#");
                  inputRef.current?.focus();
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--panel-strong)] focus-glow"
              >
                <KeyCap>#</KeyCap>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-dim)]">
                  {t("palette.mode-wallpapers")}
                </span>
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setConfirmWipe(false);
                  setActionsId(null);
                  setSub(null);
                  setQuery("@");
                  inputRef.current?.focus();
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--panel-strong)] focus-glow"
              >
                <KeyCap>@</KeyCap>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-dim)]">
                  {t("palette.mode-profiles")}
                </span>
              </button>
              <div className="mx-2 my-1.5 border-t border-[var(--line)]" />
              <div className="flex items-center gap-2.5 px-2 py-1.5">
                <KeyCap>⇧↑↓</KeyCap>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-dim)]">
                  {t("palette.adjust-selected-knob")}
                </span>
              </div>
              <div className="flex items-center gap-2.5 px-2 py-1.5">
                <ComboCaps keys={["Ctrl", "↵"]} />
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-dim)]">
                  {t("palette.actions")}
                </span>
              </div>
              <div className="flex items-center gap-2.5 px-2 py-1.5">
                <KeyCap>esc</KeyCap>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-dim)]">
                  {t("palette.back")}
                </span>
              </div>
            </div>
          )}
        </div>
        <div
          key={
            confirmWipe
              ? "wipe-confirm"
              : actionsCmd
                ? `actions-${actionsId}`
                : sub ?? "root"
          }
          className="pal-swap flex items-stretch overflow-hidden p-2"
        >
          {confirmWipe ? (
            <div className="flex min-w-0 flex-1 flex-col items-center gap-3 px-6 py-8 text-center">
              <IconBox size="md" variant="amber">
                <IconAlert />
              </IconBox>
              <p className="max-w-[52ch] text-xs leading-relaxed text-[var(--text-dim)]">
                {t("palette.wipe-warning")}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--text-faint)]">
                {t("palette.type-{word}-to-confirm", { word: t("palette.confirm-word") })}
              </p>
            </div>
          ) : (
          <div
            ref={listRef}
            id="pal-listbox"
            role="listbox"
            aria-label={t("palette.command-palette")}
            className="min-w-0 flex-1 overflow-y-auto max-h-[440px]"
            onMouseMove={() => { pointerMoving.current = true; }}
          >

            {rows.length === 0 && (
              <div className="flex flex-col items-center gap-3 px-3 py-10 text-center">
                <IconSearch className="h-5 w-5 text-[var(--text-faint)]" />
                <span className="max-w-[44ch] text-xs leading-relaxed text-[var(--text-faint)]">
                  {query
                    ? t("palette.nothing-matches-{query}", { query })
                    : t("palette.no-matching-{kind}", { kind: emptyKind })}
                </span>
                <div className="flex items-center gap-2">
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className={MINI_BTN}
                    >
                      {t("palette.clear")}
                    </button>
                  )}
                  {actionsCmd && (
                    <button
                      type="button"
                      onClick={() => setActionsId(null)}
                      className={MINI_BTN}
                    >
                      {t("palette.back")}
                    </button>
                  )}
                  {sub && !actionsCmd && (
                    <button
                      type="button"
                      onClick={() => setSub(null)}
                      className={MINI_BTN}
                    >
                      {t("palette.back")}
                    </button>
                  )}
                </div>
              </div>
            )}
            {rows.map((row) =>
              row.kind === "header" ? (
                <div
                  key={`h-${row.label}`}
                  role="presentation"
                  className="px-3 pb-1 pt-3 text-[11px] font-medium text-[var(--text-dim)]"
                >
                  {row.label}
                </div>
              ) : (
              <div
                key={row.r.c.id}
                id={`pal-opt-${row.i}`}
                role="option"
                aria-selected={row.i === sel}
                aria-disabled={row.r.c.disabledReason ? true : undefined}
                data-idx={row.i}
                onClick={() => { if (!row.r.c.disabledReason) execute(row.i); }}
                onMouseEnter={() => { if (pointerMoving.current) setSel(row.i); }}
                className={`pal-cmd pal-row group/pin relative flex w-full select-none items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm ${
                  row.r.c.disabledReason
                    ? "cursor-default opacity-60"
                    : "cursor-pointer"
                } ${
                  row.i === sel
                    ? "bg-[rgb(var(--glow)/0.10)] text-[var(--text)]"
                    : "text-[var(--text-dim)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
                }`}
                style={{ animationDelay: query ? "0ms" : `${staggerDelay(row.i)}ms` }}
              >

                <span
                  className={`absolute inset-y-1 left-0 w-[2.5px] rounded-full bg-[rgb(var(--glow))] transition-opacity ${
                    row.i === sel ? "opacity-100" : "opacity-0"
                  }`}
                />
                {row.r.c.thumb ? (
                  <img
                    src={row.r.c.thumb}
                    alt=""
                    loading="lazy"
                    className={`h-7 w-10 shrink-0 rounded-md object-cover ring-1 transition-all ${
                      row.i === sel ? "ring-[rgb(var(--glow)/0.6)]" : "ring-[var(--line)] opacity-80"
                    }`}
                  />
                ) : (
                  (() => {
                    const Icon: Glyph = row.r.c.icon;
                    return (
                      <IconBox size="sm" variant={row.i === sel ? "glow" : "neutral"}>
                        <Icon className="h-4 w-4" />
                      </IconBox>
                    );
                  })()
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    <MatchedLabel text={row.r.c.label} ranges={row.r.ranges} />
                  </span>

                  {!sub && !actionsCmd && (
                    <span
                      className={`mt-0.5 block truncate text-[11px] leading-tight ${
                        row.r.c.disabledReason
                          ? "text-amber-300/90"
                          : row.i === sel
                            ? "text-[var(--text-dim)]"
                            : "text-[var(--text-faint)]"
                      }`}
                    >
                      {row.r.c.disabledReason ?? groupLabel(row.r.c.group)}
                    </span>
                  )}
                </span>

                {row.r.c.hotkey && (
                  <span
                    className={`shrink-0 transition-opacity duration-[var(--motion-fast)] ${
                      row.i === sel ? "opacity-100" : "opacity-60"
                    }`}
                  >
                    <ComboCaps keys={row.r.c.hotkey.split("+")} />
                  </span>
                )}
                {row.r.c.adjust && (
                  <span
                    className={`shrink-0 font-mono text-[11px] tabular-nums ${
                      row.i === sel ? "text-[var(--text)]" : "text-[var(--text-dim)]"
                    }`}
                  >
                    {row.r.c.adjust.pct}%
                  </span>
                )}
                {row.r.c.hint && (
                  <span
                    className={`shrink-0 transition-opacity duration-[var(--motion-fast)] ${
                      row.i === sel ? "opacity-100" : "opacity-60"
                    }`}
                  >
                    <KeyCap>{row.r.c.hint}</KeyCap>
                  </span>
                )}
                {row.r.c.active && (
                  <span className="shrink-0 rounded-sm bg-[rgb(var(--glow)/0.15)] px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.15em] text-[rgb(var(--glow))]">
                    {t("palette.live")}
                  </span>
                )}
                {!actionsCmd && !row.r.c.disabledReason && (
                  <>
                    <button
                      type="button"
                      title={t(pinned.includes(row.r.c.id) ? "common.unpin" : "common.pin")}
                      aria-label={t(pinned.includes(row.r.c.id) ? "common.unpin" : "common.pin")}
                      aria-pressed={pinned.includes(row.r.c.id)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePin(row.r.c.id);
                        inputRef.current?.focus();
                      }}
                      className={`shrink-0 rounded p-0.5 transition-all ${
                        pinned.includes(row.r.c.id)
                          ? "text-[rgb(var(--glow))] opacity-100"
                          : "text-[var(--text-faint)] opacity-0 hover:text-[var(--text)] group-hover/pin:opacity-100 focus:opacity-100"
                      }`}
                    >
                      <IconPin filled={pinned.includes(row.r.c.id)} className="h-3 w-3" />
                    </button>

                    <button
                      type="button"
                      title={t("palette.actions")}
                      aria-label={t("palette.actions")}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSel(row.i);
                        setActionsId(row.r.c.id);
                        inputRef.current?.focus();
                      }}
                      className={`shrink-0 rounded p-0.5 transition-all ${
                        row.i === sel
                          ? "text-[var(--text-faint)] opacity-100 hover:text-[var(--text)]"
                          : "text-[var(--text-faint)] opacity-0 hover:text-[var(--text)] group-hover/pin:opacity-100 focus:opacity-100"
                      }`}
                    >
                      <IconNext className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
              )
            )}
          </div>
          )}

          {previewEntry && (
            <aside
              aria-label={previewEntry.name}
              className="pal-swap max-h-[440px] w-[210px] shrink-0 overflow-y-auto border-l border-[var(--line)] bg-[var(--panel-sunken)] p-3"
            >
              {previewEntry.thumb ? (
                <img
                  src={previewEntry.thumb}
                  alt=""
                  className="mb-2.5 h-24 w-full rounded-[var(--radius-sm)] object-contain ring-1 ring-[var(--line)]"
                />
              ) : (
                <div className="mb-2.5 flex h-24 w-full items-center justify-center rounded-[var(--radius-sm)] border border-dashed border-[var(--line-strong)]">
                  <IconImage className="h-5 w-5 text-[var(--text-faint)]" />
                </div>
              )}

              <div
                className="truncate text-[13px] font-medium text-[var(--text)]"
                title={previewEntry.name}
              >
                {previewEntry.name}
              </div>
              <div className="kicker mt-1 flex items-center gap-1.5 text-[var(--text-faint)]">
                {t(GALLERY_KIND_LABEL[previewEntry.kind])}
                {previewEntry.favorite && <IconStar filled className="h-3 w-3 text-amber-300" />}
              </div>
              <dl className="mt-3 space-y-1.5 font-mono text-[10px] leading-tight">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="kicker shrink-0 text-[var(--text-faint)]">
                    {t("palette.detail-source")}
                  </dt>
                  <dd className="truncate text-right text-[var(--text-dim)]" title={previewEntry.source}>
                    {wallpaperSourceLabel(previewEntry.source)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="kicker shrink-0 text-[var(--text-faint)]">
                    {t("palette.detail-added")}
                  </dt>
                  <dd className="tabular-nums text-[var(--text-dim)]">
                    {new Date(previewEntry.addedMs).toLocaleDateString()}
                  </dd>
                </div>
                {previewEntry.lastAppliedMs ? (
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="kicker shrink-0 text-[var(--text-faint)]">
                      {t("palette.detail-last-used")}
                    </dt>
                    <dd className="tabular-nums text-[var(--text-dim)]">
                      {new Date(previewEntry.lastAppliedMs).toLocaleDateString()}
                    </dd>
                  </div>
                ) : null}
                {previewEntry.opts?.speed != null || previewEntry.opts?.volume != null ? (
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="kicker shrink-0 text-[var(--text-faint)]">
                      {t("palette.detail-overrides")}
                    </dt>
                    <dd className="tabular-nums text-[var(--text-dim)]">
                      {[
                        previewEntry.opts.speed != null
                          ? `${previewEntry.opts.speed}×`
                          : null,
                        previewEntry.opts.volume != null
                          ? `${Math.round(previewEntry.opts.volume * 100)}%`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </aside>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-[var(--line)] bg-[var(--panel-sunken)] px-4 py-2.5 font-mono text-[10px] text-[var(--text-faint)]">
          <span className="flex items-center gap-1.5">
            <KeyCap>↑↓</KeyCap>
            {t("palette.select")}
          </span>
          <span className="flex items-center gap-1.5">
            <KeyCap>↵</KeyCap>
            {t("palette.run")}
          </span>
          <span className="flex items-center gap-1.5">
            <KeyCap>esc</KeyCap>
            {t(actionsCmd || sub || confirmWipe ? "palette.back" : "palette.close")}
          </span>
          {(query || (sub && !actionsCmd)) && (
            <span aria-live="polite" className="ml-auto tabular-nums">{t("palette.{n}-results", { n: matchTotal })}</span>
          )}

          {!actionsCmd && !query && !sub && !confirmWipe && (
            <span className="ml-auto flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <ComboCaps keys={["Ctrl", "↵"]} />
                {t("palette.actions")}
              </span>
              <span className="flex items-center gap-1.5">
                <IconPin filled={false} className="h-3 w-3" />
                {t("palette.pin-for-quick-access")}
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
