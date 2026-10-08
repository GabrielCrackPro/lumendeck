
export function foldForSearch(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export type RailItem = {
  id: string;
  text: string;
};

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