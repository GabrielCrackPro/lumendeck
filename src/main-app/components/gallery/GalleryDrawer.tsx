import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconFolder, IconPencil, IconRefresh, IconTrash } from "../icons";
import { Btn, Dropdown, Slider, displayName, type MonitorEntry } from "../ui";
import { t } from "../../i18n";
import { GALLERY_KIND_LABEL } from "./kindLabels";
import { formatDuration, formatResolution, mediaMeta, type MediaMeta } from "./mediaMeta";
import { collectionsOf } from "./galleryQuery";
import type { Unhealthy } from "./vaultHealth";
import type { EntryOptions, GalleryEntry, WallpaperCollection } from "@shared/types";

export interface GalleryDrawerProps {
  entry: GalleryEntry;
  collections: WallpaperCollection[];
  monitors: MonitorEntry[];
  screenNames: Record<string, string>;
  perMonitor: Record<string, { kind: string; source: string } | undefined>;
  /** The globally applied entry, so the drawer can say what "live" means. */
  activeEntry: GalleryEntry | null;
  url: string;
  preview: ReactNode;
  renaming: boolean;
  renameValue: string;
  onRenameValue: (v: string) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onCommitRename: () => void;
  onApplyAll: () => void;
  onApplyToMonitor: (device: string) => void;
  onClearMonitor: (device: string) => void;
  onToggleCollection: (collectionId: string) => void;
  onRemove: () => void;
  onClose: () => void;
  /** "missing" when the file is gone, "duplicate" when another entry is the
   *  same file. Null when the entry is fine. */
  health: Unhealthy | null;
  onSetOpts: (patch: Partial<EntryOptions>) => void;
  onResetOpts: () => void;
  onReveal: () => void;
  onRegenerateThumb: () => void;
  /** The global values the entry would go back to, for the "inherits" hints. */
  globalOpts: { fit: string; speed: number; volume: number };
}

function useMediaMeta(url: string, entry: GalleryEntry): MediaMeta | null {
  const [meta, setMeta] = useState<MediaMeta | null>(null);
  useEffect(() => {
    let live = true;
    void mediaMeta(url, entry.kind).then((m) => {
      if (live) setMeta(m);
    });
    return () => {
      live = false;
    };
  }, [url, entry.kind]);
  return meta;
}

/** One label/value cell of the facts grid. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="kicker !text-[var(--text-faint)]">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-xs text-[var(--text)]">{value}</dd>
    </div>
  );
}

/**
 * The detail view for one vault entry, as a slide-over drawer.
 *
 * It covers the right edge of the grid instead of taking width from it. The
 * earlier version was a permanent 320px column that appeared on selection, so
 * every time you picked something to look at, the vault you were browsing
 * reflowed sideways underneath you. An overlay leaves the grid exactly where it
 * was, which is the whole point of a browsing surface.
 *
 * Inside, the name is pinned to a header that never scrolls away — it is what
 * you are reading the rest of the panel about — the media facts sit in a grid
 * where you can compare them at a glance, and the two groups below are plain
 * labelled blocks. The collapsible sections they replaced were two short lists
 * behind two chevrons: the interaction cost more than the space it saved.
 *
 * Portalled to <body> for the same reason the modal is: the vault `Card` has a
 * `backdrop-filter`, which makes it a containing block for `position: fixed`.
 * Written in place, the scrim would cover only the card and the drawer would be
 * pinned to the card's right edge and height rather than the window's.
 */
