// Every colour the dashboard is built from, in one place.
//
// The three theme blocks used to be hand-authored in index.css, which left the
// accent readability maths in main-app/accent.ts with no choice but to restate
// the backgrounds as RGB tuples in order to score contrast against them.
// Nothing related the two, they drifted once — #11121b in the JS against
// #101214 in the stylesheet — and the third theme had no JS counterpart at all,
// so an AMOLED user's accent was corrected against a surface nobody could see.
//
// So the tokens live here. The stylesheet receives them from the themeTokens
// plugin in vite.config.ts, which replaces the `/* theme-tokens */` marker in
// index.css with the blocks below; the maths resolves the same declarations
// through [themeToken]. There is no second place to fall out of date, and the
// build fails if index.css loses the marker.
//
// The declarations are kept in CSS syntax deliberately. A token is whatever
// value a custom property accepts, and rewriting rgba() into hex here to make
// the data look tidier would mean the generator had to understand colour.

import { DEFAULT_GLOW } from "./tokens";

export type ThemeName = "light" | "dark";

/** One theme's contribution to the cascade. */
export interface ThemeBlock {
  /** The selector carrying these declarations. */
  selector: string;
  /**
   * `color-scheme`, so form controls, scrollbars and the canvas match. Only
   * the base themes set it: `.dark.amoled` is a modifier on dark, and
   * repeating `color-scheme: dark` there would be a second place to keep in
   * step for no gain.
   */
  colorScheme?: ThemeName;
  /**
   * Custom properties, without the leading `--`.
   *
   * A block states only what it changes. `.dark.amoled` overrides seven of the
   * dark theme's tokens and inherits the rest, which is what the cascade
   * would do anyway and keeps the AMOLED corrections from having to restate
   * values they do not change.
   */
  tokens: Record<string, string>;
}

/**
 * The token cascade, in the order the browser applies it.
 *
 * The two prose blocks that used to sit above these in index.css live here as
 * well, because a colour with no stated intent is exactly how the graphite
 * panel and the ivory workbench drifted into being two unrelated lists.
 */
export const THEME_BLOCKS: readonly ThemeBlock[] = [
  {
    // Light: warm ivory workbench. Panels are near-white and mostly opaque, so
    // the desktop wallpaper stays visible only around the window's edges.
    selector: ":root",
    colorScheme: "light",
    tokens: {
      // The live accent triplet, as an `r g b` space triplet because every
      // use site is `rgb(var(--glow) / <alpha>)`. This is the value on screen
      // for the few frames before the backend hands over the real one, and it
      // is DEFAULT_GLOW because that is the colour the app falls back to once
      // every source has been ruled out — a second literal here would be free
      // to disagree with the fallback the user actually ends up looking at.
      glow: DEFAULT_GLOW.join(" "),
      // Ink for text and dots sitting ON a filled accent. A literal at every
      // call site (a dozen copies of #06121f across the gallery) had no
      // guaranteed relationship to --glow, which is dynamic — it follows the
      // wallpaper — so the contrast was luck. One token names the role; a
      // future theme that needs a different ink declares it in its own block
      // and every pill, badge and chip picks it up.
      "on-accent": "#06121f",
      bg: "#e9e7e0",
      panel: "rgba(255, 255, 254, 0.78)",
      "panel-strong": "rgba(255, 255, 255, 0.96)",
      "panel-sunken": "rgba(12, 14, 18, 0.05)",
      line: "rgba(28, 27, 24, 0.12)",
      "line-strong": "rgba(28, 27, 24, 0.24)",
      text: "#17150f",
      "text-dim": "#4d4a41",
      "text-faint": "#847f72",
      // The end of the ramp the accent readability maths steps toward when a
      // source colour is unreadable on this surface. Darker than any text
      // colour, so a lifted accent has somewhere left to go.
      //
      // This is very close to `--text` (#17150f) and deliberately not the same
      // value: the ramp wants the deepest tone the theme can offer, and text
      // is chosen for reading rather than for being an endpoint. It was a bare
      // literal in accent.ts before it lived here, which is how a colour ends
      // up stated twice with nothing saying they are related.
      "accent-lift": "#110f0a",
      shadow:
        "0 0 0 1px rgba(28, 27, 24, 0.05), 0 2px 6px rgba(28, 27, 24, 0.06), 0 20px 48px -32px rgba(28, 27, 24, 0.4)",
    },
  },
  {
    // Dark: graphite instrument panel. Panels are a few percent of white over
    // the background rather than solid, so depth comes from the stack instead
    // of from borders.
    selector: ".dark",
    colorScheme: "dark",
    tokens: {
      bg: "#101214",
      panel: "rgba(255, 255, 255, 0.026)",
      "panel-strong": "rgba(255, 255, 255, 0.055)",
      "panel-sunken": "rgba(0, 0, 0, 0.35)",
      line: "rgba(255, 255, 255, 0.075)",
      "line-strong": "rgba(255, 255, 255, 0.17)",
      text: "#ecedef",
      "text-dim": "#a5a8ae",
      "text-faint": "#66696f",
      // See the note on the light theme's `accent-lift`. Lighter than every
      // text colour, for the same reason: it is a ramp endpoint, not a colour
      // anything is typeset in.
      "accent-lift": "#ffffff",
      shadow:
        "0 0 0 1px rgba(0, 0, 0, 0.5), 0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 24px 60px -34px rgba(0, 0, 0, 0.9)",
    },
  },
  {
    // AMOLED: true-black surfaces stacked on .dark — pixels fully off on OLED
    // panels. Hairlines dim to keep contrast from vibrating on pure black, and
    // the sunken panel deepens because a translucent black over black has
    // nothing left to do.
    selector: ".dark.amoled",
    tokens: {
      bg: "#000000",
      panel: "rgba(255, 255, 255, 0.02)",
      "panel-strong": "rgba(255, 255, 255, 0.04)",
      "panel-sunken": "rgba(0, 0, 0, 0.6)",
      line: "rgba(255, 255, 255, 0.09)",
      "line-strong": "rgba(255, 255, 255, 0.2)",
      shadow:
        "0 0 0 1px rgba(0, 0, 0, 0.8), 0 24px 60px -34px rgba(0, 0, 0, 1)",
    },
  },
];

