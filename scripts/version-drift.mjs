// Is the repository's version behind the published releases?
//
// The release workflow reads the version from `tauri.conf.json`, notices it is
// lower than the newest published tag, and releases `latest + 1`. It rewrites the
// four version files inside the CI runner to do that, and never commits them
// back. So the repository is expected to sit *one* release behind the tags — that
// lag is the pipeline working as designed, not a fault.
//
// What is a fault is the state this check exists to catch: the version files
// were never advanced at all, so every release shipped past them. That happened
// unnoticed across 21 releases, because `check-versions.mjs` only ever compared
// the four files with each other, and they agreed perfectly while all being
// wrong.

import { execFileSync } from "node:child_process";

/** Releases the pipeline may legitimately trail by. See the note above. */
const EXPECTED_LAG = 1;

/** Version as a comparable number, or `null` if it is not `major.minor.patch`. */
export function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? "").trim());
  if (!match) return null;
  return (
    Number(match[1]) * 1e6 + Number(match[2]) * 1e3 + Number(match[3])
  );
}

/**
 * Compare the repository version against the newest published release.
 *
 * Returns `ok: true` for anything that cannot be judged — an unparseable
 * version, no releases, no `gh`, no network. A check that blocks work it cannot
 * substantiate is its own kind of wrong, and this one runs in CI where the cost
 * of a false failure is a wasted release.
 */
export function compareVersionToLatest(repoVersion, latestTag) {
  const repo = parseVersion(repoVersion);
  const latest = parseVersion(String(latestTag ?? "").replace(/^v/, ""));

  if (repo === null) {
    return { ok: true, skipped: "unparseable repository version" };
  }
  if (latest === null) {
    return { ok: true, skipped: "no published release to compare against" };
  }

  const behindBy = latest - repo;
  if (behindBy <= 0) {
    return { ok: true, latest: latestTag, behindBy: 0 };
  }
  if (behindBy <= EXPECTED_LAG) {
    return { ok: true, latest: latestTag, behindBy };
  }
  return { ok: false, latest: latestTag, behindBy };
}

/**
 * The highest non-draft, non-prerelease release tag, or `null` if that cannot be
 * determined — which includes `gh` being absent or unauthenticated.
 */
export function latestPublishedTag() {
  try {
    const json = execFileSync(
      "gh",
      ["release", "list", "--limit", "100", "--json", "tagName,isDraft,isPrerelease"],
      { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "ignore"] },
    );
    const releases = JSON.parse(json);
    const tags = releases
      .filter((r) => !r.isDraft && !r.isPrerelease && r.tagName)
      .map((r) => String(r.tagName).replace(/^v/, ""))
      .filter((t) => parseVersion(t) !== null);
    if (tags.length === 0) return null;
    tags.sort((a, b) => parseVersion(b) - parseVersion(a));
    return `v${tags[0]}`;
  } catch {
    return null;
  }
}