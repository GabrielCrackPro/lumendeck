import { describe, expect, it } from "vitest";
import { compareVersionToLatest, parseVersion } from "./version-drift.mjs";

describe("parseVersion", () => {
  it("orders by major, then minor, then patch", () => {
    expect(parseVersion("0.2.10")).toBeGreaterThan(parseVersion("0.2.9"));
    expect(parseVersion("1.0.0")).toBeGreaterThan(parseVersion("0.99.99"));
    expect(parseVersion("0.3.0")).toBeGreaterThan(parseVersion("0.2.99"));
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseVersion(" 0.2.8 ")).toBe(parseVersion("0.2.8"));
  });

  it("rejects anything that is not major.minor.patch", () => {
    expect(parseVersion("0.2")).toBeNull();
    expect(parseVersion("0.2.8-rc.1")).toBeNull();
    expect(parseVersion("v0.2.8")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });
});

describe("compareVersionToLatest", () => {
  it("passes when the repository matches the newest release", () => {
    const result = compareVersionToLatest("0.2.28", "v0.2.28");
    expect(result.ok).toBe(true);
    expect(result.behindBy).toBe(0);
  });

  it("passes when the repository is exactly one release behind", () => {
    const result = compareVersionToLatest("0.2.28", "v0.2.29");
    expect(result.ok).toBe(true);
    expect(result.behindBy).toBe(1);
  });

  it("passes when the repository is ahead of the newest release", () => {
    const result = compareVersionToLatest("0.3.0", "v0.2.28");
    expect(result.ok).toBe(true);
  });

  it("fails when the repository is two releases behind", () => {
    const result = compareVersionToLatest("0.2.7", "v0.2.28");
    expect(result.ok).toBe(false);
    expect(result.behindBy).toBe(21);
    expect(result.latest).toBe("v0.2.28");
  });

  it("fails across a minor boundary, not just a patch one", () => {
    const result = compareVersionToLatest("0.2.9", "v1.0.0");
    expect(result.ok).toBe(false);
  });

  it("does not block on values it cannot judge", () => {
    expect(compareVersionToLatest("0.2.7", null).ok).toBe(true);
    expect(compareVersionToLatest("not-a-version", "v0.2.28").ok).toBe(true);
    expect(compareVersionToLatest("0.2.7", "nightly").ok).toBe(true);
  });

  it("explains why it skipped rather than passing silently", () => {
    expect(compareVersionToLatest("0.2.7", null).skipped).toBeTruthy();
    expect(compareVersionToLatest("0.2.7", "v0.2.28").skipped).toBeUndefined();
  });
});