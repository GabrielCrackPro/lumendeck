//! Typed IPC commands exposed to the frontends.

use crate::config::{Config, StickerDef, WallpaperConfig};
use crate::rgb::openrgb_client::RgbStatus;
use crate::rgb::ZoneSample;
use serde::Serialize;
use tauri::{AppHandle, State};
use std::sync::Mutex;

/// Per-window wallpaper info: geometry of the monitor this webview covers.
#[derive(Debug, Clone, Serialize)]
pub struct WallpaperInfo {
    pub monitor: crate::win32::MonitorRect,
    /// Authoritative scale factor: physical monitor px per logical webview px
    /// (from the window itself, not a devicePixelRatio guess).
    pub scale: f64,
    pub source: String,
    /// Servable URL of the static wallpaper snapshot (poster frame for videos,
    /// copy for images). Shown under the video so a failed/dead source
    /// degrades to a still image instead of a black screen. Empty when none.
    pub fallback_source: String,
    pub config: WallpaperConfig,
    pub paused: bool,
    /// All stickers (virtual-screen coords); each window clips to its monitor.
    pub stickers: Vec<StickerDef>,
    /// Every connected monitor (virtual-screen coords) — used for alignment
    /// guides when dragging stickers.
    pub monitors: Vec<crate::win32::MonitorRect>,
    /// Snap behavior for the sticker editor.
    pub snap: crate::config::StickerSnap,
}

// ---------- Config ----------

#[tauri::command]
pub fn get_config() -> Config {
    crate::config_store::get()
}

#[tauri::command]
pub fn set_config(app: AppHandle, cfg: Config) -> Result<Config, String> {
    // `stickers` and `gallery` are backend-managed collections (dedicated
    // add/update/remove commands). The dashboard may hold a stale copy — e.g.
    // a sticker placed moments ago that it has not rendered yet — so its full-
    // config saves must never overwrite them. Take them from the live store.
    let mut cfg = cfg;
    let current = crate::config_store::get();
    if cfg.stickers != current.stickers {
        log::debug!(
            "set_config: preserving store stickers ({}) over incoming ({})",
            current.stickers.len(),
            cfg.stickers.len()
        );
        cfg.stickers = current.stickers;
    }
    if cfg.gallery != current.gallery {
        cfg.gallery = current.gallery;
    }
    crate::config_store::set(cfg)?;
    let fresh = crate::config_store::get();
    crate::ipc::apply_side_effects(&app, &fresh);
    Ok(fresh)
}

/// Apply config-dependent windows/RGB state. Shared by UI saves and external
/// config reloads.
pub fn apply_side_effects(app: &AppHandle, cfg: &Config) {
    if cfg.general.wallpaper_enabled {
        if let Err(e) = crate::wallpaper::ensure(app) {
            log::warn!("wallpaper ensure failed: {e}");
        }
        // Save a static snapshot of the wallpaper as the Windows desktop +
        // lock screen background, so the user has a matching BG if LumenDeck
        // is closed.
        crate::wallpaper_bg::apply_bg(&cfg.wallpaper);
    } else if let Err(e) = crate::wallpaper::remove(app) {
        log::warn!("wallpaper remove failed: {e}");
    }
    // Topmost sticker windows track their per-sticker onTop flag.
    crate::sticker_windows::sync(app);
    log::info!(
        "side effects applied (wallpaper={}, stickers={})",
        cfg.general.wallpaper_enabled,
        cfg.stickers.len()
    );
}

/// Force-reload the config from disk (manual edits are also picked up
/// automatically by the watcher).
#[tauri::command]
pub fn reload_config(app: AppHandle) -> Result<Config, String> {
    use crate::config_store::ConfigReload;
    match crate::config_store::reload_if_changed() {
        ConfigReload::Unchanged | ConfigReload::Reloaded => {}
        // Force path: retry briefly in case the save is still in flight.
        ConfigReload::Pending(_) => {
            std::thread::sleep(std::time::Duration::from_millis(300));
            let _ = crate::config_store::reload_if_changed();
        }
    }
    let cfg = crate::config_store::get();
    crate::ipc::apply_side_effects(&app, &cfg);
    Ok(cfg)
}

// ---------- Wallpaper ----------

