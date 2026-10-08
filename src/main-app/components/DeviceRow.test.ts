import { describe, expect, it } from "vitest";
import { deviceName, deviceTypeLabel } from "./DeviceRow";
import type { RgbDeviceInfo } from "@shared/types";

function device(over: Partial<RgbDeviceInfo> = {}): RgbDeviceInfo {
  return {
    id: 1,
    name: "LEDStrip1",
    typeName: "LEDStrip",
    leds: 30,
    zones: [],
    ...over,
  };
}

describe("deviceName", () => {
  it("prefers the user's alias over anything the driver said", () => {
    expect(deviceName(device(), { "1": "Desk strip" })).toBe("Desk strip");
  });

  it("falls back to the driver name when no alias exists", () => {
    expect(deviceName(device(), {})).toBe("LEDStrip1");
    expect(deviceName(device(), { "2": "Monitor" })).toBe("LEDStrip1");
  });

  it("treats a blank alias as no alias", () => {
    expect(deviceName(device(), { "1": "" })).toBe("LEDStrip1");
    expect(deviceName(device(), { "1": "   " })).toBe("LEDStrip1");
  });

  it("trims a padded alias", () => {
    expect(deviceName(device(), { "1": "  Desk strip  " })).toBe("Desk strip");
  });

  it("falls back to the type when the driver gave no name", () => {
    expect(deviceName(device({ name: "" }), {})).toBe("Led strip");
  });

  it("uses the id when there is neither a name nor a usable type", () => {
    expect(deviceName(device({ name: "", typeName: "" }), {})).toBe("Device 1");
  });

  it("works without a names argument at all", () => {
    expect(deviceName(device())).toBe("LEDStrip1");
  });
});

describe("deviceTypeLabel", () => {
  it("names a keyboard in the catalog rather than echoing the driver", () => {
    expect(deviceTypeLabel("Keyboard")).toBe("Keyboard");
  });

  it("collapses a driver's type name onto the same word a person uses", () => {
    expect(deviceTypeLabel("LEDStrip2")).toBe("LED strip");
    expect(deviceTypeLabel("DRAM")).toBe("Memory");
  });

  it("separates a mouse from a mouse pad", () => {
    expect(deviceTypeLabel("Mouse")).toBe("Mouse");
    expect(deviceTypeLabel("MouseMat")).toBe("Mouse pad");
  });

  it("falls back to the driver's own words for an unknown device", () => {
    expect(deviceTypeLabel("TeslaCoil3")).toBe("Tesla coil");
  });

  it("returns nothing rather than throwing on an empty type", () => {
    expect(deviceTypeLabel("")).toBe("");
  });
});
