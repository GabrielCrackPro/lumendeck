
import { CODE_ONLY_TOKENS, THEME_BLOCKS, type ThemeBlock } from "./palette";

export const THEME_TOKEN_MARKER = "/* theme-tokens */";

const GENERATED_BY = "/* Generated from src/shared/palette.ts";

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

export function renderThemeBlocks(): string {
  return [
    "/* Generated from src/shared/palette.ts by the themeTokens plugin in",
    "   vite.config.ts. Every colour the app uses is declared there — edit",
    "   that, not this. */",
    ...THEME_BLOCKS.map(renderBlock),
  ].join("\n\n");
}

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