/// Everything one wallpaper webview needs: its monitor's geometry and the
/// resolved source. Called by each wallpaper window at boot and on changes.
#[tauri::command]
pub fn get_wallpaper_info(webview_window: tauri::WebviewWindow) -> WallpaperInfo {
    let cfg = crate::config_store::get();
    let mons = crate::win32::monitors();
    let label = webview_window.label().to_string();
    let index = label
        .strip_prefix("wallpaper-")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    let mon = mons
        .get(index)
        .cloned()
        .unwrap_or_else(|| crate::win32::MonitorRect {
            device: String::new(),
            x: 0,
            y: 0,
            w: 1920,
            h: 1080,
            primary: false,
        });
    // Authoritative DPI: the webview's own scale factor for the monitor it
    // covers. Falls back to 1 when the window is gone (shouldn't happen).
    let scale = webview_window.scale_factor().unwrap_or(1.0);
    for s in &cfg.stickers {
        log::info!(
            "sticker visible-check: id={} at ({},{}) {}x{} | monitor {}=({},{}) {}x{} scale={scale}",
            s.id,
            s.x,
            s.y,
            s.w,
            s.h,
            mon.device,
            mon.x,
            mon.y,
            mon.w,
            mon.h
        );
    }
    // Per-display wallpaper: when this monitor has an override, hand the
    // webview an effective config carrying it (kind+source swapped in).
    // resolve_for_monitor returns an already-resolved media URL — do NOT run
    // resolve_source over it again (that would double-encode and break video).
    let (pm_kind, pm_source) =
        crate::wallpaper::resolve_for_monitor(&cfg.wallpaper, &mon.device);
    let mut effective = cfg.wallpaper.clone();
    effective.kind = pm_kind;
    effective.source = pm_source.clone();
    WallpaperInfo {
        monitor: mon,
        scale,
        stickers: crate::stickers::render_list(),
        monitors: mons,
        fallback_source: crate::wallpaper_bg::bg_media_url(),
        snap: cfg.sticker_snap,
        source: pm_source,
        config: effective,
        paused: crate::wallpaper::is_paused(),
    }
}

/// Enter sticker-editor mode: the wallpaper streams mouse activity over
/// EDITOR_MOUSE and handles drag/resize hit-testing itself.
#[tauri::command]
pub fn begin_sticker_editor(app: AppHandle) -> Result<(), String> {
    log::info!("sticker editor: on");
    crate::mouse_hook::set_editor_mode(true);
    crate::events::emit_all(&app, crate::events::EDITOR_STATE, &true);
    spawn_editor_forwarder(app);
    Ok(())
}

/// Exit sticker-editor mode.
#[tauri::command]
pub fn end_sticker_editor() -> Result<(), String> {
    log::info!("sticker editor: off");
    crate::mouse_hook::set_editor_mode(false);
    crate::mouse_hook::release_cursor_stream();
    if let Some(a) = crate::app_handle() {
        crate::events::emit_all(&a, crate::events::EDITOR_STATE, &false);
    }
    Ok(())
}

fn spawn_editor_forwarder(app: AppHandle) {
    let Some(mut rx) = crate::mouse_hook::take_cursor_stream() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        while let Some((x, y, l, r)) = rx.recv().await {
            crate::events::emit_all(&app, crate::events::EDITOR_MOUSE, &(x, y, l, r));
        }
    });
}

/// Diagnostics: the wallpaper webview reports how each sticker rendered.
/// Frontend diagnostics channel: webview console messages don't reach the
/// log file, so wallpaper/sticker pages forward important events here.
#[tauri::command]
pub fn log_frontend(msg: String) {
    log::info!("{}", msg);
}

/// (see log_frontend)
#[tauri::command]
pub fn log_sticker_render(
    id: String,
    ok: bool,
    left: f64,
    top: f64,
    width: f64,
    height: f64,
    url: String,
) {
    if ok {
        log::info!(
            "sticker render ok: id={id} rect=({left:.0},{top:.0} {width:.0}x{height:.0}) logical px url={url}",
        );
    } else {
        log::warn!(
            "sticker render FAILED (media load): id={id} rect=({left:.0},{top:.0} {width:.0}x{height:.0}) url={url}",
        );
    }
}

