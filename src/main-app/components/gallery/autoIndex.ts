// Whether an import should kick off a vault index rebuild, and doing it.
//
// The index (resolution and length per file) is what lets the vault answer
// "sort by 4K" or "show me only the long ones". It is built on demand from the
// Wallpaper tab's toolbar button, because probing a few hundred files the moment
// the tab mounts is the request storm the lazy probe in `mediaMeta` exists to
// avoid.
//
// An import is the one moment where that reasoning inverts: the user has just
// named a cost ("import this folder") and the thing they cannot do until the
// index exists is sort or filter by anything measured. So the import is where
// paying it automatically is right — provided it is a decision rather than a
// side effect, because "probe everything I just did" is exactly the behaviour
// someone with a 400-file drop wants turned off. Hence `autoIndexEnabled`,
// which callers check before they get here.
//
// Two things this module does for its callers rather than trusting them to:
// refresh the file stamps before deciding or building, and never start a second
// build while one is running. The first is a correctness requirement, not
// tidiness — see `buildAfterImport`.

import {
  buildIndex,
  cachedCount,
  type IndexProgress,
  type StampMap,
  type VaultIndex,
} from "./vaultIndex";
import { api } from "../../ipc";
import type { GalleryEntry } from "@shared/types";

/**
 * Everything the decision depends on, as values.
 *
 * Flat and total rather than a config object so each input can be varied in a
 * test without constructing a Config, and so a missing input is a type error
 * rather than an `undefined` that quietly reads as false.
 */
export interface AutoIndexRequest {
  /** How many entries the import actually added. */
  added: number;
  /** Whether a build is already in flight. */
  building: boolean;
  /** The vault as it stands after the import. */
  entries: GalleryEntry[];
  /** File stamps for those entries. */
  stamps: StampMap;
  /** The index as it stands after the import. */
  index: VaultIndex;
}

/**
 * Whether auto-indexing is switched on, read from a config.
 *
 * A function rather than a bare field so the reading lives next to the rule
 * that honours it, and a caller cannot accidentally compare a possibly-absent
 * value. `!== false` rather than `=== true`: a config written before this
 * setting existed has no value here, and the answer for it is the same as for
 * one that says true — the default is on.
 */
export function autoIndexEnabled(cfg: { indexAfterImport?: boolean } | undefined): boolean {
  return cfg?.indexAfterImport !== false;
}

/**
 * True when this import should start a rebuild.
 *
 * The order is cheapest-and-most-decisive first, because each test is a reason
 * not to spend the user's disk on a guess:
 *
 * - Nothing added means there is nothing new to measure. This is not
 *   hypothetical: a folder import of a directory that held only web pages and
 *   shaders returns an empty list, and a cancelled file picker returns one too.
 * - Already building means the work is in progress and a second build would
 *   duplicate every probe still running.
 * - Not fully covered means there is something to do. This also covers a vault
 *   with nothing probeable in it: a web-page or shader-only vault counts as
 *   zero covered out of zero probeable, which is complete, so no build starts.
 *
 * That last test is what stops this from firing on every import forever: the
 * index is persistent, so once the vault is measured, later imports of already
 * known files are free.
 */
export function shouldAutoIndex(req: AutoIndexRequest): boolean {
  if (req.added <= 0) return false;
  if (req.building) return false;
  return cachedCount(req.entries, req.index, req.stamps) < probeableCount(req.entries);
}

/** Entries the index can measure at all: web pages and shaders have no file. */
function probeableCount(entries: GalleryEntry[]): number {
  let n = 0;
  for (const e of entries) if (e.kind === "video" || e.kind === "image") n += 1;
  return n;
}

/**
 * What a completed auto-index produced.
 *
 * The stamps come back because the caller needs them for its own later
 * judgement of coverage, and re-reading them would be a second pass over the
 * whole vault for no new information.
 */
export interface AutoIndexResult {
  index: VaultIndex;
  stamps: StampMap;
}

/**
 * Rebuild the index after an import and hand back the result, or null if the
 * decision says no.
 *
 * Stamps are read here rather than passed in, and that is the part that is easy
 * to get wrong. `buildIndex` measures an entry only if it has a stamp to record
 * the measurement against — an entry with no stamp is counted as "nothing to
 * measure" and skipped. A freshly imported entry has no stamp in the caller's
 * map, because those stamps were read before the file existed. Passing a
 * caller's stamps straight through therefore indexes *nothing*, reports 100%
 * complete, and leaves an index that silently never covers what was just
 * imported — which looks exactly like the feature working.
 *
 * Reading before the decision, not after, matters for the same reason: coverage
 * is judged against stamps, so deciding on a stale map would answer "is this
 * covered" about a file that did not exist when the map was taken.
 *
 * Callers cannot supply the stamps at all. There is no parameter for it, because
 * every caller has the same one: a map read before the import, which is stale
 * for exactly the entries that matter. Accepting it would mean the correctness
 * of the feature depended on each caller noticing, and the failure is invisible
 * — an index that skipped everything still reports itself 100% complete. The
 * stamps come back on the result instead, so the caller can persist the map the
 * build actually used without ever having held one of its own.
 */
export async function buildAfterImport(
  req: Omit<AutoIndexRequest, "stamps">,
  hooks: {
    onProgress?: (p: IndexProgress) => void;
    /** Fired only when a build actually starts, so a no-op shows nothing. */
    onStart?: () => void;
  } = {},
): Promise<AutoIndexResult | null> {
  const stamps = await api.vaultStamps();
  if (!shouldAutoIndex({ ...req, stamps })) return null;
  hooks.onStart?.();
  return { index: await buildIndex(req.entries, stamps, hooks.onProgress), stamps };
}