import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel } from "../dropdownAnchor";
import { isInsideAnchoredPanel } from "../portalContainment";
import { IconClose, IconGrid, IconLayers, IconSearch, IconSelectAll, IconSliders, IconSort, IconSparkle, IconStar } from "../icons";
import type { SelectAllState } from "./selection";
import { t } from "../../i18n";
import { GALLERY_KINDS, GALLERY_KIND_LABEL, originLabel } from "./kindLabels";
import { kindCounts, originCounts, type GalleryPick, type GalleryQuery, type GallerySort, type SelectContext } from "./galleryQuery";
import { activeFilters, filterBadgeCount } from "./activeFilters";
import { CHIP_H, chipStyle, Dropdown, ICON_BTN, ICON_BTN_ACTIVE, ICON_BTN_IDLE } from "../ui";
import type { GalleryEntry, WallpaperCollection } from "@shared/types";

export interface GalleryToolbarProps {
  query: GalleryQuery;
  onQuery: (patch: Partial<GalleryQuery>) => void;
  entries: GalleryEntry[];
  collections: WallpaperCollection[];
  onCollection: (id: string) => void;
  onRenameCollection: (c: WallpaperCollection) => void;
  onDeleteCollection: (c: WallpaperCollection) => void;
  onNewCollection: () => void;
  density: GalleryDensity;
  onDensity: (d: GalleryDensity) => void;
  selectAllState: SelectAllState;
  onSelectAll: (want: boolean) => void;
  indexReady: boolean;
  indexBuilding: boolean;
  indexProgress: { done: number; total: number } | null;
  onBuildIndex: () => void;
  shownCount: number;
  resultCount: number;
  countCtx: SelectContext;
  displays: { device: string; name: string }[];
  draggingId: string | null;
  onDropOnCollection: (collectionId: string) => void;
  collectionEditor?: ReactNode;
  children?: ReactNode;
  searchRef?: React.RefObject<HTMLInputElement | null>;
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

const PICKS: { id: GalleryPick; label: string; icon: ReactNode }[] = [
  { id: "favourites", label: "gallery.favourites", icon: <IconStar className="h-3 w-3" /> },
];

const WIDTH_FLOORS = [
  { id: "0", label: "gallery.any-resolution" },
  { id: "1920", label: "gallery.at-least-1080p" },
  { id: "2560", label: "gallery.at-least-1440p" },
  { id: "3840", label: "gallery.at-least-4k" },
];

const DENSITIES = [
  { id: "compact", label: "gallery.density-compact" },
  { id: "cozy", label: "gallery.density-cozy" },
  { id: "large", label: "gallery.density-large" },
];

export type GalleryDensity = (typeof DENSITIES)[number]["id"];

export const DENSITY_CLASS: Record<GalleryDensity, string> = {
  compact: "grid-cols-2 @[36rem]:grid-cols-3 @[44rem]:grid-cols-4 @[54rem]:grid-cols-6 @[68rem]:grid-cols-8 @[84rem]:grid-cols-10 @[100rem]:grid-cols-12",
  cozy: "grid-cols-1 @[32rem]:grid-cols-2 @[42rem]:grid-cols-3 @[54rem]:grid-cols-4 @[68rem]:grid-cols-5 @[82rem]:grid-cols-6 @[100rem]:grid-cols-8",
  large: "grid-cols-1 @[34rem]:grid-cols-2 @[48rem]:grid-cols-3 @[62rem]:grid-cols-4 @[78rem]:grid-cols-5 @[94rem]:grid-cols-6",
};

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="min-w-0 space-y-2 rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)]/40 p-2.5"
    >
      <span className="kicker block">
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {children}
      </div>
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
  shownCount,
  resultCount,
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
  const [chipMenu, setChipMenu] = useState<string | null>(null);
  const chipTrigger = useRef<HTMLButtonElement | null>(null);

  const chipAnchor = useAnchoredPanel(chipTrigger, chipMenu !== null, "right");

  useEffect(() => {
    if (chipMenu && !collections.some((c) => c.id === chipMenu)) setChipMenu(null);
  }, [chipMenu, collections]);