#[tauri::command]
pub fn apply_wallpaper(app: AppHandle, wallpaper: WallpaperConfig) -> Result<(), String> {
    crate::config_store::update(|c| c.wallpaper = wallpaper.clone())?;
    if crate::config_store::get().general.wallpaper_enabled {
        crate::wallpaper::ensure(&app)?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_wallpaper_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    crate::config_store::update(|c| c.general.wallpaper_enabled = enabled)?;
    if enabled {
        crate::wallpaper::ensure(&app)?;
    } else {
        crate::wallpaper::remove(&app)?;
    }
    Ok(())
}

// ---------- Dialogs / library ----------

// ---------- Gallery ----------

const GALLERY_VIDEO_EXT: &[&str] = &["mp4", "webm", "mov", "mkv"];
const GALLERY_IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif"];

/// Classify a file path as a gallery-importable wallpaper kind, or None.
fn gallery_classify(path: &std::path::Path) -> Option<crate::config::WallpaperKind> {
    use crate::config::WallpaperKind;
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if GALLERY_VIDEO_EXT.contains(&ext.as_str()) {
        Some(WallpaperKind::Video)
    } else if GALLERY_IMAGE_EXT.contains(&ext.as_str()) {
        Some(WallpaperKind::Image)
    } else {
        None
    }
}

/// Add a wallpaper to the gallery (idempotent by source+kind) and return the
/// full list. Existing entries get their thumb updated when provided.
#[tauri::command]
pub fn gallery_add(
    name: String,
    kind: crate::config::WallpaperKind,
    source: String,
    thumb: Option<String>,
) -> Vec<crate::config::GalleryEntry> {
    use crate::config::GalleryEntry;
    crate::config_store::update(|c| {
        if let Some(existing) = c.gallery.iter_mut().find(|g| g.source == source && g.kind == kind) {
            if thumb.is_some() {
                existing.thumb = thumb;
            }
        } else {
            let id = gen_gallery_id(0);
            let name = if name.trim().is_empty() {
                display_name_from_path(std::path::Path::new(&source))
            } else {
                name
            };
            c.gallery.push(GalleryEntry {
                id,
                name,
                kind,
                source,
                added_ms: now_ms(),
                thumb,
            });
        }
    })
    .map_err(|e| log::warn!("gallery_add persist failed: {e}"))
    .ok();
    crate::config_store::get().gallery
}

/// Import all videos (and images) in a folder as individual gallery entries.
/// Idempotent per file; returns the full updated gallery sorted by recency.
#[tauri::command]
pub fn gallery_import_folder(folder: String) -> Result<Vec<crate::config::GalleryEntry>, String> {
    use crate::config::GalleryEntry;

    let dir = std::path::PathBuf::from(&folder);
    if !dir.is_dir() {
        return Err(format!("not a folder: {folder}"));
    }
    // Make every file in this folder servable (now and after restarts).
    crate::media::allow_dir(&dir);

    let entries: Vec<std::path::PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| format!("read dir failed: {e}"))?
        .flatten()
        .map(|e| e.path())
        .collect();

    let mut imported = 0usize;
    crate::config_store::update(|c| {
        for path in &entries {
            let path = path.as_path();
            if !path.is_file() {
                continue;
            }
            let Some(kind) = gallery_classify(path) else {
                continue;
            };
            let source = path.to_string_lossy().to_string();
            if c.gallery.iter().any(|g| g.source == source && g.kind == kind) {
                continue;
            }
            let id = gen_gallery_id(imported as u128);
            let name = display_name_from_path(path);
            c.gallery.push(GalleryEntry {
                id,
                name,
                kind,
                source,
                added_ms: now_ms(),
                thumb: None,
            });
            imported += 1;
        }
    })?;

    log::info!("gallery: imported {imported} item(s) from {folder}");
    let mut list = crate::config_store::get().gallery;
    list.sort_by(|a, b| b.added_ms.cmp(&a.added_ms));
    Ok(list)
}

