import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { GalleryCard } from "./GalleryCard";
import { DENSITY_CLASS, type GalleryDensity } from "./GalleryToolbar";
import type { Unhealthy } from "./vaultHealth";
import { t } from "../../i18n";
import type { GalleryEntry, WallpaperCollection } from "@shared/types";
import type { MonitorEntry } from "../ui";

export interface GalleryGridProps {
  entries: GalleryEntry[];
  collections: WallpaperCollection[];
  monitors: MonitorEntry[];
  /** Renders the tile imagery. */
  thumbFor: (entry: GalleryEntry) => ReactNode;
  activeEntry: GalleryEntry | null;
  perMonitor: Record<string, { kind: string; source: string } | undefined>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onApplyAll: (entry: GalleryEntry) => void;
  onInspect: (entry: GalleryEntry) => void;
  onRename: (entry: GalleryEntry) => void;
  onRemove: (entry: GalleryEntry) => void;
  density: GalleryDensity;
  /** Entry id -> why it is unhealthy, if it is. */
  health: Map<string, Unhealthy>;
  /** Multi-select: the ids currently ticked, for the action bar. */
  checked: ReadonlySet<string>;
  onToggleChecked: (id: string, range: boolean) => void;
  onApplyChecked: () => void;
  onRemoveChecked: () => void;
  onClearChecked: () => void;
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
  selectedId,
  onSelect,
  onApplyAll,
  onInspect,
  onRename,
  onRemove,
  density,
  health,
  checked,
  onToggleChecked,
  onApplyChecked,
  onRemoveChecked,
  onClearChecked,
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
      // Enter inspects rather than applies: a keyboard user moving through the
      // grid is looking, and applying by accident would change the wallpaper on
      // every display. Space is the apply gesture, and both are reachable from
      // the drawer too.
      case "Enter": {
        const entry = entries[cursor];
        if (entry) {
          e.preventDefault();
          onInspect(entry);
        }
        return;
      }
      case " ": {
        const entry = entries[cursor];
        if (entry) {
          e.preventDefault();
          onSelect(entry.id);
          onApplyAll(entry);
        }
        return;
      }
      case "F2": {
        const entry = entries[cursor];
        if (entry) {
          e.preventDefault();
          onSelect(entry.id);
          onRename(entry);
        }
        return;
      }
      case "Delete":
      case "Backspace": {
        const entry = entries[cursor];
        if (entry) {
          e.preventDefault();
          onSelect(entry.id);
          onRemove(entry);
        }
        return;
      }
      case "Escape":
        e.preventDefault();
        onSelect(null);
        return;
    }
  };

  return (
    <>
      {checked.size > 0 && (
        <div className="page-enter mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[rgb(var(--glow)/0.4)] bg-[rgb(var(--glow)/0.08)] px-3 py-2">
          <span className="text-xs font-semibold text-[rgb(var(--glow))]">
            {t("common.{n}-selected", { n: checked.size })}
          </span>
          <span className="mx-0.5 h-4 w-px bg-[rgb(var(--glow)/0.3)]" />
          <button
            onClick={onApplyChecked}
            className="rounded-md px-2 py-1 text-xs font-semibold text-[var(--text)] transition-colors hover:bg-[var(--panel-strong)]"
          >
            {t("gallery.apply-the-last-one-selected")}
          </button>
          <button
            onClick={onRemoveChecked}
            className="rounded-md px-2 py-1 text-xs text-[var(--text-dim)] transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            {t("gallery.remove-the-selected")}
          </button>
          <button
            onClick={onClearChecked}
            className="ml-auto rounded-md px-2 py-1 text-xs text-[var(--text-faint)] underline underline-offset-2 transition-colors hover:text-[var(--text)]"
          >
            {t("gallery.clear-the-selection")}
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
            selected={selectedId === entry.id}
            active={!!activeEntry && activeEntry.id === entry.id}
            runningOn={runningOn}
            collections={cols}
            health={health.get(entry.id) ?? null}
            checked={checked.has(entry.id)}
            onToggleChecked={(range) => onToggleChecked(entry.id, range)}
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
