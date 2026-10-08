import { describe, expect, it } from "vitest";
import {
  DIGEST_ORDER,
  notableCounts,
  plainEntry,
  releaseDigest,
  restCounts,
} from "./releaseDigest";

const RELEASE_BODY = [
  "## 0.2.34 — 2026-10-04",
  "",
  "### Added",
  "- **transfer:** move a setup between machines, media included (`72c7e2d`)",
  "- **profiles:** one concept for a setup, reachable from the header (`4953441`)",
  "",
  "### Fixed",
  "- **i18n:** read a key map that contains a placeholder (`2af44e5`)",
  "",
  "_3 internal._",
].join("\n");

describe("plainEntry", () => {
  it("drops the conventional-commit scope", () => {
    expect(plainEntry("- **transfer:** move a setup (`72c7e2d`)")).toBe(
      "move a setup",
    );
  });

  it("keeps a bolded word that is not a scope", () => {
    expect(plainEntry("- **Note:** run the installer first (`1122334`)")).toBe(
      "Note: run the installer first",
    );
  });

  it("drops the trailing commit hash", () => {
    expect(plainEntry("- **i18n:** read a key map (`2af44e5`)")).not.toContain("2af44e5");
  });

  it("keeps the words the hash sat between", () => {
    expect(plainEntry("- **profiles:** one concept for a setup (`4953441`)")).toBe(
      "one concept for a setup",
    );
  });

  it("flattens a link to its label", () => {
    expect(plainEntry("- see [the docs](https://example.com/x) for more")).toBe(
      "see the docs for more",
    );
  });

  it("leaves no markdown punctuation behind", () => {
    const out = plainEntry("- **BREAKING** — **rgb:** the engine restarts (`abc1234`)");
    expect(out).not.toMatch(/[*`]/);
    expect(out).not.toContain("BREAKING");
    expect(out).not.toContain("rgb:");
    expect(out).toBe("the engine restarts");
  });

  it("returns an empty string for nothing", () => {
    expect(plainEntry("- **`abc1234`**")).toBe("");
  });
});

describe("releaseDigest", () => {
  it("reads the version out of the heading", () => {
    expect(releaseDigest(RELEASE_BODY).version).toBe("0.2.34");
  });

  it("counts entries per section", () => {
    expect(releaseDigest(RELEASE_BODY).counts).toEqual({ added: 2, fixed: 1 });
  });

  it("does not count the internal footer as a change", () => {
    expect(releaseDigest(RELEASE_BODY).total).toBe(3);
    expect(releaseDigest(RELEASE_BODY).userFacing).toBe(3);
  });

  it("leads with the first user-facing entry, flattened", () => {
    expect(releaseDigest(RELEASE_BODY).headline).toBe(
      "move a setup between machines, media included",
    );
  });

  it("remembers which section the headline came from", () => {
    expect(releaseDigest(RELEASE_BODY).headlineSection).toBe("added");
    expect(releaseDigest("_4 internal._").headlineSection).toBeNull();
  });

  it("returns an empty digest for a missing body", () => {
    for (const body of [null, undefined, "", "   \n  "]) {
      const d = releaseDigest(body);
      expect(d.counts).toEqual({});
      expect(d.headline).toBeNull();
      expect(d.total).toBe(0);
    }
  });

  it("ignores prose above the first section heading", () => {
    const d = releaseDigest(
      ["A hand-written introduction.", "", "### Fixed", "- **ui:** a thing (`aa1b2c3`)"].join("\n"),
    );
    expect(d.headline).toBe("a thing");
    expect(d.total).toBe(1);
  });

  it("notices a breaking change", () => {
    const d = releaseDigest(
      ["### Changed", "- **BREAKING** — **config:** the shape moved (`bb11cc2`)"].join("\n"),
    );
    expect(d.breaking).toBe(true);
  });

  it("reports no breaking change for an ordinary release", () => {
    expect(releaseDigest(RELEASE_BODY).breaking).toBe(false);
  });

  it("ignores a bullet with no section above it", () => {
    const d = releaseDigest(["## 0.2.34", "- **orphan:** no section (`11aa22b`)"].join("\n"));
    expect(d.total).toBe(0);
    expect(d.headline).toBeNull();
  });

  it("handles a release with only internal churn", () => {
    const d = releaseDigest(
      ["### Internal", "- **chore:** bump a lockfile (`99aa11b`)"].join("\n"),
    );
    expect(d.headline).toBeNull();
    expect(d.userFacing).toBe(0);
    expect(d.total).toBe(1);
  });

  it("takes only the first version heading", () => {
    const d = releaseDigest(["## 0.2.34 — 2026-10-04", "## 0.2.33 — 2026-10-03"].join("\n"));
    expect(d.version).toBe("0.2.34");
  });

  it("survives a body that is not changelog markdown at all", () => {
    const d = releaseDigest("<p>hello</p>\r\nrandom text\n\n- not a section\n");
    expect(d.total).toBe(0);
    expect(d.headline).toBeNull();
  });
});

describe("notableCounts", () => {
  it("lists sections in reading order", () => {
    const d = releaseDigest(
      ["### Fixed", "- a (`1`) ", "### Added", "- b (`2`)", "- c (`3`)"].join("\n"),
    );
    expect(notableCounts(d).map(([k]) => k)).toEqual(["added", "fixed"]);
  });

  it("omits internal", () => {
    const d = releaseDigest(
      ["### Internal", "- a (`1`)", "- b (`2`)", "### Fixed", "- c (`3`)"].join("\n"),
    );
    expect(notableCounts(d).map(([k]) => k)).not.toContain("internal");
  });

  it("is empty when nothing notable happened", () => {
    expect(notableCounts(releaseDigest(null))).toEqual([]);
  });

  it("covers every orderable section", () => {
    expect(DIGEST_ORDER).toContain("added");
    expect(DIGEST_ORDER).toContain("fixed");
  });
});

describe("restCounts", () => {
  it("discounts the entry already used as the headline", () => {
    expect(restCounts(releaseDigest(RELEASE_BODY))).toEqual([["added", 1], ["fixed", 1]]);
  });

  it("is empty for a release that was a single change", () => {
    const d = releaseDigest(["### Added", "- one thing (`1`)"].join("\n"));
    expect(notableCounts(d)).toEqual([["added", 1]]);
    expect(restCounts(d)).toEqual([]);
  });

  it("equals notableCounts when there is no headline", () => {
    const d = releaseDigest(["### Internal", "- a (`1`)", "- b (`2`)"].join("\n"));
    expect(restCounts(d)).toEqual([]);
  });
});