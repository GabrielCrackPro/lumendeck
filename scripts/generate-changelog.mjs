#!/usr/bin/env node
// Generates CHANGELOG.md from conventional commits.
//
// Why this exists: the release pipeline's changelog was a GitHub Action that
// only ever produced a release *body*, matched categories to PR labels this
// repo does not use, and threw away commit scopes. That left no file to read
// in the repo, nothing for the app to display, and release notes padded with
// CI noise nobody wants to read.
//
// Usage:
//   node scripts/generate-changelog.mjs                 # write CHANGELOG.md
//   node scripts/generate-changelog.mjs --since v0.2.6  # one range
//   node scripts/generate-changelog.mjs --stdout        # print, write nothing
//   node scripts/generate-changelog.mjs --release-notes # just this version
//   node scripts/generate-changelog.mjs --check         # exit 1 if stale

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CHANGELOG_NAME = "CHANGELOG.md";
const CHANGELOG = `${ROOT}${CHANGELOG_NAME}`;
const NOTES_DIR = `${ROOT}.github/changelog-notes`;

// Conventional-commit types, split by whether a user would care. Internal
// types still count toward the summary line so nothing is silently lost.
const SECTIONS = [
  { title: "Added", types: ["feat"], user: true },
  { title: "Changed", types: ["refactor", "style"], user: true },
  { title: "Fixed", types: ["fix"], user: true },
  { title: "Performance", types: ["perf"], user: true },
  { title: "Internal", types: ["chore", "ci", "build", "docs", "test"], user: false },
];
const KNOWN_TYPES = new Set(SECTIONS.flatMap((s) => s.types));

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 << 20 });
}

function fail(message) {
  console.error(`generate-changelog: ${message}`);
  process.exit(1);
}

/** Commits newest-first, one per record, with NUL separators. */
function readCommits(from) {
  const range = from ? [`${from}..HEAD`] : [];
  const format = ["%H%x00%s%x00%b%x00%aI%x00%cI%x1e"].join("");
  let out;
  try {
    out = git(["log", ...range, `--format=${format}`]);
  } catch (e) {
    fail(`git log failed (${e.message.trim()})`);
  }
  return out
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, subject, body = "", authored = "", committed = ""] =
        record.split("\x00");
      return { hash, subject, body, authored, committed };
    });
}

/**
 * Commits in the range that touched `path`. Asked separately because
 * `git log --name-only` interleaves the file list with the next record's
 * fields, which is not worth parsing.
 */
function commitsTouching(path, from) {
  const range = from ? [`${from}..HEAD`] : [];
  let out = "";
  try {
    out = git(["log", ...range, "--format=%H", "--", path]);
  } catch {
    return new Set();
  }
  return new Set(
    out
      .split("\n")
      .map((h) => h.trim())
      .filter(Boolean),
  );
}

/** `fix(tray): show one icon` -> { type: "fix", scope: "tray", text: "..." } */
function parseSubject(subject) {
  const match = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject.trim());
  if (!match) return null;
  const [, type, scope, breaking, text] = match;
  return {
    type: type.toLowerCase(),
    scope: scope || null,
    breaking: Boolean(breaking),
    text: text.trim(),
  };
}

function versionFromTag(tag) {
  return tag.replace(/^v/, "");
}

function tagsDescending() {
  let out = "";
  try {
    out = git(["tag", "--list", "v*", "--sort=-v:refname"]);
  } catch {
    return [];
  }
  return out.split("\n").map((t) => t.trim()).filter(Boolean);
}

function shortHash(hash) {
  return hash.slice(0, 7);
}

/** True when a commit type earns a line in the notes a user reads. */
function isUserFacing(type) {
  return SECTIONS.find((s) => s.types.includes(type))?.user === true;
}

/**
 * The date a release earns: when its commits landed, not when the script
 * happened to run. Wall-clock time would rewrite the file on every run and
 * make `--check` fail on CI every day after the commit.
 */
function releaseDate() {
  try {
    const committed = git(["log", "-1", "--format=%cI"]).trim();
    if (committed) return committed.slice(0, 10);
  } catch {
    // fall through to the wall clock
  }
  return new Date().toISOString().slice(0, 10);
}

/**
 * Normalize line endings. CI checks out on windows-latest with autocrlf, so
 * the file on disk arrives CRLF while the generator emits LF — comparing
 * them raw would report a correct changelog as stale on every run.
 */
function normalize(text) {
  return text.replace(/\r\n?/g, "\n");
}

