import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel } from "../dropdownAnchor";
import { IconClose, IconGrid, IconLayers, IconSearch, IconSelectAll, IconSliders, IconSort, IconSparkle, IconStar } from "../icons";
import type { SelectAllState } from "./selection";
import { t } from "../../i18n";
import { GALLERY_KINDS, GALLERY_KIND_LABEL } from "./kindLabels";
import { kindCounts, type GalleryPick, type GalleryQuery, type GallerySort, type SelectContext } from "./galleryQuery";
import { activeFilters, filterBadgeCount } from "./activeFilters";
import { CHIP_H, chipStyle, Dropdown, ICON_BTN, ICON_BTN_ACTIVE, ICON_BTN_IDLE, SelectChip } from "../ui";
import type { GalleryEntry, WallpaperCollection } from "@shared/types";

export interface GalleryToolbarProps {
  query: GalleryQuery;
  onQuery: (patch: Partial<GalleryQuery>) => void;
  entries: GalleryEntry[];
  collections: WallpaperCollection[];
  /** "all" plus one chip per collection. */
  onCollection: (id: string) => void;
  onRenameCollection: (c: WallpaperCollection) => void;
  onDeleteCollection: (c: WallpaperCollection) => void;
  onNewCollection: () => void;
  /** Tile size. */
  density: GalleryDensity;
  onDensity: (d: GalleryDensity) => void;
  /** Whether the select-all control reads empty, mixed or full. */
  selectAllState: SelectAllState;
  /** Ticks or unticks everything the current filter shows. */
  onSelectAll: (want: boolean) => void;
  /**
   * Whether the vault-wide metadata index is usable. The resolution and length
   * sorts and the width floor are all questions about every entry, so they are
   * offered only once something has been measured — otherwise picking one
   * would look like it worked and quietly order by nothing.
   */
  indexReady: boolean;
  indexBuilding: boolean;
  indexProgress: { done: number; total: number } | null;
  onBuildIndex: () => void;
  /** The context kindCounts needs, so the chip numbers cannot disagree. */
  countCtx: SelectContext;
  /** Monitor device names, for the "what is on this display" filter. */
  displays: { device: string; name: string }[];
  /** Entry id being dragged, or null. A collection chip is a drop target only
   *  while one is in flight, so it does not read as accepting anything. */
  draggingId: string | null;
  /** Files an entry onto a collection, from a drop. */
  onDropOnCollection: (collectionId: string) => void;
  /**
   * Rendered at the end of the chip row — the inline form for creating or
   * renaming a collection. It lives with the chips it affects, which is where
   * the native prompt used to stand in for it.
   */
  collectionEditor?: ReactNode;
  /** The import actions, right-aligned in the top row. */
  children?: ReactNode;
  /** Focused by the "/" shortcut and by Escape-to-clear. */
  searchRef?: React.RefObject<HTMLInputElement | null>;
  /**
   * Which surface is below. The collections view is a list of lists, so the
   * search box, the sorts and every filter would be controls that silently do
   * nothing. Only the import actions survive the switch.
   */
  view: "wallpapers" | "collections";
}

const SORTS: { id: GallerySort; label: string }[] = [
  { id: "recent", label: "gallery.sort-recent" },
  { id: "used", label: "gallery.sort-used" },
  { id: "favourites", label: "gallery.sort-favourites" },
  { id: "oldest", label: "gallery.sort-oldest" },
  { id: "name", label: "gallery.sort-name" },
  { id: "kind", label: "gallery.sort-kind" },
  { id: "resolution", label: "gallery.sort-resolution" },
  { id: "length", label: "gallery.sort-length" },
];

/**
 * The quick filters.
 *
 * There is deliberately no "Everything" chip here and no "All collections" chip
 * in the collections row: both used to exist, both meant "no narrowing", and
 * the same panel offered the same state twice. Pressing nothing now *is*
 * "everything", so each chip is a toggle -- pressing the active one clears it.
 *
 * "Uncollected" is a statement about collection membership, so it sits with the
 * collections where it can be read against them, rather than beside the star.
 */
