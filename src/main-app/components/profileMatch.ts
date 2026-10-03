// Which saved config is the machine already running?
//
// The lighting half of that question is worth isolating on its own: a config
// stores the whole RGB subtree, but a meaningful part of "is this the config I
// am running" is a comparison of three numbers, and comparing the whole struct
// would call every hand-tweaked light a different config.
//
// Pure because that is the only part worth asserting. vitest has no DOM, and
// the comparison is the whole decision.

import type { SceneProfile } from "@shared/types";

/** The subset of the RGB config that decides whether the lighting is the same. */
export interface ProfileTarget {
  mode: string;
  staticColor: [number, number, number];
  animationSpeed: number;
}

/** What a whole-config snapshot has to agree with to count as applied. */
export interface SceneTarget {
  wallpaper: { kind: string; source: string };
  rgb: ProfileTarget;
  stickers: { id: string; name: string; x: number; y: number }[];
}

/**
 * Whether a saved config describes the setup that is on screen right now.
 *
 * Sticker ids are deliberately not compared, only their arrangement: applying a
 * config rewrites positions from the snapshot, and two configs saved from the
 * same stickers keep their ids, so comparing them would be comparing the
 * implementation against itself. What matters is that the same things are on the
 * desk in the same places — that is what "this is the config I am running"
 * means to someone looking at it.
 */
export function sceneMatches(scene: SceneProfile, target: SceneTarget): boolean {
  if (scene.wallpaper.kind !== target.wallpaper.kind) return false;
  if (scene.wallpaper.source !== target.wallpaper.source) return false;
  if (!profileMatches({ mode: scene.rgb.mode, staticColor: scene.rgb.staticColor, animationSpeed: scene.rgb.animationSpeed }, target.rgb)) {
    return false;
  }
  if (scene.stickers.length !== target.stickers.length) return false;
  return scene.stickers.every((s, i) => {
    // Length is equal above, so the indexer is in range -- but the compiler
    // reads it through `noUncheckedIndexedAccess`, which is right to insist.
    const other = target.stickers[i];
    return other !== undefined && s.id === other.id && s.x === other.x && s.y === other.y;
  });
}

/**
 * The saved config the machine is running, or null.
 *
 * First match wins, in stored order: saving twice without changing anything is
 * a state a user can create, and either answer is defensible, so the order
 * decides it. One lookup behind both accessors below, because two loops over
 * the same comparison is how the header chip and the picker end up disagreeing
 * about which config is current.
 */
function firstMatchingConfig(
  scenes: readonly SceneProfile[] | undefined,
  target: SceneTarget,
): SceneProfile | null {
  if (!scenes) return null;
  return scenes.find((scene) => sceneMatches(scene, target)) ?? null;
}

/**
 * The name of the saved config the machine is running, or null.
 *
 * Named for the user-facing word ("config") rather than the storage word
 * ("scene"), because the two have drifted apart in this codebase and the copy
 * should not inherit the confusion.
 */
export function activeConfigName(
  scenes: readonly SceneProfile[] | undefined,
  target: SceneTarget,
): string | null {
  return firstMatchingConfig(scenes, target)?.name ?? null;
}

/**
 * The id of the saved config the machine is running, or null.
 *
 * The id rather than the name because that is what applying one takes, and the
 * picker marks the current entry by id: two configs can share a name after the
 * duplicate check is bypassed (the tray, the command palette, an old file), and
 * matching by name would light up the wrong row.
 */
export function activeConfigId(
  scenes: readonly SceneProfile[] | undefined,
  target: SceneTarget,
): string | null {
  return firstMatchingConfig(scenes, target)?.id ?? null;
}

/**
 * How close two speeds have to be to count as equal.
 *
 * The config is stored as JSON and the saved config is stored as JSON, so a
 * value written as 1.4 can come back as 1.4000000000000001. An exact
 * comparison would then report every config as inactive after a reload, which
 * reads as "configs are broken" rather than as a floating-point artefact.
 */
const SPEED_EPSILON = 0.01;

/**
 * Whether these lighting settings are the lighting that is on right now.
 *
 * Exported for its own tests rather than only for `sceneMatches`: the speed
 * tolerance below is a real decision with two ways to get it wrong, and
 * asserting it through the config comparison would drag wallpaper and stickers
 * into every case.
 */
export function profileMatches(
  lighting: ProfileTarget,
  target: ProfileTarget,
): boolean {
  return (
    lighting.mode === target.mode &&
    lighting.animationSpeed - target.animationSpeed < SPEED_EPSILON &&
    target.animationSpeed - lighting.animationSpeed < SPEED_EPSILON &&
    lighting.staticColor[0] === target.staticColor[0] &&
    lighting.staticColor[1] === target.staticColor[1] &&
    lighting.staticColor[2] === target.staticColor[2]
  );
}