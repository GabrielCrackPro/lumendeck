import { describe, it, expect } from "vitest";
import {
  PERF_WINDOW,
  pushSample,
  downsample,
  chartGeometry,
  latestValue,
} from "./perfChart";

/** `count` samples at one value. */
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
    // Discarding the null would draw a straight line across a period nobody
    // measured.
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
    // One 90 among idle samples is a spike, and the chart exists to show it.
    // Averaging would report it as calm.
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
    // A one-column chart has no span to draw a line across.
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
    // The bug this guards: one path across the gap implies measurements that
    // were never taken, and reads as a steady plateau.
    expect(chartGeometry([10, 20, null, null, 30, 40], W, H, 10).lines).toHaveLength(
      2,
    );
  });

  it("skips a leading gap", () => {
    // The sampler's first tick has no CPU reading at all.
    expect(chartGeometry([null, null, 10, 20], W, H, 10).lines).toHaveLength(1);
  });

  it("does not stretch a run that starts late across the full width", () => {
    // The gap occupies real time, so the run after it must start partway
    // across rather than being rescaled to fill the axis.
    const geo = chartGeometry([null, null, null, 50, 50, 50], W, H, 10);
    expect(geo.lines).toHaveLength(1);
    // Three of six samples are gaps, so the line starts at 3/5 of the width.
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
    // An SVG does not clip by default, so an unclamped point would paint over
    // the card header.
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

  /** The coordinates a path visits, so a split can be compared to the whole. */
  function points(d: string): [number, number][] {
    return d
      .slice(1)
      .split(" L")
      .map((p) => p.split(" ").map(Number) as [number, number]);
  }

  /** The measured points of a curve, from its settled line and its tail. */
  function wholeCurve(geo: ReturnType<typeof chartGeometry>): [number, number][] {
    // `linePath` re-emits the first point, hence the two `slice(1)`s: one drops
    // the duplicate at the head, the other takes the tail's newest point.
    return [
      ...points(geo.lines[0]!).slice(1),
      ...points(geo.tail!).slice(-1),
    ];
  }

  it("draws the same curve once the tail is put back", () => {
    // The whole point of the split: line plus tail has to be one continuous
    // curve, one coordinate per sample, or the animation changed the chart.
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
    // The failure this guards: reducing the series a second time to find the
    // tail moves every older sample sideways, so the animated segment lands
    // beside the line it is meant to extend instead of on its end.
    const geo = chartGeometry([10, 40, 55, 20], W, H, 10);
    const settled = points(geo.lines[0]!);
    expect(settled[settled.length - 1]).toEqual(points(geo.tail!)[0]);
  });

  it("keeps the areas whole", () => {
    // The fill keeps the newest point, so it never shows a notch under the
    // segment being animated in. Its first and last coordinates are the
    // baseline the path closes along, so the samples sit between them.
    const geo = chartGeometry([10, 40, 55, 20], W, H, 10);
    expect(points(geo.areas[0]!).slice(1, -1)).toEqual(
      wholeCurve(geo),
    );
  });

  it("has no tail before there is a segment", () => {
    // One reading is a dot, not a line: nothing to draw in.
    expect(chartGeometry([50], W, H, 10).tail).toBeNull();
    expect(chartGeometry([], W, H, 10)).toEqual({
      areas: [],
      lines: [],
      tail: null,
    });
  });

  it("has no tail when the newest sample measured nothing", () => {
    // A gap is not a new reading, so nothing should animate. The run before the
    // gap stays whole rather than being split and re-drawn for no reason.
    const geo = chartGeometry([10, 40, null], W, H, 10);
    expect(geo.tail).toBeNull();
    // Two points is no segment to draw in, so nothing came off the line.
    expect(points(geo.lines[0]!).slice(1)).toHaveLength(2);
  });

  it("splits only the newest stretch", () => {
    // The animation belongs at the leading edge; a gap boundary in the middle
    // of the history is not where the eye is.
    const geo = chartGeometry([10, 40, null, 60, 80], W, H, 10);

    // The earlier stretch keeps every one of its points...
    expect(points(geo.lines[0]!).slice(1)).toHaveLength(2);
    // ...and the newest one stops a point short, with the tail carrying it.
    const carried = points(geo.lines[1]!).slice(1);
    expect(carried).toHaveLength(1);
    expect(points(geo.tail!).slice(-1)[0]![0]).toBeGreaterThan(carried[0]![0]);
  });
});
