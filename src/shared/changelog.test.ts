import { describe, expect, it } from "vitest";
import {
  CHANGELOG,
  currentRelease,
  olderReleases,
  parseChangelog,
  releaseToMarkdown,
} from "./changelog";

const SAMPLE = `# Changelog

Some header prose that is not a release.

## 0.2.7 — 2026-09-28

Quiet login starts, explained once.

### Added
- start in the tray at login (\`b2aa8c4\`)
- add a Ctrl+K command palette (\`54bb92f\`)

### Fixed
- keep the desktop background consistent for video wallpapers (\`e1e8786\`)

_1 internal._

## 0.2.6 — 2026-09-20

### Added
- **BREAKING** — **tray:** rework the tray menu
`;

describe("parseChangelog", () => {
  it("reads versions, dates, sections and entries", () => {
    const releases = parseChangelog(SAMPLE);
    expect(releases).toHaveLength(2);
    expect(releases[0]!.version).toBe("0.2.7");
    expect(releases[0]!.date).toBe("2026-09-28");
    expect(releases[0]!.sections.map((s) => s.title)).toEqual(["Added", "Fixed"]);
    expect(releases[0]!.sections[0]!.entries).toHaveLength(2);
  });

  it("keeps the hash and drops the markup around it", () => {
    const entry = parseChangelog(SAMPLE)[0]!.sections[0]!.entries[0]!;
    expect(entry).toEqual({
      text: "start in the tray at login",
      scope: undefined,
      hash: "b2aa8c4",
      breaking: false,
    });
  });

  it("reads scope and breaking markers", () => {
    const entry = parseChangelog(SAMPLE)[1]!.sections[0]!.entries[0]!;
    expect(entry.scope).toBe("tray");
    expect(entry.breaking).toBe(true);
    expect(entry.text).toBe("rework the tray menu");
    expect(entry.hash).toBeUndefined();
  });

  it("captures per-release prose but not the file header", () => {
    const releases = parseChangelog(SAMPLE);
    expect(releases[0]!.note).toBe("Quiet login starts, explained once.");
    expect(releases[1]!.note).toBeUndefined();
  });

  it("ignores the internal-count footer and blank lines", () => {
    const release = parseChangelog(SAMPLE)[0]!;
    expect(release.sections.every((s) => s.title !== "_1 internal._")).toBe(true);
    expect(release.sections.flatMap((s) => s.entries)).toHaveLength(3);
  });

  it("survives junk without throwing", () => {
    expect(parseChangelog("")).toEqual([]);
    expect(parseChangelog("not a changelog at all")).toEqual([]);
    expect(parseChangelog("## 0.1.0\n### Added\n")).toHaveLength(1);
  });
});

describe("the bundled changelog", () => {
  it("parses into at least one release with content", () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    expect(CHANGELOG[0]!.sections.length).toBeGreaterThan(0);
  });
});

describe("lookup", () => {
  const releases = parseChangelog(SAMPLE);

  it("finds the running version and everything older", () => {
    expect(currentRelease("0.2.7", releases)?.version).toBe("0.2.7");
    expect(olderReleases("0.2.7", releases).map((r) => r.version)).toEqual([
      "0.2.6",
    ]);
  });

  it("treats an unknown version as the newest", () => {
    expect(currentRelease("9.9.9", releases)).toBeUndefined();
    expect(olderReleases("9.9.9", releases)).toHaveLength(2);
  });

  it("resolves the running build against the bundled changelog", () => {
    // The app looks this up on every boot; it must not throw or miss.
    expect(() => currentRelease(__APP_VERSION__)).not.toThrow();
  });
});

describe("releaseToMarkdown", () => {
  it("round-trips back through the parser", () => {
    const release = parseChangelog(SAMPLE)[0]!;
    const again = parseChangelog(releaseToMarkdown(release))[0]!;
    expect(again.version).toBe(release.version);
    expect(again.note).toBe(release.note);
    expect(again.sections).toEqual(release.sections);
  });
});
