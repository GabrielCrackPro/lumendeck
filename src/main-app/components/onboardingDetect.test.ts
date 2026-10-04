import { describe, expect, it } from "vitest";
import {
  detectSetup,
  foundCount,
  resolutionLabel,
  setupIsComplete,
  type DetectInputs,
} from "./onboardingDetect";

/** All-found baseline; each test overrides exactly the field it is about. */
const all: DetectInputs = {
  monitorCount: 1,
  primaryWidth: 1920,
  primaryHeight: 1080,
  rgbConnected: true,
  rgbDeviceCount: 3,
  vaultCount: 12,
  audioAvailable: true,
};

describe("detectSetup", () => {
  it("reports every fact in a fixed order", () => {
    // The rows are a layout, and the closing summary reads them in the same
    // order. Object key order would be an accident, not a decision.
    expect(detectSetup(all).map((f) => f.id)).toEqual([
      "displays",
      "lighting",
      "vault",
      "audio",
    ]);
  });

  it("marks a connected server with no devices as not found", () => {
    // The regression this guards: "answered" read as "found". A server that
    // replies with an empty device list is a worse state than one that never
    // answered, and the row must not claim success for it.
    const facts = detectSetup({ ...all, rgbDeviceCount: 0 });
    const lighting = facts.find((f) => f.id === "lighting");
    expect(lighting?.ok).toBe(false);
    expect(lighting?.count).toBe(0);
  });

  it("marks devices as not found when the server never answered", () => {
    // Device count alone is not evidence: a stale count from a server that has
    // since exited must not read as a working setup.
    const facts = detectSetup({ ...all, rgbConnected: false });
    expect(facts.find((f) => f.id === "lighting")?.ok).toBe(false);
  });

  it("treats no monitors as not found", () => {
    // Nothing else matters if there is no display to put a wallpaper on.
    expect(detectSetup({ ...all, monitorCount: 0 }).find((f) => f.id === "displays")?.ok).toBe(
      false,
    );
  });

  it("treats an empty vault as not found", () => {
    expect(detectSetup({ ...all, vaultCount: 0 }).find((f) => f.id === "vault")?.ok).toBe(false);
  });

  it("keeps the count even when the fact is not ok", () => {
    // The count drives "0 devices found" copy, which is more useful than a bare
    // "not found" when someone is trying to work out what went wrong.
    const facts = detectSetup({ ...all, rgbConnected: false, rgbDeviceCount: 4 });
    expect(facts.find((f) => f.id === "lighting")?.count).toBe(4);
  });
});

describe("setupIsComplete", () => {
  it("is true only when every fact is found", () => {
    expect(setupIsComplete(detectSetup(all))).toBe(true);
  });

  it("is false when a single fact is missing", () => {
    // All-or-nothing, deliberately: "mostly configured" on a desktop with no
    // wallpaper is a congratulation nobody should receive.
    for (const patch of [
      { monitorCount: 0 },
      { rgbConnected: false },
      { vaultCount: 0 },
      { audioAvailable: false },
    ]) {
      expect(setupIsComplete(detectSetup({ ...all, ...patch }))).toBe(false);
    }
  });

  it("is false for no facts at all", () => {
    // An empty array satisfies `every`, which would report a perfect setup for
    // a machine that detected nothing.
    expect(setupIsComplete([])).toBe(false);
  });
});

describe("foundCount", () => {
  it("counts only the found facts", () => {
    expect(foundCount(detectSetup(all))).toBe(4);
    expect(foundCount(detectSetup({ ...all, vaultCount: 0, audioAvailable: false }))).toBe(2);
  });
});

describe("resolutionLabel", () => {
  it("formats a readable resolution", () => {
    expect(resolutionLabel(1920, 1080)).toBe("1920x1080");
  });

  it("is empty when either dimension is missing", () => {
    // Empty rather than a placeholder: the caller draws "unknown" differently
    // from a resolution, because one is missing data and one is a real value.
    expect(resolutionLabel(null, 1080)).toBe("");
    expect(resolutionLabel(1920, null)).toBe("");
  });

  it("is empty for a non-positive dimension", () => {
    // A mode change can report 0 before the monitor settles. That is missing
    // information, not a resolution of zero.
    expect(resolutionLabel(0, 0)).toBe("");
    expect(resolutionLabel(1920, -1)).toBe("");
  });
});