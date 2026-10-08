
import { execFileSync } from "node:child_process";

const EXPECTED_LAG = 1;

export function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? "").trim());
  if (!match) return null;
  return (
    Number(match[1]) * 1e6 + Number(match[2]) * 1e3 + Number(match[3])
  );
}

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