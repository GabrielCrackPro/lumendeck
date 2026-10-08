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
    const marks = markArrivals({}, [], [0, 1], NOW);
    const next = markArrivals(marks, [0, 1], [0], NOW);
    expect(next[1]).toBeUndefined();
    expect(next[0]).toBe(NOW);
  });

  it("does not restamp a highlight that has already expired", () => {
    const stale = markArrivals({}, [], [0], NOW - HOTPLUG_HIGHLIGHT_MS * 10);
    const next = markArrivals(stale, [0], [0], NOW);
    expect(next[0]).toBe(stale[0]);
    expect(isRecentlyArrived(next[0], NOW)).toBe(false);
  });

  it("restamps a device that leaves and comes back", () => {
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
    expect(isRecentlyArrived(undefined, NOW)).toBe(false);
  });

  it("refuses a mark stamped in the future", () => {
    expect(isRecentlyArrived(NOW + 5_000, NOW)).toBe(false);
  });

  it("survives a zero ttl without highlighting anything", () => {
    expect(isRecentlyArrived(NOW, NOW, 0)).toBe(false);
  });
});