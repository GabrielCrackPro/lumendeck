import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHECK_MINUTES,
  effectiveInterval,
  intervalChoices,
  MANUAL_ONLY_MINUTES,
  intervalLabelKey,
  MAX_CHECK_MINUTES,
  MIN_CHECK_MINUTES,
  RECHECK_MS,
  recheckMsFor,
  shouldAnnounce,
  summaryFor,
  UPDATE_INTERVAL_MINUTES,
} from "./updater";

// Real output from `generate-changelog.mjs --release-notes`, because the whole
// job of this module is surviving what that script actually prints.
const BODY = [
  "## 0.2.34 — 2026-10-04",
  "",
  "### Added",
  "- **updater:** watch for releases while the app runs (`a1b2c3d`)",
  "",
  "### Fixed",
  "- **rgb:** dead halo on the preview strip (`d4e5f6a`)",
  "- **overview:** blank thumbnail for a corrupt file (`1122334`)",
  "",
  "_2 internal._",
].join("\n");

describe("recheckMsFor", () => {
  it("uses the configured interval", () => {
    expect(recheckMsFor(30)).toBe(30 * 60_000);
  });

  it("reports no interval at all when set to manual only", () => {
    // null and not 0 on purpose: `setInterval(fn, 0)` fires as fast as the event
    // loop allows, so "off" arriving as a number is a request to hammer the
    // release endpoint.
    expect(recheckMsFor(MANUAL_ONLY_MINUTES)).toBeNull();
  });

  it("falls back to the default when there is nothing to go on", () => {
    // Negative and nonsense are not the manual choice; only an explicit zero is.
    for (const v of [undefined, null, -5, NaN, Infinity]) {
      expect(recheckMsFor(v)).toBe(RECHECK_MS);
    }
  });

  it("clamps a hand-edited interval nobody sane would set", () => {
    // config.json is editable JSON. A `1` here would mean sixty requests an
    // hour against the release endpoint, from a user who never asked for it.
    expect(recheckMsFor(1)).toBe(MIN_CHECK_MINUTES * 60_000);
    expect(recheckMsFor(60 * 24 * 30)).toBe(MAX_CHECK_MINUTES * 60_000);
  });

  it("keeps a deliberate choice below the default", () => {
    // The floor preserves the intent of anyone asking to hear sooner than hourly.
    expect(recheckMsFor(MIN_CHECK_MINUTES)).toBe(MIN_CHECK_MINUTES * 60_000);
    expect(recheckMsFor(MIN_CHECK_MINUTES)).toBeLessThan(RECHECK_MS);
  });

  it("agrees with the bounds the dropdown sits next to", () => {
    // If one of these moves, the other has to: an option the watcher would clamp
    // is an option that lies.
    expect(MIN_CHECK_MINUTES).toBe(15);
    expect(MAX_CHECK_MINUTES).toBe(1440);
  });
});

