
export type SectionKey =
  | "added"
  | "changed"
  | "fixed"
  | "performance"
  | "internal";

export type NotableSection = Exclude<SectionKey, "internal">;

const SECTION_KEYS: Record<string, SectionKey> = {
  Added: "added",
  Changed: "changed",
  Fixed: "fixed",
  Performance: "performance",
  Internal: "internal",
};

export interface ReleaseDigest {
  version: string | null;
  counts: Partial<Record<SectionKey, number>>;
  headline: string | null;
  headlineSection: SectionKey | null;
  breaking: boolean;
  total: number;
  userFacing: number;
}

export function plainEntry(line: string): string {
  return line
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\*\*BREAKING\*\*\s*[\u2014\u2013-]?\s*/i, "")
    .replace(/^\*\*[a-z][^*]{0,39}:\*\*\s*/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s*\(`[0-9a-f]+`\)\s*$/i, "")
    .replace(/^`[0-9a-f]+`$/i, "")
    .replace(/(^|\s)[*_]{1,2}(?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

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

    const heading = line.match(/^##\s+(.+)$/)?.[1];
    if (heading !== undefined) {
      if (digest.version == null) {
        digest.version = heading.split("—")[0]?.split("-")[0]?.trim() || null;
      }
      continue;
    }

    const sub = line.match(/^###\s+(.+)$/)?.[1];
    if (sub !== undefined) {
      section = SECTION_KEYS[sub.trim()] ?? null;
      continue;
    }

    if (/^_.*_$/.test(line)) continue;

    if (!/^[-*]\s+/.test(line)) continue;
    if (section == null) continue;

    const text = plainEntry(line.replace(/^[-*]\s+/, ""));
    if (!text) continue;

    digest.counts[section] = (digest.counts[section] ?? 0) + 1;
    digest.total += 1;
    if (section !== "internal") digest.userFacing += 1;
    if (/\bBREAKING\b/.test(line)) digest.breaking = true;
    if (digest.headline == null && section !== "internal") {
      digest.headline = text;
      digest.headlineSection = section;
    }
  }

  return digest;
}

export const DIGEST_ORDER: readonly NotableSection[] = [
  "added",
  "changed",
  "fixed",
  "performance",
];

export const SECTION_LABELS: Record<NotableSection, string> = {
  added: "update.{n}-added",
  changed: "update.{n}-changed",
  fixed: "update.{n}-fixed",
  performance: "update.{n}-performance",
};

export function notableCounts(
  digest: ReleaseDigest,
): [NotableSection, number][] {
  return DIGEST_ORDER.flatMap((k) =>
    digest.counts[k] ? [[k, digest.counts[k]!] as [NotableSection, number]] : [],
  );
}

export function restCounts(digest: ReleaseDigest): [NotableSection, number][] {
  return notableCounts(digest).flatMap(([k, n]) => {
    if (k === digest.headlineSection) {
      if (n <= 1) return [];
      return [[k, n - 1] as [NotableSection, number]];
    }
    return [[k, n] as [NotableSection, number]];
  });
}