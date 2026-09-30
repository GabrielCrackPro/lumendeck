import { describe, expect, it } from "vitest";
import { displayName } from "./ui";

describe("displayName", () => {
  it("prefers the user's alias over the Windows device name", () => {
    expect(displayName({ device: "\\.\\DISPLAY2" }, 1, { "\\.\\DISPLAY2": "Desk" })).toBe(
      "Desk",
    );
  });

  it("falls back to the device name with its backslashes stripped", () => {
    // This is what the panel showed before renaming existed: ".DISPLAY1".
    expect(displayName({ device: "\\.\\DISPLAY1" }, 0, {})).toBe(".DISPLAY1");
  });

  it("treats a blank alias as no alias", () => {
    expect(displayName({ device: "\\.\\DISPLAY1" }, 0, { "\\.\\DISPLAY1": "" })).toBe(
      ".DISPLAY1",
    );
    expect(displayName({ device: "\\.\\DISPLAY1" }, 0, { "\\.\\DISPLAY1": "  " })).toBe(
      ".DISPLAY1",
    );
  });

  it("trims a padded alias", () => {
    expect(displayName({ device: "\\.\\DISPLAY1" }, 0, { "\\.\\DISPLAY1": "  Desk  " })).toBe(
      "Desk",
    );
  });

  it("does not leak an alias belonging to another display", () => {
    expect(displayName({ device: "\\.\\DISPLAY1" }, 0, { "\\.\\DISPLAY2": "Desk" })).toBe(
      ".DISPLAY1",
    );
  });

  it("numbers the display when Windows reports no device name", () => {
    // A headless or briefly-unnamed monitor must still be addressable.
    expect(displayName({ device: "" }, 2, {})).toBe("Display 3");
  });

  it("works without a names argument at all", () => {
    expect(displayName({ device: "\\.\\DISPLAY1" }, 0)).toBe(".DISPLAY1");
  });
});
