
import type { SceneProfile } from "@shared/types";

export interface ProfileTarget {
  mode: string;
  staticColor: [number, number, number];
  animationSpeed: number;
}

export interface SceneTarget {
  wallpaper: { kind: string; source: string };
  rgb: ProfileTarget;
  stickers: { id: string; name: string; x: number; y: number }[];
}

export function sceneMatches(scene: SceneProfile, target: SceneTarget): boolean {
  if (scene.wallpaper.kind !== target.wallpaper.kind) return false;
  if (scene.wallpaper.source !== target.wallpaper.source) return false;
  if (!profileMatches({ mode: scene.rgb.mode, staticColor: scene.rgb.staticColor, animationSpeed: scene.rgb.animationSpeed }, target.rgb)) {
    return false;
  }
  if (scene.stickers.length !== target.stickers.length) return false;
  return scene.stickers.every((s, i) => {
    const other = target.stickers[i];
    return other !== undefined && s.id === other.id && s.x === other.x && s.y === other.y;
  });
}

function firstMatchingConfig(
  scenes: readonly SceneProfile[] | undefined,
  target: SceneTarget,
): SceneProfile | null {
  if (!scenes) return null;
  return scenes.find((scene) => sceneMatches(scene, target)) ?? null;
}

export function activeConfigName(
  scenes: readonly SceneProfile[] | undefined,
  target: SceneTarget,
): string | null {
  return firstMatchingConfig(scenes, target)?.name ?? null;
}

export function activeConfigId(
  scenes: readonly SceneProfile[] | undefined,
  target: SceneTarget,
): string | null {
  return firstMatchingConfig(scenes, target)?.id ?? null;
}

const SPEED_EPSILON = 0.01;

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