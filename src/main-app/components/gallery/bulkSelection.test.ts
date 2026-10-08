import { describe, expect, it } from "vitest";
import {
  bulkApplyPlan,
  bulkRemovePlan,
  removableIds,
  restoreEntries,
  type Removable,
} from "./bulkSelection";

interface E extends Removable {
  name: string;
}

const e = (id: string, addedMs: number, name = id): E => ({ id, addedMs, name });

const VAULT: E[] = [
  e("old", 100, "alpha"),
  e("new", 900, "beta"),
  e("mid", 500, "gamma"),
  e("other", 700, "delta"),
];

const set = (...ids: string[]) => new Set(ids);

describe("bulkApplyPlan", () => {
  it("applies nothing for an empty selection", () => {
    expect(bulkApplyPlan(VAULT, set())).toEqual({ apply: null, collapsed: 0 });
  });

  it("applies only the newest, not every selected wallpaper", () => {
    const plan = bulkApplyPlan(VAULT, set("old", "mid", "new"));
    expect(plan.apply?.id).toBe("new");
    expect(plan.collapsed).toBe(3);
  });

  it("counts what it collapsed, so the toast can say so honestly", () => {
    expect(bulkApplyPlan(VAULT, set("old")).collapsed).toBe(1);
  });

  it("reaches the same wallpaper however the selection was built", () => {
    const forward = bulkApplyPlan(VAULT, set("mid", "old"));
    const backward = bulkApplyPlan(VAULT, set("old", "mid"));
    expect(forward.apply?.id).toBe(backward.apply?.id);
  });

  it("orders by age, not by array position", () => {
    const shuffled = [VAULT[2]!, VAULT[0]!, VAULT[1]!, VAULT[3]!];
    expect(bulkApplyPlan(shuffled, set("old", "new"))?.apply?.id).toBe(
      bulkApplyPlan(VAULT, set("old", "new"))?.apply?.id,
    );
  });

  it("breaks an age tie by id, so the result is stable", () => {
    const tied = [e("b", 100), e("a", 100)];
    expect(bulkApplyPlan(tied, set("a", "b")).apply?.id).toBe("b");
  });

  it("ignores selected ids that are not in the vault", () => {
    const plan = bulkApplyPlan(VAULT, set("new", "ghost"));
    expect(plan.apply?.id).toBe("new");
    expect(plan.collapsed).toBe(1);
  });

  it("does not mutate the list it was given", () => {
    const order = [...VAULT];
    bulkApplyPlan(VAULT, set("old", "new"));
    expect(VAULT.map((x) => x.id)).toEqual(order.map((x) => x.id));
  });
});

describe("bulkRemovePlan", () => {
  it("removes every selected entry, unlike the apply", () => {
    expect(bulkRemovePlan(VAULT, set("old", "mid", "new")).map((x) => x.id)).toEqual([
      "old",
      "mid",
      "new",
    ]);
  });

  it("is empty for an empty selection", () => {
    expect(bulkRemovePlan(VAULT, set())).toEqual([]);
  });

  it("skips ids the vault no longer has", () => {
    expect(bulkRemovePlan(VAULT, set("ghost", "old")).map((x) => x.id)).toEqual(["old"]);
  });

  it("names each entry once", () => {
    const dupe = [e("a", 1), e("a", 1), e("b", 2)];
    expect(removableIds(dupe, set("a", "b"))).toEqual(["a", "b"]);
  });
});

describe("restoreEntries", () => {
  it("puts every removed entry back in one call", () => {
    const removed = bulkRemovePlan(VAULT, set("old", "mid"));
    const restored = restoreEntries(VAULT.filter((x) => x.id === "new"), removed);
    expect(restored.map((x) => x.id)).toEqual(["new", "old", "mid"]);
  });

  it("returns the same array when there is nothing to restore", () => {
    const vault = [...VAULT];
    expect(restoreEntries(vault, [])).toBe(vault);
  });

  it("does not mutate its input", () => {
    const vault = [...VAULT];
    restoreEntries(vault, bulkRemovePlan(VAULT, set("old")));
    expect(vault.map((x) => x.id)).toEqual(["old", "new", "mid", "other"]);
  });

  it("restores the original entries, not copies of them", () => {
    const removed = bulkRemovePlan(VAULT, set("mid"));
    expect(restoreEntries([], removed)[0]).toBe(VAULT[2]);
  });
});