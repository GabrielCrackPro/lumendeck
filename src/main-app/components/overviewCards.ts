// The decisions the Overview profiles and hotkeys cards make, kept out of the
// components so they can be asserted.
//
// Vitest runs in node with no DOM, so a card cannot be interaction-tested
// here. What each card is actually deciding is not its layout, though: which
// profiles survive a truncating list, whether a bound key is live or dormant,
// and which three fields describe a profile. Those are the parts that were
// wrong, and they are all pure.

import { HOTKEY_ACTIONS, type HotkeyActionId } from "@shared/constants";
import { parseAccelerator } from "../eq";
import type { HotkeyConfig, SceneProfile } from "@shared/types";

/**
 * How many profiles the Overview card lists before it defers to Settings.
 *
 * Five, not six: with the active one guaranteed a slot (below), five leaves
 * four ordinary rows plus it, which fits the card's height without scrolling
 * at the dashboard's usual window size.
 */
export const OVERVIEW_PROFILE_LIMIT = 5;

/**
 * Which profiles the card shows, and how many it is hiding.
 *
 * The applied profile is never the one that gets truncated away. Truncating
 * strictly by position means applying a profile from Settings can move it past
 * the cut, and the card then shows no sign of what is actually running -- the
 * one thing it exists to answer. So the active profile takes the last slot and
 * the row it displaced is what gets hidden.
 */
export function visibleProfiles(
  scenes: readonly SceneProfile[],
  activeId: string | null,
  limit: number = OVERVIEW_PROFILE_LIMIT,
): { shown: SceneProfile[]; hidden: number } {
  if (scenes.length <= limit) return { shown: [...scenes], hidden: 0 };
  const shown = scenes.slice(0, limit);
  // `activeId` may name a profile that no longer exists -- deleting from the
  // picker leaves the header holding a ghost -- and an id no longer in the
  // list must not displace a real row.
  if (activeId != null && !shown.some((s) => s.id === activeId)) {
    const active = scenes.find((s) => s.id === activeId);
    if (active) shown[shown.length - 1] = active;
  }
  return { shown, hidden: scenes.length - shown.length };
}

/**
 * The three fields that describe what a profile holds.
 *
 * Extracted because the picker row and the Overview card both want this line,
 * and they are the same string: a profile called "Work" with a dimmed variant
 * beside it is otherwise indistinguishable in both lists. Sticker count is a
 * number rather than a formatted string so the caller owns the wording.
 */
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

/** Modifier tokens as they should read on a key cap, not as the OS spells them. */
const MODIFIER_LABELS: Record<string, string> = {
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  super: "Win",
};

/**
 * An accelerator as key-cap labels, or an empty list when it will not parse.
 *
 * "Super" becomes "Win" because that is what the key on the user's keyboard
 * has printed on it. The empty list rather than a raw echo is deliberate: the
 * Settings row renders an unparseable combo in red, and a card that quietly
 * printed it back would look like a working binding.
 */
export function splitAccelerator(accelerator: string): string[] {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return [];
  return [...parsed.modifiers, parsed.key].map(
    (token) => MODIFIER_LABELS[token.toLowerCase()] ?? token,
  );
}

/**
 * A window shortcut row. Mirrors what `shortcutRows()` returns, so the card
 * reads the overlay's table rather than a second list of its own.
 */
export interface WindowShortcutRow {
  keys: string[];
  what: string;
}

