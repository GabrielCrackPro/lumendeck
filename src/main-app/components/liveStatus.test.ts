import { describe, it, expect } from "vitest";
import { isLiveStatus } from "./liveStatus";

const all = {
  rgbConnected: true,
  rgbEnabled: true,
  wallpaperRunning: true,
};

describe("isLiveStatus", () => {
  it("is live when everything is running", () => {
    expect(isLiveStatus(all)).toBe(true);
  });

  it("is not live when OpenRGB is not answering", () => {
    expect(isLiveStatus({ ...all, rgbConnected: false })).toBe(false);
  });

  it("is not live when the lights are switched off", () => {
    expect(isLiveStatus({ ...all, rgbEnabled: false })).toBe(false);
  });

  it("is not live when the wallpaper is paused", () => {
    expect(isLiveStatus({ ...all, wallpaperRunning: false })).toBe(false);
  });

  it("needs all three, not any of them", () => {
    expect(
      isLiveStatus({
        rgbConnected: true,
        rgbEnabled: true,
        wallpaperRunning: false,
      }),
    ).toBe(false);
  });
});
