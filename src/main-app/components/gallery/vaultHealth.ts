
import type { GalleryEntry } from "@shared/types";

export function sourceKey(entry: GalleryEntry): string | null {
  if (entry.kind !== "video" && entry.kind !== "image") return null;
  const s = entry.source.trim().toLowerCase();
  return s.length > 0 ? s : null;
}

export function findDuplicates(entries: GalleryEntry[]): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const e of entries) {
    const key = sourceKey(e);
    if (!key) continue;
    const group = byKey.get(key);
    if (group) group.push(e.id);
    else byKey.set(key, [e.id]);
  }
  const dupes = new Map<string, string[]>();
  for (const [key, ids] of byKey) {
    if (ids.length > 1) dupes.set(key, ids);
  }
  return dupes;
}

export function duplicateIds(entries: GalleryEntry[]): Set<string> {
  const redundant = new Set<string>();
  for (const ids of findDuplicates(entries).values()) {
    for (const id of ids.slice(1)) redundant.add(id);
  }
  return redundant;
}

export type Unhealthy = "missing" | "duplicate";

export function healthOf(
  entryId: string,
  missing: ReadonlySet<string>,
  duplicates: ReadonlySet<string>,
): Unhealthy | null {
  if (missing.has(entryId)) return "missing";
  if (duplicates.has(entryId)) return "duplicate";
  return null;
}
