// These run in the node vitest environment, but a test under src/ cannot import
// node builtins — the app tsconfig carries no node types on purpose, so a test
// that read the real index.css would need the tsconfig opened up for every
// other file as well. "Does index.css still carry the marker" is therefore a
// build-time question: the themeTokens plugin in vite.config.ts throws when it
// is gone, and `node scripts/verify.mjs` runs `vite build`, so a stylesheet that
// lost it fails CI rather than passing here.
//
// What is worth testing is the cascade itself, which is the part the browser
// would otherwise be the only witness to.

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
    // Every token .dark.amoled declares is the one that wins.
    for (const [name, value] of Object.entries(
      THEME_BLOCKS.find((b) => b.selector === ".dark.amoled")!.tokens,
    )) {
      expect(themeToken("dark", true, name)).toBe(value);
    }
  });

  it("lets dark show through where AMOLED says nothing", () => {
    // The AMOLED block overrides seven of dark's tokens and inherits the rest
    // — which is why a light theme with the setting on is still ivory, and why
    // the text colours needed no third copy.
    expect(themeToken("dark", true, "text")).toBe(
      themeToken("dark", false, "text"),
    );
    expect(themeToken("dark", true, "text-dim")).toBe("#a5a8ae");
  });

  it("never applies the AMOLED block to a light theme", () => {
    // App.tsx only stacks the class when the resolved theme is not light, so
    // this is unreachable — but the contrast maths must not be handed a black
    // surface under an ivory panel if it ever is.
    expect(themeToken("light", true, "bg")).toBe("#e9e7e0");
    expect(themeToken("light", true, "panel")).toBe("rgba(255, 255, 254, 0.78)");
  });

  it("publishes the glow default the CSS default has to match", () => {
    // --glow is the value on screen for the frames before the backend answers,
    // and DEFAULT_GLOW is the colour everything falls back to. Stating it
    // twice is how the splash could end up a different blue from the app.
    expect(themeToken("light", false, "glow")).toBe(DEFAULT_GLOW.join(" "));
  });

  it("inherits a token a theme does not override", () => {
    // `--glow` is set once on `:root` and every theme inherits it, so a
    // resolver that only read the theme's own block would throw on a token the
    // browser resolves without complaint — which is how a caller ends up
    // avoiding themeToken and hand-reading the palette instead.
    expect(themeToken("dark", false, "glow")).toBe(DEFAULT_GLOW.join(" "));
    expect(themeToken("dark", true, "glow")).toBe(DEFAULT_GLOW.join(" "));
  });

  it("throws on a token no theme declares", () => {
    // A typo in a caller must not resolve to a plausible default: a silently
    // wrong surface is the exact failure this module exists to prevent.
    expect(() => themeToken("dark", false, "backgroud")).toThrow(
      /no theme declares --backgroud/,
    );
    // And the message lists what is available, CSS spelling, so the fix is a
    // glance rather than a trip back to the file.
    expect(() => themeToken("dark", false, "backgroud")).toThrow(/--bg/);
  });
});

describe("THEME_BLOCKS", () => {
  it("only the base themes set color-scheme", () => {
    // `.dark.amoled` repeating `color-scheme: dark` would be a second place to
    // keep in step for no gain; the cascade already puts it in dark mode.
    expect(THEME_BLOCKS.filter((b) => b.colorScheme).map((b) => b.selector)).toEqual([
      ":root",
      ".dark",
    ]);
  });

  it("has :root declare every token the palette uses", () => {
    // :root is the base layer of the cascade, so a token that exists only in
    // `.dark` resolves on a light theme to the initial value — silently, and
    // as a broken panel. This is the most likely mistake in the file.
    const root = THEME_BLOCKS.find((b) => b.selector === ":root")!;
    const every = new Set(
      THEME_BLOCKS.flatMap((b) => Object.keys(b.tokens)),
    );
    for (const name of every) {
      expect(Object.keys(root.tokens)).toContain(name);
    }
  });

  it("keeps the AMOLED block a strict subset of dark's tokens", () => {
    // Anything the AMOLED block declares that dark does not would only ever
    // apply on an OLED panel, and would be a token no other theme has.
    const dark = THEME_BLOCKS.find((b) => b.selector === ".dark")!;
    const amoled = THEME_BLOCKS.find((b) => b.selector === ".dark.amoled")!;
    for (const name of Object.keys(amoled.tokens)) {
      expect(Object.keys(dark.tokens)).toContain(name);
    }
  });

  it("keeps the three backgrounds opaque", () => {
    // The accent maths parses --bg as a hex, so a translucent background would
    // make surfaceRgb throw at runtime rather than quietly scoring contrast
    // against something the user never sees.
    for (const theme of ["light", "dark"] as const) {
      for (const amoled of [false, true]) {
        expect(themeToken(theme, amoled, "bg")).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});