export function GalleryDrawer({
  entry,
  collections,
  monitors,
  screenNames,
  perMonitor,
  activeEntry,
  url,
  preview,
  renaming,
  renameValue,
  onRenameValue,
  onStartRename,
  onCancelRename,
  onCommitRename,
  onApplyAll,
  onApplyToMonitor,
  onClearMonitor,
  onToggleCollection,
  onRemove,
  onClose,
  health,
  onSetOpts,
  onResetOpts,
  onReveal,
  onRegenerateThumb,
  globalOpts,
}: GalleryDrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const meta = useMediaMeta(url, entry);
  const resolution = formatResolution(meta);
  const duration = formatDuration(meta?.duration ?? null);
  const mine = collectionsOf(entry, collections);
  const isActive = activeEntry?.id === entry.id;
  const opts = entry.opts ?? {};
  // An override that equals the global value is not an override; leaving it set
  // would mean the entry stopped following the global setting the moment the
  // global setting was changed, which is the opposite of what the user meant.
  const hasOverrides = Object.keys(opts).length > 0;
  const isPlayable = entry.kind === "video" || entry.kind === "image";

  // The grid's Escape already closes the drawer, but Escape must also work when
  // focus has moved into it, which is where it usually is once you rename or
  // pick a display.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus in so the drawer's controls are reachable by Tab, and hand it
  // back to the grid when it closes.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return createPortal(
    <>
      <div
        className="drawer-scrim fixed inset-0 z-40 bg-black/35"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={entry.name}
        tabIndex={-1}
        className="drawer-panel fixed right-0 top-0 z-50 flex h-full w-[min(380px,92vw)] flex-col border-l border-[var(--line-strong)] bg-[color-mix(in_srgb,var(--bg)_94%,transparent)] shadow-[-24px_0_60px_-20px_rgb(0_0_0/0.7)] outline-none backdrop-blur-xl"
      >
        <header className="shrink-0 border-b border-[var(--line)] bg-[var(--panel-sunken)] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="kicker min-w-0 flex-1 truncate !text-[var(--text-dim)]">
              {t("gallery.details")}
            </span>
            {isActive && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-[rgb(var(--glow))] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#06121f]">
                <span className="h-1 w-1 rounded-full bg-[#06121f]" />
                {t("shell.live")}
              </span>
            )}
            <button
              onClick={onClose}
              aria-label={t("common.close")}
              className="shrink-0 rounded px-1.5 text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
            >
              ✕
            </button>
          </div>

          <div className="mt-1 flex min-w-0 items-start gap-1.5">
            {renaming ? (
              <form
                className="min-w-0 flex-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  onCommitRename();
                }}
              >
                <input
                  autoFocus
                  value={renameValue}
                  aria-label={t("gallery.rename-entry")}
                  onChange={(e) => onRenameValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && onCancelRename()}
                  onBlur={onCommitRename}
                  className="w-full rounded-md border border-[rgb(var(--glow)/0.5)] bg-[var(--panel-strong)] px-2 py-1 text-sm font-semibold text-[var(--text)] outline-none"
                />
              </form>
            ) : (
              <>
                <div className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text)]">
                  {entry.name}
                </div>
                <button
                  aria-label={t("gallery.rename-entry")}
                  onClick={onStartRename}
                  className="shrink-0 rounded p-1 text-[var(--text-faint)] transition-colors hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
                >
                  <IconPencil className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {health && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-200">
              <span className="shrink-0 font-semibold">
                {t(health === "missing" ? "gallery.file-is-missing" : "gallery.duplicated-entry")}
              </span>
              <span className="min-w-0 text-amber-200/80">
                {t(
                  health === "missing"
                    ? "gallery.file-is-missing-hint"
                    : "gallery.duplicated-entry-hint",
                )}
              </span>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel-sunken)]">
            <div className="aspect-video w-full">{preview}</div>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label={t("gallery.type")} value={t(GALLERY_KIND_LABEL[entry.kind])} />
            {resolution && <Fact label={t("gallery.resolution")} value={resolution} />}
            {duration && <Fact label={t("gallery.duration")} value={duration} />}
            <Fact
              label={t("gallery.in-collections")}
              value={
                mine.length === 0
                  ? t("gallery.none")
                  : mine.map((c) => c.name).join(", ")
              }
            />
          </dl>

          <div className="space-y-2">
            <Btn
              variant="primary"
              className="w-full"
              onClick={onApplyAll}
              disabled={isActive}
            >
              {isActive ? t("gallery.applied-everywhere") : t("gallery.apply-to-all")}
            </Btn>
            <div className="flex justify-end">
              <button
                onClick={onRemove}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--text-faint)] transition-colors hover:bg-red-500/10 hover:text-red-400"
              >
                <IconTrash className="h-4 w-4" />
                {t("gallery.remove-entry")}
              </button>
            </div>
          </div>

          {isPlayable && (
            <div>
              <div className="kicker mb-1 flex items-center gap-2 !text-[var(--text-faint)]">
                {t("gallery.playback")}
                {hasOverrides && (
                  <button
                    onClick={onResetOpts}
                    className="ml-auto normal-case tracking-normal text-[var(--text-dim)] underline underline-offset-2 transition-colors hover:text-[var(--text)]"
                  >
                    {t("gallery.use-global-settings")}
                  </button>
                )}
              </div>
              <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-2.5 py-0.5">
                <Dropdown
                  compact
                  ariaLabel={t("gallery.fit")}
                  value={opts.fit ?? "inherit"}
                  onChange={(v) =>
                    onSetOpts({ fit: v === "inherit" ? undefined : v })
                  }
                  className="w-full border-0 bg-transparent"
                  options={[
                    { id: "inherit", label: t("gallery.fit-inherit") },
                    { id: "cover", label: t("gallery.fit-cover") },
                    { id: "contain", label: t("gallery.fit-contain") },
                    { id: "fill", label: t("gallery.fit-fill") },
                    { id: "auto", label: t("gallery.fit-auto") },
                  ]}
                />
                <div className="px-0.5">
                  <Slider
                    label={t("gallery.speed")}
                    value={opts.speed ?? globalOpts.speed}
                    min={0.1}
                    max={4}
                    step={0.05}
                    format={(v) => `${v.toFixed(2)}${v === (opts.speed ?? globalOpts.speed) ? "" : " *"}`}
                    onChange={(v) =>
                      onSetOpts({ speed: v === globalOpts.speed ? undefined : v })
                    }
                  />
                  <Slider
                    label={t("gallery.volume")}
                    value={opts.volume ?? globalOpts.volume}
                    min={0}
                    max={1}
                    step={0.01}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) =>
                      onSetOpts({ volume: v === globalOpts.volume ? undefined : v })
                    }
                  />
                </div>
              </div>
              <p className="text-dim-sm mt-1.5">
                {t("gallery.playback-hint")}
              </p>
            </div>
          )}

          {isPlayable && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={onReveal}
                className="flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--text-dim)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text)]"
              >
                <IconFolder className="h-4 w-4" />
                {t("gallery.reveal-in-explorer")}
              </button>
              <button
                onClick={onRegenerateThumb}
                className="flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--text-dim)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text)]"
              >
                <IconRefresh className="h-4 w-4" />
                {t("gallery.regenerate-thumbnail")}
              </button>
            </div>
          )}

          {monitors.length > 0 && (
            <div>
              <div className="kicker mb-2 !text-[var(--text-faint)]">
                {t("gallery.per-display")}
              </div>
              <div className="space-y-1">
                {monitors.map((m, i) => {
                  const o = perMonitor[m.device];
                  const onThis = o && o.kind === entry.kind && o.source === entry.source;
                  const overridden = !!o;
                  return (
                    <div key={m.device || i} className="flex items-center gap-1.5">
                      <button
                        onClick={() => onApplyToMonitor(m.device)}
                        className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                          onThis
                            ? "border-[rgb(var(--glow)/0.5)] bg-[rgb(var(--glow)/0.12)]"
                            : "border-[var(--line)] bg-[var(--panel)] hover:border-[var(--line-strong)]"
                        }`}
                      >
                        <span className="truncate text-xs text-[var(--text)]">
                          {displayName(m, i, screenNames)}
                        </span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--text-faint)]">
                          {`${m.w}×${m.h}`}
                        </span>
                        {onThis && (
                          <span className="shrink-0 text-[rgb(var(--glow))]">
                            <IconCheck className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                      {overridden && (
                        <button
                          onClick={() => onClearMonitor(m.device)}
                          title={t("common.reset-to-global")}
                          aria-label={t("common.reset-to-global")}
                          className="shrink-0 rounded-md border border-[var(--line)] px-1.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-faint)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--text)]"
                        >
                          {t("common.reset")}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="kicker mb-2 !text-[var(--text-faint)]">
              {t("common.collections")}
            </div>
            {collections.length === 0 ? (
              <p className="text-xs text-[var(--text-faint)]">
                {t("common.no-collections-yet-create-one-with-the-in-the-ta")}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {collections.map((c) => {
                  const member = mine.some((x) => x.id === c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => onToggleCollection(c.id)}
                      aria-pressed={member}
                      className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                        member
                          ? "bg-[rgb(var(--glow)/0.18)] text-[rgb(var(--glow))]"
                          : "bg-[var(--panel)] text-[var(--text-dim)] hover:bg-[var(--panel-strong)]"
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
