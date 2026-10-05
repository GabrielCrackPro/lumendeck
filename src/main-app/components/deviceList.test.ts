import { describe, expect, it } from "vitest";
import { DEVICE_ROWS_COLLAPSED, deviceWindow, ledCounts } from "./deviceList";

const many = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("deviceWindow", () => {
  it("shows everything when the list fits", () => {
    const d = many(DEVICE_ROWS_COLLAPSED);
    const w = deviceWindow(d, false);
    expect(w.visible).toEqual(d);
    expect(w.hidden).toBe(0);
    // No toggle when there is nothing behind it: a "show all" that shows six
    // of six is a control that does nothing.
    expect(w.collapsible).toBe(false);
  });

  it("caps at the row count and reports the remainder", () => {
    const w = deviceWindow(many(10), false);
    expect(w.visible).toHaveLength(DEVICE_ROWS_COLLAPSED);
    expect(w.hidden).toBe(4);
    expect(w.collapsible).toBe(true);
    // The first rows, in order — the cap takes from the bottom, so the devices
    // nearest the card's header are the ones always on screen.
    expect(w.visible[0]).toBe(0);
    expect(w.visible[DEVICE_ROWS_COLLAPSED - 1]).toBe(
      DEVICE_ROWS_COLLAPSED - 1,
    );
  });

  it("shows everything once expanded", () => {
    const d = many(10);
    const w = deviceWindow(d, true);
    expect(w.visible).toEqual(d);
    expect(w.hidden).toBe(0);
    expect(w.collapsible).toBe(false);
  });

  it("keeps the expanded choice when the device count changes", () => {
    // The card holds `expanded` in its own state, so a device arriving mid
    // session must not silently re-collapse a list the user had opened.
    expect(deviceWindow(many(3), true).visible).toHaveLength(3);
    expect(deviceWindow(many(10), true).visible).toHaveLength(10);
  });

  it("never hides every device, whatever cap it is handed", () => {
    // A cap of 0 or negative from a bad config would otherwise produce an
    // empty list with no affordance to recover from.
    for (const cap of [0, -5, 0.4, NaN]) {
      const w = deviceWindow(many(4), false, cap);
      expect(w.visible.length).toBeGreaterThanOrEqual(1);
      expect(w.collapsible).toBe(true);
    }
  });

  it("does not mutate or alias the caller's array", () => {
    // The list comes straight out of the store. A window that sorted or spliced
    // it in place would reorder the device list the user sees everywhere else.
    const d = many(10);
    const before = [...d];
    deviceWindow(d, true);
    deviceWindow(d, false);
    expect(d).toEqual(before);
  });

  it("is empty-safe", () => {
    expect(deviceWindow([], false)).toEqual({
      visible: [],
      hidden: 0,
      collapsible: false,
    });
    expect(deviceWindow([], true)).toEqual({
      visible: [],
      hidden: 0,
      collapsible: false,
    });
  });
});

describe("ledCounts", () => {
  const devices = [
    { id: 1, leds: 96 },
    { id: 2, leds: 24 },
    { id: 3, leds: 12 },
  ];

  it("counts every LED when nothing is muted", () => {
    expect(ledCounts(devices, [])).toEqual({ total: 132, active: 132, muted: 0, unmuted: 3 });
  });

  it("excludes a muted device's LEDs from active but not from total", () => {
    // Mutually consistent by construction: the whole reason this is one walk
    // is that the figures used to be derived in two files and could disagree.
    const c = ledCounts(devices, [2]);
    expect(c).toEqual({ total: 132, active: 108, muted: 1, unmuted: 2 });
    expect(c.active).toBeLessThan(c.total);
  });

  it("counts muted devices even when the list is empty of LEDs", () => {
    const c = ledCounts(
      [{ id: 1, leds: 0 }, { id: 2, leds: 0 }],
      [1, 2],
    );
    expect(c.muted).toBe(2);
    expect(c.unmuted).toBe(0);
    expect(c.active).toBe(0);
  });
});