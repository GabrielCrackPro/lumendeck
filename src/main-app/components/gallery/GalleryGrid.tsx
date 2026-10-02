import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { GalleryCard } from "./GalleryCard";
import { DENSITY_CLASS, type GalleryDensity } from "./GalleryToolbar";
import type { Unhealthy } from "./vaultHealth";
import type { ClickModifiers } from "./selection";
import { t } from "../../i18n";
import { IconClose, IconEyeOff, IconFolder, IconMonitor, IconTrash } from "../icons";
import type { GalleryEntry, WallpaperCollection } from "@shared/types";
import { ICON_BTN, ICON_BTN_ACTIVE, ICON_BTN_IDLE, ICON_BTN_PRIMARY, type MonitorEntry } from "../ui";

export interface GalleryGridProps {
  entries: GalleryEntry[];
  collections: WallpaperCollection[];
  monitors: MonitorEntry[];
  /** Renders the tile imagery. */
  thumbFor: (entry: GalleryEntry) => ReactNode;
  activeEntry: GalleryEntry | null;
  perMonitor: Record<string, { kind: string; source: string } | undefined>;
  /** The ids making up the current selection. */
  onApplyAll: (entry: GalleryEntry) => void;
  onInspect: (entry: GalleryEntry) => void;
  onRename: (entry: GalleryEntry) => void;
  onRemove: (entry: GalleryEntry) => void;
  density: GalleryDensity;
  /** Entry id -> why it is unhealthy, if it is. */
  health: Map<string, Unhealthy>;
  /** The current selection. One concept: the drawer target and the bulk
   *  selection are the same set, so there is nothing to keep in step. */
  checked: ReadonlySet<string>;
  onSelect: (id: string, mods: ClickModifiers) => void;
  /** Selects or clears everything the current filter shows. */
  onSelectAll: (want: boolean) => void;
  /** Whether everything the filter shows is already selected, for Ctrl+A. */
  selectAllActive: boolean;
  /** Applies the selection: the last entry in it ends up on every display. */
  onApplyChecked: () => void;
  onRemoveChecked: () => void;
  onClearChecked: () => void;
  /**
   * File the ticked wallpapers into a collection.
   *
   * The obvious use for a five-item selection is putting all five somewhere,
   * and it was the one thing the bar could not do — you had to drag each tile
   * onto a chip individually.
   */
  onAddCheckedToCollection: (collectionId: string) => void;
  /** How many ticked wallpapers the current filter has hidden, if any. */
  hiddenChecked: number;
  /** Collections the ticked wallpapers are not yet in. */
  collectionOptions: { id: string; name: string; pending: number }[];
  /** Drag a tile onto a collection chip to file it. */
  onDragEntry: (id: string) => void;
  /** "N min" when a playlist is rotating, else null. */
  rotating: string | null;
  onToggleFavorite: (entry: GalleryEntry) => void;
}

/** Columns to step when moving vertically. The grid is fluid, so this is
 *  measured from the first row rather than hardcoded to the breakpoint. */
function columnsOf(grid: HTMLElement | null): number {
  if (!grid) return 1;
  const cols = getComputedStyle(grid).gridTemplateColumns;
  const n = cols.split(" ").filter((s) => s.trim().length).length;
  return Math.max(1, n);
}

