import raw from "../../CHANGELOG.md?raw";

export interface ChangelogEntry {
  text: string;
  scope?: string;
  hash?: string;
  breaking: boolean;
}

export interface ChangelogSection {
  title: string;
  entries: ChangelogEntry[];
}

export interface ChangelogRelease {
  version: string;
  date: string;
  note?: string;
  sections: ChangelogSection[];
}

const HEADING = /^## (\S+)\s*(?:—\s*(.+))?$/;
const SECTION_HEADING = /^###\s+(.+)$/;
const ITEM =
  /^- (?:(\*\*BREAKING\*\*)\s*—\s*)?(?:\*\*([^*]+):\*\*\s*)?(.*?)(?:\s*\(`([0-9a-f]{7,})`\))?$/;

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

    if (line.trim() && !section) prose.push(line.trim());
  }
  closeProse();

  return releases;
}

export const CHANGELOG: ChangelogRelease[] = parseChangelog(raw);

export function currentRelease(
  version: string,
  entries: ChangelogRelease[] = CHANGELOG,
): ChangelogRelease | undefined {
  return entries.find((r) => r.version === version);
}

export function olderReleases(
  version: string,
  entries: ChangelogRelease[] = CHANGELOG,
): ChangelogRelease[] {
  const index = entries.findIndex((r) => r.version === version);
  return index === -1 ? entries : entries.slice(index + 1);
}

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
