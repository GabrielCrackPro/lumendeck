import { SETTINGS_TAB, TABS } from "./Sidebar";
import type { TabId } from "./Sidebar";

export type ActionId = "run" | "pin" | "unpin" | "goto";

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

export function actionsFor(group: string, pinned: boolean): ActionId[] {
  const ids: ActionId[] = ["run", pinned ? "unpin" : "pin"];
  if (SECTION_TAB[group]) ids.push("goto");
  return ids;
}

export function navDigit(tab: string): number | null {
  const i = TABS.findIndex((t) => t.id === tab);
  if (i !== -1) return i + 1;
  return tab === SETTINGS_TAB.id ? TABS.length + 1 : null;
}

export function stepClamped(
  value: number,
  dir: 1 | -1,
  step: number,
  min: number,
  max: number,
): number {
  const next = value + dir * step;
  return Math.min(max, Math.max(min, Number(next.toFixed(6))));
}

export function stepIndex(current: number, len: number): number {
  if (len <= 0) return -1;
  return (((current + 1) % len) + len) % len;
}

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
