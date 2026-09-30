import { describe, expect, it } from "vitest";
import { deviceName } from "./DeviceRow";
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
    // An alias for a different device must not leak onto this one.
    expect(deviceName(device(), { "2": "Monitor" })).toBe("LEDStrip1");
  });

  it("treats a blank alias as no alias", () => {
    // Emptying the rename box is how a user forgets a name, so whitespace and
    // the empty string both have to fall through rather than render as nothing.
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
