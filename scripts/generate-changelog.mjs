#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CHANGELOG_NAME = "CHANGELOG.md";
const CHANGELOG = `${ROOT}${CHANGELOG_NAME}`;
const NOTES_DIR = `${ROOT}.github/changelog-notes`;

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

function isUserFacing(type) {
  return SECTIONS.find((s) => s.types.includes(type))?.user === true;
}

function releaseDate() {
  try {
    const committed = git(["log", "-1", "--format=%cI"]).trim();
    if (committed) return committed.slice(0, 10);
  } catch {
    // fall through to the wall clock
  }
  return new Date().toISOString().slice(0, 10);
}

function normalize(text) {
  return text.replace(/\r\n?/g, "\n");
}

function listedHashes(document) {
  return new Set(
    [...document.matchAll(/\(`([0-9a-f]{7,})`\)/g)].map((m) => m[1]),
  );
}

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

const SECTION_TYPE = {
  Added: "feat",
  Changed: "refactor",
  Fixed: "fix",
  Performance: "perf",
  Internal: "chore",
};

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
  const commit = process.argv.includes("--commit");
  const releaseNotes = process.argv.includes("--release-notes");
  const sinceIndex = process.argv.indexOf("--since");
  const since = sinceIndex !== -1 ? process.argv[sinceIndex + 1] : null;
  if (sinceIndex !== -1 && !since) fail("--since needs a tag");

  const version = JSON.parse(
    readFileSync(`${ROOT}src-tauri/tauri.conf.json`, "utf8"),
  ).version;

  const allTags = tagsDescending();
  const from = since ?? allTags[0];
  const bookkeeping = commitsTouching(CHANGELOG_NAME, from);
  const entries = readCommits(from)
    .map((commit) => ({ ...commit, parsed: parseSubject(commit.subject) }))
    .filter((commit) => {
      if (!commit.parsed) {
        console.warn(
          `  skipping non-conventional commit: ${commit.subject.slice(0, 70)}`,
        );
        return false;
      }
      return !bookkeeping.has(commit.hash);
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

  const existing = existsSync(CHANGELOG)
    ? normalize(readFileSync(CHANGELOG, "utf8"))
    : "";
  const head = `## ${version} — `;
  const [oldHeader, ...oldSections] = existing.split(/\n(?=## )/);
  const kept = oldSections.filter((s) => !s.startsWith(head));
  const current = oldSections.find((s) => s.startsWith(head)) ?? "";
  const { carried, counts } = carryForward(current);
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
  if (releaseNotes) {
    const [, section = ""] = document.split(/\n(?=## )/);
    console.log(section.trim());
    return;
  }
  if (check) {
    if (!existsSync(CHANGELOG)) {
      fail("CHANGELOG.md is missing — run: node scripts/generate-changelog.mjs");
    }
    const present = listedHashes(normalize(readFileSync(CHANGELOG, "utf8")));
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

  if (!commit) return;

  if (!git(["diff", "--numstat", "--", CHANGELOG_NAME]).trim()) {
    console.log("CHANGELOG.md already matches; nothing to commit.");
    return;
  }
  execFileSync(
    "git",
    [
      "commit",
      "--quiet",
      "-m",
      `chore(changelog): release notes for v${version}\n\nGenerated with Codebuff`,
      "--",
      CHANGELOG_NAME,
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  console.log(`Committed the release notes for v${version}.`);
}

build();
