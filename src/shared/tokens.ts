// The runtime constants the dashboard, the webviews and the Rust backend all
// have to agree on.
//
// Every one of these used to exist as two or three independent literals:
//
//   - the default glow was DEFAULT_GLOW in constants.ts, `--glow` in index.css
//     and a literal in rgb/mod.rs's sweep base;
//   - the hotkey blink colour was a TS constant whose only defence was a
//     comment saying it mirrored the Rust default;
//   - the sticker size was a TS constant that nothing imported, four literals
//     in the placement overlay that did, and a third copy in constants_sticker.rs.
//
// A comment saying "keep these in step" is not a mechanism. This file and
// tokens.rs both read tokens.json, so there is one value and the two runtimes
// cannot disagree about it — and a test on each side fails the build if the
// shape moves.
//
// The colours the CSS palette needs are NOT here: those are design tokens and
// belong in palette.ts, which the stylesheet is generated from. What crosses
// this boundary is only what a second runtime has to compute with.

import raw from "./tokens.json";

/** [r, g, b] triplet, 0..255. */
export type RGB = [number, number, number];

/**
 * JSON has no tuple type, so a three-element array arrives as `number[]` and
 * would be handed out as one. Checking the length here is what makes the
 * exported constant a tuple; the Rust side gets the same guarantee from
 * `[u8; 3]`, which rejects a wrong-length array at deserialisation.
 */
function rgb(name: string, value: number[]): RGB {
  if (value.length !== 3) {
    throw new Error(`tokens.json ${name} must be [r, g, b], got ${value.length}`);
  }
  return [value[0]!, value[1]!, value[2]!];
}

/**
 * The accent the UI falls back to when every source has been ruled out.
 *
 * Also the `--glow` default in the stylesheet — palette.ts reads this to
 * generate it, so the splash before the backend answers is the same blue the
 * app settles on, rather than a second literal that happened to match.
 */
export const DEFAULT_GLOW: RGB = rgb("defaultGlow", raw.defaultGlow);

/**
 * The colour a hotkey's LED blinks in.
 *
 * Both sides need this: the dashboard renders the swatch, and the Rust config
 * default decides what a binding with no stored colour does.
 */
export const HOTKEY_BLINK_COLOR: RGB = rgb("hotkeyBlink", raw.hotkeyBlink);

/**
 * Sticker geometry, in physical pixels before the monitor's scale factor.
 *
 * The overlay clamps to the limits while the user resizes; the backend creates
 * a sticker at the default size when none is supplied, and its wheel handler
 * clamps with the same two bounds. Four copies of 220 and two of each limit is
 * how the preview came to offer a size the backend would silently change.
 */
export const STICKER_DEFAULT_W = raw.stickerDefaultW;
export const STICKER_DEFAULT_H = raw.stickerDefaultH;
export const STICKER_MIN_SIZE = raw.stickerMinSize;
export const STICKER_MAX_SIZE = raw.stickerMaxSize;
