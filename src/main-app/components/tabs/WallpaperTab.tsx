import { useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store";
import { Card, Btn, Slider, Toggle, TextInput, NumberField, Section, chipStyle } from "../ui";
import { IconImage, IconLayers, IconGlobe, IconPlus, IconTrash, IconPencil, IconPlay, IconFolder } from "../icons";
import { SHADERS, SHADER_ART } from "@shared/constants";
import type { Config, GalleryEntry, WallpaperKind, ZoneDef } from "@shared/types";
import { api } from "../../ipc";
import { truncateError } from "../../utilities";

const KIND_META: Record<WallpaperKind, { label: string }> = {
  video: { label: "Video" },
  image: { label: "Image" },
  slideshow: { label: "Slideshow" },
  web: { label: "Web" },
  shader: { label: "Shader" },
};

/** How many gallery tiles are mounted at once. The vault is unbounded and
 *  every tile is a real element, so the rest is revealed on demand. */
const GALLERY_PAGE = 48;

/**
 * Reports when an element is close to the viewport. Video tiles mount a
 * <video> that eagerly decodes a frame, so a vault of a few hundred
 * wallpapers would otherwise open a few hundred decoders at once.
 */
function useNearViewport<T extends HTMLElement>(rootMargin = "240px") {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, rootMargin]);
  return { ref, near };
}

/** Thumbnail for a gallery entry: hover-playing video, image, or art tile. */
function GalleryThumb({ entry }: { entry: GalleryEntry }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const { ref: nearRef, near } = useNearViewport<HTMLDivElement>();

  if (entry.kind === "video") {
    return (
      <div ref={nearRef} className="relative h-full w-full bg-[var(--panel-strong)]">
        {!thumbLoaded && !playing && (
          <div className="absolute inset-0 animate-pulse bg-[linear-gradient(110deg,var(--panel-strong),var(--panel)_45%,var(--panel-strong))]" />
        )}
        {/* Off-screen tiles keep just the still; the decoder waits for the
            tile to come near the viewport. */}
        {near && (
        <video
          ref={videoRef}
          // #t=1 makes the browser decode & paint a frame at 1s eagerly, so the
          // tile shows real imagery without any hover (preload=metadata).
          src={`${convertFileSrc(entry.source, "media")}#t=1`}
          muted
          loop
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
          onMouseEnter={() => videoRef.current?.play().catch(() => {})}
          onMouseLeave={() => videoRef.current?.pause()}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        )}
        {entry.thumb && !playing && (
          <img
            src={entry.thumb}
            alt={entry.name}
            onLoad={() => setThumbLoaded(true)}
            className="absolute inset-0 h-full w-full bg-black/50 object-cover"
          />
        )}
        {!playing && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur">
              <IconPlay className="h-3.5 w-3.5" fill="currentColor" stroke="none" />
            </span>
          </div>
        )}
      </div>
    );
  }
  if (entry.kind === "image") {
    return (
      <div className="relative h-full w-full bg-[var(--panel-strong)]">
        <img
          src={entry.thumb ?? convertFileSrc(entry.source, "media")}
          alt={entry.name}
          loading="lazy"
          className="h-full w-full bg-black/50 object-cover"
        />
      </div>
    );
  }
  if (entry.kind === "shader") {
    return (
      <div
        className="h-full w-full transition-transform duration-500 group-hover:scale-105"
        style={{ background: SHADER_ART[entry.source] ?? SHADER_ART.aurora }}
      />
    );
  }
  const Icon = entry.kind === "web" ? IconGlobe : IconLayers;
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--panel-strong)] to-[var(--panel)]">
      <Icon className="h-7 w-7 text-[var(--text-faint)]" />
    </div>
  );
}

type MonEntry = Awaited<ReturnType<typeof api.monitors>>[number];