describe("intervalChoices", () => {
  it("offers the standard intervals in ascending order", () => {
    expect(intervalChoices(60)).toEqual([0, 30, 60, 360, 1440]);
  });

  it("offers no interval the watcher would clamp", () => {
    // The failure this guards: an option outside the bounds is a value the user
    // picks and the watcher then silently discards. Manual-only is the one entry
    // that is not a duration at all, so it is checked against `recheckMsFor`
    // rather than against the bounds.
    for (const m of UPDATE_INTERVAL_MINUTES) {
      if (m === MANUAL_ONLY_MINUTES) {
        expect(recheckMsFor(m)).toBeNull();
        continue;
      }
      expect(m).toBeGreaterThanOrEqual(MIN_CHECK_MINUTES);
      expect(m).toBeLessThanOrEqual(MAX_CHECK_MINUTES);
      expect(recheckMsFor(m)).toBe(m * 60_000);
    }
  });

  it("keeps a value an older build could have stored", () => {
    // The setting was a slider once, so configs hold values like 45 that match
    // no option. Dropping it would show an empty field and then rewrite the
    // user's cadence on the next save.
    expect(intervalChoices(45)).toContain(45);
    expect(intervalChoices(45)).toEqual([0, 30, 45, 60, 360, 1440]);
  });

  it("does not list a standard interval twice", () => {
    expect(intervalChoices(60).filter((m) => m === 60)).toHaveLength(1);
  });

  it("falls back to the default for a value that means nothing", () => {
    // The blank-field bug: `value` had to be one of the rendered options, and a
    // config holding a nonsense value matched no row.
    for (const v of [undefined, null, -5, Number.NaN]) {
      expect(effectiveInterval(v)).toBe(DEFAULT_CHECK_MINUTES);
      expect(intervalChoices(effectiveInterval(v))).toContain(effectiveInterval(v));
    }
  });

  it("keeps manual-only as the value shown, not an hour", () => {
    // The control must say what is actually running. Replacing 0 with the
    // default would have shown "Every hour" for an app that never checks.
    expect(effectiveInterval(MANUAL_ONLY_MINUTES)).toBe(MANUAL_ONLY_MINUTES);
    expect(intervalChoices(MANUAL_ONLY_MINUTES)).toContain(MANUAL_ONLY_MINUTES);
  });

  it("clamps an out-of-range value to the end of the scale, not the default", () => {
    // The watcher honours 5000 as 24 hours, so the setting has to say 24 hours.
    // Reporting the default here would have the dropdown claiming a cadence
    // that never runs.
    expect(effectiveInterval(5000)).toBe(MAX_CHECK_MINUTES);
    expect(effectiveInterval(1)).toBe(MIN_CHECK_MINUTES);
    // A fractional hand-edit is a real value below the floor, so both the
    // watcher and the display round it up rather than discarding it.
    expect(effectiveInterval(12.5)).toBe(MIN_CHECK_MINUTES);
  });

  it("keeps a real value, standard or not", () => {
    expect(effectiveInterval(60)).toBe(60);
    expect(effectiveInterval(45)).toBe(45);
    expect(effectiveInterval(15)).toBe(MIN_CHECK_MINUTES);
    expect(effectiveInterval(1440)).toBe(MAX_CHECK_MINUTES);
  });

  it("shows the value the watcher is actually using", () => {
    // The setting must not claim a cadence the watcher replaced.
    for (const v of [-5, 5000, 1, undefined, 45, 60]) {
      expect(recheckMsFor(v)).toBe(effectiveInterval(v) * 60_000);
    }
  });

  it("always shows an interval the dropdown can render", () => {
    // The blank-field case, closed: whatever the config holds, the displayed
    // value is one of the options.
    for (const v of [0, -5, 5000, 1, 12.5, undefined, 45, 60, 1440, 15, 180, 720]) {
      const shown = effectiveInterval(v);
      expect(intervalChoices(v).map(String), String(v)).toContain(String(shown));
    }
  });

  it("ignores a value the watcher would have replaced anyway", () => {
    // 5000 is a hand-edit and 12.5 a fractional one; neither is a cadence worth
    // preserving as its own option.
    for (const v of [undefined, null, -5, 5000, Number.NaN]) {
      expect(intervalChoices(v)).toEqual([...UPDATE_INTERVAL_MINUTES]);
    }
  });

  it("offers the clamped cadence for a value under the floor", () => {
    // 15 was the old slider's floor and is no longer one of the options, so a
    // stored 1 or a fractional 12.5 runs as 15 -- a cadence with no row of its
    // own. Inserting the clamped value rather than the stored one is what keeps
    // the dropdown from rendering blank for a hand-edited config.
    for (const v of [1, 12.5]) {
      const shown = effectiveInterval(v);
      expect(intervalChoices(v), String(v)).toContain(shown);
      expect(intervalChoices(v).map(String)).toContain("15");
    }
  });

  it("still offers an interval a config written by the old slider may hold", () => {
    // Trimming the list must not strand a cadence that is genuinely running.
    // Each of these is no longer an option, but each can be in a stored config,
    // and each has to be named by the control that reports it.
    for (const v of [15, 180, 720, 100]) {
      expect(intervalChoices(v), String(v)).toContain(v);
      expect(intervalLabelKey(v)).toBeTruthy();
    }
  });

  it("labels every interval it offers", () => {
    // A missing label renders an empty row in the dropdown with nothing to
    // click, which reads as a broken control.
    for (const m of intervalChoices(45)) {
      expect(intervalLabelKey(m), String(m)).toBeTruthy();
    }
  });

  it("names a standard interval in words rather than minutes", () => {
    // "Every 60 minutes" next to "Every 3 hours" is the sort of thing that makes
    // a menu look machine-generated.
    expect(intervalLabelKey(60)).toBe("update.every-hour");
    expect(intervalLabelKey(1440)).toBe("update.every-day");
  });

  it("falls back to the counted form for a value off the list", () => {
    expect(intervalLabelKey(45)).toBe("update.every-{n}-minutes");
    expect(intervalLabelKey(47)).toBe("update.every-{n}-minutes");
  });

  it("names the manual-only choice in words", () => {
    // Not "Every 0 minutes", which is what the counted form would produce.
    expect(intervalLabelKey(MANUAL_ONLY_MINUTES)).toBe("update.manual-only");
  });
});