  useEffect(() => {
    if (!chipMenu) return;
    const away = (e: MouseEvent) => {
      if (
        !isInsideAnchoredPanel(e.target as Node, chipTrigger.current, chipAnchor.panelRef.current)
      ) {
        setChipMenu(null);
      }
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setChipMenu(null);
    document.addEventListener("click", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("click", away);
      document.removeEventListener("keydown", esc);
    };
  }, [chipMenu]);
  const clearFilters = () => {
    onQuery({
      search: "",
      kind: "all",
      minWidth: null,
      picks: "all",
      display: "all",
      origin: "all",
    });
    onCollection("all");
  };

  const origins = originCounts(entries, collections, query, countCtx);
  const originIds = Object.keys(origins)
    .filter((id) => id !== "all")
    .sort((a, b) => (origins[b] ?? 0) - (origins[a] ?? 0));

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
        <div className="min-w-[9rem] flex-1 sm:max-w-[22rem]">
          <div className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--panel-strong)] py-1.5 pl-3 pr-1.5 transition-colors focus-within:border-[rgb(var(--glow)/0.5)]">
            <IconSearch className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" />
            <input
              ref={searchRef}
              value={query.search}
              onChange={(e) => onQuery({ search: e.target.value })}
              placeholder={t("common.search-vault")}
              aria-label={t("common.search-wallpapers-by-name")}
              className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
            />
            {query.search !== "" && (
              <button
                type="button"
                onClick={() => onQuery({ search: "" })}
                aria-label={t("gallery.clear-search")}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--text-faint)] transition-colors hover:bg-[var(--panel)] hover:text-[var(--text)]"
              >
                <IconClose className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        )}

        {view === "wallpapers" && (
        <div className="ml-1 flex shrink-0 items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)]/50 p-1">
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
            aria-controls="gallery-filter-panel"
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
        </div>
        )}

        <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2.5">

          {!open && collectionEditor}
          {children}
          <span className="hidden items-center border-l border-[var(--line)] pl-3 text-[11px] italic text-[var(--text-faint)] xl:flex">
            {t("common.or-drop-files-and-folders-anywhere-in-the-vault")}
          </span>
        </div>
      </div>

      {view === "wallpapers" && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11px] text-[var(--text-faint)]"
        >
          <span className="font-mono tabular-nums text-[var(--text-dim)]">
            {t("gallery.showing-{shown}-of-{total}-results", {
              shown: shownCount,
              total: resultCount,
            })}
          </span>
        </div>
      )}

      {open && view === "wallpapers" && (
        <div
          id="gallery-filter-panel"
          className="@container page-enter rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 sm:p-3.5"
        >
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[var(--text)]">
                {t("gallery.filter-panel-title")}
              </h3>
              <p className="mt-0.5 text-[11px] text-[var(--text-faint)]">
                {t("gallery.filter-panel-hint")}
              </p>
            </div>
            {activeCount > 0 && (
              <button
                onClick={clearFilters}
                className="rounded-full px-2 py-1 text-xs font-medium text-[var(--text-faint)] underline underline-offset-2 transition-colors hover:text-[var(--text)] focus-glow"
              >
                {t("gallery.clear-filters")}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2 @[56rem]:grid-cols-2">
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
                disabled={n === 0 && !active}
                className={`rounded-full px-3 py-1 text-xs disabled:opacity-35 ${chipStyle(active)}`}
              >
                {`${t(GALLERY_KIND_LABEL[k])} · ${n}`}
              </button>
            );
          })}
            </FilterGroup>

            <FilterGroup label={t("gallery.filter-source")}>
              <button
                onClick={() => onQuery({ origin: "all" })}
                aria-pressed={query.origin === "all"}
                className={`rounded-full px-3 py-1 text-xs ${chipStyle(query.origin === "all")}`}
              >
                {`${t("common.all")} · ${origins.all ?? 0}`}
              </button>
              {originIds.map((id) => {
                const label = originLabel(id);
                const active = query.origin === id;
                return (
                  <button
                    key={id}
                    onClick={() => onQuery({ origin: active ? "all" : id })}
                    aria-pressed={active}
                    className={`rounded-full px-3 py-1 text-xs ${chipStyle(active)}`}
                  >
                    {`${label ? t(label) : id} · ${origins[id] ?? 0}`}
                  </button>
                );
              })}
            </FilterGroup>

            <FilterGroup label={t("gallery.filter-in")}>

            <button
              onClick={() => onQuery({ picks: query.picks === "uncollected" ? "all" : "uncollected" })}
              aria-pressed={query.picks === "uncollected"}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${chipStyle(query.picks === "uncollected")}`}
            >
              <IconLayers className="h-3 w-3" />
              {t("gallery.uncollected")}
            </button>

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

            <FilterGroup label={t("gallery.filter-quality")}>
            {indexReady ? (
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
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <button
                  onClick={onBuildIndex}
                  disabled={indexBuilding}
                  className="focus-glow flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-[var(--line-strong)] px-3 py-1 text-xs text-[var(--text-faint)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[var(--text)] disabled:opacity-60"
                >
                  <IconSparkle className="h-4 w-4" />
                  {indexBuilding && indexProgress
                    ? t("gallery.indexing-{done}-of-{total}", indexProgress)
                    : t("gallery.index-the-vault")}
                </button>
                <span className="text-[11px] text-[var(--text-faint)]">
                  {t("gallery.build-the-index-for-resolution-and-length")}
                </span>
              </div>
            )}
            {indexReady && (
              <p className="basis-full pt-1 text-[11px] text-[var(--text-faint)]">
                {t("gallery.unmeasured-items-stay-included")}
              </p>
            )}
            </FilterGroup>
          </div>
        </div>
      )}


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
          {activeCount > 0 && !open && (
            <button
              onClick={clearFilters}
              className="rounded-full px-2 py-1 text-xs font-medium text-[var(--text-faint)] underline underline-offset-2 transition-colors hover:text-[var(--text)] focus-glow"
            >
              {t("gallery.clear-filters")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
