// Narrowing the settings section index as you type.
//
// Extracted from `SettingsLayout` for the same reason the gallery's query
// module is separate from its component: the matching rules are the part that
// can be wrong quietly, and they are the part nobody can check by looking.

/**
 * Fold a string for comparison: no case, no accents.
 *
 * The catalog is bilingual and the Spanish labels carry accents — "Vídeo
 * decoding", "Configuración", "Añadir". Folding both sides is what lets
 * someone type `video` or `config` and still find them. A plain `toLowerCase`
 * makes the box look broken in precisely the catalog where typing without
 * accents is most natural, and the failure is invisible unless you happen to
 * try the one word that has one.
 */
export function foldForSearch(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** One index row, with its searchable text already folded. */
export type RailItem = {
  id: string;
  /** Label and blurb concatenated and folded. Built by the caller. */
  text: string;
};

/**
 * The rows to show for `query`.
 *
 * Three rules, each answering a different way this can go wrong:
 *
 * - **Every token has to match, not the whole phrase.** Typing `hot key` finds
 *   "Global hotkeys" the way a person expects a search box to behave, and a
 *   phrase match would find nothing.
 * - **The section you are reading never disappears.** This rail is not a
 *   command palette: it tracks scroll position, so filtering out the row that
 *   is currently highlighted leaves you reading a section with nothing lit up
 *   and no way to tell where you are. Keeping it costs at most one extra row
 *   and keeps the highlight meaningful.
 * - **An empty query returns everything, unfiltered and un-copied.** Not
 *   `[]`, not a fresh array — the caller's list, so clearing the box cannot
 *   cost a re-render of eight rows for nothing.
 */
export function filterRail(
  items: readonly RailItem[],
  query: string,
  activeId: string,
): RailItem[] {
  const tokens = foldForSearch(query).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return items as RailItem[];
  return items.filter(
    (item) => item.id === activeId || tokens.every((tok) => item.text.includes(tok)),
  );
}