export function GalleryGrid({
  entries,
  collections,
  monitors,
  thumbFor,
  activeEntry,
  perMonitor,
  onApplyAll,
  onInspect,
  onRename,
  onRemove,
  density,
  health,
  checked,
  onSelect,
  onSelectAll,
  selectAllActive,
  onApplyChecked,
  onRemoveChecked,
  onClearChecked,
  onAddCheckedToCollection,
  hiddenChecked,
  collectionOptions,
  onDragEntry,
  rotating,
  onToggleFavorite,
}: GalleryGridProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  // Roving tabindex: one cell is tabbable, the rest are -1, so Tab enters the
  // grid once and the arrows move within it. Without this the grid is one
  // giant tab stop per tile, which is worse than not being focusable at all.
  //
  // The cursor is deliberately *not* the selection. Opening the drawer on focus
  // would cover the grid the moment you arrowed into it, so moving the cursor
  // only moves the highlight; Enter inspects, Space applies.
  const [cursor, setCursor] = useState(0);
  /** Which collection the "add selection to" menu is showing. */
  const [collectionMenu, setCollectionMenu] = useState(false);
  /** The menu's anchor, so a click outside can dismiss it without a document-wide
   *  handler firing on the opening click itself. */
  const collectionMenuRoot = useRef<HTMLDivElement | null>(null);

  // The menu previously had no way out except picking a collection: clicking
  // anywhere else left it hanging open over the grid, and Escape did nothing.
  // The chip menu in the toolbar has had this handler all along.
  useEffect(() => {
    if (!collectionMenu) return;
    const away = (e: MouseEvent) => {
      if (!collectionMenuRoot.current?.contains(e.target as Node)) setCollectionMenu(false);
    };
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setCollectionMenu(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [collectionMenu]);

  // Keep the cursor on something real when the vault is filtered down.
  useEffect(() => {
    if (entries.length === 0) {
      setCursor(0);
      return;
    }
    if (cursor >= entries.length) setCursor(entries.length - 1);
  }, [entries.length, cursor]);

  const move = useCallback(
    (next: number) => {
      if (entries.length === 0) return;
      const clamped = Math.max(0, Math.min(entries.length - 1, next));
      setCursor(clamped);
      const cell = gridRef.current?.querySelectorAll<HTMLElement>('[role="gridcell"]')[clamped];
      cell?.focus();
    },
    [entries.length],
  );

  const onKeyDown = (e: KeyboardEvent) => {
    const cols = columnsOf(gridRef.current);
    const last = entries.length - 1;
    // Ctrl+A, because every list with a multi-select has it and its absence
    // reads as a missing feature. Restricted to the grid's own key handler so
    // it cannot swallow select-all on a text field elsewhere.
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      onSelectAll(!selectAllActive);
      return;
    }
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        move(cursor + 1);
        return;
      case "ArrowLeft":
        e.preventDefault();
        move(cursor - 1);
        return;
      case "ArrowDown":
        e.preventDefault();
        move(Math.min(last, cursor + cols));
        return;
      case "ArrowUp":
        e.preventDefault();
        move(Math.max(0, cursor - cols));
        return;
      case "Home":
        e.preventDefault();
        move(0);
        return;
      case "End":
        e.preventDefault();
        move(last);
        return;
      // Enter applies, Space selects. This is the keyboard half of the redesign:
      // selecting is the safe, reversible thing and Space is what a list uses
      // for it, while applying changes every display and therefore gets the
      // key people already press to confirm. Details move to "i", which is
      // otherwise taken by nothing here.
      case "Enter": {
        const entry = entries[cursor];
        if (entry) {
          e.preventDefault();
          onSelect(entry.id, {});
          onApplyAll(entry);
        }
        return;
      }
      case " ": {
        const entry = entries[cursor];
        if (entry) {
          e.preventDefault();
          onSelect(entry.id, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
        }
        return;
      }
      case "i":
      case "I": {
        const entry = entries[cursor];
        if (entry) {
          e.preventDefault();
          onInspect(entry);
        }
        return;
      }
      case "F2": {
        const entry = entries[cursor];
        if (entry) {
          e.preventDefault();
          onSelect(entry.id, {});
          onRename(entry);
        }
        return;
      }
      case "Delete":
      case "Backspace": {
        const entry = entries[cursor];
        if (entry) {
          e.preventDefault();
          onSelect(entry.id, {});
          onRemove(entry);
        }
        return;
      }
      case "Escape":
        e.preventDefault();
        onClearChecked();
        return;
    }
  };

  return (
    <>
      {/* Only once something is actually ticked. Previously this bar also
          appeared for a bare select mode, which put a second row of checkbox-
          shaped controls directly above a grid of checkbox-bearing tiles -- it
          read as a duplicated checkbox -- and made the bar mount and unmount as
          the count crossed zero, replaying the enter animation each time. */}
      {checked.size > 0 && (
        <div className="page-enter mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[rgb(var(--glow)/0.4)] bg-[rgb(var(--glow)/0.08)] px-2 py-1.5">
          {/* Count first, then icons. The count is information and has to be
              read; the four actions were four long sentences competing with it
              for the same row, which is why this bar wrapped to two lines on a
              narrow window. Icons give each action a fixed 32px slot, so the
              row never reflows as the selection grows. */}
          <span className="pl-1 text-xs font-semibold tabular-nums text-[rgb(var(--glow))]">
            {t("common.{n}-selected", { n: checked.size })}
          </span>
          {/* A selection outlives a filter change, so without this the bar reads
              "5 selected" over a grid showing none of them -- and the actions
              below then operate on wallpaper the user cannot see. The eye says
              what the number means; a bare amber "3" next to a count of "5" was
              doing neither job on its own. */}
          {hiddenChecked > 0 && (
            <span
              className="flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-200"
              title={t("gallery.{n}-selected-are-hidden", { n: hiddenChecked })}
            >
              <IconEyeOff className="h-3 w-3 shrink-0" />
              {hiddenChecked}
            </span>
          )}
          <span className="mx-0.5 h-5 w-px bg-[rgb(var(--glow)/0.3)]" />

          <div className="relative" ref={collectionMenuRoot}>
            <button
              disabled={collectionOptions.length === 0}
              onClick={() => setCollectionMenu((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={collectionMenu}
              aria-label={t("gallery.add-the-selection-to")}
              title={
                collectionOptions.length === 0
                  ? t("gallery.all-selected-already-collected")
                  : t("gallery.add-the-selection-to")
              }
              className={`${ICON_BTN} ${collectionOptions.length === 0 ? ICON_BTN_IDLE : ICON_BTN_ACTIVE}`}
            >
              <IconFolder className="h-4 w-4" />
            </button>
            {collectionMenu && collectionOptions.length > 0 && (
              <div className="page-enter absolute left-0 top-10 z-20 max-h-56 w-52 overflow-y-auto rounded-lg border border-[var(--line-strong)] bg-[var(--panel-strong)] py-1 shadow-[var(--shadow)]">
                {collectionOptions.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setCollectionMenu(false);
                      onAddCheckedToCollection(c.id);
                    }}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-[var(--text)] transition-colors hover:bg-[var(--panel)]"
                  >
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
                      +{c.pending}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* The one primary control in the row, so it is the one filled with
              the accent: it is the action the bar exists for. */}
          <button
            onClick={onApplyChecked}
            aria-label={t("gallery.apply-selection")}
            title={t("gallery.apply-the-last-one-selected-explained")}
            className={`${ICON_BTN} ${ICON_BTN_PRIMARY}`}
          >
            <IconMonitor className="h-4 w-4" />
          </button>

          {/* Destructive, and the only action here that loses wallpaper, so it
              sits behind a divider: the three buttons to its left can be
              undone by clicking something else. */}
          <span className="mx-0.5 h-5 w-px bg-[rgb(var(--glow)/0.3)]" />
          <button
            onClick={onRemoveChecked}
            aria-label={t("gallery.remove-the-selected")}
            title={t("gallery.remove-the-selected")}
            className={`${ICON_BTN} ${ICON_BTN_IDLE} hover:border-red-500/60 hover:bg-red-500/10 hover:text-red-400`}
          >
            <IconTrash className="h-4 w-4" />
          </button>

          <button
            onClick={onClearChecked}
            aria-label={t("gallery.clear-the-selection")}
            title={t("gallery.clear-the-selection")}
            className={`${ICON_BTN} ${ICON_BTN_IDLE} ml-auto`}
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>
      )}
      <div
        ref={gridRef}
        role="grid"
        onKeyDown={onKeyDown}
        className={`grid gap-3 ${DENSITY_CLASS[density]}`}
      >
      {entries.map((entry, i) => {
        const cols = collections.filter((c) => c.entryIds.includes(entry.id));
        const runningOn = monitors
          .map((m, idx) => {
            const o = perMonitor[m.device];
            const mine = o && o.kind === entry.kind && o.source === entry.source;
            return mine ? idx + 1 : 0;
          })
          .filter((n) => n > 0);
        return (
          <GalleryCard
            key={entry.id}
            entry={entry}
            tabbable={i === cursor}
            // The tile's highlight comes from the selection itself. There is no second
            // "selected id" that could disagree with the set.
            selected={checked.has(entry.id)}
            active={!!activeEntry && activeEntry.id === entry.id}
            runningOn={runningOn}
            collections={cols}
            health={health.get(entry.id) ?? null}
            checked={checked.has(entry.id)}
            onSelect={(mods) => onSelect(entry.id, mods)}
            favorite={!!entry.favorite}
            onToggleFavorite={() => onToggleFavorite(entry)}
            rotating={rotating}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/lumendeck-entry", entry.id);
              e.dataTransfer.effectAllowed = "copy";
              onDragEntry(entry.id);
            }}
            onFocusCell={() => setCursor(i)}
            onApplyAll={() => onApplyAll(entry)}
            onInspect={() => onInspect(entry)}
            onRename={() => onRename(entry)}
            onRemove={() => onRemove(entry)}
            thumbFor={thumbFor}
          />
        );
      })}
      </div>
    </>
  );
}
