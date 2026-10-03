// What the config avatar shows, with the decisions separated from the pixels.
//
// Vitest runs in node with no DOM, so this is where the interesting part has
// to live: a config name is free text written by a person, and the avatar is
// the one place a name is reduced to a single glyph. Getting that wrong is
// visible — a blank circle for a config called "3AM", or half a surrogate
// pair rendered as a replacement character.

/**
 * The one character to draw for a config name, or "" when there is none.
 *
 * Uppercased because a name is written in whatever case its author felt like,
 * and two configs reading as `n` and `N` in the same column look like a bug.
 * A name starting with a digit or symbol keeps it: "3AM" is a name, and
 * inventing a letter for it would be worse than showing the 3.
 *
 * Empty string rather than a placeholder character, because "no name" and
 * "named with a symbol" are different states and the caller draws them
 * differently.
 */
export function avatarInitial(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  // Array.from splits by code point, so an emoji or an accented character is
  // one element rather than half a surrogate pair.
  const first = Array.from(trimmed)[0];
  return first ? first.toLocaleUpperCase() : "";
}
