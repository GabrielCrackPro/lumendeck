// The collections view: a grid of collection cards.
//
// This used to have no way to rename or delete anything, so the only controls
// lived on the filter chips — a 16px `×` that appeared on hover, inside a
// collapsible panel. Managing a collection from the screen that exists to show
// collections was not possible.
//
// The cover used to run `convertFileSrc` over `entry.thumb`, which the backend
// already stores as a finished `http://media.localhost/...` URL. That produced
// a request for a file that cannot exist, so every collection whose members had
// thumbnails — which is every collection — rendered as "empty". The cover
// decision now lives in `collections.ts` and travels with whether the value
// needs converting.

import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { SHADER_ART } from "@shared/constants";
import { IconGlobe, IconLayers, IconPlus, IconTrash, IconPencil } from "../icons";
import { Btn, EmptyState, OVERLAY_ICON_BTN } from "../ui";
import { coverFor, liveCount } from "./collections";
import { t } from "../../i18n";
import type { GalleryEntry, WallpaperCollection } from "@shared/types";

export interface CollectionsViewProps {
  collections: WallpaperCollection[];
  entries: GalleryEntry[];
  onOpen: (id: string) => void;
  onNewCollection: () => void;
  /** Omitted when the caller has no handlers — the controls hide rather than
   *  render as buttons that do nothing. */
  onRename?: (c: WallpaperCollection) => void;
  onDelete?: (c: WallpaperCollection) => void;
}

/** One card's overflow menu. Closes on outside click and on Escape. */
function CardMenu({
  c,
  onRename,
  onDelete,
}: {
  c: WallpaperCollection;
  onRename?: (c: WallpaperCollection) => void;
  onDelete?: (c: WallpaperCollection) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="absolute right-1.5 top-1.5 z-10">
      <button
        aria-label={t("gallery.collection-actions", { name: c.name })}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        // 24px rather than the old 16px: a control you have to hit precisely
        // is not one you can rely on finding.
        className={`${OVERLAY_ICON_BTN} font-bold`}
      >
        ⋯
      </button>
      {open && (
        <div
          className="page-enter absolute right-0 top-7 w-36 overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[var(--panel-strong)] py-1 shadow-[var(--shadow)]"
          onClick={(e) => e.stopPropagation()}
        >
          {onRename && (
            <button
              onClick={() => {
                setOpen(false);
                onRename(c);
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-[var(--text)] transition-colors hover:bg-[var(--panel)]"
            >
              <IconPencil className="h-4 w-4 shrink-0" />
              {t("common.rename")}
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => {
                setOpen(false);
                onDelete(c);
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-red-300 transition-colors hover:bg-red-500/15"
            >
              <IconTrash className="h-4 w-4 shrink-0" />
              {t("common.delete")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function CollectionsView({
  collections,
  entries,
  onOpen,
  onNewCollection,
  onRename,
  onDelete,
}: CollectionsViewProps) {
  if (collections.length === 0) {
    return (
      <EmptyState
        icon={<IconLayers className="h-6 w-6" />}
        title={t("gallery.no-collections-yet")}
        description={t("gallery.collections-let-you-group-wallpapers-and-switch")}
        action={
          <Btn variant="primary" onClick={onNewCollection}>
            <IconPlus className="h-4 w-4" />
            {t("gallery.new-collection")}
          </Btn>
        }
      />
    );
  }

  return (
    <div className="page-enter grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
      {collections.map((c) => {
        const cover = coverFor(c, entries, SHADER_ART);
        const count = liveCount(c, entries);
        const stale = c.entryIds.length !== count;
        return (
          <div key={c.id} className="group/col relative">
            <button
              onClick={() => onOpen(c.id)}
              className="block w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:shadow-[var(--shadow)]"
            >
              <div className="relative aspect-video w-full bg-[var(--panel-sunken)]">
                {cover.kind === "image" ? (
                  <img
                    src={cover.convert ? convertFileSrc(cover.url, "media") : cover.url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover/col:scale-[1.05]"
                  />
                ) : cover.kind === "shader" ? (
                  // A shader preset has no file behind it — the gradient is the
                  // wallpaper. Requesting an image for it gives a broken frame.
                  <div
                    className="h-full w-full transition-transform duration-500 group-hover/col:scale-[1.05]"
                    style={{ background: cover.art }}
                  />
                ) : cover.kind === "web" ? (
                  <CoverGlyph Icon={IconGlobe} label={t("gallery.kind-web")} />
                ) : cover.kind === "slideshow" ? (
                  <CoverGlyph Icon={IconLayers} label={t("gallery.kind-slideshow")} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[var(--text-faint)]">
                    <span className="text-[10px]">{t("gallery.empty-collection")}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 border-t border-[var(--line)] bg-[var(--panel-sunken)] px-2.5 py-1.5">
                <div className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--text)]">
                  {c.name}
                </div>
                {/* The live count, not the stored one: a member whose file was
                    deleted stays in entryIds forever, so the old number drifted
                    away from what the collection actually holds. */}
                <span
                  className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--text-faint)]"
                  data-tip={stale ? t("gallery.count-includes-missing-files") : undefined}
                >
                  {count}
                </span>
              </div>
            </button>
            {(onRename || onDelete) && (
              <CardMenu c={c} onRename={onRename} onDelete={onDelete} />
            )}
          </div>
        );
      })}

      <button
        onClick={onNewCollection}
        className="flex aspect-video flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--line-strong)] text-[var(--text-faint)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[var(--text)] sm:aspect-auto"
      >
        <span className="text-lg leading-none">+</span>
        <span className="text-xs">{t("gallery.new-collection")}</span>
      </button>
    </div>
  );
}

function CoverGlyph({
  Icon,
  label,
}: {
  Icon: (p: { className?: string }) => ReactElement;
  label: string;
}) {
  return (
    <div
      className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--panel-strong)] to-[var(--panel)]"
      data-tip={label}
    >
      <Icon className="h-7 w-7 text-[var(--text-faint)]" />
    </div>
  );
}