export default function WallpaperTab() {
  const { cfg, rgb, save } = useStore(
    useShallow((s) => ({ cfg: s.cfg, rgb: s.rgb, save: s.save })),
  );
  const [busy, setBusy] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [dropCount, setDropCount] = useState(0);
  const [mons, setMons] = useState<MonEntry[]>([]);
  const [assignFor, setAssignFor] = useState<string | null>(null); // gallery entry id
  const [activeCollection, setActiveCollection] = useState<string>("all"); // filter
  const [query, setQuery] = useState(""); // vault search
  const [limit, setLimit] = useState(GALLERY_PAGE);
  const [addToCol, setAddToCol] = useState<string | null>(null); // entry-picker target
  const [playlistFor, setPlaylistFor] = useState<string | null>(null); // open editor
  const [colNaming, setColNaming] = useState(false);
  const [colNameVal, setColNameVal] = useState("");
  const [plNaming, setPlNaming] = useState(false);
  const [plNameVal, setPlNameVal] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .monitors()
      .then((m) => alive && setMons(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Drag-and-drop import: Tauri intercepts file drops at the window level.
  useEffect(() => {    let disposed = false;
    let unlisten: (() => void) | undefined;
    let importSeq = 0;

    getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        if (disposed) return;
        if (event.payload.type === "enter") {
          setDropCount(event.payload.paths.length);
          setDropActive(true);
        } else if (event.payload.type === "over") {
          setDropActive(true);
        } else if (event.payload.type === "drop") {
          setDropActive(false);
          const paths = event.payload.paths;
          if (paths.length === 0) return;
          const seq = ++importSeq;
          setBusy(true);
          api
            .galleryImportPaths(paths)
            .then((list) => {
              if (seq !== importSeq) return;
              toast("ok", `Imported ${list.length} item${list.length === 1 ? "" : "s"}`);
            })
            .catch((e) => {
              console.error("gallery drop import failed:", e);
              toast("error", `Drop import failed: ${truncateError(e)}`);
            })
            .finally(() => {
              if (seq === importSeq) setBusy(false);
            });
        } else {
          setDropActive(false);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (!cfg) return null;
  const wall = cfg.wallpaper;
  const galleryAll = [...cfg.gallery].sort((a, b) => b.addedMs - a.addedMs);
  const collections = cfg.collections ?? [];
  const playlists = cfg.playlists ?? [];
  // Collection filter: "all" = whole vault, otherwise membership list.
  const gallery = (
    activeCollection === "all"
      ? galleryAll
      : galleryAll.filter((g) =>
          collections
            .find((c) => c.id === activeCollection)
            ?.entryIds.includes(g.id),
        )
  ).filter((g) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return g.name.toLowerCase().includes(q);
  });
  // Only the first page of tiles is mounted; the rest waits for "show more".
  const visibleGallery = gallery.slice(0, limit);
  const isActive = (g: GalleryEntry) => g.kind === wall.kind && g.source === wall.source;
  const inCollection = (g: GalleryEntry, colId: string) =>
    collections.find((c) => c.id === colId)?.entryIds.includes(g.id) ?? false;

  const overrides = wall.perMonitor ?? {};
  /** Displays an entry is running on: overrides matching it, or all displays when it's the global source. */
  const displaysFor = (g: GalleryEntry): MonEntry[] => {
    const matched = mons.filter((m) => {
      const o = overrides[m.device];
      return o && o.kind === g.kind && o.source === g.source;
    });
    if (isActive(g) && matched.length === 0) return mons;
    return matched;
  };
  const applyToAll = (g: GalleryEntry) =>
    api
      .galleryApply(g.id)
      .then(() => toast("ok", `Applied "${g.name}" to every display`))
      .catch((e) => toast("error", `Apply failed: ${truncateError(e)}`));
  const applyToMonitor = (g: GalleryEntry, device: string) =>
    api
      .galleryApplyMonitor(g.id, device)
      .then(() => toast("ok", `Applied "${g.name}" to that display`))
      .catch((e) => toast("error", `Apply failed: ${truncateError(e)}`));
  const clearMonitor = (device: string) =>
    api
      .galleryApplyMonitor(null, device)
      .then(() => toast("info", "Display reset to the global wallpaper"))
      .catch((e) => toast("error", `Reset failed: ${truncateError(e)}`));

  const toast = (tone: "error" | "info" | "ok", msg: string) =>
    useStore.getState().toast(tone, msg);
  const undoDelete = (msg: string, restore: (c: Config) => void) =>
    useStore.getState().undoDelete(msg, restore);

  const addToGallery = async (kind: WallpaperKind, source: string, name: string) => {
    try {
      const list = await api.galleryAdd({ name, kind, source });
      const added = list.find((g) => g.source === source && g.kind === kind);
      if (added) await api.galleryApply(added.id);
      toast("ok", `Applied "${added?.name ?? name}" from the vault`);
    } catch (e) {
      toast("error", `Import failed: ${truncateError(e)}`);
    }
  };

  const pickAndAdd = async (kind: "video" | "image") => {
    setBusy(true);
    try {
      const file = await api.pickMediaFile();
      if (file)
        await addToGallery(
          kind,
          file,
          file.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "Untitled",
        );
    } catch (e) {
      toast("error", `Import failed: ${truncateError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const pickSlideshow = async () => {
    setBusy(true);
    try {
      const folder = await api.pickMediaFolder();
      if (!folder) return;
      const list = await api.galleryImportFolder(folder);
      toast("ok", `Imported ${list.length} item${list.length === 1 ? "" : "s"} from the folder`);
    } catch (e) {
      toast("error", `Folder import failed: ${truncateError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const updateZone = (id: string, patch: Partial<ZoneDef>) =>
    save((c) => {
      const z = c.rgb.zones.find((z) => z.id === id);
      if (z) Object.assign(z, patch);
    });

  return (
    <div className="stagger space-y-6">
        <Card
          title="Vault"
          right={
            <span className="font-mono text-[10px] tracking-wide text-[var(--text-faint)]">
              {gallery.length} item{gallery.length === 1 ? "" : "s"}
            </span>
          }
        >
          {/* collection tabs */}
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <div className="relative mr-1">
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(GALLERY_PAGE);
                }}
                placeholder="Search vault"
                aria-label="Search wallpapers by name"
                className="w-40 rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-1 pl-7 text-xs text-[var(--text)] outline-none transition-colors placeholder:text-[var(--text-faint)] focus:border-[rgb(var(--glow)/0.5)]"
              />
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <circle cx="5" cy="5" r="3.5" />
                  <path d="M7.5 7.5L11 11" strokeLinecap="round" />
                </svg>
              </span>
            </div>
            <button
              onClick={() => {
                setActiveCollection("all");
                setLimit(GALLERY_PAGE);
              }}
              className={`rounded-full px-3 py-1 text-xs ${chipStyle(activeCollection === "all")}`}
            >
              All · {cfg.gallery.length}
            </button>
            {collections.map((c) => (
              <div key={c.id} className="group/col relative">
                <button
                  onClick={() => {
                    setActiveCollection(c.id);
                    setLimit(GALLERY_PAGE);
                  }}
                  onDoubleClick={() => {
                    const name = window.prompt("Rename collection", c.name);
                    if (name?.trim())
                      api
                        .collectionRename(c.id, name.trim())
                        .catch((e) => toast("error", `Rename failed: ${truncateError(e)}`));
                  }}
                  className={`rounded-full px-3 py-1 text-xs ${chipStyle(activeCollection === c.id)}`}
                >
                  {c.name} · {c.entryIds.length}
                </button>
                <button
                  aria-label={`Delete collection ${c.name}`}
                  onClick={() => {
                    api
                      .collectionDelete(c.id)
                      .then(() => {
                        if (activeCollection === c.id) setActiveCollection("all");
                        undoDelete(
                          `Deleted collection "${c.name}" (vault items kept)`,
                          (next) => {
                            next.collections.push(c);
                            if (activeCollection === c.id) setActiveCollection(c.id);
                          },
                        );
                      })
                      .catch((e) => toast("error", `Delete failed: ${truncateError(e)}`));
                  }}
                  className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-red-500/90 text-[9px] font-bold text-white group-hover/col:flex"
                >
                  ×
                </button>
              </div>
            ))}
            {colNaming ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = colNameVal.trim();
                  if (name)
                    api
                      .collectionCreate(name)
                      .then((col) => setActiveCollection(col.id))
                      .catch((e) => toast("error", `Create failed: ${truncateError(e)}`));
                  setColNaming(false);
                }}
              >
                <input
                  autoFocus
                  value={colNameVal}
                  onChange={(e) => setColNameVal(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setColNaming(false)}
                  placeholder="Collection name"
                  className="w-32 rounded-full border border-[rgb(var(--glow)/0.4)] bg-[var(--panel-strong)] px-3 py-1 text-xs font-semibold text-[var(--text)] outline-none"
                />
              </form>
            ) : (
              <button
                onClick={() => {
                  setColNaming(true);
                  setColNameVal("");
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-[var(--line-strong)] text-[var(--text-faint)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[rgb(var(--glow))]"
                title="New collection"
              >
                <IconPlus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div
            className="relative"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "none";
            }}
            onDrop={(e) => e.preventDefault()}
          >
            {dropActive && (
              <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-[rgb(var(--glow)/0.7)] bg-[rgb(var(--glow)/0.08)] backdrop-blur-[2px]">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgb(var(--glow)/0.2)]">
                  <IconPlus className="h-6 w-6 text-[rgb(var(--glow))]" />
                </div>
                <span className="text-sm font-semibold text-[rgb(var(--glow))]">
                  Drop {dropCount > 1 ? `${dropCount} items` : "file or folder"} to import
                </span>
                <span className="text-[11px] text-[var(--text-dim)]">
                  videos, images and folders become vault cards
                </span>
              </div>
            )}
            {/* import toolbar */}
            <div className="mb-4 flex flex-wrap items-center gap-2.5">
              <Btn variant="primary" disabled={busy} onClick={() => pickAndAdd("video")}>
                <IconPlus className="h-4 w-4" />
                Add video
              </Btn>
              <Btn disabled={busy} onClick={() => pickAndAdd("image")}>
                <IconImage className="h-4 w-4" />
                Add image
              </Btn>
              <Btn disabled={busy} onClick={pickSlideshow}>
                <IconLayers className="h-4 w-4" />
                Import folder
              </Btn>
              <Btn disabled={busy} onClick={() => setUrlOpen(true)}>
                <IconGlobe className="h-4 w-4" />
                From URL
              </Btn>
              <span className="ml-auto hidden text-[11px] text-[var(--text-faint)] sm:block">
                …or drop files and folders anywhere in the vault
              </span>
              {urlOpen && (
                <UrlImport
                  busy={busy}
                  onCancel={() => setUrlOpen(false)}
                  onSubmit={async (url, name) => {
                    setBusy(true);
                    try {
                      const list = await api.galleryAddFromUrl(url, name || undefined);
                      const added = list[list.length - 1];
                      if (added) await api.galleryApply(added.id);
                      toast("ok", `Downloaded and applied "${added?.name ?? (name || url)}"`);
                      setUrlOpen(false);
                    } catch (e) {
                      toast("error", `URL import failed: ${truncateError(e)}`);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">

              {visibleGallery.map((g) => (
                <div
                  key={g.id}
                  className={`group relative aspect-video cursor-pointer overflow-hidden rounded-xl border transition-all duration-300 hover:-translate-y-0.5 ${
                    isActive(g)
                      ? "border-[rgb(var(--glow)/0.7)] shadow-[0_14px_36px_-14px_rgb(var(--glow)/0.55)] ring-2 ring-[rgb(var(--glow)/0.22)]"
                      : "border-[var(--line)] bg-[var(--panel-strong)] hover:border-[var(--line-strong)] hover:shadow-[var(--shadow)]"
                  }`}
                  onClick={() => applyToAll(g)}
                >
                  <div className="h-full w-full transition-transform duration-500 group-hover:scale-[1.05]">
                    <GalleryThumb entry={g} />
                  </div>
                  {/* running-on badges: which displays show this entry */}
                  {displaysFor(g).length > 0 && (
                    <div className="absolute left-2 top-2 flex gap-1">
                      {displaysFor(g).map((m, i) => (
                        <span
                          key={m.device || i}
                          className="flex h-5 min-w-5 items-center justify-center rounded-md bg-[rgb(var(--glow))] px-1 font-mono text-[10px] font-bold text-[#06121f] shadow-[0_0_10px_rgb(var(--glow)/0.6)]"
                          title={`${m.w}×${m.h}${m.primary ? " (primary)" : ""}`}
                        >
                          {mons.findIndex((x) => x.device === m.device) + 1}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* hover scrim + apply affordances: all displays / per-display split */}
                  {!isActive(g) && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/35 group-hover:opacity-100">
                      <span className="rounded-full border border-white/25 bg-black/55 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur">
                        All displays
                      </span>
                      {mons.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setAssignFor(assignFor === g.id ? null : g.id);
                          }}
                          className="pointer-events-auto rounded-full border border-white/25 bg-black/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition-colors hover:bg-black/75"
                        >
                          Per display…
                        </button>
                      )}
                    </div>
                  )}
                  {/* per-display assignment popover */}
                  {assignFor === g.id && (
                    <div
                      className="absolute inset-0 z-10 flex flex-col gap-1.5 overflow-auto bg-black/80 p-3 backdrop-blur-sm"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between">
                        <span className="kicker !text-white/60">Assign to display</span>
                        <button
                          onClick={() => setAssignFor(null)}
                          className="text-white/60 transition-colors hover:text-white"
                          aria-label="Close"
                        >
                          ✕
                        </button>
                      </div>
                      {mons.map((m, i) => {
                        const o = overrides[m.device];
                        const mine = o && o.kind === g.kind && o.source === g.source;
                        return (
                          <div key={m.device || i} className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                applyToMonitor(g, m.device);
                                setAssignFor(null);
                              }}
                              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-left transition-colors hover:bg-white/15"
                            >
                              <span className="font-mono text-[10px] font-bold text-white/50">{i + 1}</span>
                              <span className="truncate text-xs font-semibold text-white">
                                {m.w} × {m.h}
                                {m.primary && <span className="ml-1 text-white/50">· primary</span>}
                              </span>
                              {o && !mine && (
                                <span className="ml-auto shrink-0 text-[10px] text-white/40">
                                  override
                                </span>
                              )}
                            </button>
                            {o && (
                              <button
                                onClick={() => clearMonitor(m.device)}
                                title="Reset to global"
                                className="shrink-0 rounded-md border border-white/15 px-1.5 py-1 text-[10px] text-white/50 transition-colors hover:text-white"
                              >
                                reset
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* add-to-collection popover */}
                  {addToCol === g.id && (
                    <div
                      className="absolute inset-0 z-10 flex flex-col gap-1.5 overflow-auto bg-black/80 p-3 backdrop-blur-sm"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between">
                        <span className="kicker !text-white/60">Collections</span>
                        <button
                          onClick={() => setAddToCol(null)}
                          className="text-white/60 transition-colors hover:text-white"
                          aria-label="Close"
                        >
                          ✕
                        </button>
                      </div>
                      {collections.length === 0 && (
                        <div className="px-1 py-2 text-xs text-white/50">
                          No collections yet — create one with the + in the tab bar.
                        </div>
                      )}
                      {collections.map((c) => {
                        const member = inCollection(g, c.id);
                        return (
                          <button
                            key={c.id}
                            onClick={() =>
                              api
                                .collectionToggleEntry(c.id, g.id)
                                .then((added) =>
                                  toast(
                                    "ok",
                                    added
                                      ? `Added to "${c.name}"`
                                      : `Removed from "${c.name}"`,
                                  ),
                                )
                                .catch((e) => toast("error", `Failed: ${truncateError(e)}`))
                            }
                            className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-xs font-semibold transition-colors ${
                              member
                                ? "border-[rgb(var(--glow)/0.5)] bg-[rgb(var(--glow)/0.15)] text-white"
                                : "border-white/15 bg-white/5 text-white/80 hover:bg-white/15"
                            }`}
                          >
                            {c.name}
                            {member && <span className="text-[10px]">member</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-1.5 pt-6">
                    {renaming === g.id ? (
                      <form
                        onClick={(e) => e.stopPropagation()}
                        onSubmit={(e) => {
                          e.preventDefault();
                          const name = renameVal.trim();
                          if (name) {
                            save((c) => {
                              const entry = c.gallery.find((x) => x.id === g.id);
                              if (entry) entry.name = name;
                            });
                          }
                          setRenaming(null);
                        }}
                      >
                        <input
                          autoFocus
                          value={renameVal}
                          onChange={(e) => setRenameVal(e.target.value)}
                          onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                          className="w-full rounded-md border border-white/30 bg-black/60 px-1.5 py-0.5 text-xs font-semibold text-white outline-none"
                        />
                      </form>
                    ) : (
                      <div className="flex items-center gap-1">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold text-white">{g.name}</div>
                          <div className="kicker mt-0.5 !text-white/50">{KIND_META[g.kind].label}</div>
                        </div>
                        <button
                          aria-label={`Rename ${g.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenaming(g.id);
                            setRenameVal(g.name);
                          }}
                          className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/15 bg-black/50 text-white/70 backdrop-blur transition-colors hover:text-white group-hover:flex"
                        >
                          <IconPencil className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                  {isActive(g) && (
                    <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-[rgb(var(--glow))] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#06121f] shadow-[0_0_14px_rgb(var(--glow)/0.7)]">
                      <span className="h-1 w-1 rounded-full bg-[#06121f]" />
                      LIVE
                    </div>
                  )}
                  <button
                    aria-label={`Add ${g.name} to collection`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAddToCol(addToCol === g.id ? null : g.id);
                    }}
                    className="absolute right-11 top-2 hidden h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/70 backdrop-blur transition-colors hover:text-white group-hover:flex"
                  >
                    <IconFolder className="h-3.5 w-3.5" />
                  </button>
                  <button
                    aria-label={`Remove ${g.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      api
                        .galleryRemove(g.id)
                        .then(() =>
                          undoDelete(`Removed "${g.name}" from the vault`, (next) => {
                            next.gallery.push(g);
                          }),
                        )
                        .catch((e) => toast("error", `Remove failed: ${truncateError(e)}`));
                    }}
                    className="absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/70 backdrop-blur transition-colors hover:bg-red-500 hover:text-white group-hover:flex"
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {visibleGallery.length < gallery.length && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => setLimit((n) => n + GALLERY_PAGE)}
                  className="rounded-full border border-[var(--line-strong)] bg-[var(--panel-strong)] px-5 py-2 text-xs font-semibold text-[var(--text-dim)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[rgb(var(--glow))]"
                >
                  Show {Math.min(GALLERY_PAGE, gallery.length - visibleGallery.length)} more
                  <span className="ml-1.5 font-mono text-[10px] text-[var(--text-faint)]">
                    {visibleGallery.length} / {gallery.length}
                  </span>
                </button>
              </div>
            )}
          </div>

          {gallery.length === 0 && (
            <div className="mt-4 flex flex-col items-center gap-2.5 rounded-2xl border border-dashed border-[var(--line-strong)] px-6 py-12 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--panel-strong)] text-[var(--text-faint)]">
                <IconImage className="h-5 w-5" />
              </div>
              <div className="text-sm font-semibold text-[var(--text)]">
                {query.trim() ? "No matches" : "Vault is empty"}
              </div>
              <p className="max-w-sm text-xs leading-relaxed text-[var(--text-faint)]">
                {query.trim() ? (
                  <>
                    Nothing in this view is called “{query.trim()}”.{" "}
                    <button
                      onClick={() => setQuery("")}
                      className="text-[rgb(var(--glow))] underline underline-offset-2"
                    >
                      Clear the search
                    </button>
                    .
                  </>
                ) : (
                  <>
                    Add a video or image, or drop files and folders here — everything stays in
                    the vault and one click applies it to every display.
                  </>
                )}
              </p>
            </div>
          )}
        </Card>

        <Card
          title="Playlists"
          right={
            <span className="font-mono text-[10px] tracking-wide text-[var(--text-faint)]">
              {playlists.find((p) => p.enabled)?.name ?? "off"}
            </span>
          }
        >
          <p className="mb-4 text-sm leading-relaxed text-[var(--text-dim)]">
            Rotate wallpapers automatically: shuffle a collection on an interval,
            with optional time-of-day rules that swap the pool (e.g. dark shader
            at night, videos by day). One playlist runs at a time.
          </p>

          {plNaming ? (
            <form
              className="mb-4"
              onSubmit={(e) => {
                e.preventDefault();
                const name = plNameVal.trim();
                if (name)
                  api
                    .playlistCreate(name)
                    .then((pl) => setPlaylistFor(pl.id))
                    .catch((e) => toast("error", `Create failed: ${truncateError(e)}`));
                setPlNaming(false);
              }}
            >
              <input
                autoFocus
                value={plNameVal}
                onChange={(e) => setPlNameVal(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setPlNaming(false)}
                placeholder="Playlist name"
                className="w-56 rounded-xl border border-[rgb(var(--glow)/0.4)] bg-[var(--panel-strong)] px-3 py-2 text-sm font-semibold text-[var(--text)] outline-none"
              />
            </form>
          ) : (
            <div className="mb-4">
              <Btn
                onClick={() => {
                  setPlNaming(true);
                  setPlNameVal("");
                }}
              >
                <IconPlus className="h-4 w-4" />
                New playlist
              </Btn>
            </div>
          )}

          {playlists.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--line-strong)] px-4 py-6 text-center text-xs text-[var(--text-faint)]">
              No playlists yet — create one and pick a collection to shuffle.
            </div>
          ) : (
            <div className="space-y-3">
              {playlists.map((pl) => {
                const open = playlistFor === pl.id;
                const activeEntry = cfg.gallery.find(
                  (g) => g.kind === wall.kind && g.source === wall.source,
                );
                const pool =
                  pl.source === "all"
                    ? cfg.gallery
                    : cfg.gallery.filter((g) =>
                        collections
                          .find((c) => `collection:${c.id}` === pl.source)
                          ?.entryIds.includes(g.id),
                      );
                return (
                  <div
                    key={pl.id}
                    className={`rounded-2xl border p-4 transition-all ${
                      pl.enabled
                        ? "border-[rgb(var(--glow)/0.4)] bg-[rgb(var(--glow)/0.06)]"
                        : "border-[var(--line)] bg-[var(--panel-strong)]"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-[var(--text)]">
                            {pl.name}
                          </span>
                          {pl.enabled && (
                            <span className="rounded-full bg-[rgb(var(--glow))] px-2 py-0.5 font-mono text-[10px] font-bold text-[#06121f]">
                              RUNNING
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[var(--text-faint)]">
                          {pool.length} item{pool.length === 1 ? "" : "s"} ·{" "}
                          {pl.shuffleMin > 0 ? `every ${pl.shuffleMin} min` : "manual"}
                          {pl.rules.length > 0 && ` · ${pl.rules.length} time rule${pl.rules.length === 1 ? "" : "s"}`}
                          {pl.enabled && activeEntry && ` · now: ${activeEntry.name}`}
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          api
                            .playlistSetActive(pl.enabled ? null : pl.id)
                            .then(() =>
                              toast(
                                "ok",
                                pl.enabled
                                  ? "Playlist stopped"
                                  : `Playing "${pl.name}"`,
                              ),
                            )
                            .catch((e) => toast("error", `Failed: ${truncateError(e)}`))
                        }
                        className={`rounded-lg px-3 py-1.5 text-xs ${chipStyle(pl.enabled)}`}
                      >
                        {pl.enabled ? "Stop" : "Start"}
                      </button>
                      <button
                        onClick={() => setPlaylistFor(open ? null : pl.id)}
                        className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-xs font-semibold text-[var(--text-dim)] transition-colors hover:text-[var(--text)]"
                      >
                        {open ? "Close" : "Edit"}
                      </button>
                      <button
                        aria-label={`Delete playlist ${pl.name}`}
                        onClick={() =>
                          api
                            .playlistDelete(pl.id)
                            .then(() =>
                              undoDelete(`Deleted "${pl.name}"`, (next) => {
                                next.playlists.push(pl);
                              }),
                            )
                            .catch((e) => toast("error", `Delete failed: ${truncateError(e)}`))
                        }
                        className="text-[var(--text-faint)] transition-colors hover:text-red-400"
                      >
                        <IconTrash className="h-4 w-4" />
                      </button>
                    </div>

                    {open && (
                      <div className="mt-4 space-y-4 border-t border-[var(--line)] pt-4">
                        {/* source picker */}
                        <div>
                          <div className="kicker mb-2">Source</div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() =>
                                api
                                  .playlistSave({ ...pl, source: "all" })
                                  .catch(() => {})
                              }
                              className={`rounded-xl px-3 py-1.5 text-xs ${chipStyle(pl.source === "all")}`}
                            >
                              Whole vault
                            </button>
                            {collections.map((c) => (
                              <button
                                key={c.id}
                                onClick={() =>
                                  api
                                    .playlistSave({
                                      ...pl,
                                      source: `collection:${c.id}`,
                                    })
                                    .catch(() => {})
                                }
                                className={`rounded-xl px-3 py-1.5 text-xs ${chipStyle(pl.source === `collection:${c.id}`)}`}
                              >
                                {c.name}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* shuffle interval */}
                        <Slider
                          label="Shuffle every"
                          min={1}
                          max={180}
                          step={1}
                          value={pl.shuffleMin || 15}
                          format={(v) => `${Math.round(v)} min`}
                          onChange={(v) =>
                            api
                              .playlistSave({ ...pl, shuffleMin: Math.round(v) })
                              .catch(() => {})
                          }
                        />

                        {/* transition crossfade */}
                        <Slider
                          label="Transition crossfade"
                          min={0}
                          max={8}
                          step={0.5}
                          value={pl.crossfadeSec ?? 1.5}
                          format={(v) => (v === 0 ? "Instant cut" : `${v.toFixed(1)}s`)}
                          onChange={(v) =>
                            api
                              .playlistSave({ ...pl, crossfadeSec: v })
                              .catch(() => {})
                          }
                        />

                        {/* time-of-day rules */}
                        <div>
                          <div className="kicker mb-2">
                            Time-of-day rules (optional)
                          </div>
                          {pl.rules.length === 0 && (
                            <div className="mb-2 text-[11px] text-[var(--text-faint)]">
                              Without rules the playlist shuffles one pool all day.
                            </div>
                          )}
                          <div className="space-y-2">
                            {pl.rules.map((r, ri) => (
                              <div
                                key={ri}
                                className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-2"
                              >
                                <input
                                  type="time"
                                  value={r.start}
                                  onChange={(e) => {
                                    const rules = [...pl.rules];
                                    rules[ri] = { ...r, start: e.target.value };
                                    api
                                      .playlistSave({ ...pl, rules })
                                      .catch(() => {});
                                  }}
                                  className="rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-2 py-1 text-xs text-[var(--text)] outline-none"
                                />
                                <select
                                  value={r.source}
                                  onChange={(e) => {
                                    const rules = [...pl.rules];
                                    rules[ri] = { ...r, source: e.target.value };
                                    api
                                      .playlistSave({ ...pl, rules })
                                      .catch(() => {});
                                  }}
                                  className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-2 py-1 text-xs text-[var(--text)] outline-none"
                                >
                                  <option value="all">Whole vault</option>
                                  {collections.map((c) => (
                                    <option key={c.id} value={`collection:${c.id}`}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  aria-label="Delete rule"
                                  onClick={() =>
                                    api
                                      .playlistSave({
                                        ...pl,
                                        rules: pl.rules.filter((_, x) => x !== ri),
                                      })
                                      .catch(() => {})
                                  }
                                  className="text-[var(--text-faint)] transition-colors hover:text-red-400"
                                >
                                  <IconTrash className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                          <button
                            onClick={() =>
                              api
                                .playlistSave({
                                  ...pl,
                                  rules: [
                                    ...pl.rules,
                                    {
                                      start:
                                        pl.rules.length === 0
                                          ? "08:00"
                                          : pl.rules[pl.rules.length - 1]!.start,
                                      source: "all",
                                    },
                                  ],
                                })
                                .catch(() => {})
                            }
                            className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--line-strong)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-dim)] transition-colors hover:border-[rgb(var(--glow)/0.5)] hover:text-[rgb(var(--glow))]"
                          >
                            <IconPlus className="h-3.5 w-3.5" />
                            Add rule
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <Card title="Shader presets">
            <div className="grid grid-cols-2 gap-3">
              {SHADERS.map((s) => {
                const active = wall.kind === "shader" && wall.source === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() =>
                      save((c) => {
                        c.wallpaper.kind = "shader";
                        c.wallpaper.source = s.id;
                      })
                    }
                    className={`group overflow-hidden rounded-2xl border text-left transition-all duration-300 ${
                      active
                        ? "border-[rgb(var(--glow)/0.7)] shadow-[0_10px_30px_-12px_rgb(var(--glow)/0.5)] ring-2 ring-[rgb(var(--glow)/0.2)]"
                        : "border-[var(--line)] hover:border-[var(--line-strong)]"
                    }`}
                  >
                    <div className="relative h-14 w-full overflow-hidden">
                      <div
                        className="h-full w-full transition-transform duration-700 group-hover:scale-110"
                        style={{ background: SHADER_ART[s.id] }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                    </div>
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-xs font-semibold text-[var(--text)]">{s.label}</span>
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          active
                            ? "bg-[rgb(var(--glow))] shadow-[0_0_8px_rgb(var(--glow))]"
                            : "bg-[var(--line-strong)]"
                        }`}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card title="Playback">
            {wall.kind === "video" && (
              <>
                <Slider
                  label="Volume"
                  min={0}
                  max={1}
                  step={0.05}
                  value={wall.volume}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => save((c) => (c.wallpaper.volume = v))}
                />
                <Slider
                  label="Playback speed"
                  min={0.25}
                  max={3}
                  step={0.05}
                  value={wall.videoSpeed ?? 1}
                  format={(v) => `${v.toFixed(2)}×`}
                  onChange={(v) => save((c) => (c.wallpaper.videoSpeed = v))}
                />
                <div className="mt-2">
                  <div className="mb-2 text-xs font-medium text-[var(--text-dim)]">Fit to display</div>
                  <div className="grid grid-cols-4 gap-2">
                    {(["auto", "cover", "contain", "fill"] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => save((c) => (c.wallpaper.videoFit = f))}
                        className={`rounded-lg border px-2 py-1.5 text-xs font-semibold capitalize transition-all ${
                          wall.videoFit === f
                            ? "glow-tint border-[rgb(var(--glow)/0.4)]"
                            : "border-[var(--line)] bg-[var(--panel-strong)] text-[var(--text-dim)] hover:text-[var(--text)]"
                        }`}
                      >
                        {f === "fill" ? "stretch" : f}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--text-faint)]">
                    Auto fills the screen and crops only when shapes are similar; Contain
                    letterboxes; Stretch ignores aspect.
                  </p>
                </div>
                <div className="mt-3 border-t border-[var(--line)] pt-2">
                  <Section title="Color grading" defaultOpen>
                  <Slider
                    label="Brightness"
                    min={0.2}
                    max={2}
                    step={0.05}
                    value={wall.videoBrightness ?? 1}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => save((c) => (c.wallpaper.videoBrightness = v))}
                  />
                  <Slider
                    label="Saturation"
                    min={0}
                    max={2}
                    step={0.05}
                    value={wall.videoSaturation ?? 1}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => save((c) => (c.wallpaper.videoSaturation = v))}
                  />
                  <Slider
                    label="Hue shift"
                    min={-180}
                    max={180}
                    step={5}
                    value={wall.videoHue ?? 0}
                    format={(v) => `${v}°`}
                    onChange={(v) => save((c) => (c.wallpaper.videoHue = v))}
                  />
                  </Section>
                </div>
              </>
            )}
            {wall.kind === "slideshow" && (
              <>
                <Slider
                  label="Seconds per image"
                  min={5}
                  max={300}
                  step={5}
                  value={wall.slideshow.intervalSec}
                  format={(v) => `${v}s`}
                  onChange={(v) => save((c) => (c.wallpaper.slideshow.intervalSec = v))}
                />
                <Slider
                  label="Crossfade"
                  min={0}
                  max={5}
                  step={0.5}
                  value={wall.slideshow.crossfadeSec}
                  format={(v) => `${v}s`}
                  onChange={(v) => save((c) => (c.wallpaper.slideshow.crossfadeSec = v))}
                />
              </>
            )}
            {wall.kind === "web" && (
              <TextInput
                type="url"
                placeholder="https://example.com"
                value={wall.source}
                onChange={(v) => save((c) => (c.wallpaper.source = v))}
              />
            )}
            {(wall.kind === "image" || wall.kind === "video") && (
              <div className="truncate font-mono text-[11px] text-[var(--text-faint)]" title={wall.source}>
                {wall.source || "Nothing applied yet"}
              </div>
            )}
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <Toggle
                label="Live wallpaper enabled"
                description="Renders the configured source behind your icons on every display."
                checked={cfg.general.wallpaperEnabled}
                onChange={(v) => save((c) => (c.general.wallpaperEnabled = v))}
              />
            </div>
          </Card>
        </div>


        <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 text-xs leading-relaxed text-[var(--text-faint)]">
          Each display gets its own wallpaper window sized to its exact resolution.
          Hover a vault tile to apply it to <b className="text-[var(--text)]">all displays</b> or
          just one — tiles show which displays they're running on.
        </div>

        <Card title="Zone → device mapping">
          <p className="mb-5 text-sm leading-relaxed text-[var(--text-dim)]">
            Each zone is a rectangle of the wallpaper (normalized 0–1). In{" "}
            <b className="text-[var(--text)]">Zone sync</b> mode, devices receive the
            average color of their mapped zones.
          </p>
          {cfg.rgb.zones.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[var(--line-strong)] p-7 text-center text-sm text-[var(--text-faint)]">
              No zones yet — add one, then map devices to it.
            </div>
          )}
          <div className="space-y-4">
            {cfg.rgb.zones.map((z) => (
              <div
                key={z.id}
                className="rounded-2xl border border-[var(--line)] bg-[var(--panel-strong)] p-5"
              >
                <div className="mb-4 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--glow))] shadow-[0_0_8px_rgb(var(--glow))]" />
                  <input
                    value={z.name}
                    onChange={(e) => updateZone(z.id, { name: e.target.value })}
                    className="w-44 rounded-lg border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold text-[var(--text)] outline-none transition-colors hover:border-[var(--line)] focus:border-[rgb(var(--glow)/0.5)]"
                  />
                  <div className="ml-auto">
                    <Btn
                      variant="danger"
                      onClick={() =>
                        save((c) => {
                          c.rgb.zones = c.rgb.zones.filter((x) => x.id !== z.id);
                        })
                      }
                    >
                      <IconTrash className="h-4 w-4" />
                      Delete
                    </Btn>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {(["x", "y", "w", "h"] as const).map((k) => (
                    <NumberField
                      key={k}
                      label={k}
                      min={0}
                      max={1}
                      step={0.01}
                      value={z[k]}
                      onChange={(v) => updateZone(z.id, { [k]: v })}
                    />
                  ))}
                </div>
                <div className="mt-4">
                  <div className="kicker mb-2">devices</div>
                  <div className="flex flex-wrap gap-2">
                    {rgb.devices.map((d) => {
                      const on = z.deviceIds.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          onClick={() =>
                            updateZone(z.id, {
                              deviceIds: on
                                ? z.deviceIds.filter((x) => x !== d.id)
                                : [...z.deviceIds, d.id],
                            })
                          }
                          className={`rounded-full px-2.5 py-1 font-mono text-[11px] font-medium ${chipStyle(on)} ${on ? "shadow-[0_0_12px_-2px_rgb(var(--glow)/0.5)]" : ""}`}
                        >
                          {on && <span className="mr-1 inline-block h-1 w-1 rounded-full bg-[rgb(var(--glow))]" />}
                          {d.name || `Device ${d.id}`}
                        </button>
                      );
                    })}
                    {rgb.devices.length === 0 && (
                      <span className="text-xs text-[var(--text-faint)]">
                        Connect OpenRGB to map devices.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5">
            <Btn
              variant="primary"
              onClick={() =>
                save((c) => {
                  const id = `zone-${Date.now().toString(36)}`;
                  c.rgb.zones.push({
                    id,
                    name: `Zone ${c.rgb.zones.length + 1}`,
                    x: 0.05,
                    y: 0.05,
                    w: 0.4,
                    h: 0.4,
                    deviceIds: [],
                  });
                })
              }
            >
              <IconPlus className="h-4 w-4" />
              Add zone
            </Btn>
          </div>
        </Card>
      </div>
  );
}

function UrlImport({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (url: string, name: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  return (
    <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          type="url"
          placeholder="https://example.com/wallpaper.mp4"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-sm outline-none focus:border-[rgb(var(--glow)/0.5)]"
        />
        <input
          type="text"
          placeholder="Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-44 rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-sm outline-none focus:border-[rgb(var(--glow)/0.5)]"
        />
        <Btn variant="primary" disabled={busy || !url.trim()} onClick={() => onSubmit(url.trim(), name.trim())}>
          Download
        </Btn>
        <Btn disabled={busy} onClick={onCancel}>
          Cancel
        </Btn>
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-faint)]">
        Direct link to an mp4/webm video or png/jpg/webp/gif image (max 200 MB). It is downloaded into your vault.
      </p>
    </div>
  );
}