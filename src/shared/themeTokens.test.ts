import { describe, expect, it } from "vitest";
import {
  THEME_TOKEN_MARKER,
  injectThemeTokens,
  renderThemeBlocks,
} from "./themeTokens";
import { CODE_ONLY_TOKENS, THEME_BLOCKS, themeToken } from "./palette";

const STYLESHEET = `@import "tailwindcss";

${THEME_TOKEN_MARKER}

@theme { --radius-lg: 12px; }
`;

describe("renderThemeBlocks", () => {
  it("emits one block per theme, in cascade order", () => {
    const css = renderThemeBlocks();
    for (const block of THEME_BLOCKS) {
      expect(css).toContain(`${block.selector} {`);
    }
    expect(css.indexOf(":root {")).toBeLessThan(css.indexOf(".dark {"));
    expect(css.indexOf(".dark {")).toBeLessThan(css.indexOf(".dark.amoled {"));
  });

  it("writes every token the palette declares, with the -- prefix", () => {
    const css = renderThemeBlocks();
    for (const block of THEME_BLOCKS) {
      for (const [name, value] of Object.entries(block.tokens)) {
        if (CODE_ONLY_TOKENS.has(name)) continue;
        expect(css).toContain(`  --${name}: ${value};`);
      }
    }
  });

  it("leaves the code-only tokens out of the stylesheet", () => {
    const css = renderThemeBlocks();
    for (const name of CODE_ONLY_TOKENS) {
      expect(css).not.toContain(`--${name}:`);
      expect(themeToken("dark", false, name)).toBeTruthy();
      expect(themeToken("light", false, name)).toBeTruthy();
    }
  });

  it("emits color-scheme only where the palette asks for it", () => {
    const css = renderThemeBlocks();
    expect(css.match(/color-scheme:/g)).toHaveLength(2);
  });

  it("agrees with themeToken on what each theme actually resolves to", () => {
    const css = renderThemeBlocks();
    const blockFor = (selector: string) => {
      const at = css.indexOf(`${selector} {`);
      return css.slice(at, css.indexOf("\n}", at) + 2);
    };
    const root = blockFor(":root");
    const dark = blockFor(".dark");
    const amoled = blockFor(".dark.amoled");

    for (const token of ["bg", "panel", "text", "text-dim", "shadow"]) {
      expect(root).toContain(`--${token}: ${themeToken("light", false, token)};`);
      expect(dark).toContain(`--${token}: ${themeToken("dark", false, token)};`);
    }
    for (const token of ["bg", "panel", "line-strong"]) {
      expect(amoled).toContain(`--${token}: ${themeToken("dark", true, token)};`);
    }
  });

  it("says where it came from", () => {
    expect(renderThemeBlocks()).toContain("src/shared/palette.ts");
  });
});

describe("injectThemeTokens", () => {
  it("replaces the marker and leaves the rest of the file alone", () => {
    const out = injectThemeTokens(STYLESHEET);
    expect(out).not.toContain(THEME_TOKEN_MARKER);
    expect(out).toContain(renderThemeBlocks());
    expect(out.startsWith(STYLESHEET.slice(0, STYLESHEET.indexOf(THEME_TOKEN_MARKER)))).toBe(true);
    expect(out.endsWith(STYLESHEET.slice(STYLESHEET.indexOf(THEME_TOKEN_MARKER) + THEME_TOKEN_MARKER.length))).toBe(true);
  });

  it("refuses a stylesheet that has lost the marker", () => {
    let message = "";
    try {
      injectThemeTokens('@import "tailwindcss";\n\n@theme { --radius: 8px; }');
    } catch (e) {
      message = String(e);
    }
    expect(message).toContain(THEME_TOKEN_MARKER);
    expect(message).toContain("index.css");
    expect(message).toContain("palette.ts");
  });

  it("refuses a stylesheet carrying the marker twice", () => {
    expect(() =>
      injectThemeTokens(
        `${THEME_TOKEN_MARKER}\n${THEME_TOKEN_MARKER}\n@theme { --radius: 8px; }`,
      ),
    ).toThrow(/more than once/);
  });

  it("is idempotent, so a second pass is a no-op rather than an error", () => {
    const once = injectThemeTokens(STYLESHEET);
    expect(injectThemeTokens(once)).toBe(once);
    expect(injectThemeTokens(injectThemeTokens(once))).toBe(once);
    expect(once.split(".dark.amoled {")).toHaveLength(2);
  });

  it("still refuses a source that never had the marker", () => {
    expect(() => injectThemeTokens("@theme { --radius: 8px; }")).toThrow(
      /no longer contains/,
    );
  });
});
