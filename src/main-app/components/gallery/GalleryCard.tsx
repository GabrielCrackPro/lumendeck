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
  /**
   * The vault-wide metadata index, when one has been built.
   *
   * Read for the tile's resolution and duration rather than probing per tile:
   * a vault of several hundred tiles would fire a metadata request each, which
   * is exactly the storm mediaMeta's cache exists to prevent. Unmeasured tiles
   * simply show no facts until the index exists.
   */
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
  // Resolution and length, from the vault index if it has measured this file.
  // Both are things people compare wallpapers on, and the drawer already shows
  // them -- having to open every tile to tell a 4K file from a 1080p one is
  // what this row exists to remove.
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
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-[var(--panel-strong)] outline-none transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow))]  ${near ? "tile-revealed" : "tile-reveal"} ${
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
          strip below instead, apart from the corner overlays: those are either
          transient or about the picture itself, and covering a wallpaper with
          its own name is the one thing a wallpaper gallery should not do. */}
      <div className="relative aspect-video w-full overflow-hidden">
        <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.05]">
          {thumbFor(entry)}
        </div>

      {/* Four corners, one occupant each.

          This used to be three overlays on the same two corners. The live pill
          and the selection tick both sat at `left-2 top-2` and were measured
          overlapping exactly, so a tile that was both live and ticked showed
          the tick painted over the word "live"; the display badges and the
          hover actions both sat at `right-2 top-2` and were measured
          overlapping too, so hovering a wallpaper running on two displays
          hid the fact that it was running on two displays.

          Corners rather than a stack because nothing here has an order that
          survives: every combination of live, ticked, unhealthy and hovering
          is reachable. Corner 1 is the tick, corner 2 the display badges,
          corner 3 the status stack, corner 4 the actions. */}
      {/* Status stack, top-left. One pill per transient state, stacked so a
          wallpaper that is both live and rotating does not paint one label over
          the other. */}
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-col items-start gap-1">
        {active && (
          <div className="flex items-center gap-1 rounded-full bg-[rgb(var(--glow))] px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--on-accent)] shadow-[0_0_14px_rgb(var(--glow)/0.7)] live-pulse">
            <span className="h-1 w-1 rounded-full bg-[var(--on-accent)]" />
            {t("shell.live")}
          </div>
        )}

        {/* A playlist can replace the wallpaper on a timer while you are
            looking at the grid. Saying so on the live tile is the difference
            between a vault that surprises you and one you can predict. */}
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

      {/* Display badges, top-right. Always visible state, not an action, so hiding
          them behind hover made multi-monitor setups unreadable. */}
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

      {/* Display badges, top-right. Always visible state, not an action, so hiding
          them behind hover made multi-monitor setups unreadable. */}
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

        {/* Actions. Shown on hover, on keyboard focus, and whenever the card is
            selected — the old hover-only version left rename and delete
            unreachable without a pointer.

            Bottom-right, wrapping, so they cannot be clipped by a narrow tile
            and cannot land on the badges. Four 28px buttons plus gaps is 124px,
            which is most of a compact two-column tile at 640px, so the cluster
            is allowed to break onto a second row of two rather than be cut off
            at the media box edge. */}
        <div
          className={`absolute bottom-2 right-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap justify-end gap-1 transition-opacity ${
            selected ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"
          }`}
        >
          {/* Apply, as its own labelled control rather than the tile click.
              This is the whole point of the redesign: changing every display in
              the house is a big, visible act, so it gets a button that says so
              instead of being something you do by pointing at a picture. */}
          <button
            aria-label={t("gallery.apply-{name}-everywhere", { name: entry.name })}
            data-tip={t("gallery.apply-everywhere-hint")}
            onClick={(e) => {
              e.stopPropagation();
              // Deliberately does not touch the selection. This used to select
              // the tile first, which on a twenty-item selection collapsed it to
              // one -- so hovering an unrelated tile and pressing Apply threw
              // away a bulk choice the user had not finished with, with no way
              // to get it back.
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

        {/* Selection tick, top-left. Inside the media box, so it is positioned
            against the picture rather than against whatever ancestor happened
            to be positioned -- as a sibling of the box it resolved against the
            card, which drifted as soon as a caption was taller than another.

            Dimmed rather than invisible at rest. It used to be `opacity-0`
            until hover or focus, which meant the one control that makes
            multi-select possible was invisible to anyone not currently pointing
            at the tile -- on a trackpad, and on every touch screen, the tick
            simply did not exist. At rest it reads as an empty checkbox, which
            is what it is. */}
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
              ? "border-transparent bg-[rgb(var(--glow))] text-[var(--on-accent)] opacity-100"
              : "border-white/40 bg-black/45 text-transparent opacity-40 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
          }`}
        >
          <IconCheck className="h-4 w-4" />
        </button>
      </div>

      {/* Caption. A solid strip rather than a gradient over the picture, so the
          name and the kind are readable at rest without spending any of the
          frame you came here to look at. */}
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
          // A 24px hit area around a 16px glyph: `p-0.5` gave 20px, which is under
          // the smallest comfortable target on the tile and the smallest
          // control the rest of the app uses. The negative margin keeps the
          // glyph exactly where it was, so nothing in the caption shifts.
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
      {/* Facts line. Rendered only when the index knows something about this
          file, so the row does not appear and then empty itself a moment later
          on every tile in a vault that has never been indexed. */}
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
