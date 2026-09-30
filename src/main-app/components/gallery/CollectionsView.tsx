import { convertFileSrc } from "@tauri-apps/api/core";
import { t } from "../../i18n";
import type { GalleryEntry, WallpaperCollection } from "@shared/types";

export interface CollectionsViewProps {
  collections: WallpaperCollection[];
  entries: GalleryEntry[];
  onOpen: (id: string) => void;
  onNewCollection: () => void;
}

/**
 * Collections as objects rather than as a row of chips.
 *
 * The data model already treats them as first-class membership lists, and the
 * grid treated them as fourteen chips in a collapsible row. A chip tells you a
 * collection exists and a count; a card tells you what is in it, which is the
 * thing you actually want before deciding whether to open it. The cover is the
 * first member's own thumbnail, so it is always something real from the vault
 * rather than a placeholder.
 */
export function CollectionsView({
  collections,
  entries,
  onOpen,
  onNewCollection,
}: CollectionsViewProps) {
  const byId = new Map(entries.map((e) => [e.id, e]));

  return (
    <div className="page-enter grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
      {collections.map((c) => {
        // First member that still exists, so a collection whose leading entry
        // was deleted shows its next wallpaper rather than an empty frame.
        const cover = c.entryIds.map((id) => byId.get(id)).find(Boolean);
        const coverUrl = cover
          ? convertFileSrc(cover.thumb ?? cover.source, "media")
          : null;
        return (
          <button
            key={c.id}
            onClick={() => onOpen(c.id)}
            className="group/col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:shadow-[var(--shadow)]"
          >
            <div className="relative aspect-video w-full bg-[var(--panel-sunken)]">
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover/col:scale-[1.05]"
                />
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
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
                {c.entryIds.length}
              </span>
            </div>
          </button>
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
