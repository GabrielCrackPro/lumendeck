// Deciding which cached measurements are still true.
//
// The vault index caches resolution and duration per source path. That was
// correct while files never changed underneath it, and wrong the moment one
// does: re-encoding a video in place keeps the path, so the cache keeps
// reporting the old resolution and duration, and the grid sorts and filters on
// numbers that no longer describe the file. "Rescan" could not fix it, because
// rescan only ever asked whether the file was still *there*.
//
// A stamp — size and mtime — makes staleness detectable without decoding
// anything, which is the point: the whole reason the index exists is to avoid
// probing the whole vault on open.
//
// The comparison is deliberately strict. An entry whose stamp we do not have is
// treated as needing a probe rather than as being fine, because "we don't know"
// and "we know it's current" are different answers and only one of them is
// safe to act on. That means the first run after this change re-probes the
// vault once, which is the honest cost of admitting the old cache cannot be
// trusted.

// What the backend can tell us about a file without decoding it.
export interface FileStamp {
  mtimeMs: number;
  size: number;
}

/** Entry id -> the stamp of that entry's file. Absent when the file is gone. */
export type StampMap = Record<string, FileStamp | undefined>;

/**
 * The stamp a measurement was taken from.
 *
 * Part of the cached record rather than a separate map, so a cached entry and
 * the file it describes cannot drift apart in storage.
 */
export interface MeasuredAt {
  mtimeMs: number;
  size: number;
}

/** True when two stamps describe the same bytes. */
export function sameStamp(a: MeasuredAt | undefined, b: FileStamp | undefined): boolean {
  if (!a || !b) return false;
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

/**
 * Whether the cached measurement for this entry can still be trusted.
 *
 * `cached` is the stamp stored alongside the measurement, if any.
 */
export function isStale(
  hasMeasurement: boolean,
  cached: MeasuredAt | undefined,
  current: FileStamp | undefined,
): boolean {
  // Nothing cached and nothing to compare: an entry whose file has vanished is
  // not stale, it is missing, and re-probing it every time would make a vault
  // with one deleted file permanently "not ready".
  if (!current) return false;
  if (!hasMeasurement) return true;
  return !sameStamp(cached, current);
}

export interface StaleDecision {
  /** Entries that need a probe: never measured, or measured against a different file. */
  pending: string[];
  /** Entries whose cached measurement is still current. */
  fresh: number;
  /** Entries whose file is gone. Nothing to probe. */
  missing: number;
}

/**
 * Split every entry into "needs a probe", "current", and "file is gone".
 *
 * `measured` maps entry id to whether the index holds a measurement at all;
 * `stampsOf` maps entry id to that measurement's stamp. Both are passed rather
 * than the index itself so this stays a pure function of plain data, which is
 * what makes it testable at all.
 */
export function partitionByFreshness(
  probeableIds: readonly string[],
  measured: Readonly<Record<string, boolean>>,
  stampsOf: (id: string) => MeasuredAt | undefined,
  current: StampMap,
): StaleDecision {
  const pending: string[] = [];
  let fresh = 0;
  let missing = 0;
  for (const id of probeableIds) {
    const stamp = current[id];
    if (!stamp) {
      missing += 1;
      continue;
    }
    if (isStale(measured[id] === true, stampsOf(id), stamp)) {
      pending.push(id);
    } else {
      fresh += 1;
    }
  }
  return { pending, fresh, missing };
}