describe("shouldAnnounce", () => {
  it("announces a version it has never shown", () => {
    expect(shouldAnnounce(null, "0.2.34")).toBe(true);
  });

  it("stays quiet about the version it already showed", () => {
    // The whole reason a repeating check is not nagging: an hour later the same
    // update is still uninstalled, and a fresh sticky card every hour is the
    // behaviour a user would report as a bug.
    expect(shouldAnnounce("0.2.34", "0.2.34")).toBe(false);
  });

  it("announces again once a newer version appears", () => {
    expect(shouldAnnounce("0.2.34", "0.2.35")).toBe(true);
  });

  it("announces on request even when it already did", () => {
    // The manual "Check for updates" button. Without this the button silently
    // does nothing whenever the hourly check got there first, with no toast to
    // say why -- the worst kind of regression, because every check passes.
    expect(shouldAnnounce("0.2.34", "0.2.34", true)).toBe(true);
  });

  it("still deduplicates the automatic path when asked twice", () => {
    expect(shouldAnnounce("0.2.34", "0.2.34", false)).toBe(false);
  });
});

describe("summaryFor", () => {
  it("leads with the headline and counts what is left over", () => {
    expect(summaryFor(BODY)).toBe(
      "watch for releases while the app runs, plus 2 fixed",
    );
  });

  it("never shows markdown or a commit hash", () => {
    // The failure being fixed: the toast used to render the raw body, so a card
    // read "## 0.2.34 — 2026-10-04 ### Added - **updater:** ... (a1b2c3d)".
    const out = summaryFor(BODY) ?? "";
    for (const fragment of ["##", "###", "**", "`", "a1b2c3d", "updater:"]) {
      expect(out).not.toContain(fragment);
    }
  });

  it("leads with a breaking change when the release has one", () => {
    const body = [
      "## 0.2.35 — 2026-10-11",
      "",
      "### Changed",
      "- **BREAKING** — **config:** the shape moved (`bb11cc2`)",
      "- **ui:** a smaller button (`cc22dd3`)",
    ].join("\n");
    expect(summaryFor(body)).toBe("Breaking: 1 changed");
  });

  it("says housekeeping when there was nothing user-facing", () => {
    const body = [
      "## 0.2.36 — 2026-10-18",
      "",
      "### Internal",
      "- **chore:** bump a lockfile (`99aabb2`)",
    ].join("\n");
    expect(summaryFor(body)).toBe("Housekeeping only");
  });

  it("returns null for a release with no notes at all", () => {
    // Distinct from "housekeeping": we have not read a changelog, we have none,
    // and claiming the release changed nothing would be a guess.
    for (const body of [null, "", "   \n  "]) {
      expect(summaryFor(body)).toBeNull();
    }
  });

  it("names the sections when there is no headline to lead with", () => {
    // Every entry under an unrecognised heading: counted nowhere, so the digest
    // is empty, but the body is present.
    const body = ["## 0.2.37 — 2026-10-25", "", "A hand-written note."].join("\n");
    expect(summaryFor(body)).toBe("Housekeeping only");
  });
});
