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
const CHANGELOG = `${ROOT}CHANGELOG.md`;
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

function renderRelease(version, date, entries) {
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

  if (internal.length || unknown.length) {
    const parts = [];
    if (internal.length) parts.push(`${internal.length} internal`);
    if (unknown.length) parts.push(`${unknown.length} misc`);
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
      if (commit.parsed) return true;
      console.warn(
        `  skipping non-conventional commit: ${commit.subject.slice(0, 70)}`,
      );
      return false;
    });

  const today = new Date().toISOString().slice(0, 10);
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
  const existing = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf8") : "";
  const head = `## ${version} — `;
  const [oldHeader, ...oldSections] = existing.split(/\n(?=## )/);
  const kept = oldSections.filter((s) => !s.startsWith(head));
  const document = [
    header.trimEnd(),
    renderRelease(version, today, entries),
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
    if (existsSync(CHANGELOG) && readFileSync(CHANGELOG, "utf8") === document) {
      console.log("CHANGELOG.md is up to date.");
      return;
    }
    fail("CHANGELOG.md is stale — run: node scripts/generate-changelog.mjs");
  }

  writeFileSync(CHANGELOG, document);
  console.log(
    `Wrote CHANGELOG.md: ${entries.length} commit(s) since ${from ?? "the beginning"} → v${version}.`,
  );
}

build();
