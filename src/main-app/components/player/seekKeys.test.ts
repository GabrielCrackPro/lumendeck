import { describe, expect, it } from "vitest";
import { nextSeekAnchor, seekTarget } from "./mediaTime";

describe("seekTarget", () => {
  it("steps by a fraction of the duration, so a press feels the same anywhere", () => {
    expect(seekTarget(10, 40, "right")).toBeCloseTo(10.8);
    expect(seekTarget(1000, 7200, "right")).toBeCloseTo(1144);
  });

  it("steps backwards by the same fraction", () => {
    expect(seekTarget(100, 200, "left")).toBeCloseTo(96);
    expect(seekTarget(30, 100, "left")).toBeCloseTo(28);
  });

  it("goes to the ends on home and end", () => {
    expect(seekTarget(1000, 7200, "home")).toBe(0);
    expect(seekTarget(1000, 7200, "end")).toBe(7200);
  });

  it("stops at the ends instead of running past them", () => {
    expect(seekTarget(0.2, 40, "left")).toBe(0);
    expect(seekTarget(39.9, 40, "right")).toBe(40);
  });

  it("gives up on a track with no duration", () => {
    expect(seekTarget(30, 0, "right")).toBe(0);
    expect(seekTarget(30, -5, "end")).toBe(0);
  });

  it("accumulates across a burst of presses", () => {
    const duration = 200;
    let anchor = 100;
    for (let i = 0; i < 5; i++) anchor = seekTarget(anchor, duration, "right");
    expect(anchor).toBeCloseTo(120);
  });
});

describe("nextSeekAnchor", () => {
  it("keeps a burst inside the track", () => {
    expect(nextSeekAnchor(-5, 200)).toBe(0);
    expect(nextSeekAnchor(500, 200)).toBe(200);
  });

  it("is what a caller feeds back in to make presses accumulate", () => {
    const duration = 200;
    let anchor = nextSeekAnchor(199, duration);
    anchor = seekTarget(anchor, duration, "right");
    expect(anchor).toBe(200);
    expect(seekTarget(anchor, duration, "right")).toBe(200);
  });
});
