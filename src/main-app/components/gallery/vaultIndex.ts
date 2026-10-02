// A vault-wide index of entry metadata: resolution and length for every file.
//
// This exists because the probe in mediaMeta is deliberately lazy — it runs for
// the one entry whose drawer is open. That is right for the grid and useless
// for "sort by resolution" or "show me only the 4K ones", which are questions
// about the whole vault and need every entry measured.
//
// So the index is built on demand rather than on open. Probing a few hundred
// files the moment the tab mounts is exactly the request storm the lazy probe
// was built to avoid; a user who wants to sort by length should ask for that
// cost, and see it happen.
//
// The result is cached in localStorage, keyed by source path, and each entry
// carries the file stamp it was measured from. The stamp is what makes the cache
// correct rather than merely persistent: a file replaced in place keeps its
// path, so a path-keyed cache with no stamp would keep reporting the old
// resolution forever. See `indexStamps` for that decision.

import { convertFileSrc } from "@tauri-apps/api/core";
import { mediaMeta } from "./mediaMeta";
import {
  isStale,
  sameStamp,
  type FileStamp,
  type MeasuredAt,
  type StampMap,
} from "./indexStamps";
import type { GalleryEntry, WallpaperKind } from "@shared/types";

export interface IndexedMeta {
  width: number;
  height: number;
  /** Seconds, for video only. */
  duration: number | null;
  /**
   * The file stamp this was measured from.
   *
   * Absent on entries cached before stamps existed. Those are treated as stale
   * and re-probed once, which is the honest cost of admitting an unstampable
   * measurement cannot be trusted.
   */
  stamp?: MeasuredAt;
}

export type VaultIndex = Record<string, IndexedMeta>;

/**
 * Bumped when the cached shape changes in a way older entries cannot satisfy.
 *
 * The stamp made that necessary: a v1 record has no stamp, so every entry in it
 * would read as stale and the whole vault would re-probe on a version that has
 * nothing new to measure. A fresh key skips straight to correct.
 */
const CACHE_KEY = "lumendeck.vaultIndex.v2";
/// How many probes are in flight at once. The cache dedupes, but the network
///  (well, the disk) still has to be walked a few entries at a time or a large
///  vault locks the window up. */
const CONCURRENCY = 6;

const probeable = (kind: WallpaperKind) => kind === "video" || kind === "image";

/** Read the persisted index. A corrupt blob is discarded rather than thrown. */
export function readCache(): VaultIndex {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as VaultIndex;
  } catch {
    return {};
  }
}

function writeCache(index: VaultIndex): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(index));
  } catch {
    // Full or unavailable (private mode). The index still works for this
    // session, which is the part the user is looking at.
  }
}

/** How many of these entries the index can still vouch for. */
export function cachedCount(
  entries: GalleryEntry[],
  index: VaultIndex,
  stamps: StampMap,
): number {
  let fresh = 0;
  for (const entry of entries) {
    if (!probeable(entry.kind)) continue;
    const current = stamps[entry.id];
    if (!current) continue;
    const meta = index[entry.source];
    if (!meta) continue;
    if (!isStale(true, meta.stamp, current)) fresh += 1;
  }
  return fresh;
}

export interface IndexProgress {
  done: number;
  total: number;
  /** The source currently being probed, for a "working on it" line. */
  current: string | null;
}

/**
 * Probe every entry whose cached measurement is missing or stale, and return
 * the whole index.
 *
 * "Stale" means the file's stamp no longer matches the one the measurement was
 * taken from, which is how a re-encoded file gets re-measured. Entries whose
 * file is gone are left alone: they have nothing to measure, and probing them
 * would keep the progress bar short of 100% forever.
 */
export async function buildIndex(
  entries: GalleryEntry[],
  stamps: StampMap,
  onProgress?: (p: IndexProgress) => void,
): Promise<VaultIndex> {
  const index = { ...readCache() };
  const probeableEntries = entries.filter((e) => probeable(e.kind));

  const pending: GalleryEntry[] = [];
  let fresh = 0;
  let missing = 0;
  for (const entry of probeableEntries) {
    const current = stamps[entry.id];
    if (!current) {
      missing += 1;
      continue;
    }
    const meta = index[entry.source];
    const needs = !meta || isStale(true, meta.stamp, current);
    if (needs) {
      pending.push(entry);
    } else {
      fresh += 1;
    }
  }

  // Progress counts what will be probed plus what is already known. Missing
  // files are counted as done so the bar can actually finish.
  const total = fresh + missing + pending.length;
  let done = fresh + missing;
  onProgress?.({ done, total, current: null });

  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= pending.length) return;
      const entry = pending[i];
      if (!entry) return;
      onProgress?.({ done, total, current: entry.name });
      const meta = await mediaMeta(convertFileSrc(entry.source, "media"), entry.kind);
      const stamp = stamps[entry.id];
      // A null result is cached too, but as nothing: an unreadable file stays
      // unmeasured rather than being retried on every single build.
      if (meta && stamp) {
        index[entry.source] = {
          width: meta.width,
          height: meta.height,
          duration: meta.duration,
          stamp: { mtimeMs: stamp.mtimeMs, size: stamp.size },
        };
      } else if (meta) {
        // Measured but with no stamp to record against: keep the measurement,
        // and it will simply be re-probed next time rather than trusted.
        index[entry.source] = {
          width: meta.width,
          height: meta.height,
          duration: meta.duration,
        };
      }
      done += 1;
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, Math.max(1, pending.length)) }, worker),
  );
  writeCache(index);
  onProgress?.({ done: total, total, current: null });
  return index;
}

/** Re-exported so callers do not need to know which module owns the types. */
export type { FileStamp, MeasuredAt, StampMap };
export { isStale, sameStamp };
