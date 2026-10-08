import { describe, expect, it } from "vitest";
import { amoledDefault } from "./onboardingAmoled";

describe("amoledDefault", () => {
  it("turns AMOLED on for the dark theme", () => {
    expect(amoledDefault("dark", false)).toBe(true);
  });

  it("turns it off for the light theme", () => {
    expect(amoledDefault("light", false)).toBe(false);
  });

  it("writes nothing once the user has touched the toggle", () => {
    expect(amoledDefault("dark", true)).toBeNull();
    expect(amoledDefault("light", true)).toBeNull();
  });
});