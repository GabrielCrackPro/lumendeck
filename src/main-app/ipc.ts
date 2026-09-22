// Thin typed wrappers over the Tauri IPC surface.
import { invoke } from "@tauri-apps/api/core";
import type {
  Config,
  GalleryEntry,
  RgbStatus,
  StickerDef,
  WallpaperConfig,
  WallpaperKind,
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
