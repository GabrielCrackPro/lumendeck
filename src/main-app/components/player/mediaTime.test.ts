import { describe, expect, it } from "vitest";
import {
  SEEK_SETTLE_MS,
  formatDuration,
  positionFromFraction,
  progressFraction,
  sampleAgreesWithSeek,
  seekTipPercent,
  skewedPosition,
  totalTimeLabel,
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
    expect(formatDuration(59.9)).toBe("0:59");
    expect(formatDuration(0.4)).toBe("0:00");
  });

  it("clamps a negative position to zero", () => {
    expect(formatDuration(-5)).toBe("0:00");
  });

  it("survives a non-finite duration", () => {
    expect(formatDuration(NaN)).toBe("0:00");
    expect(formatDuration(Infinity)).toBe("0:00");
  });
});

describe("skewedPosition", () => {
  it("advances by the sample age while playing", () => {
    expect(skewedPosition(10, 100, true, 500)).toBeCloseTo(10.5);
  });

  it("does not advance while paused", () => {
    expect(skewedPosition(10, 100, false, 500)).toBe(10);
  });

  it("ignores a negative sample age rather than rewinding", () => {
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
    expect(positionFromFraction(1.4, 200)).toBe(200);
    expect(positionFromFraction(-0.2, 200)).toBe(0);
  });

  it("resolves to zero for a track with no duration", () => {
    expect(positionFromFraction(0.5, 0)).toBe(0);
  });
});

describe("sampleAgreesWithSeek", () => {
  it("believes a sample when no seek is outstanding", () => {
    expect(sampleAgreesWithSeek(42, null, 0)).toBe(true);
  });

  it("rejects a sample still carrying the pre-seek position", () => {
    expect(sampleAgreesWithSeek(30, 120, 400)).toBe(false);
  });

  it("accepts a sample once it matches the seek", () => {
    expect(sampleAgreesWithSeek(120, 120, 400)).toBe(true);
    expect(sampleAgreesWithSeek(120.5, 120, 400)).toBe(true);
  });

  it("tolerates a sample a beat away from the seek", () => {
    expect(sampleAgreesWithSeek(121, 120, 400)).toBe(true);
  });

  it("stops shielding the seek once it has had time to settle", () => {
    expect(sampleAgreesWithSeek(30, 120, SEEK_SETTLE_MS)).toBe(true);
    expect(sampleAgreesWithSeek(30, 120, SEEK_SETTLE_MS + 5000)).toBe(true);
  });
})

describe("totalTimeLabel", () => {
  it("reads the plain total until the countdown is asked for", () => {
    expect(totalTimeLabel(108, 65, false)).toBe("1:48");
  });

  it("counts down behind a minus while there is time left", () => {
    expect(totalTimeLabel(108, 65, true)).toBe("-0:43");
  });

  it("floors the countdown exactly as the total floors", () => {
    expect(totalTimeLabel(100, 40.9, true)).toBe("-0:59");
  });

  it("reads 0:00 rather than a negative countdown at or past the end", () => {
    expect(totalTimeLabel(100, 100, true)).toBe("0:00");
    expect(totalTimeLabel(100, 104, true)).toBe("0:00");
  });
});

describe("seekTipPercent", () => {
  it("maps the pointer across the bar's width", () => {
    expect(seekTipPercent(0)).toBe(0);
    expect(seekTipPercent(0.5)).toBe(50);
    expect(seekTipPercent(1)).toBe(100);
  });

  it("clamps a pointer resting past either end", () => {
    expect(seekTipPercent(-0.25)).toBe(0);
    expect(seekTipPercent(1.3)).toBe(100);
    expect(seekTipPercent(NaN)).toBe(0);
  });
});
