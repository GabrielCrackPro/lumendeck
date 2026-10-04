import { describe, expect, it } from "vitest";
import {
  DIGEST_ORDER,
  notableCounts,
  plainEntry,
  releaseDigest,
  restCounts,
} from "./releaseDigest";

// The real shape, copied from `generate-changelog.mjs --release-notes` output for
// 0.2.34. Taken from the file rather than invented, because the parser's whole
// job is to survive what that script emits.
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
    // The scope identifies the change to someone reading CHANGELOG.md. In a
    // one-line toast "transfer: move a setup" is a stutter, not information.
    expect(plainEntry("- **transfer:** move a setup (`72c7e2d`)")).toBe(
      "move a setup",
    );
  });

  it("keeps a bolded word that is not a scope", () => {
    // Matched on the colon-inside-bold form only, so an entry that opens with a
    // bolded term keeps it.
    expect(plainEntry("- **Note:** run the installer first (`1122334`)")).toBe(
      "Note: run the installer first",
    );
  });

  it("drops the trailing commit hash", () => {
    expect(plainEntry("- **i18n:** read a key map (`2af44e5`)")).not.toContain("2af44e5");
  });

  it("keeps the words the hash sat between", () => {
    // The failure this guards: a strip that eats the tail of the line leaves a
    // headline reading "one concept for a setup," with no verb.
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
    // The BREAKING marker is reported as a separate flag, so keeping it here
    // would make it the whole headline for a breaking entry.
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
    // `_3 internal._` is prose wrapped in underscores, and counting it would
    // inflate every release by the number of chores in it.
    expect(releaseDigest(RELEASE_BODY).total).toBe(3);
    expect(releaseDigest(RELEASE_BODY).userFacing).toBe(3);
  });

  it("leads with the first user-facing entry, flattened", () => {
    expect(releaseDigest(RELEASE_BODY).headline).toBe(
      "move a setup between machines, media included",
    );
  });

  it("remembers which section the headline came from", () => {
    // So the counts can discount the headline instead of counting it twice.
    expect(releaseDigest(RELEASE_BODY).headlineSection).toBe("added");
    expect(releaseDigest("_4 internal._").headlineSection).toBeNull();
  });

  it("returns an empty digest for a missing body", () => {
    // A release cut before the changelog was generated has notes but nothing to
    // say; the toast still needs a version and a restart button.
    for (const body of [null, undefined, "", "   \n  "]) {
      const d = releaseDigest(body);
      expect(d.counts).toEqual({});
      expect(d.headline).toBeNull();
      expect(d.total).toBe(0);
    }
  });

  it("ignores prose above the first section heading", () => {
    // `.github/changelog-notes/<version>.md` can carry a hand-written intro.
    // It is not a change, so it must not become a count or a headline.
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
    // Nothing to show but chores: the toast should say so rather than lead with
    // "chore: bump a lockfile".
    const d = releaseDigest(
      ["### Internal", "- **chore:** bump a lockfile (`99aa11b`)"].join("\n"),
    );
    expect(d.headline).toBeNull();
    expect(d.userFacing).toBe(0);
    expect(d.total).toBe(1);
  });

  it("takes only the first version heading", () => {
    // The workflow appends the whole file for some paths; a card must not claim
    // to be about two releases at once.
    const d = releaseDigest(["## 0.2.34 — 2026-10-04", "## 0.2.33 — 2026-10-03"].join("\n"));
    expect(d.version).toBe("0.2.34");
  });

  it("survives a body that is not changelog markdown at all", () => {
    // The updater reads whatever the release happens to carry. Nothing here
    // should throw.
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
    // "4 internal" tells a user nothing they can act on.
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
    // Otherwise the toast reads "move a setup between machines, plus 2 added",
    // counting the line the user is already reading.
    expect(restCounts(releaseDigest(RELEASE_BODY))).toEqual([["added", 1], ["fixed", 1]]);
  });

  it("is empty for a release that was a single change", () => {
    const d = releaseDigest(["### Added", "- one thing (`1`)"].join("\n"));
    expect(notableCounts(d)).toEqual([["added", 1]]);
    expect(restCounts(d)).toEqual([]);
  });

  it("equals notableCounts when there is no headline", () => {
    // Only internal churn: there is no headline to discount, so the counts stand
    // on their own.
    const d = releaseDigest(["### Internal", "- a (`1`)", "- b (`2`)"].join("\n"));
    expect(restCounts(d)).toEqual([]);
  });
});