// Writing the palette into the stylesheet.
//
// A CSS file cannot import from a TypeScript module, so the direction of
// dependency is arranged rather than declared: [THEME_BLOCKS] becomes the three
// theme blocks, and index.css carries a `/* theme-tokens */` marker where they
// belong. The marker is the whole contract — the plugin replaces it, and a
// stylesheet that has lost it is a build failure rather than an app that
// quietly renders with no colours defined.
//
// Both halves are pure string functions, so the tests exercise them without
// running Vite; the plugin in vite.config.ts is a wrapper.

import { CODE_ONLY_TOKENS, THEME_BLOCKS, type ThemeBlock } from "./palette";

/** The line in index.css that stands in for the generated blocks. */
export const THEME_TOKEN_MARKER = "/* theme-tokens */";

/** How the generated blocks introduce themselves. */
const GENERATED_BY = "/* Generated from src/shared/palette.ts";

/** One selector's worth of declarations, as authored in the source data. */
function renderBlock(block: ThemeBlock): string {
  const lines: string[] = [];
  if (block.colorScheme) {
    lines.push(`  color-scheme: ${block.colorScheme};`);
    lines.push("");
  }
  for (const [name, value] of Object.entries(block.tokens)) {
    if (CODE_ONLY_TOKENS.has(name)) continue;
    lines.push(`  --${name}: ${value};`);
  }
  return `${block.selector} {\n${lines.join("\n")}\n}`;
}

/** The three theme blocks, in cascade order, ready to drop into a stylesheet. */
export function renderThemeBlocks(): string {
  return [
    "/* Generated from src/shared/palette.ts by the themeTokens plugin in",
    "   vite.config.ts. Every colour the app uses is declared there — edit",
    "   that, not this. */",
    ...THEME_BLOCKS.map(renderBlock),
  ].join("\n\n");
}

/**
 * Put the generated theme blocks where the marker is.
 *
 * Idempotent: a pass over already-generated CSS returns it untouched. The
 * marker is consumed by the first pass, so without this a second pass over the
 * same file would report a missing marker rather than the fact that it had
 * already done the work.
 *
 * Throws when the marker is missing from the source or has been duplicated,
 * because both mean the stylesheet and the palette no longer agree about where
 * the theme lives, and a build that quietly emitted the blocks twice, or not at
 * all, would fail far away from the edit that caused it.
 */
export function injectThemeTokens(css: string): string {
  if (css.includes(GENERATED_BY)) return css;
  const first = css.indexOf(THEME_TOKEN_MARKER);
  if (first < 0) {
    throw new Error(
      `index.css no longer contains ${THEME_TOKEN_MARKER}, so the theme ` +
        `blocks from src/shared/palette.ts have nowhere to go and the app ` +
        `would render with no colours defined. Restore the marker where the ` +
        `three theme blocks used to be.`,
    );
  }
  if (css.indexOf(THEME_TOKEN_MARKER, first + 1) >= 0) {
    throw new Error(
      `index.css contains ${THEME_TOKEN_MARKER} more than once; the theme ` +
        `blocks would be emitted twice. Leave exactly one.`,
    );
  }
  return (
    css.slice(0, first) +
    renderThemeBlocks() +
    css.slice(first + THEME_TOKEN_MARKER.length)
  );
}
