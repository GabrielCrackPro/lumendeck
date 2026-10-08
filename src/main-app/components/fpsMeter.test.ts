import { describe, it, expect } from "vitest";
import { fpsFromTimestamps, formatFps, pushTimestamp, FPS_WINDOW } from "./fpsMeter";

function steady(count: number, intervalMs: number): number[] {
  return Array.from({ length: count }, (_, i) => i * intervalMs);
}

describe("fpsFromTimestamps", () => {
  it("reads 60 for a steady 60Hz run", () => {
    expect(fpsFromTimestamps(steady(60, 1000 / 60))).toBeCloseTo(60, 1);
  });

  it("reads 120 on a 120Hz display", () => {
    expect(fpsFromTimestamps(steady(120, 1000 / 120))).toBeCloseTo(120, 1);
  });

  it("counts intervals, not frames", () => {
    expect(fpsFromTimestamps(steady(61, 1000 / 60))).toBeCloseTo(60, 1);
  });

  it("averages across an irregular run rather than taking the last gap", () => {
    expect(fpsFromTimestamps([0, 16.7, 33.4, 66.7, 83.4, 100.1])).toBeLessThan(60);
  });

  it("reports 0 until there is a span to measure", () => {
    expect(fpsFromTimestamps([])).toBe(0);
    expect(fpsFromTimestamps([1234])).toBe(0);
  });

  it("reports 0 rather than infinity when two frames share a millisecond", () => {
    expect(fpsFromTimestamps([500, 500])).toBe(0);
  });

  it("reports 0 when timestamps arrive out of order", () => {
    expect(fpsFromTimestamps([100, 90, 80])).toBe(0);
  });

  it("does not depend on when the window started", () => {
    const late = steady(30, 1000 / 60).map((n) => n + 8000);
    expect(fpsFromTimestamps(late)).toBeCloseTo(60, 1);
  });
});

describe("formatFps", () => {
  it("rounds to a whole frame rate", () => {
    expect(formatFps(58.7)).toBe(59);
    expect(formatFps(60.3)).toBe(60);
  });

  it("reads 60 for the display rate a 60Hz panel actually reports", () => {
    expect(formatFps(60.000000000000014)).toBe(60);
  });

  it("keeps a non-finite or negative reading at 0", () => {
    expect(formatFps(Number.NaN)).toBe(0);
    expect(formatFps(Number.POSITIVE_INFINITY)).toBe(0);
    expect(formatFps(-5)).toBe(0);
    expect(formatFps(0)).toBe(0);
  });
});

describe("pushTimestamp", () => {
  it("appends while the window has room", () => {
    expect(pushTimestamp([0, 16], 33)).toEqual([0, 16, 33]);
  });

  it("keeps the window bounded, dropping the oldest frame", () => {
    const win = pushTimestamp(steady(20, 16), 320, 10);
    expect(win).toHaveLength(10);
    expect(win[0]).toBe(176);
    expect(win[win.length - 1]).toBe(320);
  });

  it("does not mutate the array it was given", () => {
    const before = [1, 2, 3];
    const after = pushTimestamp(before, 4);
    expect(before).toEqual([1, 2, 3]);
    expect(after).not.toBe(before);
  });

  it("measures over the retained window alone, not all history", () => {
    const win = pushTimestamp(steady(FPS_WINDOW, 16), 0, 16);
    expect(win).toHaveLength(16);
  });
});