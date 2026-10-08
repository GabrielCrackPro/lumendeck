import { memo, useEffect, useState, type DragEvent, type ReactNode } from "react";
import { IconCheck, IconInfo, IconPencil, IconPlay, IconStar, IconTrash } from "../icons";
import { OVERLAY_ICON_BTN } from "../ui";
import { t } from "../../i18n";
import "./galleryMotion.css";
import { GALLERY_KIND_LABEL } from "./kindLabels";
import { hasTileMeta, tileMetaFor } from "./tileMeta";
import type { VaultIndex } from "./vaultIndex";
import { useNearViewport } from "./useNearViewport";
import type { Unhealthy } from "./vaultHealth";
import type { ClickModifiers } from "./selection";
import type { GalleryEntry, WallpaperCollection } from "@shared/types";

const OVERLAY_BTN = OVERLAY_ICON_BTN;

export interface GalleryCardProps {
  entry: GalleryEntry;
  thumbFor: (entry: GalleryEntry) => ReactNode;
  selected: boolean;
  active: boolean;
  runningOn: number[];
  collections: WallpaperCollection[];
  tabbable: boolean;
  onFocusCell: () => void;
  onSelect: (mods: ClickModifiers) => void;
  onApplyAll: () => void;
  onInspect: () => void;
  onRename: () => void;
  onRemove: () => void;
  health: Unhealthy | null;
  checked: boolean;
  favorite: boolean;
  onToggleFavorite: () => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  rotating: string | null;
  index?: VaultIndex;
}

