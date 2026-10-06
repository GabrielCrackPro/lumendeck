// How the command palette decides what a keystroke surfaces. Extracted from
// CommandPalette so the numbers that order the list can be tested without a
// DOM — the palette is a Tauri-only overlay, so nothing about it renders in
// the test environment.
//
// Two properties are worth a module of their own:
//
//   - Ranking is tiered, not a pile of ad-hoc constants. An exact match beats
//     a prefix, a prefix beats a word-boundary hit, and so on down to a loose
//     subsequence, and every within-tier nudge (length, position) is capped so
//     it cannot cross into the next tier. Without that contract a hit on the
//     hidden keywords can outrank the label the query was typed against,
//     which is exactly what the old scorer let happen.
//   - A query with a space in it matches nothing unless every word lands
//     somewhere. The old scorer compared the whole query as one string, so
//     "set wav" — a thing people naturally type — always came back empty.

/** A [start, end) slice of the searched text, in character offsets. */
export type Range = [number, number];

export interface Match {
  /** 0 = no match. Otherwise a tier score; higher ranks first. */
  score: number;
  /** Merged ranges the query matched, for highlighting. Best effort. */
  ranges: Range[];
}

// Tier scores. The gap between tiers is the contract: every modifier below is
// capped well short of it, so tuning inside a tier can reorder a tier but can
// never promote a match into the one above.
const EXACT = 1000;
const PREFIX = 800;
const WORD_START = 700;
const SUBSTRING = 600;
const SUBSEQUENCE = 400;

// Per-field costs. Same tier, different field: a hit on the label a person
// reads beats the same hit on the keywords hidden behind it, which beats the
// section the command lives in — except at the very top, where typing a
// section's name outright ("app", "rgb") is treated as strong as it reads.
const KEYWORD_COST = 80;
const GROUP_COST = 160;

// Characters after which being one further along stops counting against a
// match, and the ceiling on the subsequence penalties. The subsequence range
// (400 +/- these) stays clear of SUBSTRING above and 0 below by construction.
const POSITION_CAP = 50;
/** Prefix matches may look further down the length ladder than position does. */
const PREFIX_LEN_CAP = 60;
const SUBSEQ_GAP_CAP = 120;
const SUBSEQ_START_CAP = 40;
const SUBSEQ_WORD_BONUS_CAP = 30;

/** Characters that make the one after them the start of a word. */
const WORD_BOUNDARY = new Set([
  " ", "\t", "-", "_", "/", ".", ":", "(", ")", "[", "]", ",", "…", "·", "\"", "'",
]);

function isWordStart(text: string, at: number): boolean {
  return at === 0 || WORD_BOUNDARY.has(text[at - 1] ?? "");
}

