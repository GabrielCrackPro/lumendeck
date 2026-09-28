// The bundled CHANGELOG.md, parsed into something renderable.
//
// The file is generated (see scripts/generate-changelog.mjs), so this only has
// to understand the subset that generator emits — no markdown library, and no
// dependency that can drift from the format it reads.
import raw from "../../CHANGELOG.md?raw";

export interface ChangelogEntry {
  text: string;
  /** Conventional-commit scope, when the commit had one. */
  scope?: string;
  /** Abbreviated commit hash, for the curious. */
  hash?: string;
  breaking: boolean;
}

export interface ChangelogSection {
  title: string;
  entries: ChangelogEntry[];
}

export interface ChangelogRelease {
  version: string;
  /** ISO date as written by the generator; empty if it could not be read. */
  date: string;
  /** Hand-written prose from .github/changelog-notes, if any. */
  note?: string;
  sections: ChangelogSection[];
}

const HEADING = /^## (\S+)\s*(?:—\s*(.+))?$/;
const SECTION_HEADING = /^###\s+(.+)$/;
// "- **BREAKING** — **scope:** text (`abc1234`)"
const ITEM =
  /^- (?:(\*\*BREAKING\*\*)\s*—\s*)?(?:\*\*([^*]+):\*\*\s*)?(.*?)(?:\s*\(`([0-9a-f]{7,})`\))?$/;

/** Parse a generated changelog. Unparseable input yields an empty list. */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | null = null;
  let section: ChangelogSection | null = null;
  let prose: string[] = [];

  const closeProse = () => {
    if (release && prose.length) release.note = prose.join(" ").trim();
    prose = [];
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    const heading = HEADING.exec(line);
    if (heading) {
      closeProse();
      section = null;
      release = {
        version: heading[1]!,
        date: (heading[2] ?? "").trim(),
        sections: [],
      };
      releases.push(release);
      continue;
    }
    if (!release) continue;

    const sectionHeading = SECTION_HEADING.exec(line);
    if (sectionHeading) {
      section = { title: sectionHeading[1]!.trim(), entries: [] };
      release.sections.push(section);
      continue;
    }

    const item = ITEM.exec(line);
    if (item && section) {
      const [, breaking, scope, text, hash] = item;
      const body = (text ?? "").trim();
      if (!body) continue;
      section.entries.push({
        text: body,
        scope: scope?.trim(),
        hash,
        breaking: Boolean(breaking),
      });
      continue;
    }

    // Anything else that is not a heading or a blank line is prose — the
    // per-version notes file — until the next heading.
    if (line.trim() && !section) prose.push(line.trim());
  }
  closeProse();

  return releases;
}

export const CHANGELOG: ChangelogRelease[] = parseChangelog(raw);

/** The release matching the running build, if the changelog knows it. */
export function currentRelease(
  version: string,
  entries: ChangelogRelease[] = CHANGELOG,
): ChangelogRelease | undefined {
  return entries.find((r) => r.version === version);
}

/** Everything before `version`, newest first. */
export function olderReleases(
  version: string,
  entries: ChangelogRelease[] = CHANGELOG,
): ChangelogRelease[] {
  const index = entries.findIndex((r) => r.version === version);
  return index === -1 ? entries : entries.slice(index + 1);
}

/** Flatten one release back to markdown, for "copy release notes". */
export function releaseToMarkdown(release: ChangelogRelease): string {
  const lines = [`## ${release.version}${release.date ? ` — ${release.date}` : ""}`];
  if (release.note) lines.push("", release.note);
  for (const section of release.sections) {
    if (section.entries.length === 0) continue;
    lines.push("", `### ${section.title}`);
    for (const entry of section.entries) {
      lines.push(
        `- ${entry.breaking ? "**BREAKING** — " : ""}${
          entry.scope ? `**${entry.scope}:** ` : ""
        }${entry.text}${entry.hash ? ` (\`${entry.hash}\`)` : ""}`,
      );
    }
  }
  return lines.join("\n");
}
