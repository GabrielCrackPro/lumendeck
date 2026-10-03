// Pruning the colour cache when hardware disappears. The identity guarantee is
// load-bearing and easy to break, so it is asserted directly rather than left
// to a comment: `RgbTab` re-renders on reference change alone.
import { describe, expect, it } from "vitest";
import type { DeviceColor } from "@shared/types";
import { pruneDeviceColors } from "./deviceColors";

const col = (r: number): DeviceColor => ({ id: 0, rgb: [r, 0, 0], ledColors: [] });

function colors(entries: Record<number, DeviceColor>) {
  return { ...entries } as Record<number, DeviceColor>;
}

describe("pruneDeviceColors", () => {
  it("drops the colour of a device that was unplugged", () => {
    // The bug this exists for: the map merges, so nothing else ever removes a
    // device that stopped being pushed to.
    const map = colors({ 0: { ...col(10), id: 0 }, 1: { ...col(20), id: 1 } });
    const next = pruneDeviceColors(map, [1]);
    expect(next[0]).toBeUndefined();
    expect(next[1]).toBeDefined();
  });

  it("keeps a connected device that has no colour yet", () => {
    // A device that has just enumerated is live before the engine has pushed
    // its first frame. Pruning is about absent devices, not missing entries.
    const map = colors({ 1: { ...col(20), id: 1 } });
    const next = pruneDeviceColors(map, [1, 2]);
    expect(Object.keys(next)).toEqual(["1"]);
  });

  it("returns the same reference when there is nothing to drop", () => {
    // `RgbTab` marks itself dirty on `s.deviceColors !== prev.deviceColors`.
    // Allocating here would re-render the whole tab on every status event to
    // produce an identical picture.
    const map = colors({ 0: { ...col(10), id: 0 } });
    expect(pruneDeviceColors(map, [0])).toBe(map);
  });

  it("clears everything when no device is connected", () => {
    // What OpenRGB going away, or lighting being switched off, looks like.
    const map = colors({ 0: { ...col(10), id: 0 }, 1: { ...col(20), id: 1 } });
    expect(pruneDeviceColors(map, [])).toEqual({});
  });

  it("does not mutate the map it was given", () => {
    // Subscribers hold the old object by reference and are mid-render with it.
    const map = colors({ 0: { ...col(10), id: 0 }, 1: { ...col(20), id: 1 } });
    pruneDeviceColors(map, [1]);
    expect(map[0]).toBeDefined();
  });

  it("survives an id that OpenRGB has already reused", () => {
    // Ids are not stable across restarts, so the rule is "is this id live
    // now", never "was this id live before".
    const map = colors({ 0: { ...col(99), id: 0 } });
    const next = pruneDeviceColors(map, [0]);
    expect(next[0]!.rgb).toEqual([99, 0, 0]);
  });

  it("keeps a device whose colour entry is not an array index string", () => {
    // Object.keys gives strings; a numeric mismatch here would delete a live
    // device's colour and reintroduce the dark preview it was meant to avoid.
    const map = colors({ 7: { ...col(70), id: 7 } });
    expect(Object.keys(pruneDeviceColors(map, [7]))).toEqual(["7"]);
    expect(Object.keys(pruneDeviceColors(map, [8]))).toEqual([]);
  });

  it("handles an empty cache", () => {
    const empty: Record<number, DeviceColor> = {};
    expect(pruneDeviceColors(empty, [])).toBe(empty);
    expect(pruneDeviceColors(empty, [1])).toBe(empty);
  });

  it("accepts a Set without rebuilding it", () => {
    const map = colors({ 0: { ...col(10), id: 0 } });
    expect(pruneDeviceColors(map, new Set([1]))).toEqual({});
  });
});