/** Commit hashes the file already lists. */
function listedHashes(document) {
  return new Set(
    [...document.matchAll(/\(`([0-9a-f]{7,})`\)/g)].map((m) => m[1]),
  );
}

/** Extra prose a human wrote for a version, if any. */
function notesFor(version) {
  const path = `${NOTES_DIR}/${version}.md`;
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8").trim();
  return text || null;
}

function formatEntry(entry) {
  const scope = entry.parsed.scope ? `**${entry.parsed.scope}:** ` : "";
  const breaking = entry.parsed.breaking ? "**BREAKING** — " : "";
  return `- ${breaking}${scope}${entry.parsed.text} (\`${shortHash(entry.hash)}\`)`;
}

/** Section title -> a conventional type that renders under it. Carried lines
 *  arrive as finished markdown from an earlier run, so they need a type only
 *  to land back in the same heading. */
const SECTION_TYPE = {
  Added: "feat",
  Changed: "refactor",
  Fixed: "fix",
  Performance: "perf",
  Internal: "chore",
};

/**
 * Entries the file already lists under this version, so regenerating adds to
 * the section instead of replacing it.
 *
 * The old behaviour rebuilt the current version's section purely from
 * `<newest tag>..HEAD`. That is only correct while the newest tag by *version
 * string* is also the boundary of this release — and here it is not: tags run
 * to v0.2.22 while the app is 0.2.7, so `v0.2.22..HEAD` excludes commits that
 * genuinely belong to 0.2.7 and the next run deleted three real release
 * notes. Merging keeps the promise in the comment below: a note that was
 * written once is never dropped, whatever the tag situation looks like.
 */
