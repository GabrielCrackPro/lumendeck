// Turning what someone typed into a colour.
//
// The picker's hex field used to accept exactly one shape — six hex digits,
// `#` optional — and rejected everything else by silently snapping back to the
// old value on blur. Three-digit shorthand is how colours are written by hand
// and in every palette and CSS snippet ever published, so it was the form most
// likely to be typed and the one most likely to be refused. Parsing lives here,
// away from the component, because it is the part with the interesting cases.

/** `#abc` shorthand, where each digit is doubled: `#abc` === `#aabbcc`. */
function expandShorthand(digits: string): string {
  return digits
    .split("")
    .map((c) => c + c)
    .join("");
}

/**
 * Parse a hex colour into RGB, or `null` if it is not one.
 *
 * Accepts, case-insensitively and with the `#` optional:
 *
 * - `RGB` / `RGB` — shorthand, each digit doubled.
 * - `RRGGBB` — the form the field displays.
 * - `RGBA` / `RRGGBBAA` — parsed, alpha discarded.
 *
 * Alpha is dropped rather than rejected: someone pasting a colour with a
 * channel they copied out of a design tool wants the colour, and an opaque RGB
 * is the closest honest answer. Rejecting it would leave the field showing the
 * old value with no explanation.
 */
export function parseHex(text: string): [number, number, number] | null {
  const body = text.trim().replace(/^#/, "");
  let digits = body;
  // Shorthand first, alpha second: `#f0a8` doubles to 8 digits and then drops
  // the alpha, which is why this cannot be one "3 or 4" branch — expanding 4
  // digits and slicing afterwards is what keeps the two paths from colliding.
  if (digits.length === 3) {
    digits = expandShorthand(digits);
  } else if (digits.length === 4) {
    digits = expandShorthand(digits).slice(0, 6);
  } else if (digits.length === 8) {
    digits = digits.slice(0, 6);
  }
  if (!/^[0-9a-fA-F]{6}$/.test(digits)) return null;
  return [
    parseInt(digits.slice(0, 2), 16),
    parseInt(digits.slice(2, 4), 16),
    parseInt(digits.slice(4, 6), 16),
  ];
}

/** Whether a hex field entry is a colour this picker can apply. */
export function isParsableHex(text: string): boolean {
  return parseHex(text) !== null;
}

/** `RGB` -> `#RRGGBB`, the one shape the field ever displays. */
export function formatHex(rgb: [number, number, number]): string {
  const joined = rgb
    .map((c) => Math.round(c).toString(16).padStart(2, "0"))
    .join("");
  return `#${joined.toUpperCase()}`;
}

/** Strip a leading `#` and uppercase, for echoing as you type. */
export function tidyHexDraft(text: string): string {
  return text.trim().replace(/^#/, "").toUpperCase();
}