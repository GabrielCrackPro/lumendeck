// Thin typed wrappers over the Tauri IPC surface.
import { invoke } from "@tauri-apps/api/core";
import type { StampMap } from "./components/gallery/indexStamps";
import type { DevInfo } from "@shared/types";
import type {
  Config,
  EntryOptions,
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

  pickMediaFiles: () => invoke<string[]>("pick_media_files"),
  pickImageFile: () => invoke<string | null>("pick_image_file"),
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
  gallerySetOpts: (id: string, opts: EntryOptions | null) =>
    invoke<GalleryEntry[]>("gallery_set_opts", { id, opts }),
  gallerySetFavorite: (id: string, favorite: boolean) =>
    invoke<GalleryEntry[]>("gallery_set_favorite", { id, favorite }),
  galleryRegenerateThumb: (id: string) =>
    invoke<GalleryEntry[]>("gallery_regenerate_thumb", { id }),
  /** Ids whose file is no longer on disk. Web/shader entries are never listed. */
  vaultMissing: () => invoke<string[]>("vault_missing"),
  /**
   * Size and mtime of every gallery entry's file, keyed by entry id. Used to
   * tell a cached measurement from a stale one after a file is replaced in
   * place. Entries whose file is missing are absent.
   */
  vaultStamps: () => invoke<StampMap>("vault_stamps"),
  /** The last N lines of the log, newest last. Empty when nothing is logged yet. */
  logTail: (limit?: number) => invoke<string[]>("log_tail", { limit: limit ?? null }),
  /**
   * Version, build mode, log level and the paths the app writes to, read from
   * the running process. The Developer section shows these instead of
   * assembling them in the UI, where the log level in particular was a guess.
   */
  devInfo: () => invoke<DevInfo>("dev_info"),
  /** Open the app data folder with the log selected. */
  revealLog: () => invoke<void>("reveal_log"),
  revealInFolder: (path: string) => invoke<void>("reveal_in_folder", { path }),
  /**
   * The clipboard's text, when it is exactly one http(s) URL.
   *
   * Null rather than an error for anything else: a clipboard holding ordinary
   * text is the normal case, not a failure.
   */
  clipboardUrl: () => invoke<string | null>("clipboard_url"),

  collectionCreate: (name: string) =>
    invoke<WallpaperCollection>("collection_create", { name }),
  collectionRename: (id: string, name: string) =>
    invoke<void>("collection_rename", { id, name }),
  collectionDelete: (id: string) => invoke<void>("collection_delete", { id }),
  collectionToggleEntry: (id: string, entryId: string) =>
    invoke<boolean>("collection_toggle_entry", { id, entryId }),
  /**
   * File several entries at once. One config write instead of one per entry,
   * and ids already present are left alone rather than toggled out.
   */
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

  // Media session (SMTC): transport + initial snapshot.
  mediaTransport: (action: "play" | "pause" | "toggle" | "next" | "previous") =>
    invoke<void>("media_transport", { action }),
  /** Seek the current SMTC session (seconds). Ignored by senders that refuse. */
  mediaSeek: (positionSec: number) => invoke<void>("media_seek", { positionSec }),
  /** Toggle shuffle on the current SMTC session. */
  mediaShuffle: (active: boolean) => invoke<void>("media_shuffle", { active }),
  /** Cycle repeat mode; pass the currently known mode (or null). */
  mediaRepeat: (current: 0 | 1 | 2 | null) => invoke<void>("media_repeat", { current }),
  /** System master volume: [percent, mutedFlag]. */
  volumeGet: () => invoke<[number, number]>("volume_get"),
  /** Set the system master volume (0..100). */
  volumeSet: (percent: number) => invoke<void>("volume_set", { percent }),
  /** Toggle system mute; resolves to the new state. */
  volumeMuteToggle: () => invoke<boolean>("volume_mute_toggle"),
  mediaCurrent: () => invoke<MediaInfo | null>("media_current"),
  /** The user's current Windows accent color (RGB triplet), for UI theming. */
  systemAccent: () => invoke<[number, number, number] | null>("system_accent"),
  /** Windows display language ("es-ES"); resolved against the user's
   *  preference in `general.language` to pick the UI locale. */
  systemLanguage: () => invoke<string>("system_language"),
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

  /**
   * Parse-check a hotkey accelerator without binding it. Called the moment
   * the user finishes recording a combo, so an unusable one is caught before
   * it reaches the config.
   */
  hotkeyValidate: (accelerator: string) =>
    invoke<void>("hotkey_validate", { accelerator }),

  quit: () => invoke<void>("quit"),
  factoryReset: () => invoke<void>("factory_reset"),
};
