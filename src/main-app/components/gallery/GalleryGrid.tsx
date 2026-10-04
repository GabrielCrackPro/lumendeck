import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel } from "../dropdownAnchor";
import { GalleryCard } from "./GalleryCard";
import { DENSITY_CLASS, type GalleryDensity } from "./GalleryToolbar";
import type { Unhealthy } from "./vaultHealth";
import type { VaultIndex } from "./vaultIndex";
import type { ClickModifiers } from "./selection";
import { t } from "../../i18n";
import { IconClose, IconEyeOff, IconFolder, IconMonitor, IconTrash, IconSpinner } from "../icons";
import { SEL_BTN, SEL_BTN_IDLE, SEL_BTN_LABEL, SEL_BTN_PRIMARY } from "./selBar";
import type { GalleryEntry, WallpaperCollection } from "@shared/types";
import { ICON_BTN_ACTIVE, type MonitorEntry } from "../ui";

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
  /** Either bulk action is mid-flight (one IPC call per ticked wallpaper). */
  applyPending?: boolean;
  removePending?: boolean;
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
  /**
   * The vault-wide metadata index, passed through to each tile so it can print
   * resolution and length without probing per tile.
   */
  index?: VaultIndex;
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
  applyPending,
  removePending,
  onClearChecked,
  onAddCheckedToCollection,
  hiddenChecked,
  collectionOptions,
  onDragEntry,
  rotating,
  onToggleFavorite,
  index,
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
  const collectionTrigger = useRef<HTMLButtonElement | null>(null);

  // Portalled and measured like the select dropdowns: this bar sits inside a
  // scrolling grid, so an absolutely positioned menu was clipped by the
  // scroller as soon as the list was taller than the row.
  const collectionAnchor = useAnchoredPanel(
    collectionTrigger,
    collectionMenu && collectionOptions.length > 0,
  );

  // The menu previously had no way out except picking a collection: clicking
  // anywhere else left it hanging open over the grid, and Escape did nothing.
  // The chip menu in the toolbar has had this handler all along.
  useEffect(() => {
    if (!collectionMenu) return;
    const away = (e: MouseEvent) => {
      // Both the trigger and the panel count as inside. The panel is portalled
      // to `document.body`, so testing the root alone would treat the first
      // mousedown of a click on a collection as a dismissal.
      const target = e.target as Node;
      const inRoot = collectionMenuRoot.current?.contains(target) ?? false;
      const inPanel = collectionAnchor.panelRef.current?.contains(target) ?? false;
      if (!inRoot && !inPanel) setCollectionMenu(false);
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
      //
      // None of the action keys below touch the selection. They used to select
      // the tile first, on the reasoning that acting on a tile should also
      // select it -- but that silently replaced a bulk selection with one entry,
      // so arrowing onto a tile and pressing Delete threw away a twenty-item
      // choice. The cursor and the selection are separate things; an action
      // acts on the cursor and leaves the selection alone.
      case "Enter": {
        const entry = entries[cursor];
        if (entry) {
          e.preventDefault();
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
          onRename(entry);
        }
        return;
      }
      case "Delete":
      case "Backspace": {
        const entry = entries[cursor];
        if (entry) {
          e.preventDefault();
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
          the count crossed zero, replaying the enter animation each time.

          Neutral tokens, on purpose. This bar was a glow ring around a glow
          tint, which made it the only lit object in a card whose whole surface
          language is flat panels and hairlines -- it read as a second card
          dropped on top of the first, and the toolbar's own comment already
          names that mistake for the filter panel it sits next to.

          So it is built the way the other band inside this card is built: the
          same `--line-strong` border, the same `--panel-strong` fill, the same
          `rounded-xl`, and the same 3/2 padding as the "entries need
          attention" banner. The accent does not vanish -- it stays on the count
          and on the one filled button, which is where it means something. A
          selection still reads as a selection; it just reads as part of the
          vault instead of as an alert about it. */}
      {checked.size > 0 && (
        <div className="page-enter mb-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-2">
          {/* Count first, then the actions.

              Three columns, not one wrapping row. `flex-wrap` plus an
              `ml-auto` close button meant the bar could break into two lines
              with the count on one and the actions on the other, which is how
              it ended up taller than the buttons it contains. Now the count,
              the actions and the close each own a track; only the action
              cluster may wrap, and only on its own.

              The actions are labelled and sit at the right. Four unlabelled
              glyphs were narrower and unusable: the bar's entire job is to be
              acted on, and a filled square, a folder and a bin are not a
              sentence. Right-aligned so the bar reads as the toolbar above it
              -- information left, controls right -- rather than as the count
              and the buttons having been typed next to each other. */}
          <div className="flex shrink items-center gap-2">
          <span className="text-xs font-semibold tabular-nums text-[rgb(var(--glow))]">
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
          </div>

          {/* Dividers are a hairline colour rather than a dimmed accent. The
              glow at 0.3 was the only thing in this row that glowed without
              saying anything, and beside a neutral bar it read as a stray
              highlight. */}
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          <span className="h-5 w-px bg-[var(--line-strong)]" />

          <div className="relative" ref={collectionMenuRoot}>
            <button
              ref={collectionTrigger}
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
              className={`${SEL_BTN} ${collectionOptions.length === 0 ? SEL_BTN_IDLE : ICON_BTN_ACTIVE}`}
            >
              <IconFolder className="h-4 w-4 shrink-0" />
              <span className={SEL_BTN_LABEL}>{t("gallery.file-the-selection")}</span>
            </button>
            {collectionMenu && collectionOptions.length > 0 && (
              createPortal(
                <div
                  ref={collectionAnchor.panelRef}
                  style={collectionAnchor.style}
                  role="menu"
                  className="page-enter z-[120] w-52 max-h-56 overflow-y-auto overscroll-contain rounded-lg border border-[var(--line-strong)] bg-[var(--panel-strong)] py-1 shadow-[var(--shadow)]"
                >
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
                </div>,
                document.body,
              )
            )}
          </div>

          {/* The one primary control in the row, so it is the one filled with
              the accent: it is the action the bar exists for. */}
          <button
            onClick={onApplyChecked}
            aria-label={t("gallery.apply-selection")}
            aria-busy={applyPending || undefined}
            title={t("gallery.sets-the-newest-of-the-ticked-wallpapers")}
            className={`${SEL_BTN} ${SEL_BTN_PRIMARY}`}
          >
            {applyPending ? (
              <IconSpinner className="h-4 w-4 shrink-0" />
            ) : (
              <IconMonitor className="h-4 w-4 shrink-0" />
            )}
            <span className={SEL_BTN_LABEL}>{t("gallery.apply-selection-short")}</span>
          </button>

          {/* Destructive, and the only action here that loses wallpaper, so it
              sits behind a divider: the three buttons to its left can be
              undone by clicking something else. */}
          <span className="h-5 w-px bg-[var(--line-strong)]" />
          <button
            onClick={onRemoveChecked}
            aria-label={t("gallery.remove-the-selected")}
            aria-busy={removePending || undefined}
            title={t("gallery.remove-the-selected")}
            className={`${SEL_BTN} ${SEL_BTN_IDLE} hover:border-red-500/60 hover:bg-red-500/10 hover:text-red-400`}
          >
            {removePending ? (
              <IconSpinner className="h-4 w-4 shrink-0" />
            ) : (
              <IconTrash className="h-4 w-4 shrink-0" />
            )}
            <span className={SEL_BTN_LABEL}>{t("gallery.remove-the-selected")}</span>
          </button>
          </div>

          <button
            onClick={onClearChecked}
            aria-label={t("gallery.clear-the-selection")}
            title={t("gallery.clear-the-selection")}
            className={`${SEL_BTN} w-8 justify-center px-0 ${SEL_BTN_IDLE}`}
          >
            <IconClose className="h-4 w-4 shrink-0" />
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
            index={index}
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