function carryForward(section) {
  const carried = [];
  let counts = { internal: 0, misc: 0 };
  let type = "feat";
  for (const line of section.split("\n")) {
    const heading = line.match(/^### (.+)$/);
    if (heading) {
      type = SECTION_TYPE[heading[1]] ?? "feat";
      continue;
    }
    const bullet = line.match(/^- (.*) \(`([0-9a-f]{7,})`\)$/);
    if (bullet) {
      carried.push({
        hash: bullet[2],
        carried: true,
        parsed: { type, text: bullet[1], scope: null, breaking: false },
      });
      continue;
    }
    // Internal commits are summarised as a count rather than listed, so the
    // count is the only record of them that exists.
    const summary = line.match(/^_(\d+) (internal|misc)/);
    if (summary) counts[summary[2]] = Number(summary[1]);
  }
  return { carried, counts };
}

function renderRelease(version, date, entries, carriedCounts = { internal: 0, misc: 0 }) {
  const lines = [`## ${version} — ${date}`];

  const prose = notesFor(version);
  if (prose) lines.push("", prose);

  const userEntries = entries.filter((e) =>
    SECTIONS.find((s) => s.types.includes(e.parsed.type))?.user,
  );
  const internal = entries.filter(
    (e) => !SECTIONS.find((s) => s.types.includes(e.parsed.type))?.user,
  );
  // Commit types the table does not know about would otherwise vanish.
  const unknown = entries.filter((e) => !KNOWN_TYPES.has(e.parsed.type));

  for (const section of SECTIONS) {
    if (!section.user) continue;
    const group = userEntries.filter((e) => section.types.includes(e.parsed.type));
    if (group.length === 0) continue;
    lines.push("", `### ${section.title}`, ...group.map(formatEntry));
  }

  const internalTotal = internal.length + carriedCounts.internal;
  const miscTotal = unknown.length + carriedCounts.misc;
  if (internalTotal || miscTotal) {
    const parts = [];
    if (internalTotal) parts.push(`${internalTotal} internal`);
    if (miscTotal) parts.push(`${miscTotal} misc`);
    lines.push("", `_${parts.join(", ")}._`);
  }

  if (entries.length === 0) {
    lines.push("", "_No user-facing changes._");
  }

  return lines.join("\n");
}

function build() {
  const stdout = process.argv.includes("--stdout");
  const check = process.argv.includes("--check");
  const releaseNotes = process.argv.includes("--release-notes");
  const sinceIndex = process.argv.indexOf("--since");
  const since = sinceIndex !== -1 ? process.argv[sinceIndex + 1] : null;
  if (sinceIndex !== -1 && !since) fail("--since needs a tag");

  const version = JSON.parse(
    readFileSync(`${ROOT}src-tauri/tauri.conf.json`, "utf8"),
  ).version;

  // Everything since the newest tag already on the repo is unreleased. With
  // an explicit --since, that range wins (used to backfill a single release).
  const allTags = tagsDescending();
  const from = since ?? allTags[0];
  const entries = readCommits(from)
    .map((commit) => ({ ...commit, parsed: parseSubject(commit.subject) }))
    .filter((commit) => {
      if (!commit.parsed) {
        console.warn(
          `  skipping non-conventional commit: ${commit.subject.slice(0, 70)}`,
        );
        return false;
      }
      // The release job commits the four version files back to main after it
      // publishes, so the repository is never behind the tag it just made. That
      // commit lands *after* the tag, which would put it in the next release's
      // range and make `--check` fail on the following push: the file on disk
      // could not contain an entry for a commit whose hash did not exist when it
      // was written. A commit that records a version is not a change worth a
      // line, so it is not listed.
      if (commit.parsed.type === "chore" && commit.parsed.scope === "release") {
        return false;
      }
      return true;
    });

  const today = releaseDate();
  const header = [
    "# Changelog",
    "",
    "Generated by `node scripts/generate-changelog.mjs` from conventional",
    "commits. Add a version's prose in `.github/changelog-notes/<version>.md`",
    "and it lands under that release's heading.",
    "",
  ].join("\n");

  // Rebuild the file: the current version's section is regenerated, older
  // sections are carried over untouched, so running this with no new commits
  // is a no-op and no release note is ever silently dropped.
  const existing = existsSync(CHANGELOG)
    ? normalize(readFileSync(CHANGELOG, "utf8"))
    : "";
  const head = `## ${version} — `;
  const [oldHeader, ...oldSections] = existing.split(/\n(?=## )/);
  const kept = oldSections.filter((s) => !s.startsWith(head));
  const current = oldSections.find((s) => s.startsWith(head)) ?? "";
  // New commits first (newest at the top), then everything the section
  // already listed that this range did not rediscover. Re-running is stable:
  // the second pass finds its own output and produces the same file.
  const { carried, counts } = carryForward(current);
  // Bullets carry the short hash while git gives the full one, so the
  // comparison has to be in the same units.
  const fresh = new Set(entries.map((e) => shortHash(e.hash)));
  const document = [
    header.trimEnd(),
    renderRelease(
      version,
      today,
      [...entries, ...carried.filter((e) => !fresh.has(e.hash))],
      counts,
    ),
    ...kept,
  ]
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");

  if (stdout) {
    console.log(document);
    return;
  }
  // The GitHub release body: this version's section only, so a release does
  // not reprint the project's whole history.
  if (releaseNotes) {
    const [, section = ""] = document.split(/\n(?=## )/);
    console.log(section.trim());
    return;
  }
  if (check) {
    // The rule: every *user-facing* commit since the last release is listed
    // in the file, except commits that are themselves changelog bookkeeping.
    // A commit that edits CHANGELOG.md can never appear in its own contents,
    // so demanding it would make the check unpassable the moment it is fixed.
    // Internal types are excluded too: they collapse into a count, so there
    // is no entry line to carry their hash.
    //
    // Hashes are compared rather than the whole document, so a differently
    // stamped date, a CRLF checkout, or a reworded summary line cannot turn
    // a correct changelog into a red build.
    if (!existsSync(CHANGELOG)) {
      fail("CHANGELOG.md is missing — run: node scripts/generate-changelog.mjs");
    }
    const present = listedHashes(normalize(readFileSync(CHANGELOG, "utf8")));
    const bookkeeping = commitsTouching(CHANGELOG_NAME, from);
    const missing = entries
      .filter((e) => isUserFacing(e.parsed.type) && !bookkeeping.has(e.hash))
      .map((e) => shortHash(e.hash))
      .filter((hash) => !present.has(hash));
    if (missing.length > 0) {
      console.error(
        `generate-changelog: CHANGELOG.md is missing ${missing.length} commit(s):`,
      );
      for (const hash of missing) console.error(`  ${hash}`);
      fail("run: node scripts/generate-changelog.mjs");
    }
    console.log(
      `CHANGELOG.md is up to date (${entries.length} commit(s) since ${from ?? "the beginning"}).`,
    );
    return;
  }

  writeFileSync(CHANGELOG, document);
  console.log(
    `Wrote CHANGELOG.md: ${entries.length} commit(s) since ${from ?? "the beginning"} → v${version}.`,
  );
}

build();