const PICKS: { id: GalleryPick; label: string; icon: ReactNode }[] = [
  { id: "favourites", label: "gallery.favourites", icon: <IconStar className="h-3 w-3" /> },
];

/** Width floors offered by the resolution filter. "Any" is the absence of one. */
const WIDTH_FLOORS = [
  { id: "0", label: "gallery.any-resolution" },
  { id: "1920", label: "gallery.at-least-1080p" },
  { id: "2560", label: "gallery.at-least-1440p" },
  { id: "3840", label: "gallery.at-least-4k" },
];

/** Tile sizes. The column count was eight hardcoded breakpoints, which gives a
 *  maximized 4K window eight columns and a half-width one two, with nothing in
 *  between. */
const DENSITIES = [
  { id: "compact", label: "gallery.density-compact" },
  { id: "cozy", label: "gallery.density-cozy" },
  { id: "large", label: "gallery.density-large" },
];

export type GalleryDensity = (typeof DENSITIES)[number]["id"];

export const DENSITY_CLASS: Record<GalleryDensity, string> = {
  compact: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8 3xl:grid-cols-10 4xl:grid-cols-12",
  cozy: "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 4xl:grid-cols-8",
  large: "grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5 4xl:grid-cols-6",
};

/**
 * Find, order, filter, add. One filter dimension per row.
 *
 * The first attempt wrapped all of this in a bordered panel nested inside the
 * vault Card, which read as a second card and boxed in a surface that is
 * supposed to feel like open space. Nothing here has a border or a background:
 * the rows are defined by their controls, the same way the original vault bar
 * was.
 *
 * The filter chips live behind a toggle rather than a permanent second row.
 * Kind and collection are refinements — you set them once and then look at
 * wallpapers, and eleven chips sitting under every grid is chrome competing
 * with the pictures. The toggle carries a count of what is currently applied,
 * and the row below it names the filters, so a collapsed panel is never
 * ambiguous about why the grid looks short.
 *
 * One filter dimension: a fixed-width label and its chips.
 *
 * The label is what makes the panel readable. Four rows of pills separated by
 * hairlines gave no clue which rule belonged to which dimension, so kind and
 * collection chips looked interchangeable. Fixed width keeps the chip columns
 * aligned between rows, which is what lets you scan down a column to compare
 * dimensions.
 */
function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      {/* 56px fits the longest label ("Quality") at this tracking with a little to
          spare. It started at 80px, which read fine but stole 24px from every
          chip row and made the panel wrap into a taller block than the single
          row it replaced.

          The label is a 26px flex box rather than a `pt-1.5` span so it centres
          on the chip row by construction. A padding nudge was 3px out against a
          26px pill -- measurable, and the reason every row's label sat a hair
          high. */}
      <span className={`kicker ${CHIP_H} flex w-14 shrink-0 items-center justify-end`}>
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

