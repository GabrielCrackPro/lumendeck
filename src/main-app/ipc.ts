import { invoke } from "@tauri-apps/api/core";
import type { StampMap } from "./components/gallery/indexStamps";
import type { DevInfo, TransferKind, TransferPreview } from "@shared/types";
import type {
  Config,
  DiscoverPage,
  DynlightStatus,
  EntryOptions,
  GalleryEntry,
  MediaInfo,
  MediaPickerListing,
  OpenrgbStatus,
  PerfSnapshot,
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

  pickMediaFiles: () => invoke<string[]>("pick_media_files"),
  pickImageFile: () => invoke<string | null>("pick_image_file"),
  pickMediaFolder: () => invoke<string | null>("pick_media_folder"),
  listImages: (folder: string) => invoke<string[]>("list_images", { folder }),
  // Lists common folders and drives at the root, or supported media in a folder.
  mediaPickerList: (path?: string) =>
    invoke<MediaPickerListing>("media_picker_list", { path: path ?? null }),

  galleryAdd: (entry: {
    name: string;
    kind: WallpaperKind;
    source: string;
    thumb?: string | null;
  }) => invoke<GalleryEntry>("gallery_add", entry),
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
    invoke<GalleryEntry>("gallery_add_from_url", { url, name: name ?? null }),
  gallerySetOpts: (id: string, opts: EntryOptions | null) =>
    invoke<GalleryEntry[]>("gallery_set_opts", { id, opts }),
  gallerySetFavorite: (id: string, favorite: boolean) =>
    invoke<GalleryEntry[]>("gallery_set_favorite", { id, favorite }),
  galleryRegenerateThumb: (id: string) =>
    invoke<GalleryEntry[]>("gallery_regenerate_thumb", { id }),
  vaultMissing: () => invoke<string[]>("vault_missing"),
  vaultStamps: () => invoke<StampMap>("vault_stamps"),
  logTail: (limit?: number) => invoke<string[]>("log_tail", { limit: limit ?? null }),
  devInfo: () => invoke<DevInfo>("dev_info"),
  revealLog: () => invoke<void>("reveal_log"),
  revealInFolder: (path: string) => invoke<void>("reveal_in_folder", { path }),
  clipboardUrl: () => invoke<string | null>("clipboard_url"),

  collectionCreate: (name: string) =>
    invoke<WallpaperCollection>("collection_create", { name }),
  collectionRename: (id: string, name: string) =>
    invoke<void>("collection_rename", { id, name }),
  collectionDelete: (id: string) => invoke<void>("collection_delete", { id }),
  collectionToggleEntry: (id: string, entryId: string) =>
    invoke<boolean>("collection_toggle_entry", { id, entryId }),
  collectionAddEntries: (id: string, entryIds: string[]) =>
    invoke<string[]>("collection_add_entries", { id, entryIds }),

  playlistCreate: (name: string) =>
    invoke<WallpaperPlaylist>("playlist_create", { name }),
  playlistSave: (playlist: WallpaperPlaylist) =>
    invoke<void>("playlist_save", { playlist }),
  playlistDelete: (id: string) => invoke<void>("playlist_delete", { id }),
  playlistSetActive: (id: string | null) =>
    invoke<void>("playlist_set_active", { id }),

  sceneSave: (name: string) => invoke<SceneProfile>("scene_save", { name }),
  sceneApply: (id: string) => invoke<void>("scene_apply", { id }),

  mediaTransport: (action: "play" | "pause" | "toggle" | "next" | "previous") =>
    invoke<void>("media_transport", { action }),
  mediaSeek: (positionSec: number) => invoke<void>("media_seek", { positionSec }),
  mediaShuffle: (active: boolean) => invoke<void>("media_shuffle", { active }),
  mediaRepeat: (current: 0 | 1 | 2 | null) => invoke<void>("media_repeat", { current }),
  volumeGet: () => invoke<[number, number]>("volume_get"),
  volumeSet: (percent: number) => invoke<void>("volume_set", { percent }),
  volumeMuteToggle: () => invoke<boolean>("volume_mute_toggle"),
  perfSnapshot: () => invoke<PerfSnapshot>("perf_snapshot"),
  mediaCurrent: () => invoke<MediaInfo | null>("media_current"),
  systemAccent: () => invoke<[number, number, number] | null>("system_accent"),
  systemLanguage: () => invoke<string>("system_language"),
  accountName: () => invoke<string>("account_name"),
  sceneDelete: (id: string) => invoke<void>("scene_delete", { id }),
  sceneRename: (id: string, name: string) =>
    invoke<void>("scene_rename", { id, name }),
  sceneSetLogo: (id: string, source: string | null) =>
    invoke<string>("scene_set_logo", { id, source }),

  transferExport: (kind: TransferKind, path: string) =>
    invoke<string>("transfer_export", { kind, path }),
  transferPreview: (path: string) => invoke<TransferPreview>("transfer_preview", { path }),
  transferImport: (path: string) => invoke<number>("transfer_import", { path }),
  transferPickSavePath: (defaultName: string) =>
    invoke<string | null>("transfer_pick_save_path", { defaultName }),
  transferPickOpenPath: () => invoke<string | null>("transfer_pick_open_path"),

  rgbStatus: () => invoke<RgbStatus>("rgb_status"),
  openrgbStatus: () => invoke<OpenrgbStatus>("openrgb_status"),
  dynlightStatus: () => invoke<DynlightStatus>("dynlight_status"),
  discoverList: (source: string, query: string, page: number) =>
    invoke<DiscoverPage>("discover_list", { source, query, page }),
  discoverThumb: (url: string) => invoke<string>("discover_thumb", { url }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  openrgbInstall: () => invoke<string>("openrgb_install"),
  openrgbLaunch: (exe: string) => invoke<void>("openrgb_launch", { exe }),
  rgbRefresh: () => invoke<void>("rgb_refresh"),

  togglePause: () => invoke<boolean>("toggle_pause"),

  minimizeWindow: () => invoke<void>("minimize_window"),

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

  hotkeyValidate: (accelerator: string) =>
    invoke<void>("hotkey_validate", { accelerator }),

  quit: () => invoke<void>("quit"),
  factoryReset: () => invoke<void>("factory_reset"),
};
