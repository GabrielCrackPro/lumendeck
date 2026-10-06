import { describe, expect, it } from "vitest";
import {
  bumpFrecency,
  decayedStrength,
  FRECENCY_HALF_LIFE_MS,
  parseFrecency,
  pruneFrecency,
  rankFrecency,
  type FrecencyStore,
} from "./paletteFrecency";

const WEEK = FRECENCY_HALF_LIFE_MS;

describe("decayedStrength", () => {
  it("is untouched at age zero", () => {
    expect(decayedStrength(3, 0)).toBe(3);
  });

  it("halves once per half-life", () => {
    expect(decayedStrength(8, WEEK)).toBeCloseTo(4, 10);
    expect(decayedStrength(8, 2 * WEEK)).toBeCloseTo(2, 10);
    expect(decayedStrength(8, 0.5 * WEEK)).toBeCloseTo(5.656, 2);
  });

  it("never ages backwards", () => {
    expect(decayedStrength(2, -1000)).toBe(2);
  });
});

describe("bumpFrecency", () => {
  it("starts a new command at exactly one use", () => {
    const next = bumpFrecency({}, "cmd", 1_000_000);
    expect(next["cmd"]).toEqual({ s: 1, t: 1_000_000 });
  });

  it("adds to a fresh entry", () => {
    const once = bumpFrecency({}, "cmd", 1_000_000);
    const twice = bumpFrecency(once, "cmd", 1_000_000);
    expect(twice["cmd"]!.s).toBe(2);
  });

  it("decays the old strength before adding, so ancient use stops counting", () => {
    const first = bumpFrecency({}, "cmd", 0);
    const later = bumpFrecency(first, "cmd", WEEK);
    // One old use decayed to a half, plus the new one.
    expect(later["cmd"]!.s).toBeCloseTo(1.5, 10);
    expect(later["cmd"]!.t).toBe(WEEK);
  });

  it("keeps other entries untouched", () => {
    const store = bumpFrecency({ other: { s: 4, t: 0 } }, "cmd", 0);
    expect(store["other"]).toEqual({ s: 4, t: 0 });
  });
});

describe("pruneFrecency", () => {
  it("drops entries whose strength has faded below the floor", () => {
    // One use, sixty days old: 0.5 ** (60/7) is far under 0.01.
    const store: FrecencyStore = { old: { s: 1, t: 0 } };
    expect(pruneFrecency(store, 60 * 24 * 60 * 60 * 1000)).toEqual({});
  });

  it("keeps entries still worth something", () => {
    const store: FrecencyStore = { fresh: { s: 1, t: 0 } };
    expect(pruneFrecency(store, WEEK)).toEqual(store);
  });

  it("caps the store at sixty entries, keeping the strongest", () => {
    let store: FrecencyStore = {};
    for (let i = 0; i < 70; i++) store[`c${i}`] = { s: 1, t: 0 };
    // One id far stronger than the rest must survive the cut.
    store["strong"] = { s: 9, t: 0 };
    const pruned = pruneFrecency(store, 0);
    expect(Object.keys(pruned).length).toBe(60);
    expect(pruned["strong"]).toBeDefined();
  });
});

describe("rankFrecency", () => {
  it("orders strongest first", () => {
    const store: FrecencyStore = {
      weak: { s: 1, t: 0 },
      strong: { s: 9, t: 0 },
      mid: { s: 3, t: 0 },
    };
    expect(rankFrecency(store, 0)).toEqual(["strong", "mid", "weak"]);
  });

  it("lets a fresh single use outrank stale heavy use", () => {
    // Ten runs four weeks ago (10 * 0.5^4 = 0.625) vs one run just now (1).
    const store: FrecencyStore = {
      stale: { s: 10, t: 0 },
      fresh: { s: 1, t: 4 * WEEK },
    };
    expect(rankFrecency(store, 4 * WEEK)).toEqual(["fresh", "stale"]);
  });

  it("hides what has faded below the floor", () => {
    // `old` is sixty days stale; `fresh` was used at `now` itself.
    const now = 60 * 24 * 60 * 60 * 1000;
    const store: FrecencyStore = { old: { s: 1, t: 0 }, fresh: { s: 1, t: now } };
    expect(rankFrecency(store, now)).toEqual(["fresh"]);
  });

  it("is empty for an empty store", () => {
    expect(rankFrecency({}, Date.now())).toEqual([]);
  });
});

describe("parseFrecency", () => {
  it("reads nothing from absence or garbage", () => {
    expect(parseFrecency(null)).toEqual({});
    expect(parseFrecency("")).toEqual({});
    expect(parseFrecency("not json")).toEqual({});
    expect(parseFrecency("[1,2,3]")).toEqual({});
    expect(parseFrecency("null")).toEqual({});
  });

  it("keeps well-formed entries", () => {
    expect(parseFrecency('{"a":{"s":2,"t":123}}')).toEqual({ a: { s: 2, t: 123 } });
  });

  it("drops a malformed entry without losing the store", () => {
    const parsed = parseFrecency('{"good":{"s":1,"t":1},"bad":{"s":"x","t":1},"worse":5}');
    expect(parsed).toEqual({ good: { s: 1, t: 1 } });
  });
});
