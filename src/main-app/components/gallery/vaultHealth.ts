// The health of the vault: entries whose file has gone, and entries that are
// the same file twice.
//
// Split deliberately. "Is this path still there" needs a filesystem, so it is a
// backend call that returns a set of ids. "Are these two entries the same
// wallpaper" is pure string work over the config, so it lives here where it can
// be tested — and it is the half that is actually easy to get wrong, because
// the answer has to be right about case, separators, and a path that was
// renamed to a different case by Explorer.

import type { GalleryEntry } from "@shared/types";

/** A canonical form of a source path, for deciding whether two entries are one file. */
export function sourceKey(entry: GalleryEntry): string | null {
  // Only files can be duplicates. Two web wallpapers with the same URL are two
  // entries on purpose, and a shader preset id is not a file at all.
  if (entry.kind !== "video" && entry.kind !== "image") return null;
  const s = entry.source.trim().toLowerCase();
  return s.length > 0 ? s : null;
}

/**
 * Group ids by the file they point at. Every group with more than one member
 * is a duplicate set; the first member (in vault order) is treated as the
 * keeper, because it is the one the user imported first and is the one whose
 * name and collections they have already curated.
 */
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

/** Ids that are redundant copies — every member of a duplicate set but the first. */
export function duplicateIds(entries: GalleryEntry[]): Set<string> {
  const redundant = new Set<string>();
  for (const ids of findDuplicates(entries).values()) {
    for (const id of ids.slice(1)) redundant.add(id);
  }
  return redundant;
}

/**
 * Ids whose file is gone. `missing` comes from the backend, which can actually
 * stat the disk; this only combines the two signals so the UI has one set to
 * ask about.
 */
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
