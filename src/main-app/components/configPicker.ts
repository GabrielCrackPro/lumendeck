// Naming rules for saving a config, kept out of the modal because they are the
// part with a decision in them.
//
// Vitest runs in node with no DOM, so anything asserted has to be pure. The
// input and the duplicate check are the two places the modal can be wrong in a
// way a user has to clean up by hand: a name saved as "  " is untidy forever,
// and two configs with the same name are indistinguishable in a list of eight.

/**
 * Whether deleting is on the table at all.
 *
 * The last profile cannot go: with none, the header avatar has nothing to
 * show and the one-click way back to a setup you liked is gone, for a mistake
 * that takes two clicks to undo but no thought to make. Counted rather than
 * checked against the running profile, so the rule holds whichever one is
 * left — and it makes the button grey itself out the moment the count reaches
 * one, instead of after a second profile has been deleted.
 */
export function canDeleteProfile(count: number): boolean {
  return count > 1;
}

/** The pending key the picker uses when applying the config with this id. */
export function configPendingKey(id: string): string {
  return `scene-${id}`;
}

/**
 * Which config is being applied right now, read off the pending set.
 *
 * Derived rather than held in its own state, because a separate flag can
 * disagree with what is actually in flight: the pending set refuses a second
 * press while one is unresolved, so clicking another row during an apply
 * leaves the first row spinning in reality and the second one pretending in
 * the UI. Reading the one source of truth cannot get out of step.
 *
 * Returns the config id, or null. "scene-save" is the capture key and is
 * skipped: it is not a config being applied, and reading it as one would put a
 * spinner on a row nobody clicked.
 */
export function applyingConfigKey(pending: Iterable<string>): string | null {
  for (const key of pending) {
    if (key === "scene-save") continue;
    if (key.startsWith("scene-")) return key.slice("scene-".length);
  }
  return null;
}

/**
 * The name a config is saved under.
 *
 * Falls back rather than refusing when the field is blank: the button next to
 * it says "Capture current look", and a user who clicks it without typing has
 * told us they want a config, not that they want an error.
 */
export function configName(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Whether this name is already taken, ignoring case and surrounding space.
 *
 * Case-insensitive because the list is read at a glance: "Night" and "night"
 * side by side read as a bug, not as two setups. Comparison is on the trimmed
 * name so a space typed at the end of an existing entry does not buy a copy.
 */
export function isDuplicateConfigName(
  raw: string,
  existing: readonly string[],
): boolean {
  const candidate = raw.trim().toLocaleLowerCase();
  if (candidate.length === 0) return false;
  return existing.some((name) => name.trim().toLocaleLowerCase() === candidate);
}
