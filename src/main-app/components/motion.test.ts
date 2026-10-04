import { describe, expect, it } from "vitest";
import {
  STAGGER_CAP,
  STAGGER_STEP_MS,
  staggerDelay,
} from "./motion";

describe("staggerDelay", () => {
  it("leaves the first row undelayed", () => {
    expect(staggerDelay(0)).toBe(0);
  });

  it("steps by the shared amount", () => {
    expect(staggerDelay(1)).toBe(STAGGER_STEP_MS);
    expect(staggerDelay(4)).toBe(STAGGER_STEP_MS * 4);
  });

  it("holds every row past the cap to the same delay", () => {
    // The failure this prevents: an unbounded stagger means row 40 appears a
    // second after row 0, by which point the eye has stopped following.
    expect(staggerDelay(STAGGER_CAP)).toBe(STAGGER_CAP * STAGGER_STEP_MS);
    expect(staggerDelay(STAGGER_CAP + 1)).toBe(staggerDelay(STAGGER_CAP));
    expect(staggerDelay(500)).toBe(staggerDelay(STAGGER_CAP));
  });

  it("keeps the last delay short enough to read as one motion", () => {
    // Ten rows at 16ms is 160ms: felt as a sweep, not as a queue.
    expect(STAGGER_CAP * STAGGER_STEP_MS).toBeLessThanOrEqual(200);
  });

  it("survives a negative or fractional index", () => {
    // The callers are map callbacks, where a stray value should cost a row its
    // stagger rather than throw inside a render.
    expect(staggerDelay(-3)).toBe(0);
    expect(staggerDelay(2.7)).toBe(staggerDelay(2));
    expect(staggerDelay(Number.NaN)).toBe(0);
  });

  it("falls back to the shared step rather than trusting a broken one", () => {
    expect(staggerDelay(2, 0)).toBe(2 * STAGGER_STEP_MS);
    expect(staggerDelay(2, -5)).toBe(2 * STAGGER_STEP_MS);
    expect(staggerDelay(2, Number.NaN)).toBe(2 * STAGGER_STEP_MS);
  });
});
