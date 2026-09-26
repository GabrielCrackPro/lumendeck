// Thin typed wrappers over the Tauri IPC surface.
import { invoke } from "@tauri-apps/api/core";
import type {
  Config,
  GalleryEntry,
  RgbStatus,
  SceneProfile,
  StickerDef,
  WallpaperCollection,
  WallpaperConfig,
  WallpaperKind,
  WallpaperPlaylist,
} from "@shared/types";

export const api = {
  getConfig: () => invoke<Config>("get_config"),
  setConfig: (cfg: Config) => invoke<Config>("set_config", { cfg }),
  reloadConfig: () => invoke<Config>("reload_config"),

  applyWallpaper: (wallpaper: WallpaperConfig) =>
    invoke<void>("apply_wallpaper", { wallpaper }),
  setWallpaperEnabled: (enabled: boolean) =>
    invoke<void>("set_wallpaper_enabled", { enabled }),

  pickMediaFile: () => invoke<string | null>("pick_media_file"),
  pickMediaFolder: () => invoke<string | null>("pick_media_folder"),
  listImages: (folder: string) => invoke<string[]>("list_images", { folder }),

  galleryAdd: (entry: {
    name: string;
    kind: WallpaperKind;
    source: string;
    thumb?: string | null;
  }) => invoke<GalleryEntry[]>("gallery_add", entry),
  galleryRemove: (id: string) => invoke<GalleryEntry[]>("gallery_remove", { id }),
  galleryApply: (id: string) => invoke<void>("gallery_apply", { id }),
  galleryApplyMonitor: (id: string | null, monitor: string) =>
    invoke<void>("gallery_apply_monitor", { id, monitor }),
  galleryImportFolder: (folder: string) =>
    invoke<GalleryEntry[]>("gallery_import_folder", { folder }),
  galleryImportPaths: (paths: string[]) =>
    invoke<GalleryEntry[]>("gallery_import_paths", { paths }),

  collectionCreate: (name: string) =>
    invoke<WallpaperCollection>("collection_create", { name }),
  collectionRename: (id: string, name: string) =>
    invoke<void>("collection_rename", { id, name }),
  collectionDelete: (id: string) => invoke<void>("collection_delete", { id }),
  collectionToggleEntry: (id: string, entryId: string) =>
    invoke<boolean>("collection_toggle_entry", { id, entryId }),

  playlistCreate: (name: string) =>
    invoke<WallpaperPlaylist>("playlist_create", { name }),
  playlistSave: (playlist: WallpaperPlaylist) =>
    invoke<void>("playlist_save", { playlist }),
  playlistDelete: (id: string) => invoke<void>("playlist_delete", { id }),
  playlistSetActive: (id: string | null) =>
    invoke<void>("playlist_set_active", { id }),

  sceneSave: (name: string) => invoke<SceneProfile>("scene_save", { name }),
  sceneApply: (id: string) => invoke<void>("scene_apply", { id }),
  sceneDelete: (id: string) => invoke<void>("scene_delete", { id }),
  sceneRename: (id: string, name: string) =>
    invoke<void>("scene_rename", { id, name }),

  rgbStatus: () => invoke<RgbStatus>("rgb_status"),
  rgbRefresh: () => invoke<void>("rgb_refresh"),

  /** Arms the desktop click-capture; resolves with the created sticker. */
  beginStickerPlacement: (name: string, url: string, kind: string) =>
    invoke<StickerDef>("begin_sticker_placement", { name, url, kind }),
  cancelStickerPlacement: () => invoke<void>("cancel_sticker_placement"),

  beginStickerEditor: () => invoke<void>("begin_sticker_editor"),
  endStickerEditor: () => invoke<void>("end_sticker_editor"),

  updateSticker: (sticker: StickerDef) =>
    invoke<void>("update_sticker", { sticker }),
  removeSticker: (id: string) => invoke<void>("remove_sticker", { id }),

  monitors: () =>
    invoke<
      { device: string; x: number; y: number; w: number; h: number; primary: boolean }[]
    >("monitors"),

  quit: () => invoke<void>("quit"),
  factoryReset: () => invoke<void>("factory_reset"),
};