export function GalleryToolbar({
  query,
  onQuery,
  entries,
  collections,
  onCollection,
  onRenameCollection,
  onDeleteCollection,
  onNewCollection,
  density,
  onDensity,
  selectAllState,
  onSelectAll,
  indexReady,
  indexBuilding,
  indexProgress,
  onBuildIndex,
  countCtx,
  displays,
  draggingId,
  onDropOnCollection,
  collectionEditor,
  searchRef,
  children,
  view,
}: GalleryToolbarProps) {
  const counts = kindCounts(entries, collections, query, countCtx);
  const [open, setOpen] = useState(false);
  /** Which collection chip has its action menu open, if any. */
  const [chipMenu, setChipMenu] = useState<string | null>(null);
  const chipTrigger = useRef<HTMLButtonElement | null>(null);

  // Right-aligned: the trigger is the trailing half of a chip, so the menu
  // hangs off its right edge. Portalled for the same reason as the collection
  // menu -- the chips live in a horizontally scrolling strip.
  const chipAnchor = useAnchoredPanel(chipTrigger, chipMenu !== null, "right");

  // A menu left open behind a re-render, or one opened on a chip that a delete
  // has just removed, would hang open over a row that is no longer there.
  useEffect(() => {
    if (chipMenu && !collections.some((c) => c.id === chipMenu)) setChipMenu(null);
  }, [chipMenu, collections]);

  // Clicking anywhere else dismisses it, the way every menu behaves.
  useEffect(() => {
    if (!chipMenu) return;
    // The panel is portalled to `document.body`, so a click on it is not a
    // descendant of the chip button. Without this the menu would close before
    // `onRenameCollection` ran.
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = chipTrigger.current?.contains(target) ?? false;
      const inPanel = chipAnchor.panelRef.current?.contains(target) ?? false;
      if (!inTrigger && !inPanel) setChipMenu(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setChipMenu(null);
    document.addEventListener("click", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("click", away);
      document.removeEventListener("keydown", esc);
    };
  }, [chipMenu]);
  /**
   * Put every filter dimension back to "no narrowing".
   *
   * Search is included, which the inline version of this used to forget: with a
   * search term still in the box, "Clear filters" left the vault looking filtered
   * with nothing to indicate why. WallpaperTab's empty state clears the same
   * set for the same reason, and the two must not drift.
   */
  const clearFilters = () => {
    onQuery({
      search: "",
      kind: "all",
      minWidth: null,
      picks: "all",
      display: "all",
    });
    onCollection("all");
  };

  /**
   * The applied filters, each with the patch that takes it back off.
   *
   * One list, computed once. It answers both "which chips are shown" and "what
   * number is on the Filters button", which is the point: two answers to "is
   * this filter on" is how the badge came to read 0 while a resolution floor
   * was applied.
   */
  const chips = activeFilters(query, collections, {
    floors: WIDTH_FLOORS,
    anyResolution: "gallery.any-resolution",
    displays,
    anyDisplay: "gallery.any-display",
    unknownCollection: "gallery.view-collections",
  });
  const activeCount = filterBadgeCount(chips);

  return (
    <div className="mb-4 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {view === "wallpapers" && (
        <div className="relative min-w-[9rem] flex-1 sm:max-w-[16rem]">
          <input
            ref={searchRef}
            value={query.search}
            onChange={(e) => onQuery({ search: e.target.value })}
            placeholder={t("common.search-vault")}
            aria-label={t("common.search-wallpapers-by-name")}
            className="w-full rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-1 pl-7 text-xs text-[var(--text)] outline-none transition-colors placeholder:text-[var(--text-faint)] focus:border-[rgb(var(--glow)/0.5)]"
          />
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]">
            <IconSearch className="h-3 w-3" />
          </span>
        </div>
        )}

        {view === "wallpapers" && (
        <>
        {/* 4K in one press. The same floor the Filters panel already offers,
            promoted to a chip because it is the question people actually ask of
            a wallpaper vault, and answering it should not mean opening a panel
            and picking from four options. It is a shortcut onto `minWidth`
            rather than a filter of its own, so the Filters badge, the applied
            chip list and the grid cannot disagree about whether it is on. */}
        <SelectChip
          active={query.minWidth === 3840}
          title={t("gallery.at-least-4k")}
          onClick={() =>
            onQuery({ minWidth: query.minWidth === 3840 ? null : 3840 })
          }
        >
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] tracking-tight">4K</span>
            <span className="opacity-70">{t("gallery.at-least-4k-short")}</span>
          </span>
        </SelectChip>

        {/* View controls, as icons. Every one of these used to be a labelled
            field -- "Sort by", "Tile size", "Filters" -- which spent about two
            hundred pixels of the top row restating what the icon already says,
            and on a narrow window pushed the search box off the edge. The
            current value is not lost: it moved into the tooltip, and for sort
            and density it is legible from the tiles themselves. */}
        <Dropdown
          icon={<IconSort className="h-4 w-4" />}
          ariaLabel={t("gallery.sort-by")}
          title={`${t("gallery.sort-by")}: ${t(SORTS.find((s) => s.id === query.sort)?.label ?? "gallery.sort-recent")}`}
          value={query.sort}
          onChange={(v) => onQuery({ sort: v as GallerySort })}
          options={SORTS.map((s) => ({ id: s.id, label: t(s.label) }))}
        />

        <Dropdown
          icon={<IconGrid className="h-4 w-4" />}
          ariaLabel={t("gallery.density")}
          title={`${t("gallery.density")}: ${t(DENSITIES.find((d) => d.id === density)?.label ?? "gallery.density-cozy")}`}
          value={density}
          onChange={(v) => onDensity(v as GalleryDensity)}
          options={DENSITIES.map((d) => ({ id: d.id, label: t(d.label) }))}
        />

        {/* Select-all, always present and never duplicated. It belongs in the
            toolbar rather than the action bar because in the bar it was a second
            checkbox-shaped control stacked directly above a grid of
            checkbox-bearing tiles, which read as one control drawn twice. The
            two-square icon keeps it from reading as a tile checkbox even here. */}
        <button
          role="checkbox"
          aria-checked={selectAllState === "all" ? true : selectAllState === "some" ? "mixed" : false}
          aria-label={t("gallery.select-all")}
          data-tip={
            selectAllState === "all"
              ? t("gallery.clear-the-selection")
              : t("gallery.select-all-hint")
          }
          onClick={() => onSelectAll(selectAllState !== "all")}
          className={`${ICON_BTN} ${selectAllState === "none" ? ICON_BTN_IDLE : ICON_BTN_ACTIVE}`}
        >
          <IconSelectAll state={selectAllState} className="h-4 w-4" />
        </button>

        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={t("gallery.filters")}
          data-tip={t("gallery.filters")}
          className={`${ICON_BTN} relative ${open || activeCount > 0 ? ICON_BTN_ACTIVE : ICON_BTN_IDLE}`}
        >
          <IconSliders className="h-4 w-4" />
          {activeCount > 0 && (
            <span
              className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[rgb(var(--glow))] px-0.5 font-mono text-[8px] font-bold text-[var(--on-accent)]"
              aria-hidden
            >
              {activeCount}
            </span>
          )}
        </button>
        </>
        )}

        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2.5">
          {/* The collection editor lives next to whatever it affects: the
              chips in the open filter row, the top row when that row is
              collapsed or when the collections view is up and there are no
              chips at all. */}
          {!open && collectionEditor}
          {children}
          <span className="text-dim-sm hidden xl:block">
            {t("common.or-drop-files-and-folders-anywhere-in-the-vault")}
          </span>
        </div>
      </div>

      {open && view === "wallpapers" && (
        /* One labelled row per dimension. This used to be a single wrapping row
           of pills separated by 1px rules, with nothing saying which rule stood
           for which dimension -- so "kind" and "collection" chips looked
           interchangeable, and a filter you had just applied was impossible to
           locate by scanning. */
        <div className="page-enter space-y-2">
          <FilterGroup label={t("gallery.filter-quick")}>
            {PICKS.map((p) => (
              <button
                key={p.id}
                onClick={() => onQuery({ picks: query.picks === p.id ? "all" : p.id })}
                aria-pressed={query.picks === p.id}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${chipStyle(query.picks === p.id)}`}
              >
                {p.icon}
                {t(p.label)}
              </button>
            ))}
          </FilterGroup>

          {displays.length > 1 && (
            <FilterGroup label={t("gallery.filter-display")}>
              <button
                onClick={() => onQuery({ display: "all" })}
                aria-pressed={query.display === "all"}
                className={`rounded-full px-3 py-1 text-xs ${chipStyle(query.display === "all")}`}
              >
                {t("gallery.any-display")}
              </button>
              {displays.map((d, i) => (
                <button
                  key={d.device || String(i)}
                  onClick={() => onQuery({ display: d.device })}
                  aria-pressed={query.display === d.device}
                  className={`rounded-full px-3 py-1 text-xs ${chipStyle(query.display === d.device)}`}
                >
                  {`${d.name} · ${i + 1}`}
                </button>
              ))}
            </FilterGroup>
          )}

          <FilterGroup label={t("gallery.filter-kind")}>
            <button
              onClick={() => onQuery({ kind: "all" })}
              aria-pressed={query.kind === "all"}
              className={`rounded-full px-3 py-1 text-xs ${chipStyle(query.kind === "all")}`}
            >
            {`${t("common.all")} · ${counts.all ?? 0}`}
          </button>
          {GALLERY_KINDS.map((k) => {
            const n = counts[k] ?? 0;
            const active = query.kind === k;
            return (
              <button
                key={k}
                onClick={() => onQuery({ kind: active ? "all" : k })}
                aria-pressed={active}
                // A kind with nothing behind it stays visible but disabled, so
                // the row does not reflow as the user types in the search box.
                disabled={n === 0 && !active}
                className={`rounded-full px-3 py-1 text-xs disabled:opacity-35 ${chipStyle(active)}`}
              >
                {`${t(GALLERY_KIND_LABEL[k])} · ${n}`}
              </button>
            );
          })}
          </FilterGroup><FilterGroup label={t("gallery.filter-in")}>
            {/* "Uncollected" belongs here rather than up with the star: it is a
                statement about collection membership, and having it in the
                quick row while "All collections" sat in this row made the panel
                offer collection membership in two places at once. */}
            <button
              onClick={() => onQuery({ picks: query.picks === "uncollected" ? "all" : "uncollected" })}
              aria-pressed={query.picks === "uncollected"}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${chipStyle(query.picks === "uncollected")}`}
            >
              <IconLayers className="h-3 w-3" />
              {t("gallery.uncollected")}
            </button>
          {/* Once a tile is in flight the chips ask for the drop rather than
              assume it: the dashed ring and the slow glow are the whole
              instruction, so there is no "drag here" hint to keep in sync. */}
          {collections.map((c) => (
            <div
              key={c.id}
              className={`group/col relative flex items-center rounded-full transition-shadow ${
                draggingId
                  ? "drop-armed ring-1 ring-dashed ring-[rgb(var(--glow)/0.5)]"
                  : ""
              }`}
              onDragOver={(e) => {
                if (!draggingId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDropOnCollection(c.id);
              }}
            >
              <button
                onClick={() => onCollection(query.collection === c.id ? "all" : c.id)}
                aria-pressed={query.collection === c.id}
                className={`rounded-l-full py-1 pl-3 pr-2 text-xs ${chipStyle(query.collection === c.id)}`}
              >
                {c.name}
                <span className="ml-1.5 font-mono text-[10px] tabular-nums opacity-70">
                  {c.entryIds.length}
                </span>
              </button>
              {/* Rename and delete live together on one visible control.
                  Split across a hover-only 16px × plus a double-click, which is
                  what made "how do I delete a collection" unanswerable from the
                  screen that shows them. */}
              <div className="relative">
                <button
                  ref={chipTrigger}
                  aria-label={t("gallery.collection-actions", { name: c.name })}
                  onClick={(e) => {
                    e.stopPropagation();
                    setChipMenu(c.id);
                  }}
                  className={`flex ${CHIP_H} w-6 items-center justify-center rounded-r-full text-[10px] font-bold leading-none ${chipStyle(query.collection === c.id)}`}
                >
                  ⋯
                </button>
                {chipMenu === c.id &&
                  createPortal(
                    <div
                      ref={chipAnchor.panelRef}
                      style={chipAnchor.style}
                      role="menu"
                      className="page-enter z-[120] w-36 rounded-lg border border-[var(--line-strong)] bg-[var(--panel-strong)] py-1 shadow-[var(--shadow)]"
                    >
                    <button
                      onClick={() => {
                        setChipMenu(null);
                        onRenameCollection(c);
                      }}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-[var(--text)] transition-colors hover:bg-[var(--panel)]"
                    >
                      {t("common.rename")}
                    </button>
                    <button
                      onClick={() => {
                        setChipMenu(null);
                        onDeleteCollection(c);
                      }}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-red-300 transition-colors hover:bg-red-500/15"
                    >
                      {t("common.delete")}
                    </button>
                    </div>,
                    document.body,
                  )}
              </div>
            </div>
          ))}
          <button
            onClick={onNewCollection}
            data-tip={t("gallery.new-collection")}
            aria-label={t("gallery.new-collection")}
            className={`flex ${CHIP_H} w-[26px] items-center justify-center rounded-full border border-dashed border-[var(--line-strong)] text-[var(--text-faint)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[var(--text)]`}
          >
            +
          </button>
          {collectionEditor}
          </FilterGroup>

          {/* Index-backed controls. Its own labelled row because it is the only
              dimension that needs a build before it can be used at all, and
              burying that behind a chip row made it look like a fifth kind. */}
          <FilterGroup label={t("gallery.filter-quality")}>
            {indexReady ? (
              /* A pill showing its own value, like every other control in this
                 panel. It was an icon-mode dropdown -- a lone 32px square in a
                 row of 26px pills, whose only statement about the active floor
                 was a tooltip -- so the panel's one legible-where-it-matters
                 filter was the one you had to hover to read. */
              <Dropdown
                chip
                chipActive={query.minWidth != null}
                ariaLabel={t("gallery.minimum-resolution")}
                title={`${t("gallery.minimum-resolution")}: ${t(WIDTH_FLOORS.find((w) => w.id === String(query.minWidth ?? 0))?.label ?? "gallery.any-resolution")}`}
                value={String(query.minWidth ?? 0)}
                onChange={(v) => onQuery({ minWidth: v === "0" ? null : Number(v) })}
                options={WIDTH_FLOORS.map((w) => ({ id: w.id, label: t(w.label) }))}
              />
            ) : (
              <button
                onClick={onBuildIndex}
                disabled={indexBuilding}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-[var(--line-strong)] px-3 py-1 text-xs text-[var(--text-faint)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[var(--text)] disabled:opacity-60"
              >
                <IconSparkle className="h-4 w-4" />
                {indexBuilding && indexProgress
                  ? t("gallery.indexing-{done}-of-{total}", indexProgress)
                  : t("gallery.index-the-vault")}
              </button>
            )}
          </FilterGroup>
        </div>
      )}

      {/* What is applied, said plainly.

          The badge on the Filters button says how many dimensions are narrowing
          the grid and nothing about which, so a collapsed panel left a short
          vault with no visible reason. These name the filters and take each one
          back individually, which is what you actually want: "Clear filters"
          also wipes the search box, and the filter you want gone is rarely the
          only one you want gone.

          Shown in both states rather than only when collapsed, because the
          panel hides its own state the moment you close it -- which is the
          moment you most want to check it. */}
      {view === "wallpapers" && chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => {
            const name = c.labelKey ? t(c.labelKey) : c.label;
            return (
              <button
                key={c.key}
                onClick={() =>
                  c.clear.kind === "collection" ? onCollection(c.clear.id) : onQuery(c.clear.patch)
                }
                aria-label={t("gallery.remove-the-{name}-filter", { name })}
                data-tip={t("gallery.remove-the-{name}-filter", { name })}
                className="flex max-w-full items-center gap-1.5 rounded-full border border-[rgb(var(--glow)/0.35)] bg-[rgb(var(--glow)/0.08)] py-0.5 pl-2.5 pr-1.5 text-xs text-[rgb(var(--glow))] transition-colors hover:border-[rgb(var(--glow)/0.7)] hover:bg-[rgb(var(--glow)/0.14)]"
              >
                <span className="truncate">{name}</span>
                <IconClose className="h-3 w-3 shrink-0" />
              </button>
            );
          })}
          {chips.length > 1 && (
            <button
              onClick={clearFilters}
              className="rounded-full px-2 py-0.5 text-xs text-[var(--text-faint)] underline underline-offset-2 transition-colors hover:text-[var(--text)]"
            >
              {t("gallery.clear-filters")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
