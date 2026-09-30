import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store";
import { Card, Btn, Slider, Toggle, TextInput, NumberField, Section, InfoNote, chipStyle, ItemTitle, displayName } from "../ui";
import { Modal } from "../Modal";
import { IconImage, IconGlobe, IconFolder, IconPlus, IconTrash, IconClipboard } from "../icons";
import { SHADERS, SHADER_ART } from "@shared/constants";
import type { Config, EntryOptions, GalleryEntry, ZoneDef } from "@shared/types";
import { api } from "../../ipc";
import { truncateError } from "../../utilities";
import { t } from "../../i18n";
import { deviceName } from "../DeviceRow";
import type { MonitorEntry } from "../ui";
import { GalleryGrid } from "../gallery/GalleryGrid";
import { GalleryDrawer } from "../gallery/GalleryDrawer";
import { GalleryToolbar } from "../gallery/GalleryToolbar";
import { CollectionsView } from "../gallery/CollectionsView";
import { DEFAULT_QUERY, selectGallery, type GalleryQuery, type SelectContext } from "../gallery/galleryQuery";
import { GalleryThumb } from "../gallery/GalleryThumb";
import { resolvePicked } from "../gallery/mediaKind";
import { duplicateIds, healthOf, type Unhealthy } from "../gallery/vaultHealth";
import {
  buildIndex,
  cachedCount,
  readCache,
  type VaultIndex,
} from "../gallery/vaultIndex";
import { type GalleryDensity } from "../gallery/GalleryToolbar";

type MonEntry = MonitorEntry;

/** Tiles mounted per page. The grid pages rather than rendering a vault of a
 *  few hundred videos at once; the button is the original vault's. */
const GALLERY_PAGE = 60;