/**
 * Tokens the accent maths needs but no stylesheet rule reads.
 *
 * The palette has two consumers — the stylesheet and the contrast maths — and
 * this is the difference between them. `accent-lift` is the endpoint of a ramp
 * computed in JavaScript; declaring `--accent-lift` on `:root` would put a
 * custom property in every shipped stylesheet that nothing selects.
 *
 * Kept as an explicit list rather than a naming convention so it stays visible,
 * and so a new code-only token cannot quietly leak into the CSS by being
 * spelled slightly differently.
 */
export const CODE_ONLY_TOKENS: ReadonlySet<string> = new Set(["accent-lift"]);

/** The selector that applies when the theme resolves to `theme`. */
export function themeSelector(theme: ThemeName): string {
  return theme === "light" ? ":root" : ".dark";
}

function blockFor(selector: string): ThemeBlock {
  const found = THEME_BLOCKS.find((b) => b.selector === selector);
  if (!found) throw new Error(`no theme block for ${selector}`);
  return found;
}

/**
 * The value a token actually has on screen, following the cascade.
 *
 * This mirrors what the browser computes rather than describing a parallel
 * model of it: dark resolves `.dark`, then `.dark.amoled` layers on top where
 * it declares something and dark shows through where it does not. An AMOLED
 * background is therefore a different surface from a dark one, which is the
 * whole reason the accent maths takes an `amoled` argument.
 *
 * A token no theme declares is a typo in the caller, so it throws rather than
 * returning a plausible default — a silently wrong surface would put the
 * contrast maths back where it started.
 */
export function themeToken(
  theme: ThemeName,
  amoled: boolean,
  token: string,
): string {
  // Most specific first, because that is the order the cascade resolves in:
  // the first block that declares the token wins. `:root` sits last as the
  // base layer, which declares every token, so a theme that overrides only
  // some of them — which is all of them — still resolves the rest. `--glow` is
  // the case that forces this shape: it is set once, on `:root`, and every
  // theme inherits it.
  const selectors =
    theme === "light"
      ? [":root"]
      : amoled
        ? [".dark.amoled", ".dark", ":root"]
        : [".dark", ":root"];
  for (const selector of selectors) {
    const value = blockFor(selector).tokens[token];
    if (value !== undefined) return value;
  }
  const declared = Object.keys(blockFor(":root").tokens)
    .map((n) => `--${n}`)
    .join(", ");
  throw new Error(
    `no theme declares --${token}; the palette has: ${declared}`,
  );
}
