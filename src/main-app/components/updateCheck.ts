// What the last update check did, and how to say so.
//
// The interval control was a blind dropdown: nothing on screen said whether the
// app had checked, when, or what it found. On a metered connection, or after a
// setting someone expected to fix a missed update, that is indistinguishable
// from the setting doing nothing.
//
// Recording also gives the swallowed failures somewhere to go. `checkForAppUpdate`
// used to end in `.catch(() => {})` -- correct for a check nobody asked for, but
// it meant a check that failed every hour was indistinguishable from one that
// never ran. It is a recorded outcome now, not a lost error.

/**
 * What one check concluded.
 *
 * Deliberately three, not a status per HTTP outcome: a user cares whether the
 * app knows about a release, not why an endpoint was briefly unreachable.
 */
export type UpdateCheckOutcome = "current" | "update" | "failed";

/** One completed check. Purely a fact about the past; nothing here acts on it. */
export interface UpdateCheckRecord {
  /** When it finished, as epoch ms. */
  atMs: number;
  outcome: UpdateCheckOutcome;
}

/**
 * The catalog key naming each outcome.
 *
 * A lookup table because the caller resolves it dynamically, and `i18n-check`
 * only follows keys that appear in a `t()` call or in a const ending in
 * `_LABELS`. Written inline it would read as dead and be stripped from both
 * catalogs while the code still referenced it.
 */
export const CHECK_OUTCOME_LABELS: Record<UpdateCheckOutcome, string> = {
  current: "update.up-to-date",
  update: "update.found-an-update",
  failed: "update.check-failed",
};

/**
 * The record a finished check produces.
 *
 * Kept separate from the store so the rule is testable: a check that failed is
 * still a check that ran, and recording it is the difference between "never
 * looked" and "looked and could not reach the server" -- which are opposite
 * problems with opposite fixes.
 */
export function nextCheckRecord(
  outcome: UpdateCheckOutcome,
  atMs: number,
): UpdateCheckRecord {
  return { atMs, outcome };
}

/**
 * The time of a check as a short label, in the user's language.
 *
 * Just the clock time when it happened today, because that is when someone
 * watching a settings panel wants to know. Older checks carry the date, since
 * "14:32" alone would suggest this morning when it was Tuesday.
 */
export function checkTimeLabel(atMs: number, now: number, locale: string): string {
  if (!Number.isFinite(atMs)) return "";
  const at = new Date(atMs);
  const today = new Date(now);
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  // A bare clock time today, the date as well once "today" is no longer true.
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(sameDay ? {} : { day: "numeric", month: "short" }),
  }).format(at);
}
