// Command palette (Ctrl+K): keyboard-first access to navigation, wallpaper
// switching, pause, scenes and lighting modes. The dashboard is often used
// beside games/media where the mouse is busy — this mirrors the Ctrl+1..5
// tab flow with a searchable superset.
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { api } from "../ipc";
import { truncateError } from "../utilities";
import { MINI_BTN } from "./ui";
import {
  IconZap,
  IconBulb,
  IconImage,
  IconSticker,
  IconGear,
  IconPause,
  IconPlay,
  IconMonitor,
  IconWave,
  IconSparkle,
  IconRefresh,
  IconLayers,
  IconSliders,
  IconTrash,
} from "./icons";
import type { SVGProps } from "react";
import { t, useLocale } from "../i18n";

const PINNED_KEY = "palette-pinned"; // string[] of command ids
const RECENTS_KEY = "palette-recents"; // string[] of command ids, newest first

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

type IconCmp = React.FC<SVGProps<SVGSVGElement>>;

interface Command {
  id: string;
  label: string;
  /** Short category shown on the right, e.g. "wallpaper" / "rgb". */
  group: string;
  icon: IconCmp;
  keywords?: string;
  /** Optional thumbnail URL — rendered instead of the icon when present. */
  thumb?: string | null;
  /** Marks the currently-active entry (e.g. the live wallpaper). */
  active?: boolean;
  run: () => void;
}

/** Section display order + header label keys for the palette list. */
const GROUP_ORDER: [string, string][] = [
  ["navigate", "palette.group-navigate"],
  ["playback", "palette.group-playback"],
  ["wallpaper", "palette.group-wallpaper"],
  ["wallpapers", "palette.group-wallpapers"],
  ["rgb", "palette.group-lighting"],
  ["scene", "palette.group-scenes"],
  ["config", "palette.group-config"],
  ["app", "palette.group-app"],
];
const groupLabel = (g: string) => t(GROUP_ORDER.find(([id]) => id === g)?.[1] ?? g);

function IconPin({ filled, ...props }: { filled: boolean } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1Z" />
    </svg>
  );
}

function fuzzyScore(query: string, text: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  // Named `needle`, not `t`: `t` is the translator everywhere else in this
  // file, and shadowing it inside one function is a trap.
  const needle = text.toLowerCase();
  if (needle.includes(q)) return 100 - needle.indexOf(q);
  // Subsequence match (e.g. "wv" -> "wave") scores by spread.
  let ti = 0;
  let hits = 0;
  for (const ch of q) {
    const idx = needle.indexOf(ch, ti);
    if (idx === -1) return 0;
    hits += 1;
    ti = idx + 1;
  }
  return hits > 0 ? 10 : 0;
}

const NAV_TABS: [string, string, IconCmp][] = [
  ["overview", "palette.go-overview", IconZap],
  ["rgb", "palette.go-lighting", IconBulb],
  ["wallpaper", "palette.go-wallpaper", IconImage],
  ["stickers", "palette.go-stickers", IconSticker],
  ["general", "palette.go-settings", IconGear],
];

