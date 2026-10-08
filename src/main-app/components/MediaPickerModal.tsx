import { useEffect, useMemo, useState } from "react";
import type { MediaPickerEntry, MediaPickerListing } from "@shared/types";
import { api } from "../ipc";
import { t } from "../i18n";
import { truncateError } from "../utilities";
import {
  IconCheck,
  IconChevronRight,
  IconFolder,
  IconImage,
  IconPrevious,
  IconSearch,
} from "./icons";

type PickerMode = "files" | "folder";

const LOCATION_LABELS: Record<string, string> = {
  home: "gallery.location-home",
  desktop: "gallery.location-desktop",
  downloads: "gallery.location-downloads",
  documents: "gallery.location-documents",
  pictures: "gallery.location-pictures",
  videos: "gallery.location-videos",
};

function labelFor(entry: MediaPickerEntry): string {
  const key = entry.locationId ? LOCATION_LABELS[entry.locationId] : undefined;
  return key ? t(key) : entry.name;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MediaRow({
  entry,
  mode,
  selected,
  onOpen,
  onToggle,
}: {
  entry: MediaPickerEntry;
  mode: PickerMode;
  selected: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const isFolder = entry.kind === "directory" || entry.kind === "location" || entry.kind === "drive";
  const Icon = isFolder ? IconFolder : IconImage;

  return (
    <button
      type="button"
      aria-pressed={isFolder || mode === "folder" ? undefined : selected}
      onClick={isFolder ? onOpen : mode === "files" ? onToggle : undefined}
      disabled={!isFolder && mode === "folder"}
      className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.7)] disabled:cursor-default disabled:opacity-50 ${
        selected
          ? "border-[rgb(var(--glow)/0.5)] bg-[rgb(var(--glow)/0.1)]"
          : "border-transparent hover:border-[var(--line)] hover:bg-[var(--panel-strong)]"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
          selected
            ? "border-[rgb(var(--glow)/0.3)] bg-[rgb(var(--glow)/0.12)] text-[rgb(var(--glow))]"
            : "border-[var(--line)] bg-[var(--panel-sunken)] text-[var(--text-faint)] group-hover:text-[rgb(var(--glow))]"
        }`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-[var(--text)]">
          {labelFor(entry)}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[9px] text-[var(--text-faint)]">
          {isFolder ? entry.path : `${entry.kind.toUpperCase()}${entry.sizeBytes === null ? "" : ` · ${formatBytes(entry.sizeBytes)}`}`}
        </span>
      </span>
      {selected ? (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[rgb(var(--glow))] text-[var(--bg)]">
          <IconCheck className="h-3.5 w-3.5" />
        </span>
      ) : isFolder ? (
        <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--text-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[rgb(var(--glow))]" />
      ) : null}
    </button>
  );
}

export function MediaPickerModal({
  initialMode,
  onImportFiles,
  onImportFolder,
}: {
  initialMode: PickerMode;
  onImportFiles: (paths: string[]) => void;
  onImportFolder: (path: string) => void;
}) {
  const [mode, setMode] = useState<PickerMode>(initialMode);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [listing, setListing] = useState<MediaPickerListing | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadId, setReloadId] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .mediaPickerList(currentPath ?? undefined)
      .then((next) => {
        if (alive) setListing(next);
      })
      .catch((reason) => {
        if (alive) setError(truncateError(reason));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [currentPath, reloadId]);

  const entries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!listing) return [];
    return listing.entries.filter((entry) =>
      labelFor(entry).toLocaleLowerCase().includes(normalized),
    );
  }, [listing, query]);

  const locations = entries.filter((entry) => entry.kind === "location");
  const drives = entries.filter((entry) => entry.kind === "drive");
  const folders = entries.filter((entry) => entry.kind === "directory");
  const files = entries.filter((entry) => entry.kind === "image" || entry.kind === "video");
  const openFolder = (path: string) => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    setQuery("");
    setCurrentPath(path);
  };

  const toggleFile = (path: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderRows = (items: MediaPickerEntry[]) =>
    items.map((entry) => (
      <MediaRow
        key={entry.path}
        entry={entry}
        mode={mode}
        selected={selected.has(entry.path)}
        onOpen={() => openFolder(entry.path)}
        onToggle={() => toggleFile(entry.path)}
      />
    ));

  const goToParent = () => {
        if (listing?.parentPath) openFolder(listing.parentPath);
        else {
          setLoading(true);
          setSelected(new Set());
          setQuery("");
          setCurrentPath(null);
        }
      };

  return (
      <div className="space-y-3 p-1 sm:p-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {currentPath && (
              <button
                type="button"
                onClick={goToParent}
                aria-label={t("gallery.parent-folder")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--panel)] text-[var(--text-dim)] transition-colors hover:bg-[var(--panel-strong)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.7)]"
              >
                <IconPrevious className="h-4 w-4" />
              </button>
            )}
          <div className="flex rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)] p-0.5">
            {(["files", "folder"] as const).map((nextMode) => (
              <button
                key={nextMode}
                type="button"
                aria-pressed={mode === nextMode}
                onClick={() => setMode(nextMode)}
                className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.7)] ${
                  mode === nextMode
                    ? "bg-[var(--panel-strong)] text-[var(--text)] shadow-sm"
                    : "text-[var(--text-faint)] hover:text-[var(--text)]"
                }`}
              >
                {t(nextMode === "files" ? "gallery.media-files" : "common.import-folder")}
              </button>
            ))}
          </div>
          <span className="max-w-full truncate font-mono text-[10px] text-[var(--text-faint)] sm:max-w-[60%]">
            {listing?.currentPath ?? t("gallery.quick-access")}
          </span>
          </div>
        </div>

        <label className="relative block">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-faint)]" />
          <input
            data-modal-autofocus
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("gallery.search-this-folder")}
            aria-label={t("gallery.search-this-folder")}
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)] py-2 pl-9 pr-3 text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[rgb(var(--glow)/0.5)]"
          />
        </label>

        <div
          aria-busy={loading}
          className={`max-h-[min(54dvh,34rem)] min-h-48 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--panel-sunken)] p-2 transition-opacity ${
            loading && listing ? "pointer-events-none opacity-55" : ""
          }`}
        >
          {loading && !listing ? (
            <div role="status" className="flex min-h-44 items-center justify-center text-xs text-[var(--text-faint)]">
              {t("gallery.loading-folder")}
            </div>
          ) : error ? (
            <div role="alert" className="flex min-h-44 flex-col items-center justify-center gap-2 px-4 text-center">
              <p className="text-xs font-semibold text-[var(--text)]">{t("gallery.folder-access-failed")}</p>
              <p className="max-w-lg break-all text-[11px] text-[var(--text-faint)]">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  setReloadId((id) => id + 1);
                }}
                className="mt-1 rounded-md border border-[var(--line)] px-3 py-1.5 text-[11px] font-semibold text-[var(--text-dim)] hover:bg-[var(--panel-strong)]"
              >
                {t("common.retry")}
              </button>
            </div>
          ) : currentPath === null ? (
            entries.length === 0 && query ? (
              <div className="flex min-h-44 items-center justify-center text-xs text-[var(--text-faint)]">
                {t("gallery.no-search-matches")}
              </div>
            ) : <div className="space-y-4 p-1">
              {locations.length > 0 && (
                <section>
                  <h3 className="kicker mb-2 px-1 !text-[var(--text-faint)]">{t("gallery.quick-access")}</h3>
                  <div className="grid gap-1 sm:grid-cols-2">{renderRows(locations)}</div>
                </section>
              )}
              <section>
                <h3 className="kicker mb-2 px-1 !text-[var(--text-faint)]">{t("gallery.drives")}</h3>
                {drives.length > 0 ? (
                  <div className="grid gap-1 sm:grid-cols-2">{renderRows(drives)}</div>
                ) : (
                  <p className="px-1 py-2 text-xs text-[var(--text-faint)]">{t("gallery.no-drives-found")}</p>
                )}
              </section>
            </div>
          ) : entries.length > 0 ? (
            <div className="space-y-4">
              {folders.length > 0 && (
                <section>
                  <h3 className="kicker mb-1 px-1 !text-[var(--text-faint)]">{t("gallery.folders")}</h3>
                  <div className="grid gap-0.5 sm:grid-cols-2">{renderRows(folders)}</div>
                </section>
              )}
              {files.length > 0 && (
                <section>
                  <h3 className="kicker mb-1 px-1 !text-[var(--text-faint)]">{t("gallery.media-files")}</h3>
                  <div className="grid gap-0.5 sm:grid-cols-2">{renderRows(files)}</div>
                </section>
              )}
              {listing?.truncated && (
                <p className="px-1 text-[10px] text-[var(--text-faint)]">{t("gallery.folder-results-limited")}</p>
              )}
            </div>
          ) : (
            <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-center">
              <IconFolder className="h-6 w-6 text-[var(--text-faint)]" />
              <p className="text-xs text-[var(--text-faint)]">{t(query ? "gallery.no-search-matches" : "gallery.no-supported-media")}</p>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-3">
          <span className="text-[11px] text-[var(--text-faint)]">
            {mode === "files"
              ? t("gallery.{n}-selected", { n: selected.size })
              : currentPath
                ? t("gallery.folder-ready")
                : t("gallery.choose-folder-to-continue")}
          </span>
          {mode === "files" ? (
            <button
              type="button"
              onClick={() => onImportFiles([...selected])}
              disabled={selected.size === 0 || loading || !!error}
              className="rounded-lg border border-[rgb(var(--glow)/0.4)] bg-[rgb(var(--glow)/0.12)] px-4 py-2 text-xs font-semibold text-[rgb(var(--glow))] transition-colors hover:bg-[rgb(var(--glow)/0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.7)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("gallery.add-selected")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => currentPath && onImportFolder(currentPath)}
              disabled={!currentPath || loading || !!error}
              className="rounded-lg border border-[rgb(var(--glow)/0.4)] bg-[rgb(var(--glow)/0.12)] px-4 py-2 text-xs font-semibold text-[rgb(var(--glow))] transition-colors hover:bg-[rgb(var(--glow)/0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.7)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("gallery.use-this-folder")}
            </button>
          )}
        </footer>
      </div>
  );
}
