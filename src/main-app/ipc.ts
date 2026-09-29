// Thin typed wrappers over the Tauri IPC surface.
import { invoke } from "@tauri-apps/api/core";
import type {
  Config,
  GalleryEntry,
  MediaInfo,
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
  galleryRemove: (id: string) =>
    invoke<GalleryEntry[]>("gallery_remove", { id }),
  galleryApply: (id: string) => invoke<void>("gallery_apply", { id }),
  galleryApplyMonitor: (id: string | null, monitor: string) =>
    invoke<void>("gallery_apply_monitor", { id, monitor }),
  galleryImportFolder: (folder: string) =>
    invoke<GalleryEntry[]>("gallery_import_folder", { folder }),
  galleryImportPaths: (paths: string[]) =>
    invoke<GalleryEntry[]>("gallery_import_paths", { paths }),
  galleryAddFromUrl: (url: string, name?: string) =>
    invoke<GalleryEntry[]>("gallery_add_from_url", { url, name: name ?? null }),

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

  // Media session (SMTC): transport + initial snapshot.
  mediaTransport: (action: "play" | "pause" | "toggle" | "next" | "previous") =>
    invoke<void>("media_transport", { action }),
  mediaCurrent: () => invoke<MediaInfo | null>("media_current"),
  /** The user's current Windows accent color (RGB triplet), for UI theming. */
  systemAccent: () => invoke<[number, number, number] | null>("system_accent"),
  sceneDelete: (id: string) => invoke<void>("scene_delete", { id }),
  sceneRename: (id: string, name: string) =>
    invoke<void>("scene_rename", { id, name }),

  rgbStatus: () => invoke<RgbStatus>("rgb_status"),
  rgbRefresh: () => invoke<void>("rgb_refresh"),

  /** Manual pause toggle (same as the tray control). Returns the new state. */
  togglePause: () => invoke<boolean>("toggle_pause"),

  /**
   * Titlebar minimize. Goes to the tray or the taskbar depending on
   * `general.minimizeToTray` — the backend owns that decision.
   */
  minimizeWindow: () => invoke<void>("minimize_window"),

  /** Arms the desktop click-capture; resolves with the created sticker. */
  beginStickerPlacement: (name: string, url: string, kind: string) =>
    invoke<StickerDef>("begin_sticker_placement", { name, url, kind }),
  cancelStickerPlacement: () => invoke<void>("cancel_sticker_placement"),

  beginStickerEditor: () => invoke<void>("begin_sticker_editor"),
  endStickerEditor: () => invoke<void>("end_sticker_editor"),

  updateSticker: (sticker: StickerDef) =>
    invoke<void>("update_sticker", { sticker }),
  removeSticker: (id: string) => invoke<void>("remove_sticker", { id }),
  duplicateSticker: (id: string) => invoke<void>("duplicate_sticker", { id }),
  reorderSticker: (id: string, delta: number) =>
    invoke<void>("reorder_sticker", { id, delta }),

  monitors: () =>
    invoke<
      {
        device: string;
        x: number;
        y: number;
        w: number;
        h: number;
        primary: boolean;
      }[]
    >("monitors"),

  quit: () => invoke<void>("quit"),
  factoryReset: () => invoke<void>("factory_reset"),
};
