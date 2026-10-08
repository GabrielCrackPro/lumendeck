import { describe, it, expect } from "vitest";
import {
  PERF_WINDOW,
  pushSample,
  downsample,
  chartGeometry,
  latestValue,
} from "./perfChart";

const flat = (count: number, v: number | null): (number | null)[] =>
  Array.from({ length: count }, () => v);

describe("pushSample", () => {
  it("appends to the history", () => {
    expect(pushSample([1, 2], 3)).toEqual([1, 2, 3]);
  });

  it("drops the oldest past the limit", () => {
    const history = pushSample(flat(PERF_WINDOW, 1), 9);
    expect(history).toHaveLength(PERF_WINDOW);
    expect(history[PERF_WINDOW - 1]).toBe(9);
  });

  it("keeps a gap rather than closing it", () => {
    expect(pushSample([1, 2], null)).toEqual([1, 2, null]);
  });

  it("does not mutate the history it was given", () => {
    const before: (number | null)[] = [1, 2];
    pushSample(before, 3);
    expect(before).toEqual([1, 2]);
  });

  it("honours a custom limit", () => {
    expect(pushSample([1, 2, 3], 4, 2)).toEqual([3, 4]);
  });
});

describe("downsample", () => {
  it("passes a short history through untouched", () => {
    const values = [10, 20, 30];
    expect(downsample(values, 10)).toEqual(values);
  });

  it("keeps the peak of each column, not the mean", () => {
    const values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 90];
    const out = downsample(values, 5);
    expect(Math.max(...out.filter((v): v is number => v != null))).toBe(90);
  });

  it("reduces to the requested column count", () => {
    expect(downsample(flat(60, 5), 12)).toHaveLength(12);
  });

  it("keeps an unmeasured column as a gap", () => {
    const values: (number | null)[] = [1, 1, null, null, 1, 1];
    const out = downsample(values, 3);
    expect(out).toContain(null);
  });

  it("returns nothing for a single column", () => {
    expect(downsample([1, 2, 3], 1)).toEqual([]);
  });

  it("handles an empty history", () => {
    expect(downsample([], 10)).toEqual([]);
  });
});

describe("chartGeometry", () => {
  const W = 100;
  const H = 50;

  it("returns nothing for an empty history", () => {
    expect(chartGeometry([], W, H, 10)).toEqual({
      areas: [],
      lines: [],
      tail: null,
    });
  });

  it("draws one line for an unbroken series", () => {
    const geo = chartGeometry([10, 20, 30], W, H, 10);
    expect(geo.lines).toHaveLength(1);
    expect(geo.lines[0]!.startsWith("M")).toBe(true);
  });

  it("splits a gap into two lines rather than bridging it", () => {
    expect(chartGeometry([10, 20, null, null, 30, 40], W, H, 10).lines).toHaveLength(
      2,
    );
  });

  it("skips a leading gap", () => {
    expect(chartGeometry([null, null, 10, 20], W, H, 10).lines).toHaveLength(1);
  });

  it("does not stretch a run that starts late across the full width", () => {
    const geo = chartGeometry([null, null, null, 50, 50, 50], W, H, 10);
    expect(geo.lines).toHaveLength(1);
    expect(geo.lines[0]!.startsWith("M60.00")).toBe(true);
  });

  it("draws nothing at all for an entirely unmeasured history", () => {
    expect(chartGeometry([null, null, null], W, H, 10).lines).toEqual([]);
  });

  it("maps 0 percent to the baseline and 100 to the top", () => {
    expect(chartGeometry([0], W, H, 10).lines[0]).toContain(" 50.00");
    expect(chartGeometry([100], W, H, 10).lines[0]).toContain(" 0.00");
  });

  it("clamps a reading above 100 rather than drawing outside the box", () => {
    expect(chartGeometry([140], W, H, 10).lines[0]).toContain(" 0.00");
  });

  it("clamps a negative reading to the baseline", () => {
    expect(chartGeometry([-5], W, H, 10).lines[0]).toContain(" 50.00");
  });

  it("closes the area back to the baseline", () => {
    const area = chartGeometry([10, 20, 30], W, H, 10).areas[0]!;
    expect(area.endsWith("Z")).toBe(true);
    expect(area).toContain("50.00");
  });
});

describe("latestValue", () => {
  it("reads the newest measured sample", () => {
    expect(latestValue([1, 2, 3])).toBe(3);
  });

  it("skips back over a trailing gap", () => {
    expect(latestValue([1, 2, null])).toBe(2);
  });

  it("is null when nothing was ever measured", () => {
    expect(latestValue([null, null])).toBeNull();
    expect(latestValue([])).toBeNull();
  });
});
describe("chartGeometry: the animated tail", () => {
  const W = 100;
  const H = 50;

  function points(d: string): [number, number][] {
    return d
      .slice(1)
      .split(" L")
      .map((p) => p.split(" ").map(Number) as [number, number]);
  }

  function wholeCurve(geo: ReturnType<typeof chartGeometry>): [number, number][] {
    return [
      ...points(geo.lines[0]!).slice(1),
      ...points(geo.tail!).slice(-1),
    ];
  }

  it("draws the same curve once the tail is put back", () => {
    const values = [10, 40, 55, 20, 70, 35];
    const curve = wholeCurve(chartGeometry(values, W, H, 10));

    expect(curve).toHaveLength(values.length);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]![0], `sample ${i} moves right`).toBeGreaterThan(
        curve[i - 1]![0],
      );
    }
  });

  it("leaves the settled line's end exactly where the tail begins", () => {
    const geo = chartGeometry([10, 40, 55, 20], W, H, 10);
    const settled = points(geo.lines[0]!);
    expect(settled[settled.length - 1]).toEqual(points(geo.tail!)[0]);
  });

  it("keeps the areas whole", () => {
    const geo = chartGeometry([10, 40, 55, 20], W, H, 10);
    expect(points(geo.areas[0]!).slice(1, -1)).toEqual(
      wholeCurve(geo),
    );
  });

  it("has no tail before there is a segment", () => {
    expect(chartGeometry([50], W, H, 10).tail).toBeNull();
    expect(chartGeometry([], W, H, 10)).toEqual({
      areas: [],
      lines: [],
      tail: null,
    });
  });

  it("has no tail when the newest sample measured nothing", () => {
    const geo = chartGeometry([10, 40, null], W, H, 10);
    expect(geo.tail).toBeNull();
    expect(points(geo.lines[0]!).slice(1)).toHaveLength(2);
  });

  it("splits only the newest stretch", () => {
    const geo = chartGeometry([10, 40, null, 60, 80], W, H, 10);

    expect(points(geo.lines[0]!).slice(1)).toHaveLength(2);
    const carried = points(geo.lines[1]!).slice(1);
    expect(carried).toHaveLength(1);
    expect(points(geo.tail!).slice(-1)[0]![0]).toBeGreaterThan(carried[0]![0]);
  });
});
