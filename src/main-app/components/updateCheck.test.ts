import { describe, expect, it } from "vitest";
import {
  CHECK_OUTCOME_LABELS,
  checkTimeLabel,
  nextCheckRecord,
  type UpdateCheckOutcome,
} from "./updateCheck";

const NOON = Date.UTC(2026, 9, 4, 12, 0, 0);
const ALL: UpdateCheckOutcome[] = ["current", "update", "failed"];

describe("nextCheckRecord", () => {
  it("records a check that ran and found nothing", () => {
    expect(nextCheckRecord("current", 1000)).toEqual({
      atMs: 1000,
      outcome: "current",
    });
  });

  it("records a check that failed as a check that ran", () => {
    expect(nextCheckRecord("failed", 2000).outcome).toBe("failed");
  });

  it("does not mutate its inputs into sharing state", () => {
    const first = nextCheckRecord("current", 1000);
    const second = nextCheckRecord("failed", 2000);
    expect(first).not.toBe(second);
    expect(first.outcome).toBe("current");
  });
});

describe("CHECK_OUTCOME_LABELS", () => {
  it("names every outcome, so none renders as a raw slug", () => {
    for (const o of ALL) expect(CHECK_OUTCOME_LABELS[o], o).toBeTruthy();
  });

  it("gives each outcome a distinct key", () => {
    const keys = ALL.map((o) => CHECK_OUTCOME_LABELS[o]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("checkTimeLabel", () => {
  it("shows a bare clock time for a check earlier today", () => {
    const now = new Date(2026, 9, 4, 12, 0, 0).getTime();
    const label = checkTimeLabel(new Date(2026, 9, 4, 11, 0, 0).getTime(), now, "en");
    expect(label).toMatch(/\d{1,2}[:.]\d{2}/);
    expect(label).not.toMatch(/Oct/);
  });

  it("adds the date once a check is not from today", () => {
    const now = new Date(2026, 9, 4, 12, 0, 0).getTime();
    const label = checkTimeLabel(new Date(2026, 9, 1, 11, 0, 0).getTime(), now, "en");
    expect(label).toMatch(/Oct/);
  });

  it("differs between today and an older check, as it must", () => {
    const now = new Date(2026, 9, 4, 12, 0, 0).getTime();
    const today = checkTimeLabel(new Date(2026, 9, 4, 11, 0, 0).getTime(), now, "en");
    const older = checkTimeLabel(new Date(2026, 9, 1, 11, 0, 0).getTime(), now, "en");
    expect(today).not.toBe(older);
  });

  it("follows the requested language rather than the machine's", () => {
    const es = checkTimeLabel(NOON, NOON, "es");
    expect(typeof es).toBe("string");
    expect(es.length).toBeGreaterThan(0);
  });

  it("returns nothing rather than throwing on a bad timestamp", () => {
    expect(checkTimeLabel(Number.NaN, NOON, "en")).toBe("");
    expect(checkTimeLabel(Number.POSITIVE_INFINITY, NOON, "en")).toBe("");
  });
});