// Same keys the lighting card uses, so the palette never drifts from it.
const RGB_MODES: [string, string, IconCmp][] = [
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
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: string) => void;
}) {
  // Command labels are resolved with `t`, so the palette has to rebuild them
  // when the language changes under it.
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
  const [recents, setRecents] = useState<string[]>(() => readIdList(RECENTS_KEY));
  /** Active submenu ("wallpapers" = gallery picker), null = root list. */
  const [sub, setSub] = useState<"wallpapers" | "scenes" | "rgb" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const togglePin = (id: string) => {
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [id, ...prev].slice(0, 8);
      writeIdList(PINNED_KEY, next);
      return next;
    });
  };

  const recordUse = (id: string) => {
    setRecents((prev) => {
      const next = [id, ...prev.filter((p) => p !== id)].slice(0, 8);
      writeIdList(RECENTS_KEY, next);
      return next;
    });
  };

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      setSub(null);
      // Focus after the overlay mounts. Remember what had it first so the
      // palette hands focus back instead of dropping it on <body>.
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

  // Tab cycles inside the palette: the overlay is modal, so focus must not
  // wander into the dashboard behind it.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
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
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    if (!cfg) return [];
    const cmds: Command[] = [];
    const run = (fn: Promise<unknown>, okMsg: string) =>
      fn.then(() => toast("ok", okMsg)).catch((e: unknown) => toast("error", truncateError(e)));

    // Navigation
    for (const [id, label, icon] of NAV_TABS) {
      cmds.push({
        id: `nav-${id}`,
        label: t(label),
        group: "navigate",
        icon,
        keywords: "tab",
        run: () => onNavigate(id),
      });
    }

    // Playback
    cmds.push({
      id: "toggle-pause",
      label: t(wallpaperPaused ? "palette.resume-wallpaper" : "palette.pause-wallpaper"),
      group: "playback",
      icon: wallpaperPaused ? IconPlay : IconPause,
      keywords: "pause resume stop freeze",
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
      run: () => save((c) => { c.general.wallpaperEnabled = !c.general.wallpaperEnabled; }),
    });
    // Third route to the master switch, after the settings card and the tray.
    // Worth having: a binding that misbehaves should be killable without
    // hunting for the right tab.
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

    // Wallpaper: a submenu entry instead of dumping every gallery item into
    // the root list — selecting it swaps the palette into the wallpapers list.
    if (cfg.gallery.length > 0) {
      cmds.push({
        id: "wp-set",
        label: t("palette.set-wallpaper"),
        group: "wallpaper",
        icon: IconImage,
        keywords: "apply use change switch gallery background",
        run: () => setSub("wallpapers"),
      });
    }

    // Lighting: submenu entry — mode list lives one level down.
    cmds.push({
      id: "rgb-mode-set",
      label: t("palette.set-lighting"),
      group: "rgb",
      icon: IconBulb,
      keywords: "set change mode rgb led openrgb",
      run: () => setSub("rgb"),
    });

    // OpenRGB: reconnect / rescan devices.
    cmds.push({
      id: "rgb-refresh",
      label: t(rgb.connected ? "palette.rescan-devices" : "palette.reconnect-openrgb"),
      group: "rgb",
      icon: IconRefresh,
      keywords: "openrgb reconnect rescan refresh devices",
      run: () => run(api.rgbRefresh(), "RGB devices rescanned"),
    });

    // Scenes: submenu entry mirroring Set wallpaper… — the full scene list
    // lives one level down instead of cluttering the root.
    if (cfg.scenes.length > 0) {
      cmds.push({
        id: "scene-set",
        label: t("palette.apply-scene"),
        group: "scene",
        icon: IconLayers,
        keywords: "apply use switch scene profile recall",
        run: () => setSub("scenes"),
      });
    }

    // Config: reload from disk (picks up manual edits instantly).
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

    // App: quit (real exit — closing the window only hides to tray).
    cmds.push({
      id: "app-quit",
      label: t("palette.quit-app"),
      group: "app",
      icon: IconGear,
      keywords: "exit close shutdown",
      run: () => run(api.quit(), "LumenDeck closed"),
    });

    // App: factory reset — requires a typed confirmation, mirrors the
    // General > Danger zone flow (wipes config, vault refs, stickers, cache).
    cmds.push({
      id: "app-wipe",
      label: t("palette.wipe-app-data"),
      group: "app",
      icon: IconTrash,
      keywords: "factory reset wipe erase delete all data danger",
      run: () => {
        const answer = window.prompt(
          t("palette.this-deletes-all-lumendeck-data-settings-wallpap"),
        );
        if (answer?.trim().toUpperCase() === "WIPE") {
          toast("info", t("palette.app-data-wiped-closing-lumendeck"));
          api.factoryReset().catch((e: unknown) => toast("error", truncateError(e)));
        }
      },
    });

    return cmds;
  }, [cfg, rgb.connected, wallpaperPaused, save, toast, onNavigate]);

  // Gallery entry currently set as the (global) wallpaper, for the active marker.
  const activeWpId = useMemo(() => {
    if (!cfg) return null;
    return cfg.gallery.find((g) => g.source === cfg.wallpaper.source)?.id ?? null;
  }, [cfg]);

  const wpCommands = useMemo<Command[]>(() => {
    if (!cfg) return [];
    const run = (fn: Promise<unknown>, okMsg: string) =>
      fn.then(() => toast("ok", okMsg)).catch((e: unknown) => toast("error", truncateError(e)));
    return cfg.gallery.map((g) => ({
      id: `wp-${g.id}`,
      label: g.name,
      group: "wallpapers",
      icon: IconImage,
      thumb: g.thumb ?? null,
      active: g.id === activeWpId,
      keywords: `apply use ${g.kind}`,
      run: () => run(api.galleryApply(g.id), t("palette.wallpaper-set-{name}", { name: g.name })),
    }));
  }, [cfg, activeWpId, toast]);

  const sceneCommands = useMemo<Command[]>(() => {
    if (!cfg) return [];
    const run = (fn: Promise<unknown>, okMsg: string) =>
      fn.then(() => toast("ok", okMsg)).catch((e: unknown) => toast("error", truncateError(e)));
    return cfg.scenes.map((s) => ({
      id: `scene-${s.id}`,
      label: s.name,
      group: "scenes",
      icon: IconLayers,
      keywords: "apply use scene profile",
      run: () => run(api.sceneApply(s.id), t("palette.scene-applied-{name}", { name: s.name })),
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
  }, [cfg, save]);

  const results = useMemo(() => {
    // Submenu mode: only the active sub-list, filtered by the query.
    if (sub) {
      const pool =
        sub === "wallpapers" ? wpCommands : sub === "scenes" ? sceneCommands : rgbCommands;
      return pool
        .map((c) => ({ c, score: fuzzyScore(query, c.label) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);
    }
    const scored = commands
      .map((c) => ({ c, score: Math.max(fuzzyScore(query, c.label), query ? (c.keywords ? fuzzyScore(query, c.keywords) : 0) : 0) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
    if (query) return scored.slice(0, 12);
    // Empty query: pinned first, then recently used (each deduped, order
    // kept), then every remaining command — the full command list is shown
    // on open so discovery doesn't depend on guessing keywords.
    const byId = new Map(scored.map((r) => [r.c.id, r]));
    const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
    const seen = new Set<string>();
    const ordered: typeof scored = [];
    for (const r of [...pick(pinned), ...pick(recents), ...scored]) {
      if (seen.has(r.c.id)) continue;
      seen.add(r.c.id);
      ordered.push(r);
    }
    return ordered;
  }, [commands, wpCommands, sceneCommands, rgbCommands, query, pinned, recents, sub]);

  // Grouped rows for the empty-query root list (headers inserted inline).
  const rows = useMemo(() => {
    if (sub || query) {
      return results.map((r, i) => ({ kind: "cmd" as const, r, i }));
    }
    const out: ({ kind: "header"; label: string } | { kind: "cmd"; r: (typeof results)[number]; i: number })[] = [];
    let lastGroup = "";
    results.forEach((r, i) => {
      if (r.c.group !== lastGroup) {
        out.push({ kind: "header", label: groupLabel(r.c.group) });
        lastGroup = r.c.group;
      }
      out.push({ kind: "cmd", r, i });
    });
    return out;
  }, [results, query, sub]);

  useEffect(() => setSel(0), [query, sub]);

  useEffect(() => {
    listRef.current?.querySelectorAll("[data-idx]")[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const execute = (i: number) => {
    const item = results[i];
    if (!item) return;
    recordUse(item.c.id);
    // Submenu entries swap the list instead of closing the palette.
    if (item.c.id.endsWith("-set")) {
      item.c.run();
      return;
    }
    onClose();
    item.c.run();
  };

  const SUB_META: Record<Exclude<typeof sub, null>, { title: string; crumb: string }> = {
    wallpapers: { title: t("palette.group-wallpapers"), crumb: t("palette.set-wallcrumb") },
    scenes: { title: t("palette.group-scenes"), crumb: t("palette.apply-scene-crumb") },
    rgb: { title: t("palette.group-lighting"), crumb: t("palette.set-lighting-crumb") },
  };

  return (
    <div
      className="pal-overlay fixed inset-0 z-[100] flex items-start justify-center bg-black/50 pt-[11vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="pal-panel w-full max-w-[600px] overflow-hidden rounded-xl border border-[var(--line-strong)] bg-[color-mix(in_srgb,var(--bg)_95%,transparent)] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.command-palette")}
      >
        <div className="relative flex items-center border-b border-[var(--line)]">
          {/* breadcrumb: shown in submenus, click = back */}
          {sub && (
            <button
              onClick={() => setSub(null)}
              title={t("palette.back-to-all-commands")}
              className={`${MINI_BTN} ml-3 shrink-0 px-2 py-1`}
            >
              <span className="text-[11px] leading-none">←</span>
              {SUB_META[sub].crumb}
            </button>
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((v) => Math.min(v + 1, results.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((v) => Math.max(v - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); execute(sel); }
              else if (e.key === "Escape") {
                e.preventDefault();
                if (sub) setSub(null);
                else onClose();
              }
            }}
            placeholder={
              sub === "wallpapers"
                ? t("palette.search-wallpapers")
                : sub === "scenes"
                  ? t("palette.search-scenes")
                  : sub === "rgb"
                    ? t("palette.search-modes")
                    : t("palette.type-a-command")
            }
            className="min-w-0 flex-1 bg-transparent px-4 py-3.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              title={t("palette.clear")}
              className="mr-3 shrink-0 rounded p-1 font-mono text-[10px] text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
            >
              ✕
            </button>
          )}
        </div>
        <div
          key={sub ?? "root"}
          className="pal-swap max-h-[440px] overflow-y-auto p-1.5"
        >
          <div ref={listRef}>
            {rows.length === 0 && (
              <div className="px-3 py-8 text-center text-xs text-[var(--text-faint)]">
                {t("palette.no-matching-{kind}", {
                  kind: t(
                    sub === "wallpapers"
                      ? "palette.kind-wallpapers"
                      : sub === "scenes"
                        ? "palette.kind-scenes"
                        : sub === "rgb"
                          ? "palette.kind-modes"
                          : "palette.kind-commands",
                  ),
                })}
              </div>
            )}
            {rows.map((row) =>
              row.kind === "header" ? (
                <div
                  key={`h-${row.label}`}
                  className="px-3 pb-1 pt-3 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--text-faint)]"
                >
                  {t(row.label)}
                </div>
              ) : (
              <button
                key={row.r.c.id}
                data-idx={row.i}
                onClick={() => execute(row.i)}
                onMouseEnter={() => setSel(row.i)}
                className={`pal-cmd group/pin relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${
                  row.i === sel
                    ? "bg-[rgb(var(--glow)/0.12)] text-[rgb(var(--glow))]"
                    : "text-[var(--text-dim)]"
                }`}
                style={{ animationDelay: `${Math.min(row.i, 10) * 14}ms` }}
              >
                {/* left selection bar (slides in with the row's glow bg) */}
                <span
                  className={`absolute inset-y-1 left-0 w-[2.5px] rounded-full bg-[rgb(var(--glow))] transition-opacity ${
                    row.i === sel ? "opacity-100" : "opacity-0"
                  }`}
                />
                {row.r.c.thumb ? (
                  <img
                    src={row.r.c.thumb}
                    alt=""
                    className={`h-6 w-9 shrink-0 rounded-sm object-cover ring-1 transition-all ${
                      row.i === sel ? "ring-[rgb(var(--glow)/0.6)]" : "ring-[var(--line)] opacity-80"
                    }`}
                  />
                ) : (
                  (() => {
                    const Icon: IconCmp = row.r.c.icon;
                    return (
                      <Icon
                        className={`h-4 w-4 shrink-0 transition-opacity ${row.i === sel ? "" : "opacity-70"}`}
                      />
                    );
                  })()
                )}
                <span className="min-w-0 flex-1 truncate">{t(row.r.c.label)}</span>
                {row.r.c.active && (
                  <span className="shrink-0 rounded-sm bg-[rgb(var(--glow)/0.15)] px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.15em] text-[rgb(var(--glow))]">
                    {t("palette.live")}
                  </span>
                )}
                <button
                  title={t(pinned.includes(row.r.c.id) ? "common.unpin" : "common.pin")}
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePin(row.r.c.id);
                  }}
                  className={`shrink-0 rounded p-0.5 transition-all ${
                    pinned.includes(row.r.c.id)
                      ? "text-[rgb(var(--glow))] opacity-100"
                      : "text-[var(--text-faint)] opacity-0 hover:text-[var(--text)] group-hover/pin:opacity-100 focus:opacity-100"
                  }`}
                >
                  <IconPin filled={pinned.includes(row.r.c.id)} className="h-3 w-3" />
                </button>
              </button>
              )
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-[var(--line)] px-4 py-2 font-mono text-[9px] uppercase tracking-[0.15em] text-[var(--text-faint)]">
          <span>{t("palette.select")}</span>
          <span>{t("palette.run")}</span>
          <span>{`esc ${t(sub ? "palette.back" : "palette.close")}`}</span>
          {query && (
            <span>
              {t("palette.{n}-results", { n: results.length })}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 normal-case">
            <IconPin filled={false} className="h-2.5 w-2.5" />{" "}
            {t("palette.pin-for-quick-access")}
          </span>
        </div>
      </div>
    </div>
  );
}
