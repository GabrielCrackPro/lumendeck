import { describe, expect, it } from "vitest";
import type { DeviceColor } from "@shared/types";
import { pruneDeviceColors } from "./deviceColors";

const col = (r: number): DeviceColor => ({ id: 0, rgb: [r, 0, 0], ledColors: [] });

function colors(entries: Record<number, DeviceColor>) {
  return { ...entries } as Record<number, DeviceColor>;
}

describe("pruneDeviceColors", () => {
  it("drops the colour of a device that was unplugged", () => {
    const map = colors({ 0: { ...col(10), id: 0 }, 1: { ...col(20), id: 1 } });
    const next = pruneDeviceColors(map, [1]);
    expect(next[0]).toBeUndefined();
    expect(next[1]).toBeDefined();
  });

  it("keeps a connected device that has no colour yet", () => {
    const map = colors({ 1: { ...col(20), id: 1 } });
    const next = pruneDeviceColors(map, [1, 2]);
    expect(Object.keys(next)).toEqual(["1"]);
  });

  it("returns the same reference when there is nothing to drop", () => {
    const map = colors({ 0: { ...col(10), id: 0 } });
    expect(pruneDeviceColors(map, [0])).toBe(map);
  });

  it("clears everything when no device is connected", () => {
    const map = colors({ 0: { ...col(10), id: 0 }, 1: { ...col(20), id: 1 } });
    expect(pruneDeviceColors(map, [])).toEqual({});
  });

  it("does not mutate the map it was given", () => {
    const map = colors({ 0: { ...col(10), id: 0 }, 1: { ...col(20), id: 1 } });
    pruneDeviceColors(map, [1]);
    expect(map[0]).toBeDefined();
  });

  it("survives an id that OpenRGB has already reused", () => {
    const map = colors({ 0: { ...col(99), id: 0 } });
    const next = pruneDeviceColors(map, [0]);
    expect(next[0]!.rgb).toEqual([99, 0, 0]);
  });

  it("keeps a device whose colour entry is not an array index string", () => {
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