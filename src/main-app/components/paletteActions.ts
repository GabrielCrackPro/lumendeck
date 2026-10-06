// What the command palette's actions view offers for a command, decided
// without the component so the rule can be tested: every command can be run
// and pinned, but a "jump to the section that owns this" is only worth
// offering where a tab exists and the jump means something — a navigation
// row already *is* the jump, profiles open from the header avatar rather
// than a tab of their own, and the app rows shut the app down.
import { SETTINGS_TAB, TABS } from "./Sidebar";
import type { TabId } from "./Sidebar";

/** The rows of the actions view, in the order they are offered. */
export type ActionId = "run" | "pin" | "unpin" | "goto";

/**
 * The tab a command's section lives on, or null when a jump would be
 * nonsense.
 *
 * Typed `TabId` on purpose: a tab id that drifts out of the Sidebar is a
 * compile error here, not a palette action that quietly navigates nowhere.
 */
export const SECTION_TAB: Record<string, TabId | null> = {
  navigate: null,
  playback: "wallpaper",
  wallpaper: "wallpaper",
  wallpapers: "wallpaper",
  rgb: "rgb",
  scene: null,
  config: "general",
  app: null,
};

/**
 * The action ids for a command, best first: run is what Enter would have
 * done anyway, pin state is what people reach for next, and the section
 * jump comes last because it is the one that leaves the palette.
 *
 * An unknown group degrades to run and pin rather than dead-ending — group
 * ids come from the config side, and a new one should still get a menu.
 */
export function actionsFor(group: string, pinned: boolean): ActionId[] {
  const ids: ActionId[] = ["run", pinned ? "unpin" : "pin"];
  if (SECTION_TAB[group]) ids.push("goto");
  return ids;
}

/**
 * The digit behind Ctrl+<digit> for a nav row, mirroring Shell's handler:
 * position in TABS, with General — kept out of TABS on purpose — last.
 *
 * Read from TABS rather than restated here so a row that shows `Ctrl+3` is
 * showing the key the Shell will actually act on, not a second list that can
 * drift from it. Null for anything that is not a tab.
 */
export function navDigit(tab: string): number | null {
  const i = TABS.findIndex((t) => t.id === tab);
  if (i !== -1) return i + 1;
  return tab === SETTINGS_TAB.id ? TABS.length + 1 : null;
}

/**
 * One knob step in `dir`, clamped to the knob's range.
 *
 * Clamped rather than wrapping: a brightness that rolls from 100% back to 0%
 * while a key is held down is a flash, not a control.
 */
export function stepClamped(
  value: number,
  dir: 1 | -1,
  step: number,
  min: number,
  max: number,
): number {
  const next = value + dir * step;
  // Six decimals kills the binary-float drift (0.35000000000000003) that
  // would otherwise display 34%, without assuming the value sits on a step
  // grid — a slider can leave it anywhere.
  return Math.min(max, Math.max(min, Number(next.toFixed(6))));
}

/**
 * The index after `current` in a cycle — "apply the one after this".
 *
 * -1 (the current thing is not in the list, or nothing is active) starts at
 * 0 rather than skipping to the second item, the end wraps, and an empty
 * list returns -1 so the caller skips the apply instead of indexing out of
 * bounds.
 */
export function stepIndex(current: number, len: number): number {
  if (len <= 0) return -1;
  return (((current + 1) % len) + len) % len;
}

/**
 * How much a row's own section — the tab you are already standing in — adds
 * to its score.
 *
 * 40, deliberately below every gap between the scorer's tiers: context can
 * settle a near-tie between two matches of the same kind (Vercel's move —
 * rank what applies here before what applies globally) but can never pull a
 * substring match past a prefix match, so typing still means what it said.
 */
export const CONTEXT_BOOST = 40;

export function withContextBoost(
  score: number,
  group: string,
  currentTab: string | null,
): number {
  return currentTab !== null && SECTION_TAB[group] === currentTab
    ? score + CONTEXT_BOOST
    : score;
}
