import { describe, expect, it } from "vitest";
import { formatDuration, formatResolution, resetMediaMetaCache } from "./mediaMeta";

describe("formatResolution", () => {
  it("renders width x height", () => {
    expect(formatResolution({ width: 1920, height: 1080, duration: null })).toBe("1920x1080");
  });

  it("omits the fact entirely when it is unknown", () => {
    // Guessing would be worse than saying nothing: a wrong resolution on a
    // card is a claim the app cannot back up.
    expect(formatResolution(null)).toBeNull();
  });
});

describe("formatDuration", () => {
  it("renders minutes and padded seconds", () => {
    expect(formatDuration(84)).toBe("1:24");
  });

  it("pads seconds below ten", () => {
    expect(formatDuration(7)).toBe("0:07");
  });

  it("keeps a zero-length clip rather than hiding it", () => {
    // Zero is a real value for a still frame, so it must not read as unknown.
    expect(formatDuration(0)).toBe("0:00");
  });

  it("is null when the duration is unknown", () => {
    expect(formatDuration(null)).toBeNull();
  });
});

describe("mediaMeta cache", () => {
  it("can be reset for tests", () => {
    expect(() => resetMediaMetaCache()).not.toThrow();
  });
});
