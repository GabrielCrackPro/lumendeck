// Arrival tracking for the just-connected highlight. Two rules carry real
// risk of being wrong in the visible direction: announcing hardware that was
// already there, and re-announcing a device whose highlight merely aged out.
import { describe, expect, it } from "vitest";
import {
  baselineArrivals,
  HOTPLUG_HIGHLIGHT_MS,
  isRecentlyArrived,
  markArrivals,
} from "./hotplug";

const NOW = 1_700_000_000_000;

describe("markArrivals", () => {
  it("stamps only the device that actually appeared", () => {
    // 0 was already there. If it picked up a mark here, every device would
    // announce itself the first time any other device moved.
    const next = markArrivals({}, [0], [0, 1], NOW);
    expect(next[0]).toBeUndefined();
    expect(next[1]).toBe(NOW);
  });

  it("keeps an existing mark when an unrelated device arrives", () => {
    const first = markArrivals({}, [], [0], NOW);
    const next = markArrivals(first, [0], [0, 1], NOW + 500);
    expect(next[0]).toBe(NOW);
    expect(next[1]).toBe(NOW + 500);
  });

  it("forgets a device that has left", () => {
    // Without this the marks map grows for the life of the process across a
    // day of plugging and unplugging.
    const marks = markArrivals({}, [], [0, 1], NOW);
    const next = markArrivals(marks, [0, 1], [0], NOW);
    expect(next[1]).toBeUndefined();
    expect(next[0]).toBe(NOW);
  });

  it("does not restamp a highlight that has already expired", () => {
    // The failure this guards: a device stays connected forever, its 15s
    // window lapses, and a naive "no mark means new" rule would make the
    // card announce an arrival every few seconds for the rest of the session.
    const stale = markArrivals({}, [], [0], NOW - HOTPLUG_HIGHLIGHT_MS * 10);
    const next = markArrivals(stale, [0], [0], NOW);
    expect(next[0]).toBe(stale[0]);
    expect(isRecentlyArrived(next[0], NOW)).toBe(false);
  });

  it("restamps a device that leaves and comes back", () => {
    // A device that genuinely went away and returned is a fresh arrival, and
    // the mark it had is dropped on the way out — so the highlight restarts
    // rather than inheriting a countdown that had already been running.
    const first = markArrivals({}, [], [0], NOW);
    const gone = markArrivals(first, [0], [], NOW + 1000);
    expect(gone[0]).toBeUndefined();
    const back = markArrivals(gone, [], [0], NOW + 2000);
    expect(back[0]).toBe(NOW + 2000);
  });

  it("returns the same reference when nothing moved", () => {
    const marks = markArrivals({}, [], [0], NOW);
    expect(markArrivals(marks, [0], [0], NOW + 999)).toBe(marks);
  });

  it("handles an empty transition", () => {
    expect(markArrivals({}, [], [], NOW)).toEqual({});
    const gone = markArrivals({ 0: NOW }, [0], [], NOW);
    expect(gone).toEqual({});
  });
});

describe("baselineArrivals", () => {
  it("announces nothing about hardware that was already plugged in", () => {
    // The startup poll. Six devices the user has owned for years must not all
    // light up as brand new.
    expect(baselineArrivals({}, [0, 1, 2])).toEqual({});
  });

  it("keeps a mark for a device that is still present", () => {
    const marks = markArrivals({}, [], [0], NOW);
    expect(baselineArrivals(marks, [0, 1])[0]).toBe(NOW);
  });

  it("drops a mark for a device that is no longer there", () => {
    const marks = markArrivals({}, [], [0, 1], NOW);
    expect(baselineArrivals(marks, [0])[1]).toBeUndefined();
  });

  it("returns the same reference when there is nothing to forget", () => {
    const marks = markArrivals({}, [], [0], NOW);
    expect(baselineArrivals(marks, [0])).toBe(marks);
  });
});

describe("isRecentlyArrived", () => {
  it("is true inside the window and false after it", () => {
    expect(isRecentlyArrived(NOW, NOW)).toBe(true);
    expect(isRecentlyArrived(NOW, NOW + HOTPLUG_HIGHLIGHT_MS - 1)).toBe(true);
    expect(isRecentlyArrived(NOW, NOW + HOTPLUG_HIGHLIGHT_MS)).toBe(false);
  });

  it("is false for a device with no mark at all", () => {
    // Absence means "we never saw it arrive", which is the boot case.
    expect(isRecentlyArrived(undefined, NOW)).toBe(false);
  });

  it("refuses a mark stamped in the future", () => {
    // Ids get reused across OpenRGB restarts. A mark ahead of the clock would
    // otherwise read as recent until the clock caught up — minutes of a badge
    // nobody can account for.
    expect(isRecentlyArrived(NOW + 5_000, NOW)).toBe(false);
  });

  it("survives a zero ttl without highlighting anything", () => {
    expect(isRecentlyArrived(NOW, NOW, 0)).toBe(false);
  });
});