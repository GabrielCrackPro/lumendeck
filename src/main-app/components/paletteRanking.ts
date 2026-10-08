import { withContextBoost } from "./paletteActions";
import { rankFrecency, type FrecencyStore } from "./paletteFrecency";
import { matchRanges, scoreCommand, withPinnedRecents, type QueryPrefix } from "./paletteScore";

export type PaletteSubmenu = "wallpapers" | "scenes" | "rgb";

const RESULT_CAP = 12;

export interface PalettePools<T> {
  commands: readonly T[];
  wallpapers: readonly T[];
  scenes: readonly T[];
  rgb: readonly T[];
  actions: readonly T[];
}

export function selectPalettePool<T>(
  pools: PalettePools<T>,
  state: { actionsOpen: boolean; submenu: PaletteSubmenu | null; prefix: QueryPrefix | null },
): readonly T[] {
  if (state.actionsOpen) return pools.actions;
  if (state.submenu === "wallpapers") return pools.wallpapers;
  if (state.submenu === "scenes") return pools.scenes;
  if (state.submenu === "rgb") return pools.rgb;
  if (state.prefix === "#") return pools.wallpapers;
  if (state.prefix === "@") return pools.scenes;
  return pools.commands;
}

export interface RankableCommand {
  id: string;
  label: string;
  group: string;
  keywords?: string;
}

export interface PaletteRankOptions {
  term: string;
  currentTab: string | null;
  pinned: readonly string[];
  frecency: FrecencyStore;
  now: number;
  groupLabel: (group: string) => string;
  actionsOpen: boolean;
}

export function rankPaletteCommands<T extends RankableCommand>(
  pool: readonly T[],
  options: PaletteRankOptions,
) {
  const pinRank = (id: string) => {
    const at = options.pinned.indexOf(id);
    return at === -1 ? options.pinned.length : at;
  };
  const scored = pool
    .map((c) => ({
      c,
      score: withContextBoost(
        scoreCommand(options.term, {
          label: c.label,
          keywords: c.keywords,
          group: options.groupLabel(c.group),
        }),
        c.group,
        options.currentTab,
      ),
      ranges: options.term ? matchRanges(options.term, c.label) : [],
    }))
    .filter((item) => item.score > 0);
  scored.sort((a, b) => b.score - a.score || pinRank(a.c.id) - pinRank(b.c.id));

  if (options.term) {
    const total = scored.length;
    return { items: scored.slice(0, RESULT_CAP), total };
  }
  if (options.actionsOpen) return { items: scored, total: scored.length };

  const items = withPinnedRecents(
    scored,
    options.pinned,
    rankFrecency(options.frecency, options.now),
    (item) => item.c.id,
  );
  return { items, total: items.length };
}
