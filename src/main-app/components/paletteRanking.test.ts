import { describe, expect, it } from "vitest";
import { rankPaletteCommands, selectPalettePool } from "./paletteRanking";

const pools = {
  commands: ["commands"],
  wallpapers: ["wallpapers"],
  scenes: ["scenes"],
  rgb: ["rgb"],
  actions: ["actions"],
};

describe("selectPalettePool", () => {
  it("uses actions first, then the active submenu", () => {
    expect(selectPalettePool(pools, { actionsOpen: true, submenu: "wallpapers", prefix: "@" })).toBe(pools.actions);
    expect(selectPalettePool(pools, { actionsOpen: false, submenu: "wallpapers", prefix: "@" })).toBe(pools.wallpapers);
    expect(selectPalettePool(pools, { actionsOpen: false, submenu: "scenes", prefix: "#" })).toBe(pools.scenes);
    expect(selectPalettePool(pools, { actionsOpen: false, submenu: "rgb", prefix: null })).toBe(pools.rgb);
  });

  it("uses root-only prefixes to select wallpaper or scene pools", () => {
    expect(selectPalettePool(pools, { actionsOpen: false, submenu: null, prefix: "#" })).toBe(pools.wallpapers);
    expect(selectPalettePool(pools, { actionsOpen: false, submenu: null, prefix: "@" })).toBe(pools.scenes);
    expect(selectPalettePool(pools, { actionsOpen: false, submenu: null, prefix: null })).toBe(pools.commands);
  });
});

const commands = [
  { id: "weak", label: "Set wallpaper", group: "wallpaper", keywords: "background" },
  { id: "strong", label: "Wallpaper settings", group: "wallpaper", keywords: "" },
  { id: "hidden", label: "Other", group: "rgb", keywords: "wallpaper" },
];
const defaults = {
  term: "wallpaper",
  currentTab: null,
  pinned: [] as string[],
  frecency: {},
  now: 100,
  groupLabel: (group: string) => group,
  actionsOpen: false,
};

describe("rankPaletteCommands", () => {
  it("ranks exact keyword, prefix and word-start hits while highlighting labels only", () => {
    const result = rankPaletteCommands(commands, defaults);
    expect(result.items.map(({ c }) => c.id)).toEqual(["hidden", "weak", "strong"]);
    expect(result.items[0]?.ranges).toEqual([]);
    expect(result.items[1]?.ranges).toEqual([[4, 13]]);
    expect(result.items[2]?.ranges).toEqual([[0, 9]]);
    expect(result.total).toBe(3);
  });

  it("uses current-section context to reorder close word-start matches", () => {
    const candidates = [
      { id: "near", label: "12345 wave", group: "rgb" },
      { id: "far", label: "123456789012345 wave", group: "wallpaper" },
    ];
    const rank = (currentTab: string | null) =>
      rankPaletteCommands(candidates, {
        ...defaults,
        term: "wave",
        currentTab,
        groupLabel: () => "unmatched group",
      });
    expect(rank(null).items.map(({ c }) => c.id)).toEqual(["near", "far"]);
    expect(rank("wallpaper").items.map(({ c }) => c.id)).toEqual(["far", "near"]);
  });

  it("caps matching rows but retains the uncapped result count", () => {
    const many = Array.from({ length: 15 }, (_, index) => ({
      id: `item-${index}`,
      label: `wallpaper ${index}`,
      group: "wallpaper",
    }));
    const result = rankPaletteCommands(many, defaults);
    expect(result.items).toHaveLength(12);
    expect(result.total).toBe(15);
  });

  it("orders an idle list by pins, recency, then original order", () => {
    const result = rankPaletteCommands(commands, {
      ...defaults,
      term: "",
      pinned: ["weak"],
      frecency: {
        hidden: { s: 2, t: 100 },
        strong: { s: 1, t: 100 },
      },
    });
    expect(result.items.map(({ c }) => c.id)).toEqual(["weak", "hidden", "strong"]);
    expect(result.total).toBe(3);
  });

  it("uses pin ties but ignores run history for an idle actions list", () => {
    const actions = [
      { id: "act-run", label: "Run", group: "action" },
      { id: "act-pin", label: "Pin", group: "action" },
      { id: "act-goto", label: "Go to", group: "action" },
    ];
    const result = rankPaletteCommands(actions, {
      ...defaults,
      term: "",
      actionsOpen: true,
      pinned: ["act-goto"],
      frecency: { "act-pin": { s: 99, t: 100 } },
    });
    expect(result.items.map(({ c }) => c.id)).toEqual(["act-goto", "act-run", "act-pin"]);
  });
});
