import { describe, expect, it } from "vitest";
import {
  formatDuration,
  positionFromFraction,
  progressFraction,
  skewedPosition,
} from "./mediaTime";

describe("formatDuration", () => {
  it("pads seconds to two digits", () => {
    expect(formatDuration(7)).toBe("0:07");
    expect(formatDuration(70)).toBe("1:10");
  });

  it("adds an hours field only when there is one", () => {
    expect(formatDuration(3599)).toBe("59:59");
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3725)).toBe("1:02:05");
  });

  it("floors rather than rounds", () => {
    // A clock that rounds up can display a duration the track does not have,
    // which then disagrees with the last frame of the progress bar.
    expect(formatDuration(59.9)).toBe("0:59");
    expect(formatDuration(0.4)).toBe("0:00");
  });

  it("clamps a negative position to zero", () => {
    // The two copies of this function disagreed here: one clamped, one did
    // not, so a sample that drifted a few ms before zero rendered "-0:01".
    expect(formatDuration(-5)).toBe("0:00");
  });

  it("survives a non-finite duration", () => {
    // A live stream can report no duration at all.
    expect(formatDuration(NaN)).toBe("0:00");
    expect(formatDuration(Infinity)).toBe("0:00");
  });
});

describe("skewedPosition", () => {
  it("advances by the sample age while playing", () => {
    // The sample is a beat old by the time it renders; without this the bar
    // starts behind and snaps forward on the first frame.
    expect(skewedPosition(10, 100, true, 500)).toBeCloseTo(10.5);
  });

  it("does not advance while paused", () => {
    expect(skewedPosition(10, 100, false, 500)).toBe(10);
  });

  it("ignores a negative sample age rather than rewinding", () => {
    // A clock that went backwards, or a zero/absent timestamp. Rewinding the
    // playhead is worse than not correcting it.
    expect(skewedPosition(10, 100, true, -500)).toBe(10);
  });

  it("never passes the end of the track", () => {
    expect(skewedPosition(99, 100, true, 5_000)).toBe(100);
  });

  it("never goes below zero", () => {
    expect(skewedPosition(-2, 100, false, 0)).toBe(0);
  });

  it("works for a live stream with no duration", () => {
    expect(skewedPosition(10, 0, true, 1_000)).toBeCloseTo(11);
  });
});

describe("progressFraction", () => {
  it("is the position as a fraction of duration", () => {
    expect(progressFraction(25, 100)).toBe(0.25);
    expect(progressFraction(100, 100)).toBe(1);
  });

  it("is zero when the duration is unknown", () => {
    // Dividing by zero here produces NaN, and `scaleX(NaN)` silently drops
    // the fill to no scale at all — a live stream would show no bar.
    expect(progressFraction(50, 0)).toBe(0);
    expect(progressFraction(50, -1)).toBe(0);
    expect(progressFraction(50, NaN)).toBe(0);
  });

  it("clamps a position past the end", () => {
    expect(progressFraction(140, 100)).toBe(1);
  });

  it("clamps a negative position", () => {
    expect(progressFraction(-5, 100)).toBe(0);
  });
});

describe("positionFromFraction", () => {
  it("maps a click across the bar to a position", () => {
    expect(positionFromFraction(0.5, 200)).toBe(100);
    expect(positionFromFraction(0, 200)).toBe(0);
    expect(positionFromFraction(1, 200)).toBe(200);
  });

  it("clamps a pointer that reports past either edge", () => {
    // A drag that leaves the bar still has to resolve to a valid position.
    expect(positionFromFraction(1.4, 200)).toBe(200);
    expect(positionFromFraction(-0.2, 200)).toBe(0);
  });

  it("resolves to zero for a track with no duration", () => {
    expect(positionFromFraction(0.5, 0)).toBe(0);
  });
});
