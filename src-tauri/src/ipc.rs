//! Typed IPC commands exposed to the frontends.

use crate::config::{Config, StickerDef, WallpaperConfig};
use crate::rgb::openrgb_client::RgbStatus;
use crate::rgb::ZoneSample;
use serde::Serialize;
use tauri::{AppHandle, State};
use std::sync::Mutex;

/// What the wallpaper webview needs to render.
#[derive(Debug, Clone, Serialize)]
pub struct WallpaperPayload {
    pub config: WallpaperConfig,
    pub resolved_source: String,
    pub paused: bool,
    pub attached: bool,
}

/// Per-window wallpaper info: geometry of the monitor this webview covers.
#[derive(Debug, Clone, Serialize)]
pub struct WallpaperInfo {
    pub monitor: crate::win32::MonitorRect,
    /// Authoritative scale factor: physical monitor px per logical webview px
    /// (from the window itself, not a devicePixelRatio guess).
    pub scale: f64,
    pub source: String,
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

#[tauri::command]
pub fn get_wallpaper_payload() -> WallpaperPayload {
    let cfg = crate::config_store::get();
    let (x, y) = {
        // Position of the first monitor, so callers can compute relative
        // geometry if they need it.
        let m = crate::win32::monitors().into_iter().next();
        m.map(|m| (m.x, m.y)).unwrap_or((0, 0))
    };
    let _ = (x, y);
    WallpaperPayload {
        resolved_source: crate::wallpaper::resolve_source(&cfg.wallpaper),
        paused: crate::wallpaper::is_paused(),
        attached: crate::workerw::attach_state() == crate::workerw::AttachState::Attached,
        config: cfg.wallpaper,
    }
}

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
    WallpaperInfo {
        monitor: mon,
        scale,
        stickers: crate::stickers::render_list(),
        monitors: mons,
        snap: cfg.sticker_snap,
        source: crate::wallpaper::resolve_source(&cfg.wallpaper),
        config: cfg.wallpaper,
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
            let id = format!("g{:x}", std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0));
            let name = if name.trim().is_empty() {
                std::path::Path::new(&source)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Untitled")
                    .to_string()
            } else {
                name
            };
            c.gallery.push(GalleryEntry {
                id,
                name,
                kind,
                source,
                added_ms: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0),
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
            let id = format!(
                "g{:x}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0)
                    + imported as u128,
            );
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Untitled")
                .to_string();
            c.gallery.push(GalleryEntry {
                id,
                name,
                kind,
                source,
                added_ms: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0),
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
            let id = format!(
                "g{:x}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u128)
                    .unwrap_or(0)
                    + imported as u128,
            );
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Untitled")
                .to_string();
            c.gallery.push(GalleryEntry {
                id,
                name,
                kind,
                source,
                added_ms: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0),
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
        .filter_map(|e| e.ok())
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

struct PendingSticker {
    name: String,
    url: String,
}

static PENDING_PLACEMENT: Mutex<Option<PendingSticker>> = Mutex::new(None);

/// Begin placement: arms the global mouse hook and awaits the click. Resolves
/// with the created sticker on left click, or an error on right click / cancel.
/// No overlay window is involved — the user clicks the desktop directly.
#[tauri::command]
pub async fn begin_sticker_placement(
    app: AppHandle,
    name: String,
    url: String,
    kind: String,
) -> Result<StickerDef, String> {
    let _ = kind; // retained for API compat; kind is derived from the extension
    log::info!("sticker placement: armed (name={name}) — waiting for desktop click");
    // Normalize up front so the wallpaper preview can render the media.
    let preview_url = crate::media::media_url_for_file(&url);
    *PENDING_PLACEMENT.lock().expect("pending poisoned") = Some(PendingSticker { name, url });
    crate::events::emit_all(&app, crate::events::PLACING, &Some(preview_url));

    // Live cursor stream for the on-wallpaper placement preview.
    let mut cursor_rx = crate::mouse_hook::take_cursor_stream();
    let app_cursor = app.clone();
    let forwarder = tauri::async_runtime::spawn(async move {
        if let Some(rx) = cursor_rx.as_mut() {
            while let Some((x, y, _l, _r)) = rx.recv().await {
                crate::events::emit_all(&app_cursor, crate::events::PLACING_CURSOR, &(x, y));
            }
        }
    });

    let result = crate::mouse_hook::wait().await;
    crate::mouse_hook::release_cursor_stream();
    let _ = forwarder.await;
    crate::events::emit_all(&app, crate::events::PLACING, &Option::<String>::None);
    let pending = PENDING_PLACEMENT.lock().expect("pending poisoned").take();

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
            // screen (a click on a monitor edge would otherwise hang it
            // half off-screen). Re-clamped against real monitor bounds after
            // creation so multi-monitor layouts without a virtual origin at
            // (0,0) behave too.
            let (x, y) = clamp_placement(x, y);
            let sticker = StickerDef {
                id: format!("stk-{}", nanoid_like()),
                name: p.name,
                url,
                x,
                y,
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
pub fn cancel_sticker_placement() -> Result<(), String> {
    log::info!("sticker placement: cancelled (UI)");
    *PENDING_PLACEMENT.lock().expect("pending poisoned") = None;
    crate::mouse_hook::disarm();
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

// ---------- helpers ----------

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
