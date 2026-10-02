import { memo, useEffect, useState, type DragEvent, type ReactNode } from "react";
import { IconCheck, IconInfo, IconPencil, IconPlay, IconStar, IconTrash } from "../icons";
import { OVERLAY_ICON_BTN } from "../ui";
import { t } from "../../i18n";
import { GALLERY_KIND_LABEL } from "./kindLabels";
import { useNearViewport } from "./useNearViewport";
import type { Unhealthy } from "./vaultHealth";
import type { ClickModifiers } from "./selection";
import type { GalleryEntry, WallpaperCollection } from "@shared/types";

/** Scrim button over the thumbnail. Shared: see OVERLAY_ICON_BTN in ui.tsx. */
const OVERLAY_BTN = OVERLAY_ICON_BTN;

export interface GalleryCardProps {
  entry: GalleryEntry;
  /** Renders the tile imagery. */
  thumbFor: (entry: GalleryEntry) => ReactNode;
  selected: boolean;
  /** Applied to every display. */
  active: boolean;
  /** Display indices (1-based) this entry is currently running on. */
  runningOn: number[];
  collections: WallpaperCollection[];
  /** Roving tabindex: only the active cell is in the tab order. This is the
   *  keyboard cursor, which is not the same thing as being selected. */
  tabbable: boolean;
  onFocusCell: () => void;
  /** Click the tile. Selects it -- applying is a separate, explicit act. */
  onSelect: (mods: ClickModifiers) => void;
  /** Apply this wallpaper to every display. */
  onApplyAll: () => void;
  /** Open the slide-over drawer for this entry. */
  onInspect: () => void;
  onRename: () => void;
  onRemove: () => void;
  /** Set when the entry's file is gone, or when another entry is the same file. */
  health: Unhealthy | null;
  /** Whether this tile is part of the current selection. */
  checked: boolean;
  favorite: boolean;
  onToggleFavorite: () => void;
  /** Makes the tile a drag source for "file this into a collection". */
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  /** Set when a playlist is rotating the wallpaper, so the live tile can say so
   *  instead of silently changing under the user. */
  rotating: string | null;
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
  draggable,
  onDragStart,
}: GalleryCardProps) {
  // No metadata probe here on purpose. Resolution and length used to sit on the
  // tile, which meant a range request per wallpaper as you scrolled a vault of
  // a few hundred; they live in the drawer, where one entry is open at a time.

  // The reveal is viewport-driven for the same reason the decoder is: sixty
  // tiles fading up together is a curtain, sixty fading up as you scroll is
  // the grid settling.
  const { ref: revealRef, near } = useNearViewport<HTMLDivElement>("120px");
  // A key that changes on every star, so the pop animation restarts. Reusing
  // the class alone does not: React sees the same node and CSS has already
  // played it once.
  const [starTick, setStarTick] = useState(0);
  const [popping, setPopping] = useState(false);
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
      className={`group flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-[var(--panel-strong)] outline-none transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow))] ${near ? "tile-revealed" : "tile-reveal"} ${
        active
          ? "border-[rgb(var(--glow)/0.7)] shadow-[0_14px_36px_-14px_rgb(var(--glow)/0.55)] ring-2 ring-[rgb(var(--glow)/0.22)]"
          : selected
            ? "border-[rgb(var(--glow)/0.55)] ring-1 ring-[rgb(var(--glow)/0.3)]"
            : tabbable
              ? "border-[var(--line-strong)] ring-1 ring-white/25"
              : "border-[var(--line)] hover:border-[var(--line-strong)]"
      }`}
    >
      {/* Media. Everything that used to sit on top of the picture lives on the
          strip below instead, apart from the badges: those are transient, and
          covering a wallpaper with its own name is the one thing a wallpaper
          gallery should not do. */}
      <div className="relative aspect-video w-full overflow-hidden">
        {/* Zoomed, and clipped by the media box, so the badges above stay put
            while the picture moves under them. */}
        <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.05]">
          {thumbFor(entry)}
        </div>

      {active && (
        <div className="live-pop pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-full bg-[rgb(var(--glow))] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#06121f] shadow-[0_0_14px_rgb(var(--glow)/0.7)]">
          <span className="h-1 w-1 rounded-full bg-[#06121f]" />
          {t("shell.live")}
        </div>
      )}

      {/* A playlist can replace the wallpaper on a timer while you are looking
          at the grid. Saying so on the live tile is the difference between a
          vault that surprises you and one you can predict. */}
      {active && rotating && (
        <div
          className="live-pop pointer-events-none absolute left-2 top-7 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[9px] font-semibold text-white/80 backdrop-blur"
          title={rotating}
        >
          {t("gallery.rotating-every-{n}-min", { n: rotating })}
        </div>
      )}

        {/* Which displays show this entry. Always visible, and parked opposite
            the live pill so the two cannot collide. It is state, not an
            action — hiding it behind hover made multi-monitor setups
            unreadable. */}
        {runningOn.length > 0 && (
          <div className="pointer-events-none absolute right-2 top-2 flex gap-1">
            {runningOn.map((n) => (
              <span
                key={n}
                className="flex h-5 min-w-5 items-center justify-center rounded-md bg-[rgb(var(--glow))] px-1 font-mono text-[10px] font-bold text-[#06121f] shadow-[0_0_10px_rgb(var(--glow)/0.6)]"
              >
                {n}
              </span>
            ))}
          </div>
        )}

        {/* Actions. Shown on hover, on keyboard focus, and whenever the card is
            selected — the old hover-only version left rename and delete
            unreachable without a pointer. */}
        <div
          className={`absolute right-2 top-2 flex items-center gap-1 transition-opacity ${
            selected ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"
          }`}
        >
          {/* Apply, as its own labelled control rather than the tile click.
              This is the whole point of the redesign: changing every display in
              the house is a big, visible act, so it gets a button that says so
              instead of being something you do by pointing at a picture. */}
          <button
            aria-label={t("gallery.apply-{name}-everywhere", { name: entry.name })}
            title={t("gallery.apply-everywhere-hint")}
            onClick={(e) => {
              e.stopPropagation();
              onSelect({});
              onApplyAll();
            }}
            className={`${OVERLAY_BTN} hover:!bg-[rgb(var(--glow))] hover:text-[#06121f]`}
          >
            <IconPlay className="h-4 w-4" />
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
            className={`${OVERLAY_BTN} hover:!bg-red-500`}
          >
            <IconTrash className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Selection tick. Hidden until the tile is hovered or focused, so the
          thumbnail keeps its corner at rest, but never *only* on hover while
          unchecked-and-unfocused would hide a control some people need: a
          checked tile always shows its tick, because a selection you cannot
          see is the one bug worth being conservative about. */}
      <button
        role="checkbox"
        aria-checked={checked}
        aria-label={t("gallery.select-{name}", { name: entry.name })}
        onClick={(e) => {
          e.stopPropagation();
          onSelect({ shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
        }}
        className={`absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-md border backdrop-blur transition-opacity duration-150 ${
          checked
            ? "border-transparent bg-[rgb(var(--glow))] text-[#06121f] opacity-100"
            : "border-white/40 bg-black/45 text-transparent opacity-0 hover:border-white/70 group-hover:opacity-100 focus-visible:opacity-100"
        }`}
      >
        <IconCheck className="h-4 w-4" />
      </button>

      {health && (
        <span
          title={t(health === "missing" ? "gallery.file-is-missing" : "gallery.duplicated-entry")}
          className="absolute bottom-8 left-2 z-10 rounded bg-amber-500/90 px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-black"
        >
          {t(health === "missing" ? "gallery.missing-short" : "gallery.duplicate-short")}
        </span>
      )}

      {/* Caption. A solid strip rather than a gradient over the picture, so the
          name and the kind are readable at rest without spending any of the
          frame you came here to look at. */}
      <div className="flex min-w-0 items-center gap-2 border-t border-[var(--line)] bg-[var(--panel-sunken)] px-2.5 py-1.5">
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
          className={`shrink-0 rounded p-0.5 transition-colors ${
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
            title={collections.map((c) => c.name).join(", ")}
          />
        )}
      </div>
    </div>
  );
}

export const GalleryCard = memo(GalleryCardImpl);
