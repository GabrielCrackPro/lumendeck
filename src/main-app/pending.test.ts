import { describe, expect, it } from "vitest";
import { claim, release, NO_PENDING, type PendingState } from "./pending";

describe("claim", () => {
  it("accepts the first press of a control", () => {
    const next = claim(NO_PENDING, "import-url");
    expect(next).not.toBeNull();
    expect(next!.has("import-url")).toBe(true);
  });

  it("refuses a second press of the same control while the first is in flight", () => {
    const first = claim(NO_PENDING, "delete")!;
    expect(claim(first, "delete")).toBeNull();
  });

  it("lets a different control start while another is running", () => {
    const first = claim(NO_PENDING, "import-url")!;
    const second = claim(first, "import-folder");
    expect(second).not.toBeNull();
    expect(second!.has("import-url")).toBe(true);
    expect(second!.has("import-folder")).toBe(true);
  });

  it("in exclusive mode refuses every other key, not just the same one", () => {
    const first = claim(NO_PENDING, "toggle", true)!;
    expect(claim(first, "next", true)).toBeNull();
    expect(claim(first, "toggle", true)).toBeNull();
  });

  it("in exclusive mode allows a fresh press once the first has settled", () => {
    const running = claim(NO_PENDING, "toggle", true)!;
    const settled = release(running, "toggle");
    expect(claim(settled, "next", true)).not.toBeNull();
  });

  it("never mutates the set it was given", () => {
    const before: PendingState = new Set(["a"]);
    claim(before, "b");
    release(before, "a");
    expect(Array.from(before)).toEqual(["a"]);
  });
});

describe("release", () => {
  it("removes only the settled key", () => {
    const both = claim(claim(NO_PENDING, "a")!, "b")!;
    expect(Array.from(release(both, "a"))).toEqual(["b"]);
  });

  it("hands back the same object for a key that was not running", () => {
    const current = claim(NO_PENDING, "a")!;
    expect(release(current, "b")).toBe(current);
  });

  it("empties the set when the last control settles", () => {
    expect(release(claim(NO_PENDING, "a")!, "a").size).toBe(0);
  });

  it("releases exactly once for a key that settles twice", () => {
    const running = claim(NO_PENDING, "a")!;
    const settled = release(running, "a");
    expect(release(settled, "a")).toBe(settled);
  });
});