/// Import files and/or folders (e.g. items dropped onto the gallery) as
/// individual gallery entries. Folders are expanded one level, same as
/// `gallery_import_folder`; every file is deduplicated by source+kind.
#[tauri::command]
pub fn gallery_import_paths(
    paths: Vec<String>,
) -> Result<Vec<crate::config::GalleryEntry>, String> {
    use crate::config::GalleryEntry;

    // Expand: folders -> their files, files -> themselves.
    let mut files: Vec<std::path::PathBuf> = Vec::new();
    for raw in &paths {
        let p = std::path::PathBuf::from(raw);
        if p.is_dir() {
            // Make every file in this folder servable (now and after restarts).
            crate::media::allow_dir(&p);
            match std::fs::read_dir(&p) {
                Ok(rd) => {
                    let mut kids: Vec<std::path::PathBuf> = rd.flatten().map(|e| e.path()).collect();
                    kids.sort();
                    files.extend(kids);
                }
                Err(e) => log::warn!("gallery drop: read_dir {} failed: {e}", p.display()),
            }
        } else if p.is_file() {
            crate::media::allow_root(&p);
            files.push(p);
        } else {
            log::warn!("gallery drop: skipping missing path {}", p.display());
        }
    }

    let mut imported = 0usize;
    crate::config_store::update(|c| {
        for path in &files {
            let Some(kind) = gallery_classify(path) else {
                continue;
            };
            if !path.is_file() {
                continue;
            }
            let source = path.to_string_lossy().to_string();
            if c.gallery.iter().any(|g| g.source == source && g.kind == kind) {
                continue;
            }
            let id = gen_gallery_id(imported as u128);
            let name = display_name_from_path(path);
            c.gallery.push(GalleryEntry {
                id,
                name,
                kind,
                source,
                added_ms: now_ms(),
                thumb: None,
            });
            imported += 1;
        }
    })?;

    log::info!(
        "gallery: imported {imported} item(s) from {} dropped path(s)",
        paths.len()
    );
    let mut list = crate::config_store::get().gallery;
    list.sort_by(|a, b| b.added_ms.cmp(&a.added_ms));
    Ok(list)
}

/// Remove one gallery entry by id.
#[tauri::command]
pub fn gallery_remove(id: String) -> Vec<crate::config::GalleryEntry> {
    crate::config_store::update(|c| c.gallery.retain(|g| g.id != id))
        .map_err(|e| log::warn!("gallery_remove persist failed: {e}"))
        .ok();
    crate::config_store::get().gallery
}

/// Apply a gallery entry as the active wallpaper.
#[tauri::command]
pub fn gallery_apply(app: AppHandle, id: String) -> Result<(), String> {
    let entry = crate::config_store::get()
        .gallery
        .into_iter()
        .find(|g| g.id == id)
        .ok_or_else(|| "gallery entry not found".to_string())?;
    crate::config_store::update(|c| {
        c.wallpaper.kind = entry.kind;
        c.wallpaper.source = entry.source.clone();
    })?;
    if crate::config_store::get().general.wallpaper_enabled {
        crate::wallpaper::ensure(&app)?;
    }
    Ok(())
}

/// Apply a gallery entry to ONE display (per-monitor wallpaper). `monitor`
/// is the device string (e.g. \\\\.\\DISPLAY1); `monitor: null` clears the
/// override so the display falls back to the global wallpaper.
#[tauri::command]
pub fn gallery_apply_monitor(
    app: AppHandle,
    id: Option<String>,
    monitor: String,
) -> Result<(), String> {
    // Validate the entry first so the update closure stays infallible.
    let entry = match &id {
        Some(id) => Some(
            crate::config_store::get()
                .gallery
                .iter()
                .find(|g| &g.id == id)
                .cloned()
                .ok_or_else(|| "gallery entry not found".to_string())?,
        ),
        None => None,
    };
    crate::config_store::update(|c| {
        match id {
            Some(_id) => {
                c.wallpaper.per_monitor.insert(
                    monitor,
                    crate::config::PerMonitorWallpaper {
                        kind: entry.as_ref().map(|e| e.kind).unwrap_or(c.wallpaper.kind),
                        source: entry
                            .map(|e| e.source)
                            .unwrap_or_else(|| c.wallpaper.source.clone()),
                    },
                );
            }
            None => {
                c.wallpaper.per_monitor.remove(&monitor);
            }
        }
    })?;
    // Config watcher broadcasts CONFIG_CHANGED; webviews re-resolve from it.
    if crate::config_store::get().general.wallpaper_enabled {
        crate::wallpaper::ensure(&app)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn pick_media_file() -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(app) = crate::app_handle() else {
        return Ok(None);
    };
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter(
            "Media",
            &["png", "jpg", "jpeg", "gif", "webp", "bmp", "mp4", "webm", "mov", "mkv"],
        )
        .pick_file(move |path| {
            let _ = tx.send(path.map(|p| p.to_string()));
        });
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pick_media_folder() -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(app) = crate::app_handle() else {
        return Ok(None);
    };
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path.map(|p| p.to_string()));
    });
    rx.await.map_err(|e| e.to_string())
}

