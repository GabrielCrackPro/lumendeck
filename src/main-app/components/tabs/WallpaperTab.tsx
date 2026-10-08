import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store";
import { Card, Btn, Dropdown, Slider, Toggle, TextInput, NumberField, Section, InfoNote, chipStyle, ItemTitle, displayName, EmptyState, Segmented } from "../ui";
import { Modal } from "../Modal";
import { IconSettings, IconImage, IconGlobe, IconFolder, IconPlus, IconTrash, IconClipboard, IconClose, IconChevronRight, IconUpload } from "../icons";
import { SHADERS, SHADER_ART } from "@shared/constants";
import type { Config, EntryOptions, GalleryEntry, WallpaperCollection, ZoneDef } from "@shared/types";
import { api } from "../../ipc";
import { usePending } from "../../pending";
import { truncateError } from "../../utilities";
import { t } from "../../i18n";
import { deviceName } from "../DeviceRow";
import type { MonitorEntry } from "../ui";
import { GalleryGrid } from "../gallery/GalleryGrid";
import { GalleryDrawer } from "../gallery/GalleryDrawer";
import { GalleryToolbar } from "../gallery/GalleryToolbar";
import { CollectionsView } from "../gallery/CollectionsView";
import { NowShowingCard } from "../gallery/NowShowingCard";
import { MediaPickerModal } from "../MediaPickerModal";
import { DEFAULT_QUERY, deriveGalleryView, type GalleryQuery, type SelectContext } from "../gallery/galleryQuery";
import { GalleryThumb } from "../gallery/GalleryThumb";
import { lastPickedEntry, newlyAddedEntries, resolvePicked } from "../gallery/mediaKind";
import { duplicateIds, healthOf, type Unhealthy } from "../gallery/vaultHealth";
import { membershipDiff, visibleSelection } from "../gallery/collections";
import {
  bulkApplyPlan,
  bulkRemovePlan,
  restoreEntries,
} from "../gallery/bulkSelection";
import {
  applyClick,
  clearSelection,
  emptySelection,
  pruneSelection,
  selectAll,
  selectAllState,
  type ClickModifiers,
  type Selection,
} from "../gallery/selection";
import {
  buildIndex,
  cachedCount,
  readCache,
  type StampMap,
  type VaultIndex,
} from "../gallery/vaultIndex";
import { autoIndexEnabled, buildAfterImport } from "../gallery/autoIndex";
import { type GalleryDensity } from "../gallery/GalleryToolbar";

type MonEntry = MonitorEntry;

const GALLERY_PAGE = 60;

