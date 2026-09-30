import { useState, type ReactNode } from "react";
import { IconChevronDown, IconSearch } from "../icons";
import { t } from "../../i18n";
import { GALLERY_KINDS, GALLERY_KIND_LABEL } from "./kindLabels";
import { kindCounts, type GalleryPick, type GalleryQuery, type GallerySort, type SelectContext } from "./galleryQuery";
import { chipStyle, Dropdown } from "../ui";
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
  totalInVault: number;
  /** Tile size. */
  density: GalleryDensity;
  onDensity: (d: GalleryDensity) => void;
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

/** Shortcut filters that are neither a kind nor a collection. */
const PICKS: { id: GalleryPick; label: string }[] = [
  { id: "all", label: "gallery.everything" },
  { id: "favourites", label: "gallery.favourites" },
  { id: "uncollected", label: "gallery.uncollected" },
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
 * Find, order, filter, add.
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
 * so a collapsed bar is never ambiguous about why the grid looks short.
 */
export function GalleryToolbar({
  query,
  onQuery,
  entries,
  collections,
  onCollection,
  onRenameCollection,
  onDeleteCollection,
  onNewCollection,
  totalInVault,
  density,
  onDensity,
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
  // How many filter dimensions are narrowing the grid. Search and sort are not
  // counted: they are visible in the top row, so a badge for them would be
  // saying something the user can already see.
  const activeCount =
    (query.kind !== "all" ? 1 : 0) +
    (query.collection !== "all" ? 1 : 0) +
    (query.picks !== "all" ? 1 : 0) +
    (query.display !== "all" ? 1 : 0);

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
        <Dropdown
          compact
          ariaLabel={t("gallery.sort-by")}
          value={query.sort}
          onChange={(v) => onQuery({ sort: v as GallerySort })}
          className="w-[7.5rem] shrink-0"
          options={SORTS.map((s) => ({ id: s.id, label: t(s.label) }))}
        />

        <Dropdown
          compact
          ariaLabel={t("gallery.density")}
          value={density}
          onChange={(v) => onDensity(v as GalleryDensity)}
          className="w-[7rem] shrink-0"
          options={DENSITIES.map((d) => ({ id: d.id, label: t(d.label) }))}
        />

        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
            open || activeCount > 0
              ? "border-[rgb(var(--glow)/0.5)] bg-[rgb(var(--glow)/0.12)] text-[rgb(var(--glow))]"
              : "border-[var(--line-strong)] bg-[var(--panel-strong)] text-[var(--text-dim)] hover:border-[rgb(var(--glow)/0.5)] hover:text-[var(--text)]"
          }`}
        >
          {t("gallery.filters")}
          {activeCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[rgb(var(--glow))] px-1 font-mono text-[9px] font-bold text-[#06121f]">
              {activeCount}
            </span>
          )}
          <IconChevronDown
            className={`h-3 w-3 transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
          />
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
        <div className="page-enter flex flex-wrap items-center gap-1.5">
          {PICKS.map((p) => (
            <button
              key={p.id}
              onClick={() => onQuery({ picks: p.id })}
              aria-pressed={query.picks === p.id}
              className={`rounded-full px-3 py-1 text-xs ${chipStyle(query.picks === p.id)}`}
            >
              {t(p.label)}
            </button>
          ))}

          {displays.length > 1 && (
            <>
              <span className="mx-1 h-4 w-px bg-[var(--line)]" />
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
            </>
          )}

          <span className="mx-1 h-4 w-px bg-[var(--line)]" />

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

          <span className="mx-1 h-4 w-px bg-[var(--line)]" />

          <button
            onClick={() => onCollection("all")}
            aria-pressed={query.collection === "all"}
            className={`rounded-full px-3 py-1 text-xs ${chipStyle(query.collection === "all")}`}
          >
            {`${t("common.all-collections")} · ${totalInVault}`}
          </button>
          {/* Once a tile is in flight the chips ask for the drop rather than
              assume it: the dashed ring and the slow glow are the whole
              instruction, so there is no "drag here" hint to keep in sync. */}
          {collections.map((c) => (
            <div
              key={c.id}
              className={`group/col relative rounded-full transition-shadow ${
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
                onClick={() => onCollection(c.id)}
                onDoubleClick={() => onRenameCollection(c)}
                aria-pressed={query.collection === c.id}
                className={`rounded-full px-3 py-1 text-xs ${chipStyle(query.collection === c.id)}`}
              >
                {`${c.name} · ${c.entryIds.length}`}
              </button>
              <button
                aria-label={t("gallery.delete-collection", { name: c.name })}
                onClick={() => onDeleteCollection(c)}
                className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-red-500/90 text-[9px] font-bold text-white group-hover/col:flex"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={onNewCollection}
            title={t("gallery.new-collection")}
            aria-label={t("gallery.new-collection")}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-[var(--line-strong)] text-[var(--text-faint)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[var(--text)]"
          >
            +
          </button>
          {collectionEditor}

          {/* Index-backed controls. Kept out of the top row because they are
              the ones you use once, not once per visit. */}
          <span className="mx-1 h-4 w-px bg-[var(--line)]" />
          {indexReady ? (
            <Dropdown
              compact
              ariaLabel={t("gallery.minimum-resolution")}
              value={String(query.minWidth ?? 0)}
              onChange={(v) => onQuery({ minWidth: v === "0" ? null : Number(v) })}
              className="w-[8.5rem] shrink-0"
              options={WIDTH_FLOORS.map((w) => ({ id: w.id, label: t(w.label) }))}
            />
          ) : (
            <button
              onClick={onBuildIndex}
              disabled={indexBuilding}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-[var(--line-strong)] px-2.5 py-1 text-xs text-[var(--text-faint)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[var(--text)] disabled:opacity-60"
            >
              {indexBuilding && indexProgress
                ? t("gallery.indexing-{done}-of-{total}", indexProgress)
                : t("gallery.index-the-vault")}
            </button>
          )}

          {activeCount > 0 || query.minWidth != null ? (
            <button                onClick={() => {
                onQuery({
                  kind: "all",
                  minWidth: null,
                  picks: "all",
                  display: "all",
                });
                onCollection("all");
              }}
              className="ml-1 rounded-full px-2.5 py-1 text-xs text-[var(--text-faint)] underline underline-offset-2 transition-colors hover:text-[var(--text)]"
            >
              {t("gallery.clear-filters")}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
