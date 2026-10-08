
import { describe, expect, it } from "vitest";
import {
  THEME_BLOCKS,
  themeSelector,
  themeToken,
} from "./palette";
import { DEFAULT_GLOW } from "./constants";

describe("themeSelector", () => {
  it("resolves the selector the stylesheet uses for each theme", () => {
    expect(themeSelector("light")).toBe(":root");
    expect(themeSelector("dark")).toBe(".dark");
  });
});

describe("themeToken", () => {
  it("returns each theme's own declarations", () => {
    expect(themeToken("light", false, "bg")).toBe("#e9e7e0");
    expect(themeToken("dark", false, "bg")).toBe("#101214");
    expect(themeToken("light", false, "text")).toBe("#17150f");
    expect(themeToken("dark", false, "text")).toBe("#ecedef");
  });

  it("layers the AMOLED block over dark, the way the cascade does", () => {
    expect(themeToken("dark", true, "bg")).toBe("#000000");
    for (const [name, value] of Object.entries(
      THEME_BLOCKS.find((b) => b.selector === ".dark.amoled")!.tokens,
    )) {
      expect(themeToken("dark", true, name)).toBe(value);
    }
  });

  it("gives AMOLED its own readable text hierarchy", () => {
    expect(themeToken("dark", true, "text")).toBe("#f2f3f5");
    expect(themeToken("dark", true, "text-dim")).toBe("#b2b5bb");
    expect(themeToken("dark", true, "text-faint")).toBe("#858a92");
  });

  it("never applies the AMOLED block to a light theme", () => {
    expect(themeToken("light", true, "bg")).toBe("#e9e7e0");
    expect(themeToken("light", true, "panel")).toBe("rgba(255, 255, 254, 0.78)");
  });

  it("publishes the glow default the CSS default has to match", () => {
    expect(themeToken("light", false, "glow")).toBe(DEFAULT_GLOW.join(" "));
  });

  it("inherits a token a theme does not override", () => {
    expect(themeToken("dark", false, "glow")).toBe(DEFAULT_GLOW.join(" "));
    expect(themeToken("dark", true, "glow")).toBe(DEFAULT_GLOW.join(" "));
  });

  it("throws on a token no theme declares", () => {
    expect(() => themeToken("dark", false, "backgroud")).toThrow(
      /no theme declares --backgroud/,
    );
    expect(() => themeToken("dark", false, "backgroud")).toThrow(/--bg/);
  });
});

describe("THEME_BLOCKS", () => {
  it("only the base themes set color-scheme", () => {
    expect(THEME_BLOCKS.filter((b) => b.colorScheme).map((b) => b.selector)).toEqual([
      ":root",
      ".dark",
    ]);
  });

  it("has :root declare every token the palette uses", () => {
    const root = THEME_BLOCKS.find((b) => b.selector === ":root")!;
    const every = new Set(
      THEME_BLOCKS.flatMap((b) => Object.keys(b.tokens)),
    );
    for (const name of every) {
      expect(Object.keys(root.tokens)).toContain(name);
    }
  });

  it("keeps the AMOLED block a strict subset of dark's tokens", () => {
    const dark = THEME_BLOCKS.find((b) => b.selector === ".dark")!;
    const amoled = THEME_BLOCKS.find((b) => b.selector === ".dark.amoled")!;
    for (const name of Object.keys(amoled.tokens)) {
      expect(Object.keys(dark.tokens)).toContain(name);
    }
  });

  it("keeps the three backgrounds opaque", () => {
    for (const theme of ["light", "dark"] as const) {
      for (const amoled of [false, true]) {
        expect(themeToken(theme, amoled, "bg")).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});