export default function WallpaperTab() {
  const { cfg, rgb, save } = useStore(
    useShallow((s) => ({ cfg: s.cfg, rgb: s.rgb, save: s.save })),
  );
  const { pending, run } = usePending({ exclusive: true });
  const [dropBusy, setDropBusy] = useState(false);
  const busy = pending.size > 0 || dropBusy;

  const importSettings =
    cfg
      ? cfg.wallpaper.applyAfterImport && cfg.wallpaper.indexAfterImport
          ? "both"
          : cfg.wallpaper.applyAfterImport
            ? "apply"
            : cfg.wallpaper.indexAfterImport
              ? "index"
              : "apply"
      : "apply";

  const [addStep, setAddStep] = useState<null | "sources" | "url" | "picker-files" | "picker-folder">(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [urlNameDraft, setUrlNameDraft] = useState("");
  const [density, setDensity] = useState<GalleryDensity>("cozy");
  const [vaultIndex, setVaultIndex] = useState<VaultIndex>({});
  const [stamps, setStamps] = useState<StampMap>({});
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<{ done: number; total: number } | null>(null);
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const [selection, setSelection] = useState<Selection>(emptySelection());
  const checked = selection.selected;
  const [dropActive, setDropActive] = useState(false);
  const [dropCount, setDropCount] = useState(0);
  const [mons, setMons] = useState<MonEntry[]>([]);
  const [mode, setMode] = useState<"wallpapers" | "collections">("wallpapers");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [gq, setGq] = useState<GalleryQuery>({ ...DEFAULT_QUERY, collection: "all" });
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [limit, setLimit] = useState(GALLERY_PAGE);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [playlistFor, setPlaylistFor] = useState<string | null>(null);
  const [colNaming, setColNaming] = useState(false);
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
          const before = useStore.getState().cfg?.gallery ?? [];
          setDropBusy(true);
          api
            .galleryImportPaths(paths)
            .then(async (list) => {
              if (seq !== importSeq) return;
              const added = newlyAddedEntries(before, list);
              await indexAfterImport(added.length);
              if (seq !== importSeq) return;
              toast(
                "ok",
                t("common.imported-{n}-items", {
                  n: added.length,
                  s: added.length === 1 ? "" : "s",
                }),
              );
            })
            .catch((e) => {
              console.error("gallery drop import failed:", e);
              toast(
                "error",
                t("common.drop-import-failed-{error}", { error: truncateError(e) }),
              );
            })
            .finally(() => {
              if (seq === importSeq) setDropBusy(false);
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
  const selectCtx: SelectContext = useMemo(
    () => ({
      index: vaultIndex,
      perMonitor: overrides,
      globalKind: wall.kind,
      globalSource: wall.source,
    }),
    [vaultIndex, overrides, wall.kind, wall.source],
  );
  const { gallery, visibleGallery, filtered } = deriveGalleryView(
    cfg.gallery,
    collections,
    gq,
    selectCtx,
    limit,
  );
  const activePlaylist = playlists.find((p) => p.enabled);
  const rotating =
    activePlaylist && (activePlaylist.shuffleMin ?? 0) > 0
      ? String(activePlaylist.shuffleMin)
      : null;
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
  const selectedEntry = gallery.find((g) => g.id === inspectedId) ?? null;
  const duplicateSet = duplicateIds(cfg.gallery);
  const health = new Map<string, Unhealthy>();
  for (const g of cfg.gallery) {
    const why = healthOf(g.id, missing, duplicateSet);
    if (why) health.set(g.id, why);
  }
  const unhealthyCount = health.size;
  const indexTotal = cfg.gallery.filter(
    (g) => g.kind === "video" || g.kind === "image",
  ).length;
  const indexReady = indexTotal > 0 && cachedCount(cfg.gallery, vaultIndex, stamps) === indexTotal;
  const setQuery = (patch: Partial<GalleryQuery>) => {
    setGq((q) => ({ ...q, ...patch }));
    setLimit(GALLERY_PAGE);
  };

  const resetQuery = () =>
    setQuery({ search: "", kind: "all", collection: "all", picks: "all", display: "all" });
  const isActive = (g: GalleryEntry) => g.kind === wall.kind && g.source === wall.source;
  const activeEntry = cfg.gallery.find((x) => isActive(x)) ?? null;

  const applyToAll = (g: GalleryEntry) =>
    void run(
      `apply-${g.id}`,
      () =>
        api
          .galleryApply(g.id)
          .then(() =>
            toast("ok", t("gallery.applied-to-every-display", { name: g.name })),
          ),
      (e) =>
        toast("error", t("gallery.apply-failed-{error}", { error: truncateError(e) })),
    );

  const removeEntry = (g: GalleryEntry) =>
    void run(
      `remove-${g.id}`,
      () =>
        api.galleryRemove(g.id).then(() => {
          if (inspectedId === g.id) setInspectedId(null);
          undoDelete(t("gallery.removed-{name}", { name: g.name }), (next) => {
            next.gallery.push(g);
          });
        }),
      (e) =>
        toast("error", t("gallery.remove-failed-{error}", { error: truncateError(e) })),
    );

  const startRename = (g: GalleryEntry) => {
    setInspectedId(g.id);
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
    void run(
      `apply-${g.id}-${device}`,
      () =>
        api
          .galleryApplyMonitor(g.id, device)
          .then(() =>
            toast("ok", t("gallery.applied-to-one-display", { name: g.name })),
          ),
      (e) =>
        toast("error", t("gallery.apply-failed-{error}", { error: truncateError(e) })),
    );
  const clearMonitor = (device: string) =>
    void run(
      `clear-${device}`,
      () =>
        api
          .galleryApplyMonitor(null, device)
          .then(() => toast("info", t("common.display-reset-to-the-global-wallpaper"))),
      (e) => toast("error", t("common.reset-failed-{error}", { error: truncateError(e) })),
    );

  const toast = (tone: "error" | "info" | "ok", msg: string) =>
    useStore.getState().toast(tone, msg);
  const undoDelete = (msg: string, restore: (c: Config) => void) =>
    useStore.getState().undoDelete(msg, restore);

  const importPickedFiles = (paths: string[]) =>
    run(
      "browse",
      async () => {
        const picked = resolvePicked(paths);
        if (picked.length === 0) return;
        const before = cfg.gallery;
        const list = await api.galleryImportPaths(picked.map((p) => p.path));
        const added = newlyAddedEntries(before, list);
        const last = lastPickedEntry(list, picked);
        if (last && appliesOnImport) await api.galleryApply(last.id);
        await indexAfterImport(added.length);
        toast(
          "ok",
          appliesOnImport
            ? t("gallery.added-{n}-items", { n: added.length })
            : t("gallery.added-{n}-items-not-applied", { n: added.length }),
        );
      },
      (e) => toast("error", t("gallery.import-failed-{error}", { error: truncateError(e) })),
    );

  const importPickedFolder = (folder: string) =>
    run(
      "folder",
      async () => {
        const before = cfg.gallery;
        const list = await api.galleryImportFolder(folder);
        const added = newlyAddedEntries(before, list);
        await indexAfterImport(added.length);
        toast("ok", t("gallery.imported-{n}-items-from-the-folder", { n: added.length }));
      },
      (e) => toast("error", t("gallery.folder-import-failed-{error}", { error: truncateError(e) })),
    );

  const appliesOnImport = wall.applyAfterImport !== false;

  const addFromUrl = (raw: string, name?: string) => {
    const url = raw.trim();
    if (!url) return Promise.resolve(false);
    return run(
      "url",
      async () => {
        const before = cfg.gallery;
        const added = await api.galleryAddFromUrl(url, name?.trim() || undefined);
        const addedCount = newlyAddedEntries(before, [added]).length;
        const applied = appliesOnImport;
        if (applied) await api.galleryApply(added.id);
        await indexAfterImport(addedCount);
        toast(
          "ok",
          t(
            applied
              ? "gallery.downloaded-and-applied"
              : "gallery.downloaded-not-applied",
            { name: added.name },
          ),
        );
      },
      (e) => toast("error", t("gallery.url-import-failed", { error: truncateError(e) })),
    );
  };

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

  const deleteCollection = (c: WallpaperCollection) => {
    api
      .collectionDelete(c.id)
      .then(() => {
        if (gq.collection === c.id) setQuery({ collection: "all" });
        if (mode === "collections") setMode("wallpapers");
        undoDelete(t("gallery.deleted-collection", { name: c.name }), (next) => {
          next.collections.push(c);
        });
      })
      .catch((e) =>
        toast("error", t("gallery.delete-failed-{error}", { error: truncateError(e) })),
      );
  };

  const startRenameCollection = (c: WallpaperCollection) => {
    setColNameVal(c.name);
    setColNaming(true);
    setColRenameId(c.id);
  };

  const startNewCollection = () => {
    setColRenameId(null);
    setColNameVal("");
    setColNaming(true);
  };

  const refreshHealth = async () => {
    try {
      setMissing(new Set(await api.vaultMissing()));
    } catch {
      // A failed health check must not empty the set: that would report the
      // whole vault as healthy when we simply do not know.
    }
    try {
      setStamps(await api.vaultStamps());
    } catch {
      // Same reasoning. An empty map makes every entry read as unmeasured,
      // which is honest — it just means the index offers to rebuild.
    }
    setVaultIndex(readCache());
  };

  useEffect(() => {
    void refreshHealth();
    setSelection((prev) => pruneSelection(prev, cfg.gallery.map((g) => g.id)));
  }, [cfg.gallery.length]);

  const runIndex = async () => {
    setIndexing(true);
    try {
      setVaultIndex(
        await buildIndex(cfg.gallery, stamps, (p) => setIndexProgress({ done: p.done, total: p.total })),
      );
    } catch (e) {
      toast("error", t("gallery.indexing-failed-{error}", { error: truncateError(e) }));
    } finally {
      setIndexing(false);
      setIndexProgress(null);
    }
  };

  const indexAfterImport = async (added: number) => {
    const fresh = await api.getConfig();
    if (!autoIndexEnabled(fresh.wallpaper)) return;
    try {
      const result = await buildAfterImport(
        {
          added,
          building: indexing,
          entries: fresh.gallery,
          index: readCache(),
        },
        {
          onStart: () => setIndexing(true),
          onProgress: (p) => setIndexProgress({ done: p.done, total: p.total }),
        },
      );
      if (!result) return;
      setVaultIndex(result.index);
      setStamps(result.stamps);
    } catch (e) {
      toast("error", t("gallery.indexing-failed-{error}", { error: truncateError(e) }));
    } finally {
      setIndexing(false);
      setIndexProgress(null);
    }
  };

  const selectEntry = (id: string, mods: ClickModifiers) => {
    setSelection((prev) => applyClick(prev, visibleGallery.map((g) => g.id), id, mods));
  };

  const clearChecked = () => setSelection(clearSelection());

  const toggleSelectAll = (want: boolean) =>
    setSelection(selectAll(gallery.map((g) => g.id), want));

  const allState = selectAllState(selection.selected, gallery.map((g) => g.id));

  const addCheckedToCollection = (collectionId: string) => {
    const col = collections.find((c) => c.id === collectionId);
    if (!col) return;
    const { toAdd, alreadyIn } = membershipDiff(col, [...checked]);
    if (toAdd.length === 0) {
      toast("info", t("gallery.all-selected-already-collected"));
      return;
    }
    void run(`collect-${collectionId}`, async () => {
      await api.collectionAddEntries(collectionId, toAdd);
      const name = col.name;
      toast(
        "ok",
        alreadyIn.length > 0
          ? t("gallery.added-{n}-to-{name}", { n: toAdd.length, name })
          : t("common.added-to", { name }),
      );
    }, (e) => toast("error", t("common.failed-{error}", { error: truncateError(e) })));
  };

  const checkedCollectionOptions = useMemo(() => {
    const picked = [...checked];
    return collections
      .map((c) => {
        const { toAdd } = membershipDiff(c, picked);
        return { id: c.id, name: c.name, pending: toAdd.length };
      })
      .filter((c) => c.pending > 0);
  }, [checked, collections]);

  const hiddenChecked = useMemo(
    () => visibleSelection(checked, visibleGallery.map((g) => g.id)).hiddenCount,
    [checked, visibleGallery],
  );

  const applyChecked = () => {
    const { apply, collapsed } = bulkApplyPlan(cfg.gallery, checked);
    if (!apply) return Promise.resolve();
    return run("apply-checked", async () => {
      await api.galleryApply(apply.id);
      toast("ok", t("gallery.applied-to-every-display", { name: apply.name }));
      clearChecked();
      if (collapsed > 1) {
        toast(
          "info",
          t("gallery.applied-the-newest-of-{n}-selected", { n: collapsed }),
        );
      }
    }, (e) =>
      toast("error", t("gallery.apply-failed-{error}", { error: truncateError(e) })),
    );
  };

  const removeChecked = () => {
    const picked = bulkRemovePlan(cfg.gallery, checked);
    if (picked.length === 0) return Promise.resolve();
    return run("remove", async () => {
      const removed: GalleryEntry[] = [];
      try {
        for (const g of picked) {
          await api.galleryRemove(g.id);
          removed.push(g);
        }
      } catch (e) {
        toast("error", t("gallery.remove-failed-{error}", { error: truncateError(e) }));
      }
      if (removed.length === 0) return;
      if (inspectedId && removed.some((g) => g.id === inspectedId)) setInspectedId(null);
      if (removed.length === picked.length) {
        undoDelete(
          t("gallery.removed-{n}-items", { n: removed.length }),
          (next) => {
            next.gallery = restoreEntries(next.gallery, removed);
          },
        );
      } else {
        for (const g of removed) {
          undoDelete(t("gallery.removed-{name}", { name: g.name }), (next) => {
            next.gallery = restoreEntries(next.gallery, [g]);
          });
        }
      }
      clearChecked();
    });
  };

  const removeDuplicates = () => {
    const redundant = cfg.gallery.filter((g) => duplicateSet.has(g.id));
    if (redundant.length === 0) return Promise.resolve();
    return run(
      "remove-duplicates",
      async () => {
        for (const g of redundant) await api.galleryRemove(g.id);
        toast("ok", t("gallery.removed-{n}-duplicates", { n: redundant.length }));
      },
      (e) => toast("error", t("gallery.remove-failed-{error}", { error: truncateError(e) })),
    );
  };

  const updateZone = (id: string, patch: Partial<ZoneDef>) =>
    save((c) => {
      const z = c.rgb.zones.find((z) => z.id === id);
      if (z) Object.assign(z, patch);
    });

  return (
    <div className="@container stagger space-y-4 sm:space-y-5">

      <NowShowingCard
        cfg={cfg}
        activeEntry={activeEntry}
        index={vaultIndex}
        save={save}
      />
        <Card
          anchor="vault"
          title={t("common.vault")}
          right={
            <Segmented
              label={t("gallery.view")}
              value={mode}
              onChange={(v) => {
                setMode(v);
                setLimit(GALLERY_PAGE);
              }}
              options={[
                {
                  id: "wallpapers" as const,
                  label: `${t("gallery.view-wallpapers")} · ${gallery.length}`,
                },
                {
                  id: "collections" as const,
                  label: `${t("gallery.view-collections")} · ${collections.length}`,
                },
              ]}
            />
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
                onClick={() => void (async () => {
                  await refreshHealth();
                  await runIndex();
                })()}
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
            searchRef={searchRef}
            density={density}
            onDensity={setDensity}
            selectAllState={allState}
            onSelectAll={toggleSelectAll}
            indexReady={indexReady}
            indexBuilding={indexing}
            indexProgress={indexProgress}
            onBuildIndex={() => void runIndex()}
            shownCount={visibleGallery.length}
            resultCount={gallery.length}
            view={mode}
            countCtx={selectCtx}
            displays={mons.map((m, i) => ({
              device: m.device,
              name: displayName(m, i, cfg.general.screenNames),
            }))}
            draggingId={draggingId}
            onDropOnCollection={dropOnCollection}
            onCollection={(id) => setQuery({ collection: id })}
            onRenameCollection={startRenameCollection}
            onDeleteCollection={deleteCollection}
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
                        .then(async (col) => {
                          const picked = [...checked];
                          setGq((q) => ({ ...q, collection: col.id }));
                          if (picked.length === 0) return;
                          await api.collectionAddEntries(col.id, picked);
                          toast("ok", t("gallery.added-{n}-to-{name}", { n: picked.length, name }));
                        })
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


            <Dropdown
              icon={<IconSettings className="h-4 w-4" />}
              ariaLabel={t("gallery.import-settings")}
              title={t("gallery.import-settings")}
              value={importSettings}
              onChange={(v) =>
                save((c) => {
                  if (v === "apply") {
                    c.wallpaper.applyAfterImport = true;
                    c.wallpaper.indexAfterImport = false;
                  } else if (v === "index") {
                    c.wallpaper.applyAfterImport = false;
                    c.wallpaper.indexAfterImport = true;
                  } else {
                    c.wallpaper.applyAfterImport = true;
                    c.wallpaper.indexAfterImport = true;
                  }
                })
              }
              options={[
                { id: "apply", label: t("gallery.apply-after-import") },
                { id: "index", label: t("gallery.index-after-import") },
                { id: "both", label: t("gallery.apply-and-measure-after-import") },
              ]}
              className="hidden shrink-0 items-center sm:flex"
            />
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

            {mode === "wallpapers" ? (
              <>
            <GalleryGrid
              entries={visibleGallery}
              collections={collections}
              monitors={mons}
              thumbFor={(g) => <GalleryThumb entry={g} />}
              activeEntry={activeEntry}
              perMonitor={overrides}
              onApplyAll={applyToAll}
              onInspect={(g) => setInspectedId(g.id)}
              onRename={startRename}
              onRemove={removeEntry}
              density={density}
              health={health}
            checked={checked}
            onSelect={selectEntry}
            onSelectAll={toggleSelectAll}
            selectAllActive={allState === "all"}
              onApplyChecked={() => void applyChecked()}
              applyPending={pending.has("apply-checked")}
              onAddCheckedToCollection={(id) => void addCheckedToCollection(id)}
              hiddenChecked={hiddenChecked}
              collectionOptions={checkedCollectionOptions}
              onRemoveChecked={() => void removeChecked()}
              removePending={pending.has("remove")}
              onClearChecked={clearChecked}
              onDragEntry={setDraggingId}
              rotating={rotating}
              onToggleFavorite={(g) => toggleFavorite(g, !g.favorite)}
              index={vaultIndex}
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
                  setMode("wallpapers");
                  setQuery({ collection: id });
                }}
                onNewCollection={startNewCollection}
                onRename={startRenameCollection}
                onDelete={deleteCollection}
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
                onClose={() => setInspectedId(null)}
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
                  void run(
                    "regen-thumb",
                    () =>
                      api
                        .galleryRegenerateThumb(selectedEntry.id)
                        .then(() => toast("ok", t("gallery.thumbnail-regenerated"))),
                    (e) =>
                      toast(
                        "error",
                        t("gallery.thumbnail-failed-{error}", { error: truncateError(e) }),
                      ),
                  );
                }}
                globalOpts={{
                  fit: cfg.wallpaper.videoFit,
                  speed: cfg.wallpaper.videoSpeed,
                  volume: cfg.wallpaper.volume,
                }}
              />
            )}
          </div>


          {addStep !== null && (
            <Modal
              title={
                addStep === "sources"
                  ? t("gallery.add-a-wallpaper")
                  : addStep === "url"
                    ? t("gallery.from-a-url")
                    : addStep === "picker-files"
                      ? t("gallery.select-wallpapers")
                      : t("gallery.choose-wallpaper-folder")
              }
              onClose={() => setAddStep(null)}
              onBack={
                addStep === "url" || addStep === "picker-files" || addStep === "picker-folder"
                  ? () => setAddStep("sources")
                  : undefined
              }
              backLabel={t("common.go-back")}
              style={{
                maxWidth:
                  addStep === "sources"
                    ? "42rem"
                    : addStep === "url"
                      ? "36rem"
                      : "56rem",
              }}
            >
              <div key={addStep} className="modal-state-enter">
              {addStep === "sources" && (
              <div className="max-h-[calc(100dvh-5rem)] space-y-3 overflow-y-auto p-1">
                <section className="relative isolate overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel-sunken)] px-4 py-4 sm:px-5 sm:py-5">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_82%_18%,rgb(var(--glow)/0.18),transparent_48%)]"
                  />
                  <div className="relative flex min-h-28 items-end justify-between gap-4">
                    <div className="max-w-sm">
                      <span className="mb-2 block font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--glow))]">
                        {t("gallery.wallpaper-library")}
                      </span>
                      <h3 className="text-lg font-semibold leading-tight tracking-[-0.03em] text-[var(--text)] sm:text-xl">
                        {t("gallery.add-wallpaper-hero")}
                      </h3>
                      <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-[var(--text-dim)]">
                        {t("gallery.add-wallpaper-description")}
                      </p>
                    </div>
                    <div aria-hidden="true" className="relative mr-1 hidden h-24 w-32 shrink-0 sm:block">
                      <div className="absolute right-6 top-2 h-16 w-24 -rotate-12 rounded-lg border border-[var(--line-strong)] bg-[var(--panel)] shadow-[var(--shadow)]" />
                      <div className="absolute right-1 top-1 h-16 w-24 rotate-6 rounded-lg border border-[var(--line-strong)] bg-[var(--panel-strong)] p-1.5 shadow-[var(--shadow)]">
                        <div className="h-full rounded-md bg-[linear-gradient(145deg,rgb(var(--glow)/0.65),rgb(var(--glow)/0.08)_45%,var(--panel-sunken))]" />
                      </div>
                      <div className="absolute bottom-0 right-7 h-5 w-14 rounded-md border border-[var(--line)] bg-[var(--panel-strong)]" />
                    </div>
                  </div>
                </section>

                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    onClick={() => {
                      setAddStep("picker-files");
                    }}
                    disabled={busy}
                    className="group relative flex min-h-24 items-center gap-3 overflow-hidden rounded-xl border border-[rgb(var(--glow)/0.35)] bg-[rgb(var(--glow)/0.07)] px-4 py-3 text-left transition-colors hover:border-[rgb(var(--glow)/0.65)] hover:bg-[rgb(var(--glow)/0.11)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.7)] disabled:cursor-not-allowed disabled:opacity-40 sm:col-span-2"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[rgb(var(--glow)/0.25)] bg-[rgb(var(--glow)/0.12)] text-[rgb(var(--glow))]">
                      <IconImage className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[var(--text)]">
                        {t("gallery.browse-files")}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-[var(--text-dim)]">
                        {t("gallery.src-browse")}
                      </span>
                    </span>
                    <IconChevronRight className="h-4 w-4 shrink-0 text-[rgb(var(--glow))] transition-transform group-hover:translate-x-0.5" />
                  </button>

                  <button
                    onClick={() => {
                      setAddStep("picker-folder");
                    }}
                    disabled={busy}
                    className="group flex min-h-20 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3.5 py-3 text-left transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--panel-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.7)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)] text-[var(--text-dim)] transition-colors group-hover:text-[rgb(var(--glow))]">
                      <IconFolder className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[var(--text)]">
                        {t("common.import-folder")}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-[var(--text-faint)]">
                        {t("gallery.src-folder")}
                      </span>
                    </span>
                    <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--text-faint)] transition-all group-hover:translate-x-0.5 group-hover:text-[rgb(var(--glow))]" />
                  </button>

                  <button
                    onClick={() => setAddStep("url")}
                    disabled={busy}
                    className="group flex min-h-20 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3.5 py-3 text-left transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--panel-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.7)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)] text-[var(--text-dim)] transition-colors group-hover:text-[rgb(var(--glow))]">
                      <IconGlobe className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[var(--text)]">
                        {t("common.from-url")}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-[var(--text-faint)]">
                        {t("gallery.src-url")}
                      </span>
                    </span>
                    <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--text-faint)] transition-all group-hover:translate-x-0.5 group-hover:text-[rgb(var(--glow))]" />
                  </button>
                </div>

                <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--line-strong)] px-3 py-2.5">
                  <IconUpload className="h-4 w-4 shrink-0 text-[rgb(var(--glow))]" />
                  <p className="text-[11px] leading-relaxed text-[var(--text-faint)]">
                    {t("gallery.drop-media-hint")}
                  </p>
                </div>
              </div>
              )}

          {(addStep === "picker-files" || addStep === "picker-folder") && (
            <MediaPickerModal
              initialMode={addStep === "picker-files" ? "files" : "folder"}
              onImportFiles={(paths) => {
                setAddStep(null);
                importPickedFiles(paths);
              }}
              onImportFolder={(path) => {
                setAddStep(null);
                importPickedFolder(path);
              }}
            />
          )}

          {addStep === "url" && (
              <form
                className="space-y-4 p-2 sm:p-3"
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
                    data-modal-autofocus
                    type="url"
                    required
                    value={urlDraft}
                    onChange={(e) => setUrlDraft(e.target.value)}
                    placeholder="https://example.com/wallpaper.mp4"
                    className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--text-faint)] focus:border-[rgb(var(--glow)/0.5)]"
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
                    className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--text-faint)] focus:border-[rgb(var(--glow)/0.5)]"
                  />
                </label>
                <p className="text-dim-sm">
                  {t("common.direct-link-to-an-mp4-webm-video-or-png-jpg-webp")}
                </p>
                <div className="flex items-center justify-between gap-2 pt-1">

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
                  <Btn type="submit" variant="primary" disabled={busy || !urlDraft.trim()} pending={pending.has("url")}>
                    {t("common.download")}
                  </Btn>
                </div>
              </form>
          )}
              </div>
            </Modal>
          )}

          {mode === "wallpapers" && gallery.length === 0 && (
            <div className="mt-4">
              <EmptyState
                icon={<IconImage className="h-6 w-6" />}
                title={t(
                  filtered ? "common.no-matches" : "common.vault-is-empty",
                )}
                description={
                  filtered
                    ? t("common.nothing-in-this-view-is-called", {
                        query: gq.search.trim() || t("gallery.this-filter"),
                      })
                    : t("common.add-a-video-or-image-or-drop-files-and-folders-h")
                }
                action={
                  filtered ? (
                    <Btn onClick={resetQuery}>
                      <IconClose className="h-4 w-4" />
                      {t("common.clear-the-search")}
                    </Btn>
                  ) : undefined
                }
              />
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
                            <span className="rounded-full bg-[rgb(var(--glow))] px-2 py-0.5 font-mono text-[10px] font-bold text-black">
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
                            .catch((e) =>
                              toast(
                                "error",
                                t("common.delete-failed-{error}", { error: truncateError(e) }),
                              ),
                            )
                        }
                        className="text-[var(--text-faint)] transition-colors hover:text-red-400"
                      >
                        <IconTrash className="h-4 w-4" />
                      </button>
                    </div>

                    {open && (
                      <div className="mt-4 space-y-4 border-t border-[var(--line)] pt-4">

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
                                  <IconTrash className="h-4 w-4" />
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
                            <IconPlus className="h-4 w-4" />
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

        <div className="grid gap-4 @[42rem]:grid-cols-2 @[56rem]:gap-5">
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
                    }                     className={`group overflow-hidden rounded-2xl border text-left transition-all duration-[var(--motion-slow)] ease-[var(--ease-standard)] ${
                      active
                        ? "border-[rgb(var(--glow)/0.7)] shadow-[0_10px_30px_-12px_rgb(var(--glow)/0.5)] ring-2 ring-[rgb(var(--glow)/0.2)]"
                        : "border-[var(--line)] hover:border-[var(--line-strong)]"
                    }`}
                  >
                    <div className="relative h-14 w-full overflow-hidden">
                      <div                         className="h-full w-full transition-transform duration-[var(--motion-slow)] ease-[var(--ease-standard)] group-hover:scale-110"
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
