import { describe, expect, it } from "vitest";
import {
  isStale,
  partitionByFreshness,
  sameStamp,
  type FileStamp,
  type MeasuredAt,
} from "./indexStamps";

const stamp = (mtimeMs: number, size: number): FileStamp => ({ mtimeMs, size });
const measured = (mtimeMs: number, size: number): MeasuredAt => ({ mtimeMs, size });

describe("sameStamp", () => {
  it("matches when both size and mtime agree", () => {
    expect(sameStamp(measured(100, 5), stamp(100, 5))).toBe(true);
  });

  it("rejects a changed mtime even at the same size", () => {
    // The re-encode case that motivated all of this: same path, same byte
    // count by coincidence, different content.
    expect(sameStamp(measured(100, 5), stamp(200, 5))).toBe(false);
  });

  it("rejects a changed size at the same mtime", () => {
    expect(sameStamp(measured(100, 5), stamp(100, 9))).toBe(false);
  });

  it("treats a missing side as not matching", () => {
    expect(sameStamp(undefined, stamp(100, 5))).toBe(false);
    expect(sameStamp(measured(100, 5), undefined)).toBe(false);
    expect(sameStamp(undefined, undefined)).toBe(false);
  });
});

describe("isStale", () => {
  it("an entry that was never measured needs a probe", () => {
    expect(isStale(false, undefined, stamp(100, 5))).toBe(true);
  });

  it("an entry measured against the current file is fresh", () => {
    expect(isStale(true, measured(100, 5), stamp(100, 5))).toBe(false);
  });

  it("an entry measured against a different file is stale", () => {
    expect(isStale(true, measured(100, 5), stamp(200, 9))).toBe(true);
  });

  it("a measurement with no recorded stamp is stale, not trusted", () => {
    // A cache written before this feature existed has no stamp. Assuming it is
    // current would keep every stale number forever, which is the bug.
    expect(isStale(true, undefined, stamp(100, 5))).toBe(true);
  });

  it("a missing file is not stale, because there is nothing to probe", () => {
    // Otherwise one deleted file keeps the index permanently "not ready" and
    // the minimum-resolution control never reappears.
    expect(isStale(false, undefined, undefined)).toBe(false);
    expect(isStale(true, measured(100, 5), undefined)).toBe(false);
  });
});

describe("partitionByFreshness", () => {
  const ids = ["a", "b", "c", "d"];

  it("sorts entries into pending, fresh and missing", () => {
    const measuredMap: Record<string, boolean> = { a: true, b: true, c: true, d: false };
    const stamps: Record<string, MeasuredAt> = {
      a: measured(100, 5), // unchanged
      b: measured(100, 5), // file replaced
      c: measured(100, 5), // unchanged
    };
    const current = {
      a: stamp(100, 5),
      b: stamp(999, 7),
      c: stamp(100, 5),
      // d has no stamp: its file is gone, so there is nothing to probe
    };

    const out = partitionByFreshness(ids, measuredMap, (id) => stamps[id], current);
    expect(out.pending).toEqual(["b"]);
    expect(out.fresh).toBe(2);
    expect(out.missing).toBe(1);
  });

  it("a never-measured entry whose file is gone is missing, not pending", () => {
    // d above is unmeasured. Probing it would fail forever and the progress
    // bar would never finish, so "no file" has to win over "no measurement".
    const out = partitionByFreshness(["d"], { d: false }, () => undefined, {});
    expect(out.pending).toEqual([]);
    expect(out.missing).toBe(1);
  });

  it("counts an unmeasured entry as pending", () => {
    const out = partitionByFreshness(["x"], {}, () => undefined, { x: stamp(1, 1) });
    expect(out.pending).toEqual(["x"]);
    expect(out.fresh).toBe(0);
    expect(out.missing).toBe(0);
  });

  it("handles an empty vault without claiming anything is ready", () => {
    const out = partitionByFreshness([], {}, () => undefined, {});
    expect(out.pending).toEqual([]);
    expect(out.fresh).toBe(0);
    expect(out.missing).toBe(0);
  });

  it("preserves vault order in the pending list", () => {
    // The list drives the order of progress messages, so it should follow the
    // vault rather than the map's iteration order.
    const measuredMap: Record<string, boolean> = { z: true, m: true, a: true };
    const out = partitionByFreshness(
      ["z", "m", "a"],
      measuredMap,
      () => measured(1, 1),
      { z: stamp(2, 2), m: stamp(2, 2), a: stamp(2, 2) },
    );
    expect(out.pending).toEqual(["z", "m", "a"]);
  });

  it("a vault of only missing files reports nothing pending", () => {
    // The whole vault deleted. Probing would fail on every entry forever and
    // the progress bar would never reach 100%.
    const out = partitionByFreshness(
      ["a", "b"],
      { a: true, b: true },
      () => measured(1, 1),
      {},
    );
    expect(out.pending).toEqual([]);
    expect(out.missing).toBe(2);
  });
});
