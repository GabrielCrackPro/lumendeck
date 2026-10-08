import { describe, expect, it } from "vitest";
import {
  anchorIsVisible,
  applyClick,
  clearSelection,
  emptySelection,
  pruneSelection,
  selectAll,
  selectAllState,
  selectOne,
  spanBetween,
  type Selection,
} from "./selection";

const IDS = ["a", "b", "c", "d", "e"];
const set = (...ids: string[]) => new Set(ids);
const list = (s: ReadonlySet<string>) => [...s];
const sel = (...ids: string[]): Selection =>
  ids.length ? { selected: set(...ids), anchor: ids[0] ?? null } : emptySelection();
const selFrom = (anchor: string | null, ...ids: string[]): Selection => ({
  selected: set(...ids),
  anchor,
});

describe("selectOne", () => {
  it("selects exactly one entry and anchors on it", () => {
    const s = selectOne("c");
    expect(list(s.selected)).toEqual(["c"]);
    expect(s.anchor).toBe("c");
  });

  it("discards a previous selection", () => {
    const next = applyClick(sel("a", "b"), IDS, "d", {});
    expect(list(next.selected)).toEqual(["d"]);
  });
});

describe("spanBetween", () => {
  it("spans forwards and includes both ends", () => {
    expect(spanBetween(IDS, "b", "d")).toEqual(["b", "c", "d"]);
  });

  it("spans backwards when the target is above the anchor", () => {
    expect(spanBetween(IDS, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("is a single tile when anchor and target agree", () => {
    expect(spanBetween(IDS, "c", "c")).toEqual(["c"]);
  });

  it("returns null when the anchor is not on screen", () => {
    expect(spanBetween(IDS, "z", "c")).toBeNull();
    expect(spanBetween(IDS, "c", "z")).toBeNull();
  });

  it("follows the order it is given, not the order of the ids", () => {
    expect(spanBetween(["e", "d", "c", "b", "a"], "e", "c")).toEqual(["e", "d", "c"]);
  });
});

describe("plain click", () => {
  it("replaces the selection with the clicked tile", () => {
    const s = applyClick(sel("a", "b", "c"), IDS, "d", {});
    expect(list(s.selected)).toEqual(["d"]);
    expect(s.anchor).toBe("d");
  });

  it("keeps the tile selected when it is clicked again", () => {
    const s = applyClick(sel("c"), IDS, "c", {});
    expect(list(s.selected)).toEqual(["c"]);
  });
});

describe("ctrl-click", () => {
  it("adds an unselected tile", () => {
    const s = applyClick(sel("a"), IDS, "c", { ctrl: true });
    expect(list(s.selected)).toEqual(["a", "c"]);
  });

  it("removes a selected tile", () => {
    const s = applyClick(sel("a", "b", "c"), IDS, "b", { ctrl: true });
    expect(list(s.selected)).toEqual(["a", "c"]);
  });

  it("moves the anchor so a following shift-click spans from it", () => {
    const s = applyClick(sel("a"), IDS, "c", { ctrl: true });
    expect(s.anchor).toBe("c");
    const next = applyClick(s, IDS, "e", { shift: true });
    expect(list(next.selected)).toEqual(["c", "d", "e"]);
  });

  it("can empty the selection entirely", () => {
    const s = applyClick(sel("a"), IDS, "a", { ctrl: true });
    expect(s.selected.size).toBe(0);
    expect(s.anchor).toBe("a");
  });
});

describe("shift-click", () => {
  it("REPLACES the selection with the run", () => {
    const s = applyClick(selFrom("b", "a"), IDS, "e", { shift: true });
    expect(list(s.selected)).toEqual(["b", "c", "d", "e"]);
  });

  it("drops tiles that fall outside the new run", () => {
    const s = applyClick(selFrom("b", "a", "e"), IDS, "d", { shift: true });
    expect(list(s.selected)).toEqual(["b", "c", "d"]);
  });

  it("keeps the anchor so a second drag re-spans and can shrink", () => {
    let s = applyClick(sel(), IDS, "b", { shift: true });
    expect(s.anchor).toBe("b");
    s = applyClick(s, IDS, "e", { shift: true });
    expect(list(s.selected)).toEqual(["b", "c", "d", "e"]);
    s = applyClick(s, IDS, "c", { shift: true });
    expect(list(s.selected)).toEqual(["b", "c"]);
  });

  it("spans backwards too", () => {
    const s = applyClick(sel(), IDS, "d", { shift: true });
    const next = applyClick(s, IDS, "b", { shift: true });
    expect(list(next.selected)).toEqual(["b", "c", "d"]);
  });

  it("adds the run under ctrl+shift rather than replacing", () => {
    const s = applyClick(selFrom("b", "a", "e"), IDS, "d", { shift: true, ctrl: true });
    expect(list(s.selected)).toEqual(["a", "e", "b", "c", "d"]);
  });

  it("falls back to a plain select when there is no anchor", () => {
    const s = applyClick(emptySelection(), IDS, "c", { shift: true });
    expect(list(s.selected)).toEqual(["c"]);
  });

  it("adopts the clicked tile as anchor when the old one scrolled off", () => {
    const page = ["d", "e"];
    const s = applyClick(sel("a", "b"), page, "e", { shift: true });
    expect(list(s.selected)).toEqual(["e"]);
    expect(s.anchor).toBe("e");
    const next = applyClick(s, page, "d", { shift: true });
    expect(list(next.selected)).toEqual(["d", "e"]);
  });

  it("does not span past the end of a paged visible list", () => {
    const page = IDS.slice(0, 3);
    const s = applyClick(emptySelection(), page, "a", {});
    const next = applyClick(s, page, "c", { shift: true });
    expect(list(next.selected)).toEqual(["a", "b", "c"]);
  });
});

describe("selectAll", () => {
  it("selects everything visible and anchors on the first", () => {
    const s = selectAll(IDS, true);
    expect(list(s.selected)).toEqual(IDS);
    expect(s.anchor).toBe("a");
  });

  it("clears the selection absolutely when asked to untick", () => {
    const s = selectAll(IDS, false);
    expect(s.selected.size).toBe(0);
    expect(s.anchor).toBeNull();
  });

  it("selects only what is visible, not the whole vault", () => {
    const s = selectAll(["a", "b"], true);
    expect(list(s.selected)).toEqual(["a", "b"]);
  });

  it("is a no-op on an empty grid", () => {
    const s = selectAll([], true);
    expect(s.selected.size).toBe(0);
    expect(s.anchor).toBeNull();
  });
});

describe("selectAllState", () => {
  it("is none when nothing is selected", () => {
    expect(selectAllState(set(), IDS)).toBe("none");
  });

  it("is all when every visible id is selected", () => {
    expect(selectAllState(set(...IDS), IDS)).toBe("all");
  });

  it("is some when only part is selected", () => {
    expect(selectAllState(set("a"), IDS)).toBe("some");
  });

  it("ignores selections that are not visible", () => {
    expect(selectAllState(set("a", "b", "z"), ["a", "b"])).toBe("all");
    expect(selectAllState(set("z"), ["a", "b"])).toBe("none");
  });

  it("is none, not all, for an empty grid", () => {
    expect(selectAllState(set(), [])).toBe("none");
    expect(selectAllState(set("a"), [])).toBe("none");
  });
});

describe("pruneSelection", () => {
  it("drops selected ids that are gone", () => {
    const s = pruneSelection(sel("a", "b", "c"), ["b", "c"]);
    expect(list(s.selected)).toEqual(["b", "c"]);
  });

  it("keeps the anchor when it survived", () => {
    expect(pruneSelection(sel("a", "b"), ["a", "b"]).anchor).toBe("a");
  });

  it("drops the anchor when its entry is gone", () => {
    expect(pruneSelection(sel("a", "b"), ["b"]).anchor).toBeNull();
  });

  it("leaves an already-null anchor null", () => {
    expect(pruneSelection(emptySelection(), ["a"]).anchor).toBeNull();
  });
});

describe("clearSelection", () => {
  it("empties the selection and forgets the anchor", () => {
    const s = clearSelection();
    expect(s.selected.size).toBe(0);
    expect(s.anchor).toBeNull();
  });

  it("makes a following shift-click a plain select", () => {
    const cleared = clearSelection();
    const s = applyClick(cleared, IDS, "c", { shift: true });
    expect(list(s.selected)).toEqual(["c"]);
  });
});

describe("anchorIsVisible", () => {
  it("is true only for an anchor on screen", () => {
    expect(anchorIsVisible(IDS, "c")).toBe(true);
    expect(anchorIsVisible(IDS, "z")).toBe(false);
    expect(anchorIsVisible(IDS, null)).toBe(false);
  });
});
