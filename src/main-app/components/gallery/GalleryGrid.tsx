import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel } from "../dropdownAnchor";
import { isInsideAnchoredPanel } from "../portalContainment";
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
  thumbFor: (entry: GalleryEntry) => ReactNode;
  activeEntry: GalleryEntry | null;
  perMonitor: Record<string, { kind: string; source: string } | undefined>;
  onApplyAll: (entry: GalleryEntry) => void;
  onInspect: (entry: GalleryEntry) => void;
  onRename: (entry: GalleryEntry) => void;
  onRemove: (entry: GalleryEntry) => void;
  density: GalleryDensity;
  health: Map<string, Unhealthy>;
  checked: ReadonlySet<string>;
  onSelect: (id: string, mods: ClickModifiers) => void;
  onSelectAll: (want: boolean) => void;
  selectAllActive: boolean;
  onApplyChecked: () => void;
  onRemoveChecked: () => void;
  applyPending?: boolean;
  removePending?: boolean;
  onClearChecked: () => void;
  onAddCheckedToCollection: (collectionId: string) => void;
  hiddenChecked: number;
  collectionOptions: { id: string; name: string; pending: number }[];
  onDragEntry: (id: string) => void;
  rotating: string | null;
  index?: VaultIndex;
  onToggleFavorite: (entry: GalleryEntry) => void;
}

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
  const [cursor, setCursor] = useState(0);
  const [collectionMenu, setCollectionMenu] = useState(false);
  const collectionMenuRoot = useRef<HTMLDivElement | null>(null);
  const collectionTrigger = useRef<HTMLButtonElement | null>(null);

  const collectionAnchor = useAnchoredPanel(
    collectionTrigger,
    collectionMenu && collectionOptions.length > 0,
  );

  useEffect(() => {
    if (!collectionMenu) return;
    const away = (e: MouseEvent) => {
      if (
        !isInsideAnchoredPanel(
          e.target as Node,
          collectionMenuRoot.current,
          collectionAnchor.panelRef.current,
        )
      ) setCollectionMenu(false);
    };
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setCollectionMenu(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [collectionMenu]);

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
      {

















 }
      {checked.size > 0 && (
        <div className="page-enter mb-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-2">
          {













 }
          <div className="flex shrink items-center gap-2">
          <span className="text-xs font-semibold tabular-nums text-[rgb(var(--glow))]">
            {t("common.{n}-selected", { n: checked.size })}
          </span>
          {



 }
          {hiddenChecked > 0 && (
            <span
              className="flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-200"
              data-tip={t("gallery.{n}-selected-are-hidden", { n: hiddenChecked })}
            >
              <IconEyeOff className="h-3 w-3 shrink-0" />
              {hiddenChecked}
            </span>
          )}
          </div>

          {


 }
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
              data-tip={
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

          {
 }
          <button
            onClick={onApplyChecked}
            aria-label={t("gallery.apply-selection")}
            aria-busy={applyPending || undefined}
            data-tip={t("gallery.sets-the-newest-of-the-ticked-wallpapers")}
            className={`${SEL_BTN} ${SEL_BTN_PRIMARY}`}
          >
            {applyPending ? (
              <IconSpinner className="h-4 w-4 shrink-0" />
            ) : (
              <IconMonitor className="h-4 w-4 shrink-0" />
            )}
            <span className={SEL_BTN_LABEL}>{t("gallery.apply-selection-short")}</span>
          </button>

          {

 }
          <span className="h-5 w-px bg-[var(--line-strong)]" />
          <button
            onClick={onRemoveChecked}
            aria-label={t("gallery.remove-the-selected")}
            aria-busy={removePending || undefined}
            data-tip={t("gallery.remove-the-selected")}
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
            data-tip={t("gallery.clear-the-selection")}
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
        const selected = checked.has(entry.id);
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
            selected={selected}
            active={!!activeEntry && activeEntry.id === entry.id}
            runningOn={runningOn}
            collections={cols}
            health={health.get(entry.id) ?? null}
            checked={selected}
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
