import { describe, it, expect } from "vitest";
import {
  formatBytes,
  formatPercent,
  memoryPressure,
  perfReadout,
} from "./perfReadout";
import type { PerfSnapshot } from "@shared/types";

const gb = 1024 ** 3;

const snap = (over: Partial<PerfSnapshot> = {}): PerfSnapshot => ({
  cpuPercent: 12,
  memUsedBytes: 8 * gb,
  memTotalBytes: 16 * gb,
  ageMs: 200,
  ...over,
});

describe("formatBytes", () => {
  it("shows one decimal below 10 GB", () => {
    expect(formatBytes(9.4 * gb)).toBe("9.4 GB");
  });

  it("drops the decimal at 10 GB and above", () => {
    // 10.4 and 10 both reading as "10 GB" would hide a gigabyte of headroom.
    expect(formatBytes(10.4 * gb)).toBe("10 GB");
    expect(formatBytes(64 * gb)).toBe("64 GB");
  });

  it("rounds rather than truncates above the switch", () => {
    expect(formatBytes(10.6 * gb)).toBe("11 GB");
  });

  it("refuses to print a measurement for nonsense input", () => {
    // Better a dash than "NaN GB" in the header strip.
    expect(formatBytes(Number.NaN)).toBe("--");
    expect(formatBytes(-1)).toBe("--");
  });
});

describe("formatPercent", () => {
  it("rounds to a whole percent", () => {
    expect(formatPercent(12.4)).toBe("12%");
    expect(formatPercent(12.6)).toBe("13%");
  });

  it("keeps a genuine 0 as 0", () => {
    // An idle machine reading 0% is a real answer; the warm-up case is handled
    // by the null check upstream, not by falsing a zero here.
    expect(formatPercent(0)).toBe("0%");
  });

  it("refuses to print a measurement for nonsense input", () => {
    expect(formatPercent(Number.NaN)).toBe("--");
  });
});

describe("memoryPressure", () => {
  it("is ok well under the threshold", () => {
    expect(memoryPressure(8 * gb, 16 * gb)).toBe("ok");
  });

  it("is tight at 85 percent", () => {
    // The boundary is the point: 85% is where Windows starts trimming the
    // working set, which is the moment a stutter has a likely cause.
    expect(memoryPressure(8.5 * gb, 10 * gb)).toBe("tight");
  });

  it("is ok just under the threshold", () => {
    expect(memoryPressure(8.49 * gb, 10 * gb)).toBe("ok");
  });

  it("is unknown rather than fine when nothing was measured", () => {
    // Calling an unmeasured machine "fine" puts a reassuring green number on
    // screen for a sampler that never ran.
    expect(memoryPressure(null, 16 * gb)).toBeNull();
    expect(memoryPressure(8 * gb, null)).toBeNull();
  });

  it("is unknown rather than dividing by zero", () => {
    expect(memoryPressure(0, 0)).toBeNull();
  });
});

describe("perfReadout", () => {
  it("renders both halves of a healthy reading", () => {
    expect(perfReadout(snap())).toEqual({
      cpu: "12%",
      memory: "8.0 GB / 16 GB",
      pressure: "ok",
      stale: false,
    });
  });

  it("shows memory but not CPU while the sampler warms up", () => {
    // The CPU figure is absent on the first tick because it is a difference
    // between two samples. Hiding memory for that second as well would be
    // throwing away a real measurement.
    const r = perfReadout(snap({ cpuPercent: null }));
    expect(r.cpu).toBeNull();
    expect(r.memory).toBe("8.0 GB / 16 GB");
  });

  it("marks memory tight at 85 percent", () => {
    const r = perfReadout(snap({ memUsedBytes: 8.5 * gb, memTotalBytes: 10 * gb }));
    expect(r.pressure).toBe("tight");
  });

  it("marks a reading stale once the sampler stops refreshing", () => {
    // A dead sampler must not leave a number frozen on screen looking current.
    expect(perfReadout(snap({ ageMs: 4000 })).stale).toBe(true);
  });

  it("does not mark a fresh reading stale", () => {
    expect(perfReadout(snap({ ageMs: 1000 })).stale).toBe(false);
  });

  it("reports nothing at all for a null snapshot", () => {
    // Which is what the window renders before the first poll lands.
    expect(perfReadout(null)).toEqual({
      cpu: null,
      memory: null,
      pressure: null,
      stale: false,
    });
  });

  it("does not call a snapshot stale before an age is known", () => {
    expect(perfReadout(snap({ ageMs: null })).stale).toBe(false);
  });
});