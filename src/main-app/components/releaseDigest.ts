// Turning a release body into something a toast can show.
//
// The updater's `body` is whatever `scripts/generate-changelog.mjs --release-notes`
// printed, which is markdown: `##` version headings, `###` section headings,
// `- **scope:** text (hash)` entries and an `_n internal._` footer. The toast used
// to put that in its message verbatim, so an update card read
//
//   ## 0.2.34 - 2026-10-04
//   ### Added
//   - **transfer:** move a setup between machines, media included (72c7e2d)
//
// which is a file fragment wearing a notification's clothes.
//
// This module reduces it to two things a card can hold: counts per section, and
// one headline. Pure and DOM-free, because vitest runs with no document and a
// function that reached for one could only be checked by reading the source.

/** The section keys this module counts. */
export type SectionKey =
  | "added"
  | "changed"
  | "fixed"
  | "performance"
  | "internal";

/** A section with a name a user can read. Internal is deliberately not one. */
export type NotableSection = Exclude<SectionKey, "internal">;

/** Section heading as the changelog writes it -> a stable key. */
const SECTION_KEYS: Record<string, SectionKey> = {
  Added: "added",
  Changed: "changed",
  Fixed: "fixed",
  Performance: "performance",
  Internal: "internal",
};

/** What the toast says about a release. Zero counts are omitted by the caller. */
export interface ReleaseDigest {
  /** The `## 0.2.34 - 2026-10-04` heading, if the body had one. */
  version: string | null;
  /** Entry count per section. Only sections that appeared are present. */
  counts: Partial<Record<SectionKey, number>>;
  /**
   * The first user-facing entry, flattened to plain text, or null when there is
   * nothing but internal churn.
   *
   * One line, not a list: a toast is four lines tall. The full list is one click
   * away in the changelog card, which is why the link exists.
   */
  headline: string | null;
  /**
   * The section the headline came from, so the caller can discount it from the
   * counts. Without this a release with one Added entry says "the thing, plus 1
   * added" — counting the very line the user is already reading.
   */
  headlineSection: SectionKey | null;
  /** True when any entry is marked BREAKING, which is worth surfacing loudly. */
  breaking: boolean;
  /** Entries across every section, including internal. */
  total: number;
  /** User-facing entries: everything except the internal bookkeeping section. */
  userFacing: number;
}

/**
 * Strips markdown from one changelog line.
 *
 * Deliberately not a general markdown parser. It only has to handle what
 * `formatEntry` in `generate-changelog.mjs` emits, and a general parser would be
 * both bigger and wrong more quietly — a bullet that failed to match here shows
 * up as a stray `**` in a toast, which is exactly what we are fixing.
 */