function GalleryCardImpl({
  entry,
  thumbFor,
  selected,
  active,
  runningOn,
  collections,
  tabbable,
  onFocusCell,
  onApplyAll,
  onInspect,
  onRename,
  onRemove,
  health,
  checked,
  onSelect,
  favorite,
  onToggleFavorite,
  rotating,
  index,
  draggable,
  onDragStart,
}: GalleryCardProps) {

  const { ref: revealRef, near } = useNearViewport<HTMLDivElement>("120px");
  const [starTick, setStarTick] = useState(0);
  const [popping, setPopping] = useState(false);
  const meta = tileMetaFor(entry, index);
  const showMeta = hasTileMeta(meta);
  useEffect(() => {
    if (!popping) return;
    const id = setTimeout(() => setPopping(false), 460);
    return () => clearTimeout(id);
  }, [starTick, popping]);

  return (
    <div
      ref={revealRef}
      role="gridcell"
      tabIndex={tabbable ? 0 : -1}
      aria-selected={selected}
      onFocus={onFocusCell}
      onClick={(e) => onSelect({ shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })}
      draggable={draggable}
      onDragStart={onDragStart}
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-[var(--panel-strong)] outline-none transition-all duration-[var(--motion-slow)] ease-[var(--ease-standard)] hover:-translate-y-0.5 hover:shadow-[var(--shadow)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow))]  ${near ? "tile-revealed" : "tile-reveal"} ${
        active
          ? "border-[rgb(var(--glow)/0.7)] shadow-[0_14px_36px_-14px_rgb(var(--glow)/0.55)] ring-2 ring-[rgb(var(--glow)/0.22)]"
          : selected
            ? "border-[rgb(var(--glow)/0.55)] ring-1 ring-[rgb(var(--glow)/0.3)]"
            : tabbable
              ? "border-[var(--line-strong)] ring-1 ring-white/25"
              : "border-[var(--line)] hover:border-[var(--line-strong)]"
      }`}
    >
      {


 }
      <div className="relative aspect-video w-full overflow-hidden">
        <div className="absolute inset-0 transition-transform duration-[var(--motion-slow)] ease-[var(--ease-standard)] group-hover:scale-[1.05]">
          {thumbFor(entry)}
        </div>

      {












 }
      {

 }
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-col items-start gap-1">
        {active && (
          <div className="flex items-center gap-1 rounded-full bg-[rgb(var(--glow))] px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--on-accent)] shadow-[0_0_14px_rgb(var(--glow)/0.7)] live-pulse">
            <span className="h-1 w-1 rounded-full bg-[var(--on-accent)]" />
            {t("shell.live")}
          </div>
        )}

        {

 }
        {active && rotating && (
          <div
            className="rounded-full bg-black/60 px-2 py-0.5 font-mono text-[9px] font-semibold text-white/80 backdrop-blur"
            data-tip={rotating}
          >
            {t("gallery.rotating-every-{n}-min", { n: rotating })}
          </div>
        )}

        {health && (
          <span
            data-tip={t(health === "missing" ? "gallery.file-is-missing" : "gallery.duplicated-entry")}
            className="rounded bg-amber-500/90 px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-black"
          >
            {t(health === "missing" ? "gallery.missing-short" : "gallery.duplicate-short")}
          </span>
        )}
      </div>

      {
 }
      {runningOn.length > 0 && (
        <div className="pointer-events-none absolute right-2 top-2 z-10 flex gap-1">
          {runningOn.map((n) => (
            <span
              key={n}
              className="flex h-5 min-w-5 items-center justify-center rounded-md bg-[rgb(var(--glow))] px-1 font-mono text-[10px] font-bold text-[var(--on-accent)] shadow-[0_0_10px_rgb(var(--glow)/0.6)]"
            >
              {n}
            </span>
          ))}
        </div>
      )}

      {
 }
      {runningOn.length > 0 && (
        <div className="pointer-events-none absolute right-2 top-2 z-10 flex gap-1">
          {runningOn.map((n) => (
            <span
              key={n}
              className="flex h-5 min-w-5 items-center justify-center rounded-md bg-[rgb(var(--glow))] px-1 font-mono text-[10px] font-bold text-[var(--on-accent)] shadow-[0_0_10px_rgb(var(--glow)/0.6)]"
            >
              {n}
            </span>
          ))}
        </div>
      )}

        {







 }
        <div
          className={`absolute bottom-2 right-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap justify-end gap-1 transition-opacity ${
            selected ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"
          }`}
        >
          {


 }
          <button
            aria-label={t("gallery.apply-{name}-everywhere", { name: entry.name })}
            data-tip={t("gallery.apply-everywhere-hint")}
            onClick={(e) => {
              e.stopPropagation();
              onApplyAll();
            }}
            className={`${OVERLAY_BTN} hover:!bg-[rgb(var(--glow))] hover:text-[var(--on-accent)] overlay-action-play`}
          >
            <IconPlay className="h-4 w-4 overlay-icon" />
          </button>
          <button
            aria-label={t("gallery.entry-details", { name: entry.name })}
            onClick={(e) => {
              e.stopPropagation();
              onInspect();
            }}
            className={OVERLAY_BTN}
          >
            <IconInfo className="h-4 w-4" />
          </button>
          <button
            aria-label={t("gallery.rename-{name}", { name: entry.name })}
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
            className={OVERLAY_BTN}
          >
            <IconPencil className="h-4 w-4" />
          </button>
          <button
            aria-label={t("gallery.remove-{name}", { name: entry.name })}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className={`${OVERLAY_BTN} hover:!bg-red-500 overlay-action-danger`}
          >
            <IconTrash className="h-4 w-4 overlay-icon" />
          </button>
        </div>

        {









 }
        <button
          role="checkbox"
          aria-checked={checked}
          aria-label={t("gallery.select-{name}", { name: entry.name })}
          onClick={(e) => {
            e.stopPropagation();
            onSelect({ shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
          }}
          className={`absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-md border backdrop-blur transition-opacity duration-[var(--motion-fast)] ease-[var(--ease-standard)] ${
            checked
              ? "border-transparent bg-[rgb(var(--glow))] text-[var(--on-accent)] opacity-100"
              : "border-white/40 bg-black/45 text-transparent opacity-40 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
          }`}
        >
          <IconCheck className="h-4 w-4" />
        </button>
      </div>

      {

 }
      <div className="border-t border-[var(--line)] bg-[var(--panel-sunken)] px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--text)]">
          {entry.name}
        </div>
        <span className="kicker shrink-0 !text-[var(--text-faint)]">
          {t(GALLERY_KIND_LABEL[entry.kind])}
        </span>
        <button
          aria-label={t(favorite ? "gallery.unstar-{name}" : "gallery.star-{name}", {
            name: entry.name,
          })}
          aria-pressed={favorite}
          onClick={(e) => {
            e.stopPropagation();
            setStarTick((n) => n + 1);
            setPopping(true);
            onToggleFavorite();
          }}
          className={`-m-1 shrink-0 rounded p-1 transition-colors ${
            favorite
              ? "text-[rgb(var(--glow))]"
              : "text-[var(--text-faint)] hover:text-[var(--text-dim)]"
          }`}
        >
          <IconStar
            key={starTick}
            filled={favorite}
            className={`h-4 w-4 ${popping ? "star-pop" : ""}`}
          />
        </button>
        {collections.length > 0 && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--glow))]"
            data-tip={collections.map((c) => c.name).join(", ")}
          />
        )}
      </div>
      {

 }
      {showMeta && (
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-[10px] leading-none text-[var(--text-faint)]">
          {meta.resolution && <span className="truncate">{meta.resolution}</span>}
          {meta.resolution && meta.duration && (
            <span aria-hidden className="shrink-0 opacity-60">
              &middot;
            </span>
          )}
          {meta.duration && (
            <span className="shrink-0">
              {t("gallery.length-{duration}", { duration: meta.duration })}
            </span>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

export const GalleryCard = memo(GalleryCardImpl);
