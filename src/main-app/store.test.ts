import { describe, expect, it, beforeEach } from "vitest";
import type { DeviceColor, RgbStatus } from "@shared/types";
import { useStore } from "./store";

const status = (ids: number[]): RgbStatus => ({
  connected: true,
  protocolVersion: 2,
  lastError: null,
  devices: ids.map((id) => ({
    id,
    name: `Device ${id}`,
    typeName: "Keyboard",
    leds: 12,
    zones: [],
  })),
});

const frame = (id: number, r: number): DeviceColor => ({
  id,
  rgb: [r, 0, 0],
  ledColors: [],
});

describe("device arrivals", () => {
  beforeEach(() => {
    useStore.setState({
      deviceColors: {},
      deviceAddedAt: {},
      rgb: status([]),
    });
  });

  it("marks a device that appears after the baseline", () => {
    const { seedRgb, setRgb } = useStore.getState();
    seedRgb(status([0]));
    expect(useStore.getState().deviceAddedAt[0]).toBeUndefined();

    setRgb(status([0, 1]));
    expect(useStore.getState().deviceAddedAt[0]).toBeUndefined();
    expect(useStore.getState().deviceAddedAt[1]).toBeTypeOf("number");
  });

  it("says nothing about hardware that was already plugged in at startup", () => {
    useStore.getState().seedRgb(status([0, 1, 2]));
    expect(useStore.getState().deviceAddedAt).toEqual({});
  });

  it("forgets a device that has been unplugged", () => {
    const { seedRgb, setRgb } = useStore.getState();
    seedRgb(status([0]));
    setRgb(status([0, 1]));
    expect(useStore.getState().deviceAddedAt[1]).toBeTypeOf("number");

    setRgb(status([0]));
    expect(useStore.getState().deviceAddedAt[1]).toBeUndefined();
  });
});

describe("device colour cache", () => {
  beforeEach(() => {
    useStore.setState({ deviceColors: {}, rgb: status([]) });
  });

  it("forgets the colour of a device the backend stopped reporting", () => {
    const { setRgb, setDeviceColors } = useStore.getState();
    setRgb(status([0, 1]));
    setDeviceColors([frame(0, 10), frame(1, 20)]);
    expect(Object.keys(useStore.getState().deviceColors)).toEqual(["0", "1"]);

    setRgb(status([1]));
    expect(Object.keys(useStore.getState().deviceColors)).toEqual(["1"]);
  });

  it("keeps a connected device's colour through a status update", () => {
    const { setRgb, setDeviceColors } = useStore.getState();
    setRgb(status([0]));
    setDeviceColors([frame(0, 42)]);
    setRgb(status([0]));
    expect(useStore.getState().deviceColors[0]!.rgb).toEqual([42, 0, 0]);
  });

  it("clears the cache when no device is connected", () => {
    const { setRgb, setDeviceColors } = useStore.getState();
    setRgb(status([0, 1]));
    setDeviceColors([frame(0, 10), frame(1, 20)]);

    setRgb({ ...status([]), connected: false });
    expect(useStore.getState().deviceColors).toEqual({});
  });
});

describe("toasts", () => {
  beforeEach(() => {
    useStore.setState({ toasts: [] });
  });

  it("stacks unkeyed toasts", () => {
    const { toast } = useStore.getState();
    toast("info", "first");
    toast("info", "second");
    expect(useStore.getState().toasts).toHaveLength(2);
  });

  it("collapses a repeated key into one card with a count", () => {
    const { toast } = useStore.getState();
    toast("info", "Keyboard disconnected", { key: "device:1" });
    toast("ok", "Keyboard connected", { key: "device:1" });
    toast("info", "Keyboard disconnected", { key: "device:1" });

    const toasts = useStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.msg).toBe("Keyboard disconnected");
    expect(toasts[0]!.tone).toBe("info");
    expect(toasts[0]!.count).toBe(3);
  });

  it("keeps the card's id so the dismiss timer tracks one card", () => {
    const { toast } = useStore.getState();
    toast("info", "a", { key: "openrgb" });
    const first = useStore.getState().toasts[0]!.id;
    toast("info", "b", { key: "openrgb" });
    expect(useStore.getState().toasts[0]!.id).toBe(first);
  });

  it("does not merge different keys, nor unkeyed into keyed", () => {
    const { toast } = useStore.getState();
    toast("info", "a", { key: "device:1" });
    toast("info", "b", { key: "device:2" });
    toast("info", "c");
    expect(useStore.getState().toasts).toHaveLength(3);
    expect(useStore.getState().toasts.every((t) => t.count == null)).toBe(true);
  });
});
