import { describe, expect, it } from "vitest";
import { amoledDefault } from "./onboardingAmoled";

describe("amoledDefault", () => {
  it("turns AMOLED on for the dark theme", () => {
    expect(amoledDefault("dark", false)).toBe(true);
  });

  it("turns it off for the light theme", () => {
    // Not null. On a lit background the toggle describes a dark theme that is
    // not in effect, so leaving a stale `true` behind would be a lie the UI
    // could not correct.
    expect(amoledDefault("light", false)).toBe(false);
  });

  it("writes nothing once the user has touched the toggle", () => {
    // The regression this guards: re-asserting the default on every theme
    // re-resolve silently undoes a deliberate choice, in an effect the user
    // never interacted with.
    expect(amoledDefault("dark", true)).toBeNull();
    expect(amoledDefault("light", true)).toBeNull();
  });
});