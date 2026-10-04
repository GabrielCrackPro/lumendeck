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