/**
 * The same rows with the per-tab Ctrl+N bindings folded into one.
 *
 * The tab rows are five of the nine rows the overlay draws, all saying the same
 * thing with a different digit, and the Overview card has room for about five.
 * Listed individually they push the global keys — the ones the card exists to
 * surface — below the fold of a 5-column card.
 *
 * Folded on "Ctrl plus a single digit", which is exactly the tabs' binding and
 * nothing else's: `Ctrl+B`, `Ctrl+K` and `?` all fail that test and survive as
 * their own rows. So the fold cannot swallow a shortcut that is not a tab.
 *
 * `groupLabel` is passed in rather than resolved here so this stays pure and
 * translatable; the caller supplies `t("common.switch-tab")`.
 */
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
  // The range is written from the first and last digit, so adding a tab keeps
  // the label honest without anyone editing this function.
  const first = digits[0]!;
  const last = digits[digits.length - 1]!;
  const range = first === last ? first : `${first}-${last}`;
  const out: WindowShortcutRow[] = [];
  let folded = false;
  for (const row of rows) {
    if (isTabRow(row)) {
      // Folded at the first tab's position, so the row keeps the order it had
      // rather than moving to the end of the list.
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

/** One configured global shortcut, ready to render. */
export interface GlobalHotkeyRow {
  id: HotkeyActionId;
  /** Catalog key for the action name; resolved by the caller with `t()`. */
  labelKey: string;
  accelerator: string;
  /** Key-cap labels from `splitAccelerator`. */
  caps: string[];
}

/**
 * What the Overview card says about the system-wide keys.
 *
 * `dormant` is the distinction the old card could not make: bindings that are
 * stored but released because the master switch is off are not "unbound", and
 * reporting them as unbound is what makes a user re-bind keys they already
 * bound. So bound keys are counted whether or not they are live, and `dormant`
 * says which case this is.
 */
export function globalHotkeyState(
  hotkeys: HotkeyConfig,
  enabled: boolean,
): {
  enabled: boolean;
  total: number;
  bound: GlobalHotkeyRow[];
  boundCount: number;
  /** Bound, but released because the master switch is off. */
  dormant: boolean;
} {
  const bound: GlobalHotkeyRow[] = [];
  for (const action of HOTKEY_ACTIONS) {
    const accelerator = (hotkeys[action.id]?.accelerator ?? "").trim();
    // Skipped when it will not parse: a combo the backend never registered has
    // no caps to draw, and rendering a row of nothing reads as a broken card.
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
// ---------- what wants doing, and where the accent came from ----------

/** What clicking an attention chip does. */
export type AttentionAction =
  /** Go to the tab that fixes it. */
  | { kind: "navigate"; tab: string }
  /** The switch is on this screen; do not make anyone go looking for it. */
  | { kind: "toggle-lighting" };

/**
 * What each attention item says. Named as a map so the checker can see the
 * keys: they are returned as data and rendered by the caller, so nothing calls
 * `t()` with a literal.
 */
export const ATTENTION_LABELS = {
  offline: "overview.openrgb-offline",
  paused: "overview.wallpaper-paused",
  lightingOff: "common.lighting-off",
} as const;

export interface AttentionItem {
  /** Stable identity, so React keys the chip and not its label. */
  id: string;
  /** Catalog key for the label. */
  key: string;
  action: AttentionAction;
}

/**
 * Everything on this machine that wants doing, in the order it wants doing.
 *
 * This replaces a chain of `if`s that could only ever report one problem: the
 * old strip suppressed "lighting off" whenever anything else was wrong, so a
 * machine with OpenRGB down *and* the wallpaper paused was told about the pause
 * and nothing about the reason the lights had gone with it. Every condition is
 * now independent and every item carries the click that fixes it — a strip that
 * can tell you something is wrong but not do anything about it is a notification
 * with the actions left off.
 */
export function attentionItems(state: {
  rgbConnected: boolean;
  wallpaperPaused: boolean;
  lightingEnabled: boolean;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  // Offline first: it is the reason the lighting item below may be lying about
  // being a choice rather than a consequence, and it is the only one of the
  // three that is not fixed from this screen.
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

/**
 * Which salutation this hour earns, as the catalog key the unnamed form reads.
 *
 * Pure so the boundaries (5, 12, 18) can be pinned by tests, and so the hook
 * that re-reads the clock and the first render cannot pick different keys —
 * picking the key twice is how a greeting ends up saying "Good evening" to
 * someone at ten in the morning.
 */
export function greetingKeyForHour(hour: number) {
  if (hour < 5) return "overview.up-late" as const;
  if (hour < 12) return "overview.good-morning" as const;
  if (hour < 18) return "overview.good-afternoon" as const;
  return "overview.good-evening" as const;
}

/**
 * How long ago something happened, as a catalog key suffix.
 *
 * A dashboard that reports state but never history leaves one question
 * unanswerable without a log: did that press do anything. Four buckets, because
 * past an hour the precise minute stops mattering and past a day nobody is
 * reading it — the coarsest bucket still has to exist, or a change from
 * yesterday renders as "43200s ago".
 */
export function recencyBucket(elapsedMs: number): "now" | "seconds" | "minutes" | "hours" {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 5_000) return "now";
  if (elapsedMs < 60_000) return "seconds";
  if (elapsedMs < 3_600_000) return "minutes";
  return "hours";
}

/** The number to put in the bucket, and the unit it is in. */
export function recencyValue(elapsedMs: number): { value: number; unit: "seconds" | "minutes" | "hours" } {
  const bucket = recencyBucket(elapsedMs);
  if (bucket === "seconds") return { value: Math.floor(elapsedMs / 1000), unit: "seconds" };
  if (bucket === "minutes") return { value: Math.floor(elapsedMs / 60_000), unit: "minutes" };
  return { value: Math.floor(elapsedMs / 3_600_000), unit: "hours" };
}
