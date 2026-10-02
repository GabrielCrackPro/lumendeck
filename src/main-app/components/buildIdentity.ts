// How a build identifies itself, in one place.
//
// The dev badge and the Developer panel both show a version. They read it from
// different sources — the badge from a constant baked into the bundle, the panel
// from the running backend over IPC — so "the same string" is not something the
// type checker can promise and was not something the code enforced. Formatting
// lives here so at least the shape of the string is decided once.
//
// The sources still differ on purpose. The panel's rule is that it reports what
// the process says rather than what the bundle guesses, because a diagnostics
// panel that is confidently wrong is worse than one that is silent. The badge has
// no such option: it renders in the title bar before any IPC has returned, so a
// baked constant is all it can have. `check-versions.mjs` is what keeps the two
// numbers equal, and `versionDisagreement` is what turns a failure of that into
// something visible instead of something believed.

/**
 * The version as the badge and the panel both print it.
 *
 * Empty in, empty out: a row with no value is skipped by the report builder, and
 * a bare `v` on the badge would be worse than nothing.
 */
export function versionLabel(version: string): string {
  const trimmed = version.trim();
  if (!trimmed) return "";
  // Manifests in the wild carry a leading `v` more often than you would like,
  // and `vv0.2.7` in a title bar is a bug that gets reported rather than fixed.
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

/**
 * Whether the bundle's baked version and the running binary's version differ.
 *
 * Reported rather than corrected: one of the two is right and the app cannot
 * tell which, so the honest move is to say so and let whoever reads the panel
 * decide. Version skew between a frontend bundle and its backend is otherwise
 * invisible — every command still works, and every value looks plausible.
 */
export function versionDisagreement(running: string, baked: string): boolean {
  const a = running.trim();
  const b = baked.trim();
  // An absent value on either side is missing data, not a conflict. Reporting
  // a mismatch the panel cannot substantiate is its own kind of wrong.
  if (!a || !b) return false;
  return versionLabel(a) !== versionLabel(b);
}