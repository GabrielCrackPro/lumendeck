
export type Range = [number, number];

export interface Match {
  score: number;
  ranges: Range[];
}

const EXACT = 1000;
const PREFIX = 800;
const WORD_START = 700;
const SUBSTRING = 600;
const SUBSEQUENCE = 400;

const KEYWORD_COST = 80;
const GROUP_COST = 160;

const POSITION_CAP = 50;
const PREFIX_LEN_CAP = 60;
const SUBSEQ_GAP_CAP = 120;
const SUBSEQ_START_CAP = 40;
const SUBSEQ_WORD_BONUS_CAP = 30;

const WORD_BOUNDARY = new Set([
  " ", "\t", "-", "_", "/", ".", ":", "(", ")", "[", "]", ",", "…", "·", "\"", "'",
]);

function isWordStart(text: string, at: number): boolean {
  return at === 0 || WORD_BOUNDARY.has(text[at - 1] ?? "");
}

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

export function matchTerm(term: string, text: string): Match {
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
  const gaps = last - first + 1 - needle.length;
  let wordHits = 0;
  for (const h of hits) if (isWordStart(text, h)) wordHits++;
  const score =
    SUBSEQUENCE -
    Math.min(SUBSEQ_GAP_CAP, gaps * 6) -
    Math.min(SUBSEQ_START_CAP, first) +
    Math.min(SUBSEQ_WORD_BONUS_CAP, wordHits * 10);
  return keep(score, mergeRanges(hits.map((h): Range => [h, h + 1])));
}

function splitQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchRanges(query: string, text: string): Range[] {
  const ranges: Range[] = [];
  for (const term of splitQuery(query)) ranges.push(...matchTerm(term, text).ranges);
  return mergeRanges(ranges);
}

export interface SearchableCommand {
  label: string;
  keywords?: string;
  group?: string;
}

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
    if (best <= 0) return 0;
    total += best;
  }
  return total;
}

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

export type QueryPrefix = "#" | "@";

export interface ParsedQuery {
  prefix: QueryPrefix | null;
  term: string;
}

export function parseQuery(raw: string): ParsedQuery {
  const head = raw.slice(0, 1);
  return head === "#" || head === "@"
    ? { prefix: head, term: raw.slice(1) }
    : { prefix: null, term: raw };
}