export default function WallpaperTab() {
  const { cfg, rgb, save } = useStore(
    useShallow((s) => ({ cfg: s.cfg, rgb: s.rgb, save: s.save })),
  );
  const [busy, setBusy] = useState(false);
  // The add dialog is two steps rather than two dialogs. Picking "From URL" used
  // to dismiss the picker and open a second, differently-shaped form underneath
  // the vault grid — two layouts, two focuses, and a cancel that left you
  // guessing which one you were in.
  const [addStep, setAddStep] = useState<null | "sources" | "url">(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [urlNameDraft, setUrlNameDraft] = useState("");
  const [density, setDensity] = useState<GalleryDensity>("cozy");
  const [vaultIndex, setVaultIndex] = useState<VaultIndex>({});
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<{ done: number; total: number } | null>(null);
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  /** Ids ticked for the bulk action bar. */
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  /** The last id ticked, so shift-click can span from here. */
  const checkAnchor = useRef<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [dropCount, setDropCount] = useState(0);
  const [mons, setMons] = useState<MonEntry[]>([]);
  /** Which of the two views the vault card is showing. Collections are a
   *  different shape of thing to wallpapers — a list of lists — so they get
   *  their own surface rather than another dimension of the same grid. */
  const [mode, setMode] = useState<"wallpapers" | "collections">("wallpapers");
  /** Entry id in flight from a tile drag, so only the collection chips become
   *  drop targets while something is actually being dragged. */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // One query object for search + collection + kind + sort, so the toolbar, the
  // grid and the counts can never disagree about what is being shown.
  const [gq, setGq] = useState<GalleryQuery>({ ...DEFAULT_QUERY, collection: "all" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [limit, setLimit] = useState(GALLERY_PAGE);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [playlistFor, setPlaylistFor] = useState<string | null>(null); // open editor
  const [colNaming, setColNaming] = useState(false);
  // null = creating a new collection; an id = renaming that one. Both used the
  // same input before, which is why renaming needed a native prompt: there was
  // no state to say which of the two it was.
  const [colRenameId, setColRenameId] = useState<string | null>(null);
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
  const collections = cfg.collections ?? [];
  const playlists = cfg.playlists ?? [];
  const overrides = wall.perMonitor ?? {};
  /**
   * Everything the query needs that is not the query. Shared with the toolbar's
   * count chips, so a chip number and the grid can never disagree about what
   * is currently visible.
   */
  const selectCtx: SelectContext = useMemo(
    () => ({
      index: vaultIndex,
      perMonitor: overrides,
      globalKind: wall.kind,
      globalSource: wall.source,
    }),
    [vaultIndex, overrides, wall.kind, wall.source],
  );
  const gallery = selectGallery(cfg.gallery, collections, gq, selectCtx);
  /**
   * "every 15 min", or null. A playlist with no shuffle interval only advances
   * on time rules and a manual nudge, so claiming it rotates would be wrong.
   */
  const activePlaylist = playlists.find((p) => p.enabled);
  const rotating =
    activePlaylist && (activePlaylist.shuffleMin ?? 0) > 0
      ? String(activePlaylist.shuffleMin)
      : null;
  // "/" jumps to the search box, the way it does in a file manager, and Escape
  // clears it and gives focus back. A vault of a few hundred is unusable without
  // a way to get to search without aiming at it.
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.key === "Escape" && target === searchRef.current) {
        setQuery({ search: "" });
        searchRef.current?.blur();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  // Only the first page of tiles is mounted; the rest waits for "show more".
  const visibleGallery = gallery.slice(0, limit);
  const selectedEntry = gallery.find((g) => g.id === selectedId) ?? null;
  const duplicateSet = duplicateIds(cfg.gallery);
  const health = new Map<string, Unhealthy>();
  for (const g of cfg.gallery) {
    const why = healthOf(g.id, missing, duplicateSet);
    if (why) health.set(g.id, why);
  }
  const unhealthyCount = health.size;
  /** The vault index is only "ready" once it can actually answer a question. */
  const indexTotal = cfg.gallery.filter(
    (g) => g.kind === "video" || g.kind === "image",
  ).length;
  const indexReady = indexTotal > 0 && cachedCount(cfg.gallery, vaultIndex) === indexTotal;
  /** Every query change re-pages from the top, so filtering does not leave you
   *  on page 4 of a list that is now one screen long. */
  const setQuery = (patch: Partial<GalleryQuery>) => {
    setGq((q) => ({ ...q, ...patch }));
    setLimit(GALLERY_PAGE);
  };
  const isActive = (g: GalleryEntry) => g.kind === wall.kind && g.source === wall.source;
  const activeEntry = cfg.gallery.find((x) => isActive(x)) ?? null;

  const applyToAll = (g: GalleryEntry) =>
    api
      .galleryApply(g.id)
      .then(() =>
        toast("ok", t("gallery.applied-to-every-display", { name: g.name })),
      )
      .catch((e) =>
        toast(
          "error",
          t("gallery.apply-failed-{error}", { error: truncateError(e) }),
        ),
      );

  const removeEntry = (g: GalleryEntry) =>
    api
      .galleryRemove(g.id)
      .then(() => {
        if (selectedId === g.id) setSelectedId(null);
        undoDelete(t("gallery.removed-{name}", { name: g.name }), (next) => {
          next.gallery.push(g);
        });
      })
      .catch((e) =>
        toast(
          "error",
          t("gallery.remove-failed-{error}", { error: truncateError(e) }),
        ),
      );

  const startRename = (g: GalleryEntry) => {
    setSelectedId(g.id);
    setRenamingId(g.id);
    setRenameVal(g.name);
  };
  const commitRename = (g: GalleryEntry) => {
    setRenamingId(null);
    const name = renameVal.trim();
    if (!name || name === g.name) return;
    save((c) => {
      const entry = c.gallery.find((x) => x.id === g.id);
      if (entry) entry.name = name;
    });
  };
  const applyToMonitor = (g: GalleryEntry, device: string) =>
    api
      .galleryApplyMonitor(g.id, device)
      .then(() =>
        toast("ok", t("gallery.applied-to-one-display", { name: g.name })),
      )
      .catch((e) =>
        toast("error", t("gallery.apply-failed-{error}", { error: truncateError(e) })),
      );
  const clearMonitor = (device: string) =>
    api
      .galleryApplyMonitor(null, device)
      .then(() => toast("info", t("common.display-reset-to-the-global-wallpaper")))
      .catch((e) =>
        toast("error", t("common.reset-failed-{error}", { error: truncateError(e) })),
      );

  const toast = (tone: "error" | "info" | "ok", msg: string) =>
    useStore.getState().toast(tone, msg);
  const undoDelete = (msg: string, restore: (c: Config) => void) =>
    useStore.getState().undoDelete(msg, restore);

  /**
   * Browse for media and import everything selected.
   *
   * There used to be two of these, one for video and one for image, over the
   * same dialog with the same filter list — all the choice decided was which
   * kind string got hardcoded next to the picked path. Lively collapsed its two
   * import buttons into a single browse dialog for the same reason, and taking
   * a list rather than one path is what makes it worth doing: selecting twenty
   * wallpapers is one dialog instead of twenty, and every one of them is
   * classified by its extension in resolvePicked.
   *
   * Everything is added to the vault, but only the last is applied. Applying
   * them in turn would leave the same end state as applying the last one, with
   * twenty wallpaper changes on the way there.
   */
  const pickAndAddMany = async () => {
    setBusy(true);
    try {
      const picked = resolvePicked(await api.pickMediaFiles());
      if (picked.length === 0) return;
      const lists = await Promise.all(
        picked.map((p) =>
          api.galleryAdd({ name: p.name, kind: p.kind, source: p.path }),
        ),
      );
      const last = lists.at(-1)?.at(-1);
      if (last && appliesOnImport) await api.galleryApply(last.id);
      toast(
        "ok",
        appliesOnImport
          ? t("gallery.added-{n}-items", { n: picked.length })
          : t("gallery.added-{n}-items-not-applied", { n: picked.length }),
      );
    } catch (e) {
      toast("error", t("gallery.import-failed-{error}", { error: truncateError(e) }));
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
      toast("ok", t("gallery.imported-{n}-items-from-the-folder", { n: list.length }));
    } catch (e) {
      toast("error", t("gallery.folder-import-failed-{error}", { error: truncateError(e) }));
    } finally {
      setBusy(false);
    }
  };

  /** Whether a fresh import should take over the screens. */
  const appliesOnImport = wall.applyAfterImport !== false;

  /**
   * Download a link into the vault.
   *
   * Shared by the URL form and by pasting a link anywhere in the window. They
   * are the same request, and two copies of an import path is how the paste
   * route ends up applying the wallpaper while the form does not — or worse,
   * neither does.
   */
  const addFromUrl = async (raw: string, name?: string) => {
    const url = raw.trim();
    if (!url || busy) return false;
    setBusy(true);
    try {
      const list = await api.galleryAddFromUrl(url, name?.trim() || undefined);
      const added = list[list.length - 1];
      const applied = !!added && appliesOnImport;
      if (applied) await api.galleryApply(added!.id);
      toast(
        "ok",
        t(
          applied
            ? "gallery.downloaded-and-applied"
            : "gallery.downloaded-not-applied",
          { name: added?.name ?? (name?.trim() || url) },
        ),
      );
      return true;
    } catch (e) {
      toast("error", t("gallery.url-import-failed", { error: truncateError(e) }));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /**
   * Paste a wallpaper link anywhere in the window.
   *
   * The address is the thing a wallpaper is usually shared as, so copying one
   * anywhere else in the app and pasting into the vault is the gesture people
   * already have. A paste event carries the text, so this needs no clipboard
   * permission and no new plugin.
   *
   * Deliberately narrow: a bare http(s) URL and nothing else. Copying a
   * paragraph that mentions a link must not start a download because a URL
   * happened to be inside it, and pasting into any text field is the field's
   * business, not this window's.
   */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const text = (e.clipboardData?.getData("text") ?? "").trim();
      if (!text || busy) return;
      let parsed: URL | null = null;
      try {
        parsed = new URL(text);
      } catch {
        return;
      }
      if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
        return;
      }
      e.preventDefault();
      void addFromUrl(text);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [busy, appliesOnImport]);

  /**
   * Star an entry.
   *
   * Optimistic, and reverted on failure. A favourite is a one-click judgement
   * and waiting on a round trip to see the star fill in makes it feel broken.
   */
  const toggleFavorite = (g: GalleryEntry, next: boolean) => {
    const before = !!g.favorite;
    save((c) => {
      const entry = c.gallery.find((x) => x.id === g.id);
      if (entry) entry.favorite = next;
    });
    api
      .gallerySetFavorite(g.id, next)
      .catch((e) => {
        save((c) => {
          const entry = c.gallery.find((x) => x.id === g.id);
          if (entry) entry.favorite = before;
        });
        toast("error", t("gallery.save-failed-{error}", { error: truncateError(e) }));
      });
  };

  /** Drop a tile onto a collection chip. Toggles, like the drawer's list. */
  const dropOnCollection = (collectionId: string) => {
    const id = draggingId;
    setDraggingId(null);
    if (!id) return;
    const name = collections.find((c) => c.id === collectionId)?.name ?? "";
    api
      .collectionToggleEntry(collectionId, id)
      .then((added) =>
        toast(
          "ok",
          added
            ? t("common.added-to", { name })
            : t("common.removed-from", { name }),
        ),
      )
      .catch((e) =>
        toast("error", t("common.failed-{error}", { error: truncateError(e) })),
      );
  };

  /**
   * Ask the backend which files have gone, and re-read the persisted index.
   *
   * Both run on open and whenever the vault changes, because both are cheap and
   * both answer a question the user cannot otherwise ask: "is this list still
   * true?". A vault entry whose file was moved renders a tile and does nothing
   * when applied, with no error anywhere — the failure is entirely silent, and
   * it is the one thing a file-based gallery cannot afford.
   */
  const refreshHealth = async () => {
    try {
      setMissing(new Set(await api.vaultMissing()));
    } catch {
      // A failed health check must not empty the set: that would report the
      // whole vault as healthy when we simply do not know.
    }
    setVaultIndex(readCache());
  };

  useEffect(() => {
    void refreshHealth();
  }, [cfg.gallery.length]);

  const runIndex = async () => {
    setIndexing(true);
    try {
      setVaultIndex(await buildIndex(cfg.gallery, (p) => setIndexProgress({ done: p.done, total: p.total })));
    } catch (e) {
      toast("error", t("gallery.indexing-failed-{error}", { error: truncateError(e) }));
    } finally {
      setIndexing(false);
      setIndexProgress(null);
    }
  };

  const toggleChecked = (id: string, range: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (!range) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
        checkAnchor.current = id;
        return next;
      }
      // Shift-click: everything between the anchor and this entry, in the order
      // currently on screen. Anything ticked in between stays ticked.
      const ids = visibleGallery.map((g) => g.id);
      const a = ids.indexOf(checkAnchor.current ?? id);
      const b = ids.indexOf(id);
      if (a < 0 || b < 0) {
        next.add(id);
        return next;
      }
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
        const id = ids[i];
        if (id) next.add(id);
      }
      return next;
    });
  };

  const clearChecked = () => {
    setChecked(new Set());
    checkAnchor.current = null;
  };

  /**
   * Apply the ticked entries in order and leave the last one showing. Applying
   * each in turn is what the user asked for, but the end state is the last one
   * either way — the difference is twenty wallpaper changes on the way there.
   */
  const applyChecked = async () => {
    const picked = cfg.gallery.filter((g) => checked.has(g.id));
    if (picked.length === 0) return;
    for (const g of picked) await applyToAll(g);
    clearChecked();
  };

  const removeChecked = async () => {
    const picked = cfg.gallery.filter((g) => checked.has(g.id));
    if (picked.length === 0) return;
    for (const g of picked) await removeEntry(g);
    clearChecked();
  };

  /** Nuke every redundant copy of a duplicated file in one go. */
  const removeDuplicates = async () => {
    const redundant = cfg.gallery.filter((g) => duplicateSet.has(g.id));
    if (redundant.length === 0) return;
    for (const g of redundant) await removeEntry(g);
    toast("ok", t("gallery.removed-{n}-duplicates", { n: redundant.length }));
  };

  const updateZone = (id: string, patch: Partial<ZoneDef>) =>
    save((c) => {
      const z = c.rgb.zones.find((z) => z.id === id);
      if (z) Object.assign(z, patch);
    });

  return (
    <div className="stagger space-y-6">
        <Card
          title={t("common.vault")}
          right={
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-0.5 rounded-full border border-[var(--line)] bg-[var(--panel-strong)] p-0.5">
                {(
                  [
                    ["wallpapers", "gallery.view-wallpapers", gallery.length],
                    ["collections", "gallery.view-collections", collections.length],
                  ] as const
                ).map(([id, label, n]) => (
                  <button
                    key={id}
                    onClick={() => {
                      setMode(id);
                      setLimit(GALLERY_PAGE);
                    }}
                    aria-pressed={mode === id}
                    className={`rounded-full px-3 py-1 text-xs transition-colors ${
                      mode === id
                        ? "bg-[rgb(var(--glow))] font-semibold text-[#06121f]"
                        : "text-[var(--text-dim)] hover:text-[var(--text)]"
                    }`}
                  >
                    {`${t(label)} · ${n}`}
                  </button>
                ))}
              </div>
            </div>
          }
        >
          {unhealthyCount > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/8 px-3 py-2 text-xs text-amber-200">
              <span className="font-semibold">
                {t("gallery.{n}-entries-need-attention", { n: unhealthyCount })}
              </span>
              <span className="min-w-0 text-amber-200/75">
                {t("gallery.health-hint")}
              </span>
              {duplicateSet.size > 0 && (
                <button
                  onClick={() => void removeDuplicates()}
                  className="ml-auto rounded-md border border-amber-500/40 px-2 py-1 font-semibold text-amber-100 transition-colors hover:bg-amber-500/20"
                >
                  {t("gallery.remove-{n}-duplicates", { n: duplicateSet.size })}
                </button>
              )}
              <button
                onClick={() => void refreshHealth()}
                className="rounded-md px-2 py-1 text-amber-200/75 underline underline-offset-2 transition-colors hover:text-amber-100"
              >
                {t("gallery.rescan")}
              </button>
            </div>
          )}

          <GalleryToolbar
            query={gq}
            onQuery={setQuery}
            entries={cfg.gallery}
            collections={collections}
            totalInVault={cfg.gallery.length}
            searchRef={searchRef}
            density={density}
            onDensity={setDensity}
            indexReady={indexReady}
            indexBuilding={indexing}
            indexProgress={indexProgress}
            onBuildIndex={() => void runIndex()}
            view={mode}
            countCtx={selectCtx}
            displays={mons.map((m, i) => ({
              device: m.device,
              name: displayName(m, i, cfg.general.screenNames),
            }))}
            draggingId={draggingId}
            onDropOnCollection={dropOnCollection}
            onCollection={(id) => setQuery({ collection: id })}
            onRenameCollection={(c) => {
              setRenameVal(c.name);
              setColNaming(true);
              setColRenameId(c.id);
            }}
            onDeleteCollection={(c) =>
              api
                .collectionDelete(c.id)
                .then(() => {
                  if (gq.collection === c.id) setQuery({ collection: "all" });
                  undoDelete(
                    t("gallery.deleted-collection", { name: c.name }),
                    (next) => {
                      next.collections.push(c);
                    },
                  );
                })
                .catch((e) =>
                  toast(
                    "error",
                    t("gallery.delete-failed-{error}", { error: truncateError(e) }),
                  ),
                )
            }
            onNewCollection={() => {
              setColRenameId(null);
              setColNameVal("");
              setColNaming(true);
            }}
            collectionEditor={
              colNaming && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = colNameVal.trim();
                    if (!name) {
                      setColNaming(false);
                      return;
                    }
                    if (colRenameId) {
                      api
                        .collectionRename(colRenameId, name)
                        .catch((e) =>
                          toast(
                            "error",
                            t("gallery.rename-failed-{error}", {
                              error: truncateError(e),
                            }),
                          ),
                        );
                    } else {
                      api
                        .collectionCreate(name)
                        .then((col) => setGq((q) => ({ ...q, collection: col.id })))
                        .catch((e) =>
                          toast(
                            "error",
                            t("common.create-failed-{error}", {
                              error: truncateError(e),
                            }),
                          ),
                        );
                    }
                    setColNaming(false);
                  }}
                >
                  <input
                    autoFocus
                    value={colNameVal}
                    onChange={(e) => setColNameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setColNaming(false);
                      }
                    }}
                    placeholder={t(
                      colRenameId ? "gallery.collection-name" : "common.collection-name",
                    )}
                    aria-label={t(
                      colRenameId ? "gallery.rename-collection" : "common.new-collection",
                    )}
                    className="w-36 rounded-full border border-[rgb(var(--glow)/0.4)] bg-[var(--panel-strong)] px-3 py-1 text-xs font-semibold text-[var(--text)] outline-none"
                  />
                </form>
              )
            }
          >
            {/* One control, four sources. They were four peer buttons in a row,
                which made the toolbar's only create action the widest thing on
                screen and left search with the leftover space. */}
            {/* Whether an import takes over the screens. It used to always do,
                which meant dropping a folder of twenty wallpapers silently
                changed the wallpaper on every display — and there was no way
                to say "not right now". */}
            <button
              onClick={() =>
                save((c) => (c.wallpaper.applyAfterImport = !appliesOnImport))
              }
              aria-pressed={appliesOnImport}
              title={t("gallery.apply-after-import")}
              className={`hidden shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors sm:flex ${
                appliesOnImport
                  ? "border-[rgb(var(--glow)/0.5)] bg-[rgb(var(--glow)/0.12)] text-[rgb(var(--glow))]"
                  : "border-[var(--line-strong)] bg-[var(--panel-strong)] text-[var(--text-faint)] hover:text-[var(--text-dim)]"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  appliesOnImport ? "bg-[rgb(var(--glow))]" : "bg-[var(--line-strong)]"
                }`}
              />
              {t("gallery.apply-after-import")}
            </button>
            <Btn variant="primary" disabled={busy} onClick={() => setAddStep("sources")}>
              <IconPlus className="h-4 w-4" />
              {t("gallery.add-source")}
            </Btn>
          </GalleryToolbar>

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
                  {dropCount > 1
                    ? t("common.drop-{n}-items-to-import", { n: dropCount })
                    : t("common.drop-file-or-folder-to-import")}
                </span>
                <span className="text-[11px] text-[var(--text-dim)]">
                  {t("common.videos-images-and-folders-become-vault-cards")}
                </span>
              </div>
            )}
            {/* The grid is always the full width of the card. The detail drawer
                is a sibling, not a column, so selecting a wallpaper never
                reflows the surface you were browsing. */}
            {mode === "wallpapers" ? (
              <>
            <GalleryGrid
              entries={visibleGallery}
              collections={collections}
              monitors={mons}
              thumbFor={(g) => <GalleryThumb entry={g} />}
              activeEntry={activeEntry}
              perMonitor={overrides}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onApplyAll={applyToAll}
              onInspect={(g) => setSelectedId(g.id)}
              onRename={startRename}
              onRemove={removeEntry}
              density={density}
              health={health}
              checked={checked}
              onToggleChecked={toggleChecked}
              onApplyChecked={() => void applyChecked()}
              onRemoveChecked={() => void removeChecked()}
              onClearChecked={clearChecked}
              onDragEntry={setDraggingId}
              rotating={rotating}
              onToggleFavorite={(g) => toggleFavorite(g, !g.favorite)}
            />

            {visibleGallery.length < gallery.length && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => setLimit((n) => n + GALLERY_PAGE)}
                  className="rounded-lg border border-[var(--line-strong)] bg-[var(--panel-strong)] px-5 py-2 text-xs font-semibold text-[var(--text-dim)] hover-glow active:scale-[0.97]"
                >
                  {t("common.show-{n}-more", {
                    n: Math.min(GALLERY_PAGE, gallery.length - visibleGallery.length),
                  })}
                  <span className="hint ml-1.5">
                    {`${visibleGallery.length} / ${gallery.length}`}
                  </span>
                </button>
              </div>
            )}
              </>
            ) : (
              <CollectionsView
                collections={collections}
                entries={cfg.gallery}
                onOpen={(id) => {
                  // Opening a collection means going to its wallpapers, so the
                  // mode has to come with it. Setting the filter alone left
                  // the user staring at the same list of collections.
                  setMode("wallpapers");
                  setQuery({ collection: id });
                }}
                onNewCollection={() => {
                  setColRenameId(null);
                  setColNameVal("");
                  setColNaming(true);
                }}
              />
            )}


            {selectedEntry && (
              <GalleryDrawer
                entry={selectedEntry}
                collections={collections}
                monitors={mons}
                screenNames={cfg.general.screenNames}
                perMonitor={overrides}
                activeEntry={activeEntry}
                url={convertFileSrc(selectedEntry.source, "media")}
                preview={<GalleryThumb entry={selectedEntry} />}
                renaming={renamingId === selectedEntry.id}
                renameValue={renameVal}
                onRenameValue={setRenameVal}
                onStartRename={() => startRename(selectedEntry)}
                onCancelRename={() => setRenamingId(null)}
                onCommitRename={() => commitRename(selectedEntry)}
                onApplyAll={() => applyToAll(selectedEntry)}
                onApplyToMonitor={(device) => applyToMonitor(selectedEntry, device)}
                onClearMonitor={clearMonitor}
                onToggleCollection={(cid) => {
                  api
                    .collectionToggleEntry(cid, selectedEntry.id)
                    .then((added) =>
                      toast(
                        "ok",
                        added
                          ? t("common.added-to", {
                              name:
                                collections.find((c) => c.id === cid)?.name ?? "",
                            })
                          : t("common.removed-from", {
                              name:
                                collections.find((c) => c.id === cid)?.name ?? "",
                            }),
                      ),
                    )
                    .catch((e) =>
                      toast(
                        "error",
                        t("common.failed-{error}", {
                          error: truncateError(e),
                        }),
                      ),
                    );
                }}
                onRemove={() => removeEntry(selectedEntry)}
                onClose={() => setSelectedId(null)}
                health={health.get(selectedEntry.id) ?? null}
                onSetOpts={(patch) => {
                  const current = cfg.gallery.find((g) => g.id === selectedEntry.id)?.opts ?? {};
                  const next = { ...current, ...patch };
                  for (const k of Object.keys(next) as (keyof EntryOptions)[]) {
                    if (next[k] === undefined) delete next[k];
                  }
                  void api
                    .gallerySetOpts(
                      selectedEntry.id,
                      Object.keys(next).length > 0 ? next : null,
                    )
                    .catch((e) =>
                      toast(
                        "error",
                        t("gallery.save-failed-{error}", { error: truncateError(e) }),
                      ),
                    );
                }}
                onResetOpts={() => {
                  void api
                    .gallerySetOpts(selectedEntry.id, null)
                    .catch((e) =>
                      toast(
                        "error",
                        t("gallery.save-failed-{error}", { error: truncateError(e) }),
                      ),
                    );
                }}
                onReveal={() => {
                  void api
                    .revealInFolder(selectedEntry.source)
                    .catch((e) =>
                      toast(
                        "error",
                        t("gallery.reveal-failed-{error}", { error: truncateError(e) }),
                      ),
                    );
                }}
                onRegenerateThumb={() => {
                  setBusy(true);
                  void api
                    .galleryRegenerateThumb(selectedEntry.id)
                    .then(() => toast("ok", t("gallery.thumbnail-regenerated")))
                    .catch((e) =>
                      toast(
                        "error",
                        t("gallery.thumbnail-failed-{error}", { error: truncateError(e) }),
                      ),
                    )
                    .finally(() => setBusy(false));
                }}
                globalOpts={{
                  fit: cfg.wallpaper.videoFit,
                  speed: cfg.wallpaper.videoSpeed,
                  volume: cfg.wallpaper.volume,
                }}
              />
            )}
          </div>

          {/* Add source. A dialog rather than a dropdown because the sources are
              a decision, not a menu of equally likely actions: each one commits
              to a different kind of work — a file dialog, a folder walk, a
              download — and a line of text in a popover gave none of them room
              to say what it actually does.

              Three rows, not four. Video and image were separate buttons over
              the same dialog with the same filter list, so splitting them only
              told you which of two kinds you already knew you had. */}
          {addStep === "sources" && (
            <Modal
              title={t("gallery.add-a-wallpaper")}
              onClose={() => setAddStep(null)}
            >
              <div className="space-y-0.5">
                {[
                  {
                    id: "browse",
                    Icon: IconImage,
                    label: t("gallery.browse-files"),
                    hint: t("gallery.src-browse"),
                    run: pickAndAddMany,
                  },
                  {
                    id: "folder",
                    Icon: IconFolder,
                    label: t("common.import-folder"),
                    hint: t("gallery.src-folder"),
                    run: pickSlideshow,
                  },
                  {
                    id: "url",
                    Icon: IconGlobe,
                    label: t("common.from-url"),
                    hint: t("gallery.src-url"),
                    run: () => setAddStep("url"),
                  },
                ].map((src, i) => (
                  <button
                    key={src.id}
                    onClick={() => {
                      // Browse and Import folder are destinations: they close
                      // the dialog. From URL is not — it is the next step
                      // *within* this dialog, so it must leave it open and let
                      // the form take its place.
                      if (src.id !== "url") setAddStep(null);
                      src.run();
                    }}
                    style={{ animationDelay: `${i * 20}ms` }}
                    className="modal-row flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-[var(--panel-strong)] focus-visible:bg-[var(--panel-strong)]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--glow)/0.12)] text-[rgb(var(--glow))]">
                      <src.Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[var(--text)]">
                        {src.label}
                      </span>
                      <span className="block truncate text-xs text-[var(--text-faint)]">
                        {src.hint}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </Modal>
          )}

          {addStep === "url" && (
            <Modal
              title={t("gallery.from-a-url")}
              onClose={() => setAddStep(null)}
              onBack={() => setAddStep("sources")}
              backLabel={t("common.go-back")}
            >
              <form
                className="space-y-3 p-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await addFromUrl(urlDraft, urlNameDraft);
                  if (!ok) return;
                  setAddStep(null);
                  setUrlDraft("");
                  setUrlNameDraft("");
                }}
              >
                <label className="block">
                  <span className="kicker mb-1.5 block !text-[var(--text-faint)]">
                    {t("gallery.wallpaper-url")}
                  </span>
                  <input
                    autoFocus
                    type="url"
                    required
                    value={urlDraft}
                    onChange={(e) => setUrlDraft(e.target.value)}
                    placeholder="https://example.com/wallpaper.mp4"
                    className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-sm outline-none transition-colors placeholder:text-[var(--text-faint)] focus:border-[rgb(var(--glow)/0.5)]"
                  />
                </label>
                <label className="block">
                  <span className="kicker mb-1.5 block !text-[var(--text-faint)]">
                    {t("common.name-optional")}
                  </span>
                  <input
                    type="text"
                    value={urlNameDraft}
                    onChange={(e) => setUrlNameDraft(e.target.value)}
                    placeholder={t("common.name-optional")}
                    className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-sm outline-none transition-colors placeholder:text-[var(--text-faint)] focus:border-[rgb(var(--glow)/0.5)]"
                  />
                </label>
                <p className="text-dim-sm">
                  {t("common.direct-link-to-an-mp4-webm-video-or-png-jpg-webp")}
                </p>
                <div className="flex items-center justify-between gap-2 pt-1">
                  {/* The clipboard button, for the case the window paste
                      listener cannot cover: the user copied a link, opened the
                      dialog, and never pressed Ctrl+V. */}
                  <Btn
                    onClick={() => {
                      api
                        .clipboardUrl()
                        .then((url) => {
                          if (!url) {
                            toast("info", t("gallery.clipboard-has-no-link"));
                            return;
                          }
                          setUrlDraft(url);
                          setUrlNameDraft("");
                        })
                        .catch((e) =>
                          toast(
                            "error",
                            t("common.failed-{error}", { error: truncateError(e) }),
                          ),
                        );
                    }}
                    disabled={busy}
                  >
                    <IconClipboard className="h-4 w-4" />
                    {t("gallery.paste-link")}
                  </Btn>
                  <Btn type="submit" variant="primary" disabled={busy || !urlDraft.trim()}>
                    {t("common.download")}
                  </Btn>
                </div>
              </form>
            </Modal>
          )}

          {mode === "wallpapers" && gallery.length === 0 && (
            <div className="mt-4 flex flex-col items-center gap-2.5 rounded-2xl border border-dashed border-[var(--line-strong)] px-6 py-12 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--panel-strong)] text-[var(--text-faint)]">
                <IconImage className="h-5 w-5" />
              </div>
              <ItemTitle>
                {t(
                  gq.search.trim() ||
                    gq.kind !== "all" ||
                    gq.collection !== "all" ||
                    gq.picks !== "all" ||
                    gq.display !== "all"
                    ? "common.no-matches"
                    : "common.vault-is-empty",
                )}
              </ItemTitle>
              <p className="max-w-sm text-xs leading-relaxed text-[var(--text-faint)]">
                {gq.search.trim() ||
                gq.kind !== "all" ||
                gq.collection !== "all" ||
                gq.picks !== "all" ||
                gq.display !== "all" ? (
                  <>
                    {t("common.nothing-in-this-view-is-called", {
                      query: gq.search.trim() || t("gallery.this-filter"),
                    })}{" "}
                    <button
                      onClick={() =>
                        setGq((q) => ({
                          ...q,
                          search: "",
                          kind: "all",
                          collection: "all",
                          picks: "all",
                          display: "all",
                        }))
                      }
                      className="text-[rgb(var(--glow))] underline underline-offset-2"
                    >
                      {t("common.clear-the-search")}
                    </button>
                    .
                  </>
                ) : (
                  <>
                    {t("common.add-a-video-or-image-or-drop-files-and-folders-h")}
                  </>
                )}
              </p>
            </div>
          )}
        </Card>

        <Card
          title={t("common.playlists")}
          right={
            <span className="font-mono text-[10px] tracking-wide text-[var(--text-faint)]">
              {playlists.find((p) => p.enabled)?.name ?? t("common.off")}
            </span>
          }
        >
          <p className="mb-4 text-sm leading-relaxed text-[var(--text-dim)]">
            {t("common.rotate-wallpapers-automatically-shuffle-a-collec")}
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
                    .catch((e) =>
                      toast(
                        "error",
                        t("common.create-failed-{error}", {
                          error: truncateError(e),
                        }),
                      ),
                    );
                setPlNaming(false);
              }}
            >
              <input
                autoFocus
                value={plNameVal}
                onChange={(e) => setPlNameVal(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setPlNaming(false)}
                placeholder={t("common.playlist-name")}
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
                {t("common.new-playlist")}
              </Btn>
            </div>
          )}

          {playlists.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--line-strong)] px-4 py-6 text-center text-xs text-[var(--text-faint)]">
              {t("common.no-playlists-yet-create-one-and-pick-a-collectio")}
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
                          <ItemTitle className="truncate">{pl.name}</ItemTitle>
                          {pl.enabled && (
                            <span className="rounded-full bg-[rgb(var(--glow))] px-2 py-0.5 font-mono text-[10px] font-bold text-[#06121f]">
                              {t("common.running")}
                            </span>
                          )}
                        </div>
                        <div className="text-dim-sm mt-0.5">
                          {t("common.{n}-items", { n: pool.length })} ·{" "}
                          {pl.shuffleMin > 0
                            ? t("common.every-{n}-min", { n: pl.shuffleMin })
                            : t("common.manual")}
                          {pl.rules.length > 0 &&
                            ` · ${t("common.{n}-time-rules", { n: pl.rules.length })}`}
                          {pl.enabled &&
                            activeEntry &&
                            ` · ${t("common.now-{name}", { name: activeEntry.name })}`}
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
                                  ? t("common.playlist-stopped")
                                  : t("common.playing", { name: pl.name }),
                              ),
                            )
                            .catch((e) =>
                              toast("error", `${t("common.failed")} ${truncateError(e)}`),
                            )
                        }
                        className={`rounded-lg px-3 py-1.5 text-xs ${chipStyle(pl.enabled)}`}
                      >
                        {t(pl.enabled ? "common.stop" : "common.start")}
                      </button>
                      <button
                        onClick={() => setPlaylistFor(open ? null : pl.id)}
                        className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-xs font-semibold text-[var(--text-dim)] transition-colors hover:text-[var(--text)]"
                      >
                        {t(open ? "common.close" : "common.edit")}
                      </button>
                      <button
                        aria-label={t("common.delete-playlist", { name: pl.name })}
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
                          <div className="kicker mb-2">{t("common.source")}</div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() =>
                                api
                                  .playlistSave({ ...pl, source: "all" })
                                  .catch(() => {})
                              }
                              className={`rounded-xl px-3 py-1.5 text-xs ${chipStyle(pl.source === "all")}`}
                            >
                              {t("common.whole-vault")}
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
                          label={t("common.shuffle-every")}
                          min={1}
                          max={180}
                          step={1}
                          value={pl.shuffleMin || 15}
                          format={(v) => t("common.{n}-min", { n: Math.round(v) })}
                          onChange={(v) =>
                            api
                              .playlistSave({ ...pl, shuffleMin: Math.round(v) })
                              .catch(() => {})
                          }
                        />

                        {/* transition crossfade */}
                        <Slider
                          label={t("common.transition-crossfade")}
                          min={0}
                          max={8}
                          step={0.5}
                          value={pl.crossfadeSec ?? 1.5}
                          format={(v) =>
                            v === 0 ? t("common.instant-cut") : `${v.toFixed(1)}s`
                          }
                          onChange={(v) =>
                            api
                              .playlistSave({ ...pl, crossfadeSec: v })
                              .catch(() => {})
                          }
                        />

                        {/* time-of-day rules */}
                        <div>
                          <div className="kicker mb-2">
                            {t("common.time-of-day-rules-optional")}
                          </div>
                          {pl.rules.length === 0 && (
                            <div className="text-dim-sm mb-2">
                              {t("common.without-rules-the-playlist-shuffles-one-pool-all")}
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
                                  <option value="all">{t("common.whole-vault")}</option>
                                  {collections.map((c) => (
                                    <option key={c.id} value={`collection:${c.id}`}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  aria-label={t("common.delete-rule")}
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
                            className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--line-strong)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-dim)] hover-glow"
                          >
                            <IconPlus className="h-3.5 w-3.5" />
                            {t("common.add-rule")}
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
          <Card title={t("common.shader-presets")}>
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
                      <span className="text-xs font-semibold text-[var(--text)]">
                        {t(s.label)}
                      </span>
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

          <Card title={t("common.playback")}>
            {wall.kind === "video" && (
              <>
                <Slider
                  label={t("common.volume")}
                  min={0}
                  max={1}
                  step={0.05}
                  value={wall.volume}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => save((c) => (c.wallpaper.volume = v))}
                />
                <Slider
                  label={t("common.playback-speed")}
                  min={0.25}
                  max={3}
                  step={0.05}
                  value={wall.videoSpeed ?? 1}
                  format={(v) => `${v.toFixed(2)}×`}
                  onChange={(v) => save((c) => (c.wallpaper.videoSpeed = v))}
                />
                <div className="mt-2">
                  <div className="mb-2 text-xs font-medium text-[var(--text-dim)]">{t("common.fit-to-display")}</div>
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
                        {f === "fill" ? t("common.stretch") : f}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--text-faint)]">
                    {t("common.auto-fills-the-screen-and-crops-only-when-shapes")}
                  </p>
                </div>
                <div className="mt-3 border-t border-[var(--line)] pt-2">
                  <Section title={t("common.color-grading")} defaultOpen>
                  <Slider
                    label={t("common.brightness")}
                    min={0.2}
                    max={2}
                    step={0.05}
                    value={wall.videoBrightness ?? 1}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => save((c) => (c.wallpaper.videoBrightness = v))}
                  />
                  <Slider
                    label={t("common.saturation")}
                    min={0}
                    max={2}
                    step={0.05}
                    value={wall.videoSaturation ?? 1}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => save((c) => (c.wallpaper.videoSaturation = v))}
                  />
                  <Slider
                    label={t("common.hue-shift")}
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
                  label={t("common.seconds-per-image")}
                  min={5}
                  max={300}
                  step={5}
                  value={wall.slideshow.intervalSec}
                  format={(v) => `${v}s`}
                  onChange={(v) => save((c) => (c.wallpaper.slideshow.intervalSec = v))}
                />
                <Slider
                  label={t("common.crossfade")}
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
              <div className="hint truncate" title={wall.source}>
                {wall.source || t("common.nothing-applied-yet")}
              </div>
            )}
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <Toggle
                label={t("common.live-wallpaper-enabled")}
                description={t("common.renders-the-configured-source-behind-your-icons")}
                checked={cfg.general.wallpaperEnabled}
                onChange={(v) => save((c) => (c.general.wallpaperEnabled = v))}
              />
            </div>
          </Card>
        </div>


        <InfoNote>
          {t("common.each-display-gets-its-own-wallpaper-window-sized")}{" "}
          <b className="text-[var(--text)]">{t("common.all-displays-2")}</b>{" "}
          {t("common.or-just-one-tiles-show-which-displays-they're-ru")}
        </InfoNote>

        <Card title={t("common.zone-device-mapping")}>
          <p className="mb-5 text-sm leading-relaxed text-[var(--text-dim)]">
            {t("common.each-zone-is-a-rectangle-of-the-wallpaper-normal")} {" "}
            <b className="text-[var(--text)]">{t("lighting.zone-sync")}</b>{" "}
            {t("common.mode-devices-receive-the-average-color-of-their")}
          </p>
          {cfg.rgb.zones.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[var(--line-strong)] p-7 text-center text-sm text-[var(--text-faint)]">
              {t("common.no-zones-yet-add-one-then-map-devices-to-it")}
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
                      {t("common.delete")}
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
                  <div className="kicker mb-2">{t("common.devices-2")}</div>
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
                          {deviceName(d, cfg.rgb.deviceNames)}
                        </button>
                      );
                    })}
                    {rgb.devices.length === 0 && (
                      <span className="text-xs text-[var(--text-faint)]">
                        {t("common.connect-openrgb-to-map-devices")}
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
              {t("common.add-zone")}
            </Btn>
          </div>
        </Card>
      </div>
  );
}