export function plainEntry(line: string): string {
  return line
    // A leading bullet, with either marker. `releaseDigest` strips this before
    // calling, but this is exported and a caller passing a raw line should not
    // get a bullet back as the first character of a headline.
    .replace(/^\s*[-*+]\s+/, "")
    // `**BREAKING** — text`: the marker is reported separately as a boolean, and
    // left in place it would become the entire headline for a breaking entry.
    .replace(/^\*\*BREAKING\*\*\s*[\u2014\u2013-]?\s*/i, "")
    // `**scope:** text` -> `text`. The scope is a conventional-commit prefix that
    // identifies the change to someone reading CHANGELOG.md; in a one-line toast
    // "updater: watch for releases" reads as a stutter, not information.
    //
    // Restricted to a lowercase prefix because `**Note:**` is otherwise
    // indistinguishable from `**transfer:**`. The generator's scope comes out of
    // a commit subject, which is lowercase by convention, so the casing tells the
    // two apart and an entry opening with a bolded proper noun keeps it.
    .replace(/^\*\*[a-z][^*]{0,39}:\*\*\s*/, "")
    // Any remaining `**text**` -> plain text.
    .replace(/\*\*(.+?)\*\*/g, "$1")
    // `[label](url)` -> `label`.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // The trailing `(\`72c7e2d\`)` commit hash: identifies the change to
    // someone reading the changelog and means nothing in a toast.
    .replace(/\s*\(`[0-9a-f]+`\)\s*$/i, "")
    // A bare `\`72c7e2d\`` with nothing around it, which is all that is left once
    // the scope and the rest have been stripped. An entry that was only a hash
    // becomes empty, and the caller drops it.
    .replace(/^`[0-9a-f]+`$/i, "")
    // Emphasis markers with nothing inside, and stray whitespace.
    .replace(/(^|\s)[*_]{1,2}(?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reads a release body into counts and a headline.
 *
 * `null` and empty input produce an empty digest rather than throwing, because
 * the updater legitimately returns no body: a release cut before the changelog
 * was generated has notes but nothing to say, and the toast still has a version
 * and a restart button.
 */
export function releaseDigest(body: string | null | undefined): ReleaseDigest {
  const digest: ReleaseDigest = {
    version: null,
    counts: {},
    headline: null,
    headlineSection: null,
    breaking: false,
    total: 0,
    userFacing: 0,
  };
  if (!body) return digest;

  let section: SectionKey | null = null;

  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    // `## 0.2.34 - 2026-10-04`
    const heading = line.match(/^##\s+(.+)$/)?.[1];
    if (heading !== undefined) {
      if (digest.version == null) {
        // The heading carries the version and a date; only the version is a
        // fact here, and the toast already shows it separately.
        digest.version = heading.split("—")[0]?.split("-")[0]?.trim() || null;
      }
      continue;
    }

    // `### Added`
    const sub = line.match(/^###\s+(.+)$/)?.[1];
    if (sub !== undefined) {
      // An unrecognised heading clears the section rather than leaving it open:
      // the changelog gains categories over time, and entries under one must not
      // be counted as whatever section happened to be above it.
      section = SECTION_KEYS[sub.trim()] ?? null;
      continue;
    }

    // `_3 internal._` — a footer, not an entry.
    if (/^_.*_$/.test(line)) continue;

    // A bullet. Only count it while a recognised section is open: the changelog
    // writes one, but a hand-written note in `.github/changelog-notes` can put
    // prose above the first heading, and prose is not a change.
    if (!/^[-*]\s+/.test(line)) continue;
    if (section == null) continue;

    const text = plainEntry(line.replace(/^[-*]\s+/, ""));
    if (!text) continue;

    digest.counts[section] = (digest.counts[section] ?? 0) + 1;
    digest.total += 1;
    if (section !== "internal") digest.userFacing += 1;
    // Read off the raw line, not `text`: `plainEntry` removes the marker, so
    // checking the flattened entry would report a breaking change as an
    // ordinary one — the one flag a user most needs to see.
    if (/\bBREAKING\b/.test(line)) digest.breaking = true;
    // The first user-facing entry becomes the headline. Internal churn is
    // skipped because "chore: bump a lockfile" is not what an update card
    // should lead with.
    if (digest.headline == null && section !== "internal") {
      digest.headline = text;
      digest.headlineSection = section;
    }
  }

  return digest;
}

/** Section keys in the order a release reads best: what was added, then what broke. */
export const DIGEST_ORDER: readonly NotableSection[] = [
  "added",
  "changed",
  "fixed",
  "performance",
];

/**
 * The i18n key naming each section, as `"{n} added"`.
 *
 * A map rather than a template literal because the checker follows const lookup
 * tables by name and nothing else: written as `` t(`update.{n}-${key}`) `` these
 * keys are unreachable, so they would be reported as dead and then removed from
 * both catalogs while the code still referenced them.
 */
export const SECTION_LABELS: Record<NotableSection, string> = {
  added: "update.{n}-added",
  changed: "update.{n}-changed",
  fixed: "update.{n}-fixed",
  performance: "update.{n}-performance",
};

/**
 * The sections worth naming, with counts, as `[key, count]` pairs.
 *
 * Internal is deliberately absent: "4 internal" tells a user nothing they can
 * act on, and it would push the real changes off a four-line card.
 */
export function notableCounts(
  digest: ReleaseDigest,
): [NotableSection, number][] {
  return DIGEST_ORDER.flatMap((k) =>
    digest.counts[k] ? [[k, digest.counts[k]!] as [NotableSection, number]] : [],
  );
}

/**
 * The notable sections left after the headline is set aside.
 *
 * Same as `notableCounts` minus one from the headline's own section, and empty
 * when the release was a single change — which is the case that matters, since
 * the toast then reads as one clean sentence instead of restating itself.
 */
export function restCounts(digest: ReleaseDigest): [NotableSection, number][] {
  return notableCounts(digest).flatMap(([k, n]) => {
    if (k === digest.headlineSection) {
      if (n <= 1) return [];
      return [[k, n - 1] as [NotableSection, number]];
    }
    return [[k, n] as [NotableSection, number]];
  });
}