/// List image files in a folder (for slideshows), sorted.
#[tauri::command]
pub fn list_images(folder: String) -> Vec<String> {
    let dir = std::path::PathBuf::from(&folder);
    let mut out: Vec<String> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .filter(|p| {
            matches!(
                p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(),
                Some("png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif")
            )
        })
        .map(|p| crate::media::to_media_url(&p.to_string_lossy()))
        .collect();
    out.sort();
    out
}

// ---------- RGB ----------

#[tauri::command]
pub fn rgb_status(state: State<'_, crate::rgb::EngineState>) -> RgbStatus {
    state.client.status()
}

#[tauri::command]
pub async fn rgb_refresh(state: State<'_, crate::rgb::EngineState>) -> Result<(), String> {
    state.client.refresh().await;
    Ok(())
}

/// Wallpaper webview pushes zone samples here (about 10 per second).
#[tauri::command]
pub fn send_zone_samples(
    state: State<'_, crate::rgb::EngineState>,
    samples: Vec<ZoneSample>,
) -> Result<(), String> {
    for s in samples {
        let _ = state.tx.try_send(s);
    }
    Ok(())
}

#[tauri::command]
pub fn update_rgb_config(cfg: crate::config::RgbConfig) -> Result<(), String> {
    crate::config_store::update(|c| c.rgb = cfg)?;
    Ok(())
}

// ---------- Stickers ----------

#[derive(Clone)]
struct PendingSticker {
    name: String,
    url: String,
}

static PENDING_PLACEMENT: Mutex<Option<PendingSticker>> = Mutex::new(None);

/// Begin placement: arms the global mouse hook and awaits the click. Resolves
/// with the created sticker on left click, or an error on right click / cancel.
/// A transparent topmost overlay per monitor gives explicit on-screen
/// feedback (veil + cursor-following preview); clicks pass through it.
#[tauri::command]
pub async fn begin_sticker_placement(
    app: AppHandle,
    name: String,
    url: String,
    kind: String,
) -> Result<StickerDef, String> {
    let _ = kind; // retained for API compat; kind is derived from the extension
    log::info!("sticker placement: armed (name={name}) — waiting for desktop click");
    // Normalize up front so the overlay can render the media.
    let preview_url = crate::media::media_url_for_file(&url);
    *PENDING_PLACEMENT.lock().expect("pending poisoned") = Some(PendingSticker {
        name: name.clone(),
        url: url.clone(),
    });
    if let Err(e) = crate::placement_overlay::show(&app, &preview_url, &name) {
        log::warn!("placement overlay failed: {e}");
    }
    crate::events::emit_all(&app, crate::events::PLACING, &Some(preview_url));

    // Live cursor + wheel streams for the placement overlay preview: moves
    // position the preview, wheel resizes it live (persisted on placement).
    let mut cursor_rx = crate::mouse_hook::take_cursor_stream();
    let app_cursor = app.clone();
    let forwarder = tauri::async_runtime::spawn(async move {
        if let Some(rx) = cursor_rx.as_mut() {
            while let Some((x, y, _l, _r)) = rx.recv().await {
                crate::events::emit_all(&app_cursor, crate::events::PLACING_CURSOR, &(x, y));
            }
        }
    });
    let (wheel_tx, mut wheel_rx) = tokio::sync::mpsc::unbounded_channel::<i32>();
    *crate::mouse_hook::WHEEL_TX.lock().expect("wheel tx poisoned") = Some(wheel_tx);
    let app_wheel = app.clone();
    let wheel_forwarder = tauri::async_runtime::spawn(async move {
        let mut size = 220i32;
        while let Some(delta) = wheel_rx.recv().await {
            size = (size + delta * 6).clamp(48, 2000);
            crate::events::set_placement_size(size);
            crate::events::emit_all(&app_wheel, crate::events::PLACING_SIZE, &size);
        }
    });

    let result = crate::mouse_hook::wait().await;
    crate::mouse_hook::release_cursor_stream();
    *crate::mouse_hook::WHEEL_TX.lock().expect("wheel tx poisoned") = None;
    let _ = wheel_forwarder.await;
    let _ = forwarder.await;
    crate::placement_overlay::hide(&app);
    crate::events::emit_all(&app, crate::events::PLACING, &Option::<String>::None);
    let pending = PENDING_PLACEMENT.lock().expect("pending poisoned").take();
    let placed_size = crate::events::take_placement_size();

    match result {
        crate::mouse_hook::ClickResult::Place(x, y) => {
            let Some(p) = pending else {
                return Err("no pending placement".into());
            };
            let cfg = crate::config_store::get();
            // Normalize to a servable media:// URL and allow-list the file.
            let mut url = crate::media::media_url_for_file(&p.url);
            // Background removal (config on by default): process a copy and
            // serve that instead of the original. Statics -> transparent PNG,
            // animated GIFs -> transparent APNG (all frames processed).
            if cfg.sticker.remove_background {
                let src_path = crate::media::decode_media_ref(&p.url);
                match crate::bgremove::process_file(&src_path) {
                    Ok(proc) => {
                        url = crate::media::media_url_for_file(
                            &proc.path.to_string_lossy(),
                        );
                        log::info!(
                            "sticker bg removed: {} frame(s), animated={}",
                            proc.frames,
                            proc.animated
                        );
                    }
                    Err(e) => log::warn!(
                        "bg removal failed for {}: {e} — serving original",
                        src_path.display()
                    ),
                }
            }
            // Clamp so the default-size sticker stays fully on the virtual
            // screen, centered on the click. Negative coordinates are valid
            // (monitors above/left of the primary), so we clamp against the
            // real virtual-screen bounds rather than assuming (0,0) origin.
            let (x, y) = clamp_placement(x, y);
            let size = placed_size.unwrap_or(crate::constants_sticker::DEFAULT_W as i32) as u32;
            let (x, y) = (
                x - size as i32 / 2,
                y - size as i32 / 2,
            );
            let sticker = StickerDef {
                id: format!("stk-{}", nanoid_like()),
                name: p.name,
                url,
                x,
                y,
                w: size,
                h: size,
                ..StickerDef::default()
            };
            let mut stickers = cfg.stickers.clone();
            stickers.push(sticker.clone());
            crate::stickers::replace_all(stickers)?;
            crate::stickers::broadcast(&app);
            log::info!(
                "sticker placed: id={} at ({x},{y}) {}x{} url={}",
                sticker.id,
                sticker.w,
                sticker.h,
                sticker.url
            );
            Ok(sticker)
        }
        crate::mouse_hook::ClickResult::Cancel => {
            log::info!("sticker placement: cancelled");
            Err("cancelled".into())
        }
    }
}

/// Cancel an in-progress placement from the UI.
#[tauri::command]
pub fn cancel_sticker_placement(app: AppHandle) -> Result<(), String> {
    log::info!("sticker placement: cancelled (UI)");
    *PENDING_PLACEMENT.lock().expect("pending poisoned") = None;
    crate::mouse_hook::disarm();
    crate::placement_overlay::hide(&app);
    crate::events::emit_all(&app, crate::events::PLACING, &Option::<String>::None);
    Ok(())
}

/// Payload for the placement overlay page: its monitor geometry, DPI, and
/// the sticker media to preview.
#[derive(serde::Serialize)]
pub struct PlacementInfo {
    pub monitor: crate::win32::MonitorRect,
    pub scale: f64,
    pub url: String,
    pub name: String,
}

#[tauri::command]
pub fn get_placement_info(webview_window: tauri::WebviewWindow) -> Option<PlacementInfo> {
    let pending = PENDING_PLACEMENT.lock().expect("pending poisoned").clone();
    let Some(p) = pending else {
        return None;
    };
    let label = webview_window.label().to_string();
    let index = label
        .strip_prefix("placement-")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    let mons = crate::win32::monitors();
    let monitor = mons.get(index).cloned()?;
    let scale = webview_window.scale_factor().unwrap_or(1.0);
    Some(PlacementInfo {
        monitor,
        scale,
        url: crate::media::media_url_for_file(&p.url),
        name: p.name,
    })
}

/// Feed a synthetic wheel delta into the placement resize stream (from the
/// overlay's +/− buttons). Shares the exact path as real wheel events.
#[tauri::command]
pub fn placement_resize(app: AppHandle, delta: i32) -> Result<(), String> {
    let _ = app;
    let tx = crate::mouse_hook::WHEEL_TX.lock().expect("wheel tx poisoned").clone();
    if let Some(tx) = tx {
        let _ = tx.send(delta);
    }
    Ok(())
}

/// Make the calling overlay window accept input (buttons) while staying
/// transparent: clears WS_EX_TRANSPARENT on its own HWND.
#[tauri::command]
pub fn placement_set_interactive(
    webview_window: tauri::WebviewWindow,
    interactive: bool,
) -> Result<(), String> {
    let hwnd = crate::wallpaper::hwnd_of(&webview_window)?;
    crate::win32::set_input_transparent(hwnd, !interactive);
    Ok(())
}

