import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("passes an explicit choice straight through", () => {
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
    expect(resolveTheme(undefined, true)).toBe("light");
    expect(resolveTheme(undefined, false)).toBe("dark");
  });

  it("never returns anything but light or dark", () => {
    for (const pref of ["dark", "light", "system", undefined] as const) {
      for (const prefersLight of [true, false]) {
        expect(["light", "dark"]).toContain(resolveTheme(pref, prefersLight));
      }
    }
  });
});
