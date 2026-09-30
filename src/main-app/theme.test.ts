import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("passes an explicit choice straight through", () => {
    // An explicit pick must ignore the OS entirely — someone who chose light
    // on a light machine and dark on a dark one both get what they asked for.
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the OS when the preference is system", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
  });

  it("treats a missing preference as system, not as dark", () => {
    // The load-time path resolves before the config has arrived. Defaulting
    // that to dark is what tinted the accent against the wrong surface on
    // light machines before the resolver existed.
    expect(resolveTheme(undefined, true)).toBe("light");
    expect(resolveTheme(undefined, false)).toBe("dark");
  });

  it("never returns anything but light or dark", () => {
    // The value feeds readableOnTheme, which indexes a two-entry surface
    // table. A third value would read `undefined` and compare against NaN,
    // which silently disables the accent correction instead of failing.
    for (const pref of ["dark", "light", "system", undefined] as const) {
      for (const prefersLight of [true, false]) {
        expect(["light", "dark"]).toContain(resolveTheme(pref, prefersLight));
      }
    }
  });
});