/// Resolve an armed placement at an arbitrary screen point (corner
/// quick-place buttons). Fires the same path as a physical click.
#[tauri::command]
pub fn placement_place_at(_app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    if PENDING_PLACEMENT.lock().expect("pending poisoned").is_none() {
        return Err("no placement armed".into());
    }
    crate::mouse_hook::resolve_place_at(x, y);
    Ok(())
}

#[tauri::command]
pub fn add_sticker(app: AppHandle, sticker: StickerDef) -> Result<(), String> {
    crate::config_store::update(|c| {
        c.stickers.retain(|s| s.id != sticker.id);
        c.stickers.push(sticker.clone());
    })?;
    crate::stickers::broadcast(&app);
    Ok(())
}

#[tauri::command]
pub fn update_sticker(app: AppHandle, sticker: StickerDef) -> Result<(), String> {
    crate::config_store::update(|c| {
        if let Some(slot) = c.stickers.iter_mut().find(|s| s.id == sticker.id) {
            *slot = sticker.clone();
        }
    })?;
    crate::stickers::broadcast(&app);
    Ok(())
}

#[tauri::command]
pub fn remove_sticker(app: AppHandle, id: String) -> Result<(), String> {
    crate::config_store::update(|c| c.stickers.retain(|s| s.id != id))?;
    crate::stickers::broadcast(&app);
    Ok(())
}

#[tauri::command]
pub fn is_paused() -> bool {
    crate::wallpaper::is_paused()
}

// ---------- Misc ----------

#[tauri::command]
pub fn monitors() -> Vec<crate::win32::MonitorRect> {
    crate::win32::monitors()
}

#[tauri::command]
pub fn quit(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

/// Wipe ALL app data (config, gallery references, sticker placements, cached
/// thumbnails, logs) and exit. Does NOT touch the user's media files that
/// vault/sticker entries point at — only LumenDeck's own directory.
#[tauri::command]
pub fn factory_reset(app: AppHandle) -> Result<(), String> {
    use std::path::PathBuf;
    log::info!("factory reset requested — wiping app data and exiting");

    // Tear down windows that hold files/handles first.
    let _ = crate::wallpaper::remove(&app);
    crate::sticker_windows::close_all(&app);
    crate::placement_overlay::hide(&app);

    let base = dirs::data_dir()
        .ok_or_else(|| "cannot resolve app data dir".to_string())?
        .join("LumenDeck");
    // Keep the log (we're about to write the outcome), delete everything else.
    for entry in [
        "config.json",
        "thumbs",
        "bg-cache",
    ] {
        let path: PathBuf = base.join(entry);
        if path.is_dir() {
            let _ = std::fs::remove_dir_all(&path);
        } else if path.is_file() {
            let _ = std::fs::remove_file(&path);
        }
    }
    log::info!("app data wiped; exiting");
    app.exit(0);
    Ok(())
}

// ---------- helpers ----------

fn gen_gallery_id(offset: u128) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("g{:x}", ms + offset)
}

fn display_name_from_path(path: &std::path::Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[allow(dead_code)]
/// Keep a placed sticker's default rect inside the virtual screen: the mouse
/// hook reports raw physical coordinates, and a click near a screen edge
/// would otherwise center the 220px default rect partly off-screen.
fn clamp_placement(x: i32, y: i32) -> (i32, i32) {
    use crate::constants_sticker::{DEFAULT_H, DEFAULT_W};
    let mons = crate::win32::monitors();
    let (vx0, vy0, vx1, vy1) = mons.iter().fold(
        (i32::MAX, i32::MAX, i32::MIN, i32::MIN),
        |(a, b, c, d), m| (a.min(m.x), b.min(m.y), c.max(m.x + m.w), d.max(m.y + m.h)),
    );
    let cx = x + DEFAULT_W as i32 / 2;
    let cy = y + DEFAULT_H as i32 / 2;
    let half_w = DEFAULT_W as i32 / 2;
    let half_h = DEFAULT_H as i32 / 2;
    (
        cx.clamp(vx0 + half_w, vx1.saturating_sub(half_w)) - half_w,
        cy.clamp(vy0 + half_h, vy1.saturating_sub(half_h)) - half_h,
    )
}

fn nanoid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{n:x}")
}