/** Sort and fuse overlapping or touching ranges so no offset is drawn twice. */
function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length <= 1) return ranges.slice();
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Range[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const [start, end] = sorted[i]!;
    const last = out[out.length - 1]!;
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/**
 * Score one term against one text, case-insensitively.
 *
 * The offsets are into `text` as written, which holds only while lowercasing
 * keeps the string's width: the Turkish dotted capital I maps to two code
 * units, and every offset after it would land one letter early. The score is
 * still right in that case, so it is kept and the highlight — best effort by
 * nature — is dropped rather than painted across the wrong letters.
 */
export function matchTerm(term: string, text: string): Match {
  // An empty term is the empty query: everything matches, weakly and equally.
  if (!term) return { score: 1, ranges: [] };
  if (!text) return { score: 0, ranges: [] };

  const needle = term.toLowerCase();
  const hay = text.toLowerCase();
  const keep = (score: number, ranges: Range[]): Match => ({
    score,
    ranges: hay.length === text.length ? ranges : [],
  });

  const at = hay.indexOf(needle);
  if (at !== -1) {
    const span: Range = [at, at + needle.length];
    if (hay === needle)
      return keep(EXACT - Math.min(POSITION_CAP, hay.length), [[0, hay.length]]);
    if (at === 0) return keep(PREFIX - Math.min(PREFIX_LEN_CAP, hay.length), [span]);
    if (isWordStart(text, at)) return keep(WORD_START - Math.min(POSITION_CAP, at), [span]);
    return keep(SUBSTRING - Math.min(POSITION_CAP, at), [span]);
  }

  // Subsequence: every character in order, not necessarily adjacent ("sw" ->
  // "Set wallpaper"). Scattered hits score below anything contiguous, tighter
  // clusters above, and hits landing on word starts read as the word itself.
  const hits: number[] = [];
  let from = 0;
  for (const ch of needle) {
    const found = hay.indexOf(ch, from);
    if (found === -1) return { score: 0, ranges: [] };
    hits.push(found);
    from = found + 1;
  }
  const first = hits[0]!;
  const last = hits[hits.length - 1]!;
  const gaps = last - first + 1 - needle.length; // characters skipped over
  let wordHits = 0;
  for (const h of hits) if (isWordStart(text, h)) wordHits++;
  const score =
    SUBSEQUENCE -
    Math.min(SUBSEQ_GAP_CAP, gaps * 6) -
    Math.min(SUBSEQ_START_CAP, first) +
    Math.min(SUBSEQ_WORD_BONUS_CAP, wordHits * 10);
  return keep(score, mergeRanges(hits.map((h): Range => [h, h + 1])));
}

/** Split a query the way every scorer below reads it: lowercased words. */
function splitQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * The ranges of `text` the whole query matched, merged for highlighting.
 *
 * Only ranges inside `text` itself appear: a term that matched the keywords
 * or the section instead has nothing to paint in the label, and guessing at
 * one would highlight letters the person never typed.
 */
export function matchRanges(query: string, text: string): Range[] {
  const ranges: Range[] = [];
  for (const term of splitQuery(query)) ranges.push(...matchTerm(term, text).ranges);
  return mergeRanges(ranges);
}

export interface SearchableCommand {
  /** Display label — already translated: people search in their language. */
  label: string;
  /** Hidden synonyms matched behind the label. */
  keywords?: string;
  /** The section's display label, already translated. */
  group?: string;
}

/**
 * Score a command against a query. Every whitespace-separated term must land
 * on the label, the keywords or the section; scores are summed, so a term
 * matching two fields still only counts its best one. An empty query scores
 * everything 1 — equal, undifferentiated, and enough to pass a `> 0` filter.
 */
export function scoreCommand(query: string, cmd: SearchableCommand): number {
  const terms = splitQuery(query);
  if (!terms.length) return 1;
  let total = 0;
  for (const term of terms) {
    const best = Math.max(
      matchTerm(term, cmd.label).score,
      (cmd.keywords ? matchTerm(term, cmd.keywords).score : 0) - KEYWORD_COST,
      (cmd.group ? matchTerm(term, cmd.group).score : 0) - GROUP_COST,
    );
    if (best <= 0) return 0; // one word found nowhere ends the search here
    total += best;
  }
  return total;
}

/**
 * The order shown before a query narrows it: pinned first (in pin order),
 * then the preferred ids the caller passes (the frecent order the palette
 * computes), then everything else — deduped across all three, with
 * the surviving `items` order kept for the tail. Ids that no longer resolve
 * to a command drop out here instead of leaving a hole in the list.
 */
export function withPinnedRecents<T>(
  items: readonly T[],
  pinned: readonly string[],
  preferred: readonly string[],
  idOf: (item: T) => string,
): T[] {
  const byId = new Map(items.map((it) => [idOf(it), it]));
  const take = (ids: readonly string[]): T[] =>
    ids.map((id) => byId.get(id)).filter((x): x is T => x !== undefined);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of [...take(pinned), ...take(preferred), ...items]) {
    const id = idOf(item);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

/**
 * A mode prefix: the query's first character choosing *which list* is
 * searched, in the Slack/VS Code tradition — `#` searches the wallpaper
 * vault, `@` searches profiles — so reaching a submenu is one keystroke
 * instead of typing "set wallpaper" first.
 *
 * Deliberately only two prefixes: the root already searches commands, so a
 * `>`-style "commands only" prefix would filter nothing. The component parses
 * prefixes only at the root; inside a submenu or the actions view the pool is
 * already chosen and a leading `#` is just a character.
 */
export type QueryPrefix = "#" | "@";

export interface ParsedQuery {
  prefix: QueryPrefix | null;
  /** What is left after the prefix. It is what scores and highlights. */
  term: string;
}

export function parseQuery(raw: string): ParsedQuery {
  const head = raw.slice(0, 1);
  return head === "#" || head === "@"
    ? { prefix: head, term: raw.slice(1) }
    : { prefix: null, term: raw };
}
