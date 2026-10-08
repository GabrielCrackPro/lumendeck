
import { HOTKEY_ACTIONS, type HotkeyActionId } from "@shared/constants";
import { parseAccelerator } from "../eq";
import type { HotkeyConfig, SceneProfile } from "@shared/types";

export const OVERVIEW_PROFILE_LIMIT = 5;

export function visibleProfiles(
  scenes: readonly SceneProfile[],
  activeId: string | null,
  limit: number = OVERVIEW_PROFILE_LIMIT,
): { shown: SceneProfile[]; hidden: number } {
  if (scenes.length <= limit) return { shown: [...scenes], hidden: 0 };
  const shown = scenes.slice(0, limit);
  if (activeId != null && !shown.some((s) => s.id === activeId)) {
    const active = scenes.find((s) => s.id === activeId);
    if (active) shown[shown.length - 1] = active;
  }
  return { shown, hidden: scenes.length - shown.length };
}

export function profileSummary(scene: SceneProfile): {
  kind: string;
  mode: string;
  stickers: number;
} {
  return {
    kind: scene.wallpaper.kind,
    mode: scene.rgb.mode,
    stickers: scene.stickers.length,
  };
}

const MODIFIER_LABELS: Record<string, string> = {
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  super: "Win",
};

export function splitAccelerator(accelerator: string): string[] {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return [];
  return [...parsed.modifiers, parsed.key].map(
    (token) => MODIFIER_LABELS[token.toLowerCase()] ?? token,
  );
}

export interface WindowShortcutRow {
  keys: string[];
  what: string;
}

export function condenseWindowShortcuts(
  rows: readonly WindowShortcutRow[],
  groupLabel: string,
): WindowShortcutRow[] {
  const isTabRow = (r: WindowShortcutRow) =>
    r.keys.length === 2 &&
    r.keys[0] === "Ctrl" &&
    /^[1-9]$/.test(r.keys[1] ?? "");
  const digits = rows.filter(isTabRow).map((r) => r.keys[1] ?? "");
  if (digits.length < 2) return [...rows];
  const first = digits[0]!;
  const last = digits[digits.length - 1]!;
  const range = first === last ? first : `${first}-${last}`;
  const out: WindowShortcutRow[] = [];
  let folded = false;
  for (const row of rows) {
    if (isTabRow(row)) {
      if (!folded) {
        out.push({ keys: ["Ctrl", range], what: groupLabel });
        folded = true;
      }
      continue;
    }
    out.push(row);
  }
  return out;
}

export interface GlobalHotkeyRow {
  id: HotkeyActionId;
  labelKey: string;
  accelerator: string;
  caps: string[];
}

export function globalHotkeyState(
  hotkeys: HotkeyConfig,
  enabled: boolean,
): {
  enabled: boolean;
  total: number;
  bound: GlobalHotkeyRow[];
  boundCount: number;
  dormant: boolean;
} {
  const bound: GlobalHotkeyRow[] = [];
  for (const action of HOTKEY_ACTIONS) {
    const accelerator = (hotkeys[action.id]?.accelerator ?? "").trim();
    const caps = splitAccelerator(accelerator);
    if (accelerator.length === 0 || caps.length === 0) continue;
    bound.push({ id: action.id, labelKey: action.label, accelerator, caps });
  }
  return {
    enabled,
    total: HOTKEY_ACTIONS.length,
    bound,
    boundCount: bound.length,
    dormant: bound.length > 0 && !enabled,
  };
}

export type AttentionAction =
  | { kind: "navigate"; tab: string }
  | { kind: "toggle-lighting" };

export const ATTENTION_LABELS = {
  offline: "overview.openrgb-offline",
  paused: "overview.wallpaper-paused",
  lightingOff: "common.lighting-off",
} as const;

export interface AttentionItem {
  id: string;
  key: string;
  action: AttentionAction;
}

export function attentionItems(state: {
  rgbConnected: boolean;
  wallpaperPaused: boolean;
  lightingEnabled: boolean;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (!state.rgbConnected) {
    items.push({
      id: "openrgb-offline",
      key: ATTENTION_LABELS.offline,
      action: { kind: "navigate", tab: "rgb" },
    });
  }
  if (state.wallpaperPaused) {
    items.push({
      id: "wallpaper-paused",
      key: ATTENTION_LABELS.paused,
      action: { kind: "navigate", tab: "wallpaper" },
    });
  }
  if (!state.lightingEnabled) {
    items.push({
      id: "lighting-off",
      key: ATTENTION_LABELS.lightingOff,
      action: { kind: "toggle-lighting" },
    });
  }
  return items;
}

export function greetingKeyForHour(hour: number) {
  if (hour < 5) return "overview.up-late" as const;
  if (hour < 12) return "overview.good-morning" as const;
  if (hour < 18) return "overview.good-afternoon" as const;
  return "overview.good-evening" as const;
}

export function recencyBucket(elapsedMs: number): "now" | "seconds" | "minutes" | "hours" {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 5_000) return "now";
  if (elapsedMs < 60_000) return "seconds";
  if (elapsedMs < 3_600_000) return "minutes";
  return "hours";
}

export function recencyValue(elapsedMs: number): { value: number; unit: "seconds" | "minutes" | "hours" } {
  const bucket = recencyBucket(elapsedMs);
  if (bucket === "seconds") return { value: Math.floor(elapsedMs / 1000), unit: "seconds" };
  if (bucket === "minutes") return { value: Math.floor(elapsedMs / 60_000), unit: "minutes" };
  return { value: Math.floor(elapsedMs / 3_600_000), unit: "hours" };
}
