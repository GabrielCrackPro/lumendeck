
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
  duration: number | null;
  stamp?: MeasuredAt;
}

export type VaultIndex = Record<string, IndexedMeta>;

const CACHE_KEY = "lumendeck.vaultIndex.v2";
const CONCURRENCY = 6;

const probeable = (kind: WallpaperKind) => kind === "video" || kind === "image";

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
  current: string | null;
}

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
      if (meta && stamp) {
        index[entry.source] = {
          width: meta.width,
          height: meta.height,
          duration: meta.duration,
          stamp: { mtimeMs: stamp.mtimeMs, size: stamp.size },
        };
      } else if (meta) {
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

export type { FileStamp, MeasuredAt, StampMap };
export { isStale, sameStamp };
