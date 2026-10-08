
export interface FrecencyEntry {
  /** Strength: one per use, older uses decayed away. */
  s: number;
  /** When the entry was last bumped, epoch ms. */
  t: number;
}

export interface FrecencyStore {
  [id: string]: FrecencyEntry;
}

/** A run is worth half as much a week later. */
export const FRECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** Below this a use is history, not signal: dropped on write, hidden from rank. */
const FADE_FLOOR = 0.01;
/** The store is pruned to this — an unbounded map is a blob in localStorage. */
const STORE_CAP = 60;

/** Exponentially decayed by the entry's age. */
export function decayedStrength(
  s: number,
  ageMs: number,
  halfLifeMs: number = FRECENCY_HALF_LIFE_MS,
): number {
  if (ageMs <= 0) return s;
  return s * 0.5 ** (ageMs / halfLifeMs);
}

/**
 * Record one more use of `id`: its stored strength decays to now, then gains
 * 1. Pruned as it writes, so the store never grows past `STORE_CAP` or keeps
 * entries too faint to rank.
 */
export function bumpFrecency(
  store: FrecencyStore,
  id: string,
  now: number,
  halfLifeMs: number = FRECENCY_HALF_LIFE_MS,
): FrecencyStore {
  const prev = store[id];
  const s = (prev ? decayedStrength(prev.s, now - prev.t, halfLifeMs) : 0) + 1;
  return pruneFrecency({ ...store, [id]: { s, t: now } }, now, halfLifeMs);
}

/**
 * Drop what has faded below the floor, then keep only the strongest
 * `STORE_CAP`. Survivors keep their original `{s, t}` — decay is
 * multiplicative, so nothing is lost by not re-stamping them.
 */
export function pruneFrecency(
  store: FrecencyStore,
  now: number,
  halfLifeMs: number = FRECENCY_HALF_LIFE_MS,
): FrecencyStore {
  const live = Object.entries(store)
    .map(([id, e]) => ({ id, e, s: decayedStrength(e.s, now - e.t, halfLifeMs) }))
    .filter((x) => x.s >= FADE_FLOOR)
    .sort((a, b) => b.s - a.s)
    .slice(0, STORE_CAP);
  const out: FrecencyStore = {};
  for (const x of live) out[x.id] = x.e;
  return out;
}

/**
 * Ids by strength right now, strongest first — the "run often and lately"
 * block the idle list shows after the pins. Ids that no longer resolve to a
 * command simply fall out at the ordering step (see `withPinnedRecents`).
 */
export function rankFrecency(
  store: FrecencyStore,
  now: number,
  halfLifeMs: number = FRECENCY_HALF_LIFE_MS,
): string[] {
  return Object.entries(store)
    .map(([id, e]) => ({ id, s: decayedStrength(e.s, now - e.t, halfLifeMs) }))
    .filter((x) => x.s >= FADE_FLOOR)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.id);
}

/**
 * Validate whatever is in localStorage into a store: absent, malformed or
 * hand-edited input all read as "no history" rather than throwing in an
 * open handler. One bad entry drops that entry, not the whole store.
 */
export function parseFrecency(raw: string | null): FrecencyStore {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: FrecencyStore = {};
    for (const [id, e] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof e !== "object" || e === null) continue;
      const { s, t } = e as { s?: unknown; t?: unknown };
      if (typeof s === "number" && typeof t === "number" && Number.isFinite(s) && Number.isFinite(t)) {
        out[id] = { s, t };
      }
    }
    return out;
  } catch {
    return {};
  }
}
