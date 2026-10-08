
export interface FrecencyEntry {
  s: number;
  t: number;
}

export interface FrecencyStore {
  [id: string]: FrecencyEntry;
}

export const FRECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

const FADE_FLOOR = 0.01;
const STORE_CAP = 60;

export function decayedStrength(
  s: number,
  ageMs: number,
  halfLifeMs: number = FRECENCY_HALF_LIFE_MS,
): number {
  if (ageMs <= 0) return s;
  return s * 0.5 ** (ageMs / halfLifeMs);
}

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
