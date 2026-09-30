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
// The result is cached in localStorage keyed by source path, so it survives a
// restart and only re-probes entries that are new or whose file changed.

import { convertFileSrc } from "@tauri-apps/api/core";
import { mediaMeta } from "./mediaMeta";
import type { GalleryEntry, WallpaperKind } from "@shared/types";

export interface IndexedMeta {
  width: number;
  height: number;
  /** Seconds, for video only. */
  duration: number | null;
}

export type VaultIndex = Record<string, IndexedMeta>;

const CACHE_KEY = "lumendeck.vaultIndex.v1";
/** How many probes are in flight at once. The cache dedupes, but the network
 *  (well, the disk) still has to be walked a few entries at a time or a large
 *  vault locks the window up. */
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

/** How many of these entries the index already knows about. */
export function cachedCount(entries: GalleryEntry[], index: VaultIndex): number {
  return entries.filter((e) => probeable(e.kind) && index[e.source]).length;
}

export interface IndexProgress {
  done: number;
  total: number;
  /** The source currently being probed, for a "working on it" line. */
  current: string | null;
}

/**
 * Probe every entry that is not already cached, and return the whole index.
 *
 * Already-cached entries are never re-probed: the cache key is the source path,
 * so a file that has not moved is assumed unchanged, and "regenerate thumbnail"
 * in the drawer is the escape hatch for the ones that are not.
 */
export async function buildIndex(
  entries: GalleryEntry[],
  onProgress?: (p: IndexProgress) => void,
): Promise<VaultIndex> {
  const index = { ...readCache() };
  const pending = entries.filter((e) => probeable(e.kind) && !index[e.source]);
  const total = entries.filter((e) => probeable(e.kind)).length;
  let done = total - pending.length;
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
      // A null result is cached too, but as nothing: an unreadable file stays
      // unmeasured rather than being retried on every single build.
      if (meta) index[entry.source] = { width: meta.width, height: meta.height, duration: meta.duration };
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
