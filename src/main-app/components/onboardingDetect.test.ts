import { describe, expect, it } from "vitest";
import {
  detectSetup,
  foundCount,
  resolutionLabel,
  setupIsComplete,
  type DetectInputs,
} from "./onboardingDetect";

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
    expect(detectSetup(all).map((f) => f.id)).toEqual([
      "displays",
      "lighting",
      "vault",
      "audio",
    ]);
  });

  it("marks a connected server with no devices as not found", () => {
    const facts = detectSetup({ ...all, rgbDeviceCount: 0 });
    const lighting = facts.find((f) => f.id === "lighting");
    expect(lighting?.ok).toBe(false);
    expect(lighting?.count).toBe(0);
  });

  it("marks devices as not found when the server never answered", () => {
    const facts = detectSetup({ ...all, rgbConnected: false });
    expect(facts.find((f) => f.id === "lighting")?.ok).toBe(false);
  });

  it("treats no monitors as not found", () => {
    expect(detectSetup({ ...all, monitorCount: 0 }).find((f) => f.id === "displays")?.ok).toBe(
      false,
    );
  });

  it("treats an empty vault as not found", () => {
    expect(detectSetup({ ...all, vaultCount: 0 }).find((f) => f.id === "vault")?.ok).toBe(false);
  });

  it("keeps the count even when the fact is not ok", () => {
    const facts = detectSetup({ ...all, rgbConnected: false, rgbDeviceCount: 4 });
    expect(facts.find((f) => f.id === "lighting")?.count).toBe(4);
  });
});

describe("setupIsComplete", () => {
  it("is true only when every fact is found", () => {
    expect(setupIsComplete(detectSetup(all))).toBe(true);
  });

  it("is false when a single fact is missing", () => {
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
    expect(resolutionLabel(null, 1080)).toBe("");
    expect(resolutionLabel(1920, null)).toBe("");
  });

  it("is empty for a non-positive dimension", () => {
    expect(resolutionLabel(0, 0)).toBe("");
    expect(resolutionLabel(1920, -1)).toBe("");
  });
});