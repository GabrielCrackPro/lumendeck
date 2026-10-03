// The compact facts a gallery tile shows about its media.
//
// Split from GalleryCard because two decisions live here that are worth
// pinning down and neither is visible in the markup: what counts as "4K" (a
// width alone would call a 4096x256 ultrawide 8K and a 3840x1080 one 4K), and
// what to show when a file has not been probed (nothing, never a guess).
//
// Vitest has no DOM, so the tile cannot be asserted on directly. These
// functions hold the whole decision.

import { formatDuration, formatResolution, type MediaMeta } from "./mediaMeta";
import type { IndexedMeta, VaultIndex } from "./vaultIndex";
import type { GalleryEntry, WallpaperKind } from "@shared/types";

/** What a tile says about its own media, or null to say nothing. */
export interface TileMeta {
  /** "3840x2160", or null when unmeasured. */
  resolution: string | null;
  /** "4:15", for video and slideshow only. */
  duration: string | null;
}

/** Kinds whose files have a runtime. A still image's length is zero, and
 *  printing "0:00" on a photo is noise, so it is omitted rather than shown. */
const HAS_DURATION: ReadonlySet<WallpaperKind> = new Set<WallpaperKind>([
  "video",
  "slideshow",
]);

/**
 * The indexed metadata for one entry, if the vault index has measured it.
 *
 * The index is the right source here rather than a per-tile probe: the grid can
 * hold hundreds of tiles, and probing each one would be the request storm
 * mediaMeta's cache exists to prevent. When the index has nothing, the tile
 * shows no facts rather than firing its own probe — a grid full of "0:00" and
 * "??x??" would be worse than a grid that is simply quiet until the index is
 * built.
 */
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

/** True when the tile has at least one fact worth rendering. */
export function hasTileMeta(meta: TileMeta): boolean {
  return meta.resolution != null || meta.duration != null;
}

/**
 * The resolution floors the quick filter offers, as the *width* in pixels each
 * one names.
 *
 * Width, not height, because that is what these labels mean in practice: "4K"
 * is a 3840-wide frame and "1080p" is a 1920-wide one. Naming the floors by
 * height and then comparing them to a width is the mistake that started this,
 * and it made a 1280x720 file pass a 1080p filter.
 */
export type ResolutionFloor = 0 | 1920 | 3840;

/**
 * How tall a frame may be, as a fraction of the floor's width, and still count.
 *
 * 16:9 is 0.5625, so this allows for the wider aspect ratios that are
 * legitimately not 16:9 -- a 32:9 3840x1600 is a real 4K-class ultrawide and a
 * strict 16:9 test would exclude it. The threshold sits above 1080p's 0.28 on
 * purpose: at 0.4, a 3840x1080 strip is 0.28 and correctly fails, while a
 * 3840x1600 ultrawide at 0.42 passes. Every attempt to derive this from the
 * floor's own 16:9 height instead put a 1080-tall strip into the 4K bucket.
 */
const MIN_HEIGHT_RATIO = 0.4;

/**
 * Whether an entry is at least this resolution class.
 *
 * An unmeasured entry meets no floor -- which is why this reads the index
 * rather than probing, and why the filter offers nothing until the index has
 * been built. Guessing here would make picking 4K look like it was deleting
 * files it simply had not looked at yet.
 */
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
