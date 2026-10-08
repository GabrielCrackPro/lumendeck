
import { formatDuration, formatResolution, type MediaMeta } from "./mediaMeta";
import type { IndexedMeta, VaultIndex } from "./vaultIndex";
import type { GalleryEntry, WallpaperKind } from "@shared/types";

export interface TileMeta {
  resolution: string | null;
  duration: string | null;
}

const HAS_DURATION: ReadonlySet<WallpaperKind> = new Set<WallpaperKind>([
  "video",
  "slideshow",
]);

export function tileMetaFor(
  entry: GalleryEntry,
  index: VaultIndex | undefined,
): TileMeta {
  const measured: IndexedMeta | MediaMeta | undefined = index?.[entry.source];
  return {
    resolution: formatResolution(measured ?? null),
    duration: HAS_DURATION.has(entry.kind)
      ? formatDuration(measured?.duration ?? null)
      : null,
  };
}

export function hasTileMeta(meta: TileMeta): boolean {
  return meta.resolution != null || meta.duration != null;
}

export type ResolutionFloor = 0 | 1920 | 3840;

const MIN_HEIGHT_RATIO = 0.4;

export function meetsFloor(
  entry: GalleryEntry,
  index: VaultIndex | undefined,
  floor: ResolutionFloor,
): boolean {
  if (floor === 0) return true;
  const measured = index?.[entry.source];
  if (!measured) return false;
  return (
    measured.width >= floor && measured.height >= floor * MIN_HEIGHT_RATIO
  );
}
