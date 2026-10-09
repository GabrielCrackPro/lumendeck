
use crate::config::{Config, StickerDef, WallpaperConfig};
use crate::rgb::openrgb_client::RgbStatus;
use crate::rgb::ZoneSample;
use serde::Serialize;
use tauri::{AppHandle, State};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
pub struct WallpaperInfo {
    pub monitor: crate::win32::MonitorRect,
    pub scale: f64,
    pub source: String,
    pub fallback_source: String,
    pub crossfade_sec: f64,
    pub config: WallpaperConfig,
    pub paused: bool,
    pub stickers: Vec<StickerDef>,
    pub monitors: Vec<crate::win32::MonitorRect>,
    pub snap: crate::config::StickerSnap,
    pub sticker_all_monitors: bool,
}


#[tauri::command]
pub fn get_config() -> Config {
    crate::config_store::get()
}

#[tauri::command]
pub fn perf_snapshot() -> crate::perf::PerfSnapshot {
    crate::perf::latest()
}

#[tauri::command]
pub fn set_config(app: AppHandle, cfg: Config) -> Result<Config, String> {
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
    if cfg.general.accent_sync_enabled && !cfg.general.accent_sync_armed {
        crate::sys_theme::remember_original_accent();
        cfg.general.accent_sync_armed = true;
    } else if !cfg.general.accent_sync_enabled && cfg.general.accent_sync_armed {
        crate::sys_theme::restore_original_accent();
        cfg.general.accent_sync_armed = false;
    }
    if !cfg.general.accent_sync_enabled {
        crate::sys_theme::forget_last_write();
    }
    let lock_screen_taking_over =
        cfg.general.lock_screen_follows_wallpaper && !cfg.general.lock_screen_armed;
    let lock_screen_releasing =
        !cfg.general.lock_screen_follows_wallpaper && cfg.general.lock_screen_armed;
    if lock_screen_taking_over {
        cfg.general.lock_screen_armed = true;
    } else if lock_screen_releasing {
        cfg.general.lock_screen_armed = false;
    }
    crate::config_store::set(cfg)?;
    if lock_screen_taking_over {
        crate::wallpaper_bg::force_lock_screen_sync();
    } else if lock_screen_releasing {
        crate::wallpaper_bg::restore_original_lock_screen();
    }
    let fresh = crate::config_store::get();
    crate::ipc::apply_side_effects(&app, &fresh);
    Ok(fresh)
}

pub fn apply_side_effects(app: &AppHandle, cfg: &Config) {
    static PENDING: std::sync::Mutex<Option<Config>> = std::sync::Mutex::new(None);
    if let Ok(mut slot) = PENDING.lock() {
        if slot.is_some() {
            *slot = Some(cfg.clone());
            return;
        }
        *slot = Some(cfg.clone());
    }
    let app2 = app.clone();
    let _ = std::thread::Builder::new()
        .name("side-effects".into())
        .spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            let latest = PENDING.lock().ok().and_then(|mut s| s.take());
            if let Some(cfg) = latest {
                apply_side_effects_now(&app2, &cfg);
            }
        });
}

fn apply_side_effects_now(app: &AppHandle, cfg: &Config) {
    if cfg.general.wallpaper_enabled {
        if let Err(e) = crate::wallpaper::ensure(app) {
            log::warn!("wallpaper ensure failed: {e}");
        }
        crate::wallpaper_bg::request_bg(cfg.wallpaper.clone());
    } else if let Err(e) = crate::wallpaper::remove(app) {
        log::warn!("wallpaper remove failed: {e}");
    }
    if let Err(e) = crate::autostart::apply(app, cfg.general.autostart) {
        log::warn!("autostart sync failed: {e}");
    }
    crate::sticker_windows::sync(app);
    crate::hotkeys::sync(
        app,
        cfg.general.hotkeys_enabled,
        &cfg.general.hotkeys,
    );
    if let Err(e) = crate::context_menu::apply_current() {
        log::warn!("explorer menu: could not sync the verb: {e}");
    }
    log::debug!(
        "side effects applied (wallpaper={}, stickers={})",
        cfg.general.wallpaper_enabled,
        cfg.stickers.len()
    );
}

#[tauri::command]
pub fn reload_config(app: AppHandle) -> Result<Config, String> {
    use crate::config_store::ConfigReload;
    match crate::config_store::reload_if_changed() {
        ConfigReload::Unchanged | ConfigReload::Reloaded => {}
        ConfigReload::Pending(_) => {
            std::thread::sleep(std::time::Duration::from_millis(300));
            let _ = crate::config_store::reload_if_changed();
        }
    }
    let cfg = crate::config_store::get();
    crate::ipc::apply_side_effects(&app, &cfg);
    Ok(cfg)
}


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
    let scale = webview_window.scale_factor().unwrap_or(1.0);
    for s in &cfg.stickers {
        log::debug!(
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
    let (pm_kind, pm_source) =
        crate::wallpaper::resolve_for_monitor(&cfg.wallpaper, &mon.device);
    let mut effective = cfg.wallpaper.clone();
    effective.kind = pm_kind;
    effective.source = pm_source.clone();
    let (raw_kind, raw_source) = crate::wallpaper::raw_for_monitor(&cfg.wallpaper, &mon.device);
    if let Some(opts) = cfg
        .gallery
        .iter()
        .find(|g| g.kind == raw_kind && g.source == raw_source)
        .and_then(|g| g.opts.clone())
    {
        opts.apply_to(&mut effective);
    }
    WallpaperInfo {
        monitor: mon,
        scale,
        stickers: crate::stickers::render_list(),
        monitors: mons,
        fallback_source: crate::wallpaper_bg::bg_media_url(),
        crossfade_sec: cfg
            .playlists
            .iter()
            .find(|p| p.enabled)
            .map(|p| p.crossfade_sec)
            .unwrap_or(0.0),
        snap: cfg.sticker_snap,
        sticker_all_monitors: cfg.sticker.all_monitors,
        source: pm_source,
        config: effective,
        paused: crate::wallpaper::is_paused(),
    }
}

#[tauri::command]
pub fn begin_sticker_editor(app: AppHandle) -> Result<(), String> {
    log::info!("sticker editor: on");
    crate::mouse_hook::set_editor_mode(true);
    crate::events::emit_all(&app, crate::events::EDITOR_STATE, &true);
    spawn_editor_forwarder(app);
    Ok(())
}

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
        const IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);
        let mut last_input = std::time::Instant::now();
        loop {
            if last_input.elapsed() > IDLE_TIMEOUT {
                log::info!("sticker editor: auto-exit after 5 min idle");
                break;
            }
            if crate::mouse_hook::editor_mode_on() {
                last_input = std::time::Instant::now();
            }
            if crate::mouse_hook::ESC_PRESSED.swap(false, std::sync::atomic::Ordering::SeqCst) {
                log::info!("sticker editor: exit (ESC)");
                break;
            }
            match tokio::time::timeout(std::time::Duration::from_millis(50), rx.recv()).await {
                Ok(Some((x, y, l, r))) => {
                    crate::events::emit_all(&app, crate::events::EDITOR_MOUSE, &(x, y, l, r));
                }
                Ok(None) => break,
                Err(_) => continue,
            }
        }
        if crate::mouse_hook::editor_mode_on() {
            log::info!("sticker editor: auto-exit after 5 min idle");
            let _ = end_sticker_editor();
        }
    });
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevInfo {
    pub version: &'static str,
    pub debug: bool,
    pub build_id: &'static str,
    pub build_dirty: bool,
    pub log_level: String,
    pub config_path: String,
    pub log_path: String,
    pub data_dir: String,
    pub last_panic: Option<String>,
    pub report_header: String,
}

#[tauri::command]
pub fn dev_info() -> DevInfo {
    DevInfo {
        version: env!("CARGO_PKG_VERSION"),
        debug: cfg!(debug_assertions),
        build_id: env!("LUMENDECK_BUILD_ID"),
        build_dirty: env!("LUMENDECK_BUILD_DIRTY") == "true",
        log_level: crate::log_level().to_string(),
        config_path: display_path(&crate::config_store::config_path()),
        log_path: display_path(&crate::config_store::log_path()),
        data_dir: display_path(&crate::config_store::data_dir()),
        last_panic: crate::panic::last(),
        report_header: crate::panic::report_header(),
    }
}

fn display_path(p: &std::path::Path) -> String {
    p.display().to_string()
}

#[tauri::command]
pub fn reveal_log() -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = crate::config_store::log_path();
    let Some(app) = crate::app_handle() else {
        return Err("app not ready".into());
    };
    let dir = path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    if path.is_file() {
        app.opener()
            .reveal_item_in_dir(&path)
            .map_err(|e| format!("explorer: {e}"))
    } else {
        app.opener()
            .open_path(dir.to_string_lossy().to_string(), None::<&str>)
            .map_err(|e| format!("explorer: {e}"))
    }
}

#[tauri::command]
pub fn log_tail(limit: Option<usize>) -> Result<Vec<String>, String> {
    let path = crate::config_store::log_path();
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let want = limit.unwrap_or(200).clamp(1, 5_000);
    crate::logtail::tail(&path, want).map_err(|e| format!("log_tail: {e}"))
}

#[tauri::command]
pub fn vault_stamps() -> std::collections::HashMap<String, FileStamp> {
    use crate::config::WallpaperKind;
    let cfg = crate::config_store::get();
    let mut out = std::collections::HashMap::new();
    for g in &cfg.gallery {
        if !matches!(g.kind, WallpaperKind::Video | WallpaperKind::Image) {
            continue;
        }
        if let Some(stamp) = file_stamp(std::path::Path::new(&g.source)) {
            out.insert(g.id.clone(), stamp);
        }
    }
    out
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    pub mtime_ms: u64,
    pub size: u64,
}

fn file_stamp(path: &std::path::Path) -> Option<FileStamp> {
    let md = std::fs::metadata(path).ok()?;
    let mtime_ms = md
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    Some(FileStamp { mtime_ms, size: md.len() })
}

#[tauri::command]
pub fn log_frontend(level: Option<String>, msg: String) {
    const WINDOW_MS: u128 = 2_000;
    static LAST: std::sync::Mutex<Option<(u128, String, u32, Option<String>)>> =
        std::sync::Mutex::new(None);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let mut guard = LAST.lock().expect("log_frontend mutex poisoned");
    match guard.as_mut() {
        Some((ts, last_msg, suppressed, _)) if *last_msg == msg && now - *ts < WINDOW_MS => {
            *suppressed += 1;
            return;
        }
        Some((ts, last_msg, suppressed, last_level))
            if *suppressed > 0 && (*last_msg != msg || now - *ts >= WINDOW_MS) =>
        {
            let n = *suppressed;
            let prev = last_msg.clone();
            let prev_level = last_level.clone();
            *guard = Some((now, msg.clone(), 0, level.clone()));
            drop(guard);
            match prev_level.as_deref() {
                Some("error") => log::error!("[frontend] {prev} (suppressed {n} repeats)"),
                Some("debug") => log::debug!("[frontend] {prev} (suppressed {n} repeats)"),
                _ => log::info!("[frontend] {prev} (suppressed {n} repeats)"),
            }
        }
        _ => {
            *guard = Some((now, msg.clone(), 0, level.clone()));
            drop(guard);
        }
    }

    match level.as_deref() {
        Some("error") => log::error!("[frontend] {msg}"),
        Some("warn") => log::warn!("[frontend] {msg}"),
        Some("debug") => log::debug!("[frontend] {msg}"),
        _ => log::info!("[frontend] {msg}"),
    }
}

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
        log::debug!(
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



pub(crate) const GALLERY_VIDEO_EXT: &[&str] = &["mp4", "webm", "mov", "mkv"];
pub(crate) const GALLERY_IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif"];

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

#[tauri::command]
pub fn gallery_add(
    name: String,
    kind: crate::config::WallpaperKind,
    source: String,
    thumb: Option<String>,
    origin: Option<String>,
) -> Result<crate::config::GalleryEntry, String> {
    use crate::config::GalleryEntry;
    let target_source = source.clone();
    let target_kind = kind;
    let updated = crate::config_store::update(|c| {
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
                opts: None,
                favorite: false,
                last_applied_ms: None,
                origin,
            });
        }
    })?;
    updated
        .gallery
        .into_iter()
        .find(|entry| entry.source == target_source && entry.kind == target_kind)
        .ok_or_else(|| "gallery entry missing after add".to_string())
}

#[tauri::command]
pub fn gallery_import_folder(folder: String) -> Result<Vec<crate::config::GalleryEntry>, String> {
    use crate::config::GalleryEntry;

    let dir = std::path::PathBuf::from(&folder);
    if !dir.is_dir() {
        return Err(format!("not a folder: {folder}"));
    }
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
                opts: None,
                favorite: false,
                last_applied_ms: None,
                origin: None,
            });
            imported += 1;
        }
    })?;

    log::info!("gallery: imported {imported} item(s) from {folder}");
    let mut list = crate::config_store::get().gallery;
    list.sort_by(|a, b| b.added_ms.cmp(&a.added_ms));
    Ok(list)
}

#[tauri::command]
pub fn gallery_import_paths(
    paths: Vec<String>,
) -> Result<Vec<crate::config::GalleryEntry>, String> {
    use crate::config::GalleryEntry;

    let mut files: Vec<std::path::PathBuf> = Vec::new();
    for raw in &paths {
        let p = std::path::PathBuf::from(raw);
        if p.is_dir() {
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
                opts: None,
                favorite: false,
                last_applied_ms: None,
                origin: None,
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

#[tauri::command]
pub async fn media_picker_list(
    path: Option<String>,
) -> Result<crate::media_picker::MediaPickerListing, String> {
    tokio::task::spawn_blocking(move || crate::media_picker::list(path.as_deref()))
        .await
        .map_err(crate::error::err_str)?
}

#[tauri::command]
pub fn gallery_remove(id: String) -> Result<Vec<crate::config::GalleryEntry>, String> {
    crate::config_store::update(|c| c.gallery.retain(|g| g.id != id))?;
    Ok(crate::config_store::get().gallery)
}

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
        if let Some(g) = c.gallery.iter_mut().find(|g| g.id == id) {
            g.last_applied_ms = Some(now_ms());
        }
    })?;
    if crate::config_store::get().general.wallpaper_enabled {
        crate::wallpaper::ensure(&app)?;
    }
    Ok(())
}

#[tauri::command]
pub fn gallery_apply_monitor(
    app: AppHandle,
    id: Option<String>,
    monitor: String,
) -> Result<(), String> {
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
                if let Some(g) = c.gallery.iter_mut().find(|g| g.id == _id) {
                    g.last_applied_ms = Some(now_ms());
                }
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
    if crate::config_store::get().general.wallpaper_enabled {
        crate::wallpaper::ensure(&app)?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct OpenrgbStatus {
    ready: bool,
    version: String,
    size_bytes: u64,
    releases_page: String,
    installed_at: Option<String>,
}

#[tauri::command]
pub fn openrgb_status(state: State<'_, crate::rgb::EngineState>) -> OpenrgbStatus {
    let st = state.client.status();
    OpenrgbStatus {
        ready: st.connected && !st.devices.is_empty(),
        version: crate::openrgb_setup::version().to_string(),
        size_bytes: 0,
        releases_page: crate::openrgb_setup::releases_page(),
        installed_at: crate::openrgb_setup::installed_exe(&crate::config_store::data_dir())
            .map(|exe| exe.display().to_string()),
    }
}

#[tauri::command]
pub async fn openrgb_install() -> Result<String, String> {
    let data = crate::config_store::data_dir();
    let exe = crate::openrgb_setup::download_and_install(&data).await?;
    log::info!(
        "openrgb {} unpacked to {}",
        crate::openrgb_setup::version(),
        exe.display()
    );
    Ok(exe.display().to_string())
}

#[tauri::command]
pub fn openrgb_launch(exe: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(exe);
    if !path.is_file() {
        return Err("OpenRGB is not installed yet".into());
    }
    std::process::Command::new(&path)
        .arg("--server")
        .spawn()
        .map_err(|e| format!("Could not start OpenRGB: {e}"))?;
    log::info!("openrgb started from {}", path.display());
    Ok(())
}


#[tauri::command]
pub async fn gallery_add_from_url(
    url: String,
    name: Option<String>,
    origin: Option<String>,
) -> Result<crate::config::GalleryEntry, String> {
    const MAX_BYTES: usize = 200 * 1024 * 1024;
    let parsed = url
        .trim()
        .parse::<url::Url>()
        .map_err(|_| "Not a valid URL")?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("Only http(s) URLs are supported".into());
    }
    let resp = reqwest::get(parsed.as_str())
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status().as_u16()));
    }
    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let (kind, ext) = match ct.as_str() {
        "video/mp4" => (crate::config::WallpaperKind::Video, "mp4"),
        "video/webm" => (crate::config::WallpaperKind::Video, "webm"),
        "image/png" => (crate::config::WallpaperKind::Image, "png"),
        "image/jpeg" | "image/jpg" => (crate::config::WallpaperKind::Image, "jpg"),
        "image/webp" => (crate::config::WallpaperKind::Image, "webp"),
        "image/gif" => (crate::config::WallpaperKind::Image, "gif"),
        other => return Err(format!("Unsupported content type: {other}")),
    };
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    if bytes.len() > MAX_BYTES {
        return Err(format!("File too large ({} MB max)", MAX_BYTES / 1024 / 1024));
    }
    if bytes.is_empty() {
        return Err("Downloaded file is empty".into());
    }

    let stem = parsed
        .path()
        .rsplit('/')
        .find(|s| !s.is_empty())
        .and_then(|s| std::path::Path::new(s).file_stem().map(|s| s.to_string_lossy().to_string()))
        .filter(|s| !s.is_empty() && s.len() <= 80)
        .unwrap_or_else(|| format!("web-{:x}", md5_lite(&bytes)));
    let media_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LumenDeck")
        .join("media");
    std::fs::create_dir_all(&media_dir).map_err(crate::error::err_str)?;
    let mut target = media_dir.join(format!("{stem}.{ext}"));
    let mut n = 1u32;
    while target.exists() && std::fs::read(&target).map(|b| b.as_slice() != bytes.as_ref()).unwrap_or(true) {
        target = media_dir.join(format!("{stem}-{n}.{ext}"));
        n += 1;
    }
    if !target.exists() {
        std::fs::write(&target, bytes.as_ref()).map_err(|e| format!("Save failed: {e}"))?;
    }
    let path_str = target.to_string_lossy().to_string();
    let display = name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| stem.replace(['-', '_'], " "));
    gallery_add(display, kind, path_str, None, origin)
}

fn md5_lite(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

#[tauri::command]
pub async fn pick_media_files() -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(app) = crate::app_handle() else {
        return Ok(Vec::new());
    };
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter(
            "Media",
            &["png", "jpg", "jpeg", "gif", "webp", "bmp", "mp4", "webm", "mov", "mkv"],
        )
        .pick_files(move |paths| {
            let _ = tx.send(
                paths
                    .unwrap_or_default()
                    .into_iter()
                    .map(|p| p.to_string())
                    .collect::<Vec<_>>(),
            );
        });
    rx.await.map_err(crate::error::err_str)
}

#[tauri::command]
pub fn gallery_set_favorite(id: String, favorite: bool) -> Result<Vec<crate::config::GalleryEntry>, String> {
    let cfg = crate::config_store::update(|c| {
        if let Some(g) = c.gallery.iter_mut().find(|g| g.id == id) {
            g.favorite = favorite;
        }
    })?;
    Ok(cfg.gallery)
}

#[tauri::command]
pub fn gallery_set_opts(
    id: String,
    opts: Option<crate::config::EntryOptions>,
) -> Result<Vec<crate::config::GalleryEntry>, String> {
    let cleaned = opts.filter(|o| !o.is_empty());
    let cfg = crate::config_store::update(|c| {
        if let Some(entry) = c.gallery.iter_mut().find(|g| g.id == id) {
            entry.opts = cleaned;
        }
    })?;
    Ok(cfg.gallery)
}

#[tauri::command]
pub fn clipboard_url() -> Option<String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let app = crate::app_handle()?;
    let text = app.clipboard().read_text().ok()?;
    let trimmed = text.trim();
    if !is_bare_http_url(trimmed) {
        return None;
    }
    Some(trimmed.to_string())
}

fn is_bare_http_url(s: &str) -> bool {
    if s.is_empty() || s.chars().any(char::is_whitespace) {
        return false;
    }
    match url::Url::parse(s) {
        Ok(u) => u.scheme() == "http" || u.scheme() == "https",
        Err(_) => false,
    }
}

fn add_ids(entry_ids: &mut Vec<String>, incoming: &[String]) {
    for eid in incoming {
        if !entry_ids.contains(eid) {
            entry_ids.push(eid.clone());
        }
    }
}

#[cfg(test)]
mod collection_tests {
    use super::add_ids;

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn adding_to_an_empty_collection_takes_everything() {
        let mut e = Vec::new();
        add_ids(&mut e, &ids(&["a", "b"]));
        assert_eq!(e, ids(&["a", "b"]));
    }

    #[test]
    fn an_id_already_present_is_not_added_twice() {
        let mut e = ids(&["a"]);
        add_ids(&mut e, &ids(&["a"]));
        assert_eq!(e, ids(&["a"]));
    }

    #[test]
    fn a_batch_containing_a_present_id_keeps_the_rest() {
        let mut e = ids(&["a"]);
        add_ids(&mut e, &ids(&["a", "b", "c"]));
        assert_eq!(e, ids(&["a", "b", "c"]));
    }

    #[test]
    fn duplicates_inside_one_batch_collapse() {
        let mut e = Vec::new();
        add_ids(&mut e, &ids(&["a", "a", "b"]));
        assert_eq!(e, ids(&["a", "b"]));
    }

    #[test]
    fn existing_order_is_preserved_and_new_ids_append() {
        let mut e = ids(&["z", "y"]);
        add_ids(&mut e, &ids(&["x", "a"]));
        assert_eq!(e, ids(&["z", "y", "x", "a"]));
    }

    #[test]
    fn adding_nothing_changes_nothing() {
        let mut e = ids(&["a"]);
        add_ids(&mut e, &[]);
        assert_eq!(e, ids(&["a"]));
    }
}

#[cfg(test)]
mod url_guard_tests {    use super::is_bare_http_url;

    #[test]
    fn accepts_a_plain_wallpaper_link() {
        assert!(is_bare_http_url("https://example.com/wallpaper.mp4"));
        assert!(is_bare_http_url("http://example.com/a.png"));
    }

    #[test]
    fn rejects_a_scheme_that_is_not_http() {
        assert!(!is_bare_http_url("file:///C:/Windows/System32/cmd.exe"));
        assert!(!is_bare_http_url("javascript:alert(1)"));
    }

    #[test]
    fn rejects_prose_that_merely_contains_a_link() {
        assert!(!is_bare_http_url(
            "here is my wallpaper https://example.com/a.mp4 enjoy"
        ));
        assert!(!is_bare_http_url("https://example.com/a.mp4 https://b.com/c.mp4"));
    }

    #[test]
    fn rejects_nothing_at_all() {
        assert!(!is_bare_http_url(""));
        assert!(!is_bare_http_url("not a url"));
    }
}

#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("not found: {path}"));
    }
    use tauri_plugin_opener::OpenerExt;
    let Some(app) = crate::app_handle() else {
        return Err("app not ready".into());
    };
    app.opener()
        .reveal_item_in_dir(&p)
        .map_err(|e| format!("explorer: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let url = https_doc_url(&url)?;
    use tauri_plugin_opener::OpenerExt;
    let Some(app) = crate::app_handle() else {
        return Err("app not ready".into());
    };
    app.opener()
        .open_url(url.to_string(), None::<&str>)
        .map_err(|e| format!("opener: {e}"))
}


fn https_doc_url(s: &str) -> Result<url::Url, String> {
    let trimmed = s.trim();
    if !is_bare_http_url(trimmed) {
        return Err(format!("not a plain URL: {trimmed}"));
    }
    let u = url::Url::parse(trimmed).map_err(|_| format!("not a URL: {trimmed}"))?;
    if u.scheme() != "https" {
        return Err(format!("only https links are opened: {trimmed}"));
    }
    Ok(u)
}

#[cfg(test)]
mod open_url_tests {
    use super::https_doc_url;

    #[test]
    fn a_bare_https_link_opens_with_surrounding_space_trimmed() {
        let u = https_doc_url(" https://pixabay.com/api/docs/ ").unwrap();
        assert_eq!(u.as_str(), "https://pixabay.com/api/docs/");
    }

    #[test]
    fn anything_but_https_is_refused() {
        for bad in [
            "http://example.com/docs",
            "file:///C:/Windows/System32/cmd.exe",
            "javascript:alert(1)",
            "example.com/docs",
            "",
        ] {
            assert!(https_doc_url(bad).is_err(), "{bad} must be refused");
        }
    }
}

#[tauri::command]
pub fn vault_missing() -> Vec<String> {
    use crate::config::WallpaperKind;
    let cfg = crate::config_store::get();
    cfg.gallery
        .iter()
        .filter(|g| matches!(g.kind, WallpaperKind::Video | WallpaperKind::Image))
        .filter(|g| !std::path::Path::new(&g.source).exists())
        .map(|g| g.id.clone())
        .collect()
}

#[tauri::command]
pub fn gallery_regenerate_thumb(id: String) -> Result<Vec<crate::config::GalleryEntry>, String> {
    let source = {
        let cfg = crate::config_store::get();
        match cfg.gallery.iter().find(|g| g.id == id) {
            Some(g) => g.source.clone(),
            None => return Err(format!("no gallery entry {id}")),
        }
    };
    let path = crate::thumbs::regenerate_thumb(&source, 480)?;
    let media = crate::thumbs::thumb_media_url(&path);
    let cfg = crate::config_store::update(|c| {
        if let Some(entry) = c.gallery.iter_mut().find(|g| g.id == id) {
            entry.thumb = Some(media);
        }
    })?;
    Ok(cfg.gallery)
}

#[tauri::command]
pub async fn pick_image_file() -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(app) = crate::app_handle() else {
        return Ok(None);
    };
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "bmp"])
        .pick_file(move |path| {
            let _ = tx.send(path.map(|p| p.to_string()));
        });
    rx.await.map_err(crate::error::err_str)
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
    rx.await.map_err(crate::error::err_str)
}

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


#[tauri::command]
pub fn rgb_status(state: State<'_, crate::rgb::EngineState>) -> RgbStatus {
    state.client.status()
}

#[tauri::command]
pub async fn rgb_refresh(state: State<'_, crate::rgb::EngineState>) -> Result<(), String> {
    state.client.refresh().await;
    Ok(())
}

#[tauri::command]
pub fn dynlight_status() -> crate::dynlight::DynlightStatus {
    crate::dynlight::status()
}

#[tauri::command]
pub async fn discover_list(
    source: String,
    query: Option<String>,
    page: Option<u32>,
) -> Result<crate::discover::DiscoverPage, String> {
    let cfg = crate::config_store::get();
    crate::discover::list(
        &source,
        query.as_deref().unwrap_or("").trim(),
        page.unwrap_or(1),
        &cfg.discover,
    )
    .await
}

#[tauri::command]
pub async fn discover_thumb(url: String) -> Result<String, String> {
    crate::discover::thumb_data_url(&url).await
}

/// Best-effort download credit for Unsplash. The caller fires this after the
/// bytes are saved and ignores the result: a missed ping must never surface as
/// a failed import to the user.
#[tauri::command]
pub async fn discover_ping_download(
    download_location: String,
) -> Result<(), String> {
    let cfg = crate::config_store::get();
    let key = cfg
        .discover
        .sources
        .iter()
        .find(|s| s.id == "unsplash")
        .map(|s| s.api_key.as_str())
        .unwrap_or("");
    crate::discover::ping_unsplash_download(&download_location, key).await
}

#[tauri::command]
pub fn send_zone_samples(
    state: State<'_, crate::rgb::EngineState>,
    samples: Vec<ZoneSample>,
) -> Result<(), String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    for mut s in samples {
        s.received_ms = now_ms;
        let _ = state.tx.try_send(s);
    }
    Ok(())
}

#[tauri::command]
pub fn update_rgb_config(cfg: crate::config::RgbConfig) -> Result<(), String> {
    crate::config_store::update(|c| c.rgb = cfg)?;
    Ok(())
}


#[derive(Clone)]
struct PendingSticker {
    name: String,
    url: String,
}

static PENDING_PLACEMENT: Mutex<Option<PendingSticker>> = Mutex::new(None);

#[tauri::command]
pub async fn begin_sticker_placement(
    app: AppHandle,
    name: String,
    url: String,
    kind: String,
) -> Result<StickerDef, String> {
    let _ = kind;
    log::info!("sticker placement: armed (name={name}) — waiting for desktop click");
    let preview_url = crate::media::media_url_for_file(&url);
    *PENDING_PLACEMENT.lock().expect("pending poisoned") = Some(PendingSticker {
        name: name.clone(),
        url: url.clone(),
    });
    if let Err(e) = crate::placement_overlay::show(&app, &preview_url, &name) {
        log::warn!("placement overlay failed: {e}");
    }
    crate::events::emit_all(&app, crate::events::PLACING, &Some(preview_url));

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
        let mut size = crate::tokens::sticker_default_w() as i32;
        while let Some(delta) = wheel_rx.recv().await {
            size = (size + delta * 6).clamp(
                crate::tokens::sticker_min_size() as i32,
                crate::tokens::sticker_max_size() as i32,
            );
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
            let mut url = crate::media::media_url_for_file(&p.url);
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
            let (x, y) = clamp_placement(x, y);
            let size = placed_size.unwrap_or(crate::tokens::sticker_default_w() as i32) as u32;
            let (w, h) = media_aspect_size(&url, size);
            let (x, y) = (
                x - w as i32 / 2,
                y - h as i32 / 2,
            );
            let sticker = StickerDef {
                id: format!("stk-{}", nanoid_like()),
                name: p.name,
                url,
                x,
                y,
                w,
                h,
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

#[tauri::command]
pub fn cancel_sticker_placement(app: AppHandle) -> Result<(), String> {
    log::info!("sticker placement: cancelled (UI)");
    *PENDING_PLACEMENT.lock().expect("pending poisoned") = None;
    crate::mouse_hook::disarm();
    crate::placement_overlay::hide(&app);
    crate::events::emit_all(&app, crate::events::PLACING, &Option::<String>::None);
    Ok(())
}

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

#[tauri::command]
pub fn placement_resize(app: AppHandle, delta: i32) -> Result<(), String> {
    let _ = app;
    let tx = crate::mouse_hook::WHEEL_TX.lock().expect("wheel tx poisoned").clone();
    if let Some(tx) = tx {
        let _ = tx.send(delta);
    }
    Ok(())
}

#[tauri::command]
pub fn placement_set_interactive(
    webview_window: tauri::WebviewWindow,
    interactive: bool,
) -> Result<(), String> {
    let hwnd = crate::wallpaper::hwnd_of(&webview_window)?;
    crate::win32::set_input_transparent(hwnd, !interactive);
    Ok(())
}

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
pub fn duplicate_sticker(app: AppHandle, id: String) -> Result<(), String> {
    let source = crate::config_store::get().stickers.iter().find(|s| s.id == id).cloned();
    let Some(mut copy) = source else {
        return Err("sticker not found".into());
    };
    copy.id = gen_gallery_id(now_ms() as u128);
    copy.name = format!("{} copy", copy.name);
    copy.x += 24;
    copy.y += 24;
    crate::config_store::update(|c| c.stickers.push(copy.clone()))?;
    crate::stickers::broadcast(&app);
    Ok(())
}

#[tauri::command]
pub fn reorder_sticker(app: AppHandle, id: String, delta: i32) -> Result<(), String> {
    crate::config_store::update(|c| {
        let Some(idx) = c.stickers.iter().position(|s| s.id == id) else {
            return;
        };
        let new_idx = (idx as i32 + delta).clamp(0, c.stickers.len() as i32 - 1) as usize;
        if new_idx != idx {
            let s = c.stickers.remove(idx);
            c.stickers.insert(new_idx, s);
        }
    })?;
    crate::stickers::broadcast(&app);
    Ok(())
}

#[tauri::command]
pub fn is_paused() -> bool {
    crate::wallpaper::is_paused()
}

#[tauri::command]
pub fn toggle_pause(app: AppHandle) -> bool {
    let now = crate::wallpaper::toggle_manual_pause();
    log::info!("pause toggled -> {now}");
    crate::events::emit_all(&app, crate::events::WALLPAUSE, &now);
    now
}

#[tauri::command]
pub fn set_live_frame(
    webview_window: tauri::WebviewWindow,
    frame: Vec<u8>,
    source: String,
) -> bool {
    if !webview_window.label().starts_with("wallpaper-") {
        return false;
    }
    crate::wallpaper_bg::install_live_frame(&frame, &source)
}

#[tauri::command]
pub fn monitors() -> Vec<crate::win32::MonitorRect> {
    crate::win32::monitors()
}

#[tauri::command]
pub fn minimize_window(app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let window = app
        .get_webview_window("main")
        .ok_or("main window is gone")?;
    if crate::config_store::get().general.minimize_to_tray {
        let _ = window.hide();
    } else {
        window.minimize().map_err(crate::error::err_str)?;
    }
    Ok(())
}

#[tauri::command]
pub fn quit(app: AppHandle) -> Result<(), String> {
    crate::wallpaper_bg::ensure_installed_before_exit();
    app.cleanup_before_exit();
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn factory_reset(app: AppHandle) -> Result<(), String> {
    use std::path::PathBuf;
    log::info!("factory reset requested — wiping app data and exiting");

    let _ = crate::wallpaper::remove(&app);
    crate::sticker_windows::close_all(&app);
    crate::placement_overlay::hide(&app);

    let base = dirs::data_dir()
        .ok_or_else(|| "cannot resolve app data dir".to_string())?
        .join("LumenDeck");
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
    app.cleanup_before_exit();
    app.exit(0);
    Ok(())
}


#[tauri::command]
pub fn collection_create(name: String) -> Result<crate::config::WallpaperCollection, String> {
    let col = crate::config::WallpaperCollection {
        id: format!("col-{}", nanoid_like()),
        name,
        entry_ids: Vec::new(),
    };
    crate::config_store::update(|c| c.collections.push(col.clone()))?;
    Ok(col)
}

#[tauri::command]
pub fn collection_rename(id: String, name: String) -> Result<(), String> {
    let mut found = false;
    crate::config_store::update(|c| {
        if let Some(col) = c.collections.iter_mut().find(|x| x.id == id) {
            col.name = name;
            found = true;
        }
    })?;
    if !found {
        return Err("collection not found".into());
    }
    Ok(())
}

#[tauri::command]
pub fn collection_delete(id: String) -> Result<(), String> {
    crate::config_store::update(|c| {
        c.collections.retain(|x| x.id != id);
        for p in &mut c.playlists {
            if p.source == format!("collection:{id}") {
                p.source = "all".into();
            }
            for r in &mut p.rules {
                if r.source == format!("collection:{id}") {
                    r.source = "all".into();
                }
            }
        }
    })?;
    Ok(())
}

#[tauri::command]
pub fn collection_add_entries(id: String, entry_ids: Vec<String>) -> Result<Vec<String>, String> {
    let mut result: Vec<String> = Vec::new();
    let mut found = false;
    crate::config_store::update(|c| {
        if let Some(col) = c.collections.iter_mut().find(|x| x.id == id) {
            found = true;
            add_ids(&mut col.entry_ids, &entry_ids);
            result = col.entry_ids.clone();
        }
    })?;
    if !found {
        return Err("collection not found".into());
    }
    Ok(result)
}

#[tauri::command]
pub fn collection_toggle_entry(id: String, entry_id: String) -> Result<bool, String> {
    let mut added: bool = false;
    let mut found = false;
    crate::config_store::update(|c| {
        if let Some(col) = c.collections.iter_mut().find(|x| x.id == id) {
            found = true;
            if let Some(pos) = col.entry_ids.iter().position(|e| e == &entry_id) {
                col.entry_ids.remove(pos);
                added = false;
            } else {
                col.entry_ids.push(entry_id);
                added = true;
            }
        }
    })?;
    if !found {
        return Err("collection not found".into());
    }
    Ok(added)
}

#[tauri::command]
pub fn playlist_create(name: String) -> Result<crate::config::WallpaperPlaylist, String> {
    let pl = crate::config::WallpaperPlaylist {
        id: format!("pl-{}", nanoid_like()),
        name,
        ..Default::default()
    };
    crate::config_store::update(|c| c.playlists.push(pl.clone()))?;
    Ok(pl)
}

#[tauri::command]
pub fn playlist_save(playlist: crate::config::WallpaperPlaylist) -> Result<(), String> {
    crate::config_store::update(|c| {
        match c.playlists.iter_mut().find(|p| p.id == playlist.id) {
            Some(p) => *p = playlist.clone(),
            None => c.playlists.push(playlist.clone()),
        }
    })?;
    crate::playlist::nudge();
    Ok(())
}

#[tauri::command]
pub fn playlist_delete(id: String) -> Result<(), String> {
    crate::config_store::update(|c| c.playlists.retain(|p| p.id != id))?;
    crate::playlist::nudge();
    Ok(())
}

#[tauri::command]
pub fn playlist_set_active(id: Option<String>) -> Result<(), String> {
    crate::config_store::update(|c| {
        for p in &mut c.playlists {
            p.enabled = id.as_deref() == Some(p.id.as_str());
        }
    })?;
    crate::playlist::nudge();
    Ok(())
}


#[tauri::command]
pub fn scene_save(name: String) -> Result<crate::config::SceneProfile, String> {
    let cfg = crate::config_store::get();
    let scene = crate::config::SceneProfile {
        id: format!("scene-{}", nanoid_like()),
        name,
        wallpaper: cfg.wallpaper.clone(),
        rgb: cfg.rgb.clone(),
        stickers: cfg.stickers.clone(),
        logo: None,
        created_ms: crate::config::now_ms(),
    };
    crate::config_store::update(|c| {
        c.scenes.push(scene.clone());
        c.general.active_profile_id = Some(scene.id.clone());
    })?;
    Ok(scene)
}

#[tauri::command]
pub fn scene_apply(app: AppHandle, id: String) -> Result<(), String> {
    let scene = crate::config_store::get()
        .scenes
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| "scene not found".to_string())?;
    crate::config_store::update(|c| {
        c.wallpaper = scene.wallpaper.clone();
        c.rgb = scene.rgb.clone();
        c.stickers = scene.stickers.clone();
        c.general.active_profile_id = Some(scene.id.clone());
    })?;
    let fresh = crate::config_store::get();
    apply_side_effects(&app, &fresh);
    log::info!("scene applied: {}", scene.name);
    Ok(())
}

#[tauri::command]
pub fn scene_delete(id: String) -> Result<(), String> {
    if crate::config_store::get().scenes.len() <= 1 {
        return Err("cannot delete the last profile".into());
    }
    crate::config_store::update(|c| c.scenes.retain(|s| s.id != id))?;
    Ok(())
}

#[tauri::command]
pub fn scene_rename(id: String, name: String) -> Result<(), String> {
    crate::config_store::update(|c| {
        if let Some(s) = c.scenes.iter_mut().find(|s| s.id == id) {
            s.name = name;
        }
    })?;
    Ok(())
}

#[tauri::command]
pub fn scene_set_logo(id: String, source: Option<String>) -> Result<String, String> {
    let Some(source) = source else {
        crate::config_store::update(|c| {
            if let Some(s) = c.scenes.iter_mut().find(|s| s.id == id) {
                s.logo = None;
            }
        })?;
        return Ok(String::new());
    };

    let src = std::path::PathBuf::from(&source);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| matches!(e.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp"))
        .ok_or("Unsupported image type")?
        .to_string();
    let bytes = std::fs::read(&src).map_err(crate::error::err_str)?;
    const MAX_LOGO_BYTES: u64 = 4 * 1024 * 1024;
    if bytes.len() as u64 > MAX_LOGO_BYTES {
        return Err("Image is larger than 4 MB".into());
    }

    let media_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LumenDeck")
        .join("media");
    std::fs::create_dir_all(&media_dir).map_err(crate::error::err_str)?;
    let target = media_dir.join(format!("logo-{}.{ext}", sanitize_for_filename(&id)));
    std::fs::write(&target, &bytes).map_err(crate::error::err_str)?;
    let path_str = target.to_string_lossy().to_string();

    crate::config_store::update(|c| {
        if let Some(s) = c.scenes.iter_mut().find(|s| s.id == id) {
            s.logo = Some(path_str.clone());
        }
    })?;
    log::info!("scene logo set: {id}");
    Ok(path_str)
}


#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferPreview {
    kind: crate::transfer::TransferKind,
    from_version: String,
    profiles: Vec<String>,
    replaces_everything: bool,
    bundled_media: usize,
    missing_media: Vec<String>,
}

#[tauri::command]
pub async fn transfer_pick_save_path(default_name: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(app) = crate::app_handle() else {
        return Ok(None);
    };
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("LumenDeck export", &["zip", "json"])
        .set_file_name(&default_name)
        .save_file(move |path| {
            let _ = tx.send(path.map(|p| p.to_string()));
        });
    rx.await.map_err(crate::error::err_str)
}

#[tauri::command]
pub async fn transfer_pick_open_path() -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(app) = crate::app_handle() else {
        return Ok(None);
    };
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("LumenDeck export", &["zip", "json"])
        .pick_file(move |path| {
            let _ = tx.send(path.map(|p| p.to_string()));
        });
    rx.await.map_err(crate::error::err_str)
}

#[tauri::command]
pub async fn transfer_export(
    kind: crate::transfer::TransferKind,
    path: String,
) -> Result<String, String> {
    let cfg = crate::config_store::get();
    let file = crate::transfer::build_export(kind, &cfg, env!("CARGO_PKG_VERSION"), &cfg.scenes);
    let text = crate::transfer::to_json(&file);

    if kind == crate::transfer::TransferKind::Profiles {
        let target = with_extension(path, "json");
        std::fs::write(&target, text).map_err(crate::error::err_str)?;
        log::info!("exported {:?} to {}", file.kind, target.display());
        return Ok(target.display().to_string());
    }

    let plan = crate::transfer_archive::plan_bundle(&cfg, &|p| {
        std::path::Path::new(p).is_file()
    });
    let target = with_extension(path, "zip");
    crate::transfer_bundle::write_bundle(&target, &text, &plan.files, &plan.missing)?;
    log::info!(
        "exported config to {} ({} media, {} missing)",
        target.display(),
        plan.files.len(),
        plan.missing.len()
    );
    Ok(target.display().to_string())
}

#[tauri::command]
pub fn transfer_preview(path: String) -> Result<TransferPreview, String> {
    let p = std::path::PathBuf::from(&path);
    let text = if is_zip(&p) {
        crate::transfer_bundle::read_envelope(&p)?
    } else {
        read_text_file(&path)?
    };
    let file = crate::transfer::parse_export(&text)?;
    let profiles = match file.kind {
        crate::transfer::TransferKind::Profiles => {
            file.profiles.iter().map(|p| p.name.clone()).collect()
        }
        crate::transfer::TransferKind::Config => Vec::new(),
    };
    let (bundled_media, missing_media) = if is_zip(&p) {
        let bundled = crate::transfer_bundle::count_media(&p).unwrap_or(0);
        let missing = crate::transfer_bundle::read_missing(&p);
        (bundled, missing)
    } else {
        (0, Vec::new())
    };
    Ok(TransferPreview {
        replaces_everything: matches!(file.kind, crate::transfer::TransferKind::Config),
        kind: file.kind,
        from_version: file.app_version,
        profiles,
        bundled_media,
        missing_media,
    })
}

#[tauri::command]
pub fn transfer_import(app: AppHandle, path: String) -> Result<usize, String> {
    let p = std::path::PathBuf::from(&path);
    let bundled = is_zip(&p);
    let text = if bundled {
        crate::transfer_bundle::read_envelope(&p)?
    } else {
        read_text_file(&path)?
    };
    let current = crate::config_store::get();

    let landed = if bundled {
        let envelope = crate::transfer::parse_export(&text)?;
        let incoming_cfg = envelope.config.clone().unwrap_or_default();
        let by_source: std::collections::HashMap<&str, &str> = incoming_cfg
            .gallery
            .iter()
            .map(|g| (g.source.as_str(), g.id.as_str()))
            .collect();
        let unpacked = crate::transfer_bundle::restore_bundle(
            &p,
            &media_dir(),
            &incoming_cfg,
            &|src| {
                by_source
                    .get(src)
                    .map(|id| (*id).to_string())
                    .unwrap_or_else(nanoid_like)
            },
        )?;
        if unpacked.rejected > 0 {
            log::warn!(
                "ignored {} unrecognised member(s) in the bundle",
                unpacked.rejected
            );
        }
        log::info!(
            "unpacked {} media file(s), {} MB, from {path}",
            unpacked.landed.len(),
            unpacked.bytes / (1024 * 1024)
        );
        unpacked.landed
    } else {
        std::collections::BTreeMap::new()
    };

    let plan = crate::transfer::plan_import(&text, &current, &mut || {
        format!("scene-{}", nanoid_like())
    })?;

    match plan.config {
        Some(mut incoming) => {
            let count = incoming.scenes.len();
            let rewritten = crate::transfer_archive::rewrite_paths(&mut incoming, &landed);
            crate::config_store::set(incoming)?;
            let fresh = crate::config_store::get();
            apply_side_effects(&app, &fresh);
            log::info!(
                "config imported from {path} ({count} profiles, {rewritten} path(s) repointed)"
            );
            Ok(count)
        }
        None => {
            let added = plan.profiles.len().saturating_sub(current.scenes.len());
            crate::config_store::update(|c| c.scenes = plan.profiles.clone())?;
            log::info!("imported {added} profile(s) from {path}");
            Ok(added)
        }
    }
}

fn with_extension(path: String, ext: &str) -> std::path::PathBuf {
    let p = std::path::PathBuf::from(path);
    match p.extension().and_then(|e| e.to_str()) {
        Some(e) if e.eq_ignore_ascii_case(ext) => p,
        _ => {
            let mut name = p.file_name().unwrap_or_default().to_os_string();
            name.push(".");
            name.push(ext);
            p.with_file_name(name)
        }
    }
}

fn media_dir() -> std::path::PathBuf {
    crate::config_store::data_dir().join("media")
}

fn is_zip(path: &std::path::Path) -> bool {
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(path) else {
        return false;
    };
    let mut magic = [0u8; 2];
    match f.read_exact(&mut magic) {
        Ok(()) => magic == [0x50, 0x4b],
        Err(_) => false,
    }
}

fn read_text_file(path: &str) -> Result<String, String> {
    const MAX_BYTES: u64 = 64 * 1024 * 1024;
    let p = std::path::PathBuf::from(path);
    let meta = std::fs::metadata(&p).map_err(crate::error::err_str)?;
    if !meta.is_file() {
        return Err(format!("{} is not a file", p.display()));
    }
    if meta.len() > MAX_BYTES {
        return Err(format!(
            "that file is {} MB; an export is never that large",
            meta.len() / (1024 * 1024)
        ));
    }
    std::fs::read_to_string(&p).map_err(crate::error::err_str)
}

fn sanitize_for_filename(id: &str) -> String {
    let cleaned: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if cleaned.is_empty() {
        "scene".to_string()
    } else {
        cleaned.chars().take(64).collect()
    }
}

#[cfg(test)]
mod transfer_file_tests {
    use super::{is_zip, read_text_file, with_extension};

    fn temp_path(name: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!(
            "lumendeck-transfer-test-{}-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&p);
        p
    }

    #[test]
    fn a_config_export_is_written_with_a_zip_extension() {
        assert!(with_extension(r"C:\backup".into(), "zip")
            .to_string_lossy()
            .ends_with("backup.zip"));
    }

    #[test]
    fn an_extension_the_user_typed_is_kept_and_the_ours_appended() {
        assert!(with_extension(r"C:\exports\backup.v1".into(), "zip")
            .to_string_lossy()
            .ends_with("backup.v1.zip"));
    }

    #[test]
    fn an_existing_extension_is_not_doubled() {
        let out = with_extension(r"C:\backup.zip".into(), "zip");
        assert!(out.to_string_lossy().ends_with("backup.zip"));
        assert!(!out.to_string_lossy().ends_with(".zip.zip"));
        let out2 = with_extension(r"C:\backup.json".into(), "zip");
        assert!(out2.to_string_lossy().ends_with("backup.json.zip"));
    }

    #[test]
    fn a_bundle_is_recognised_by_its_bytes_not_its_name() {
        let zip = temp_path("detect.zip");
        let plain = temp_path("detect.json");
        std::fs::write(&zip, [0x50u8, 0x4b, 0x03, 0x04]).unwrap();
        std::fs::write(&plain, "{}").unwrap();
        assert!(is_zip(&zip));
        assert!(!is_zip(&plain));
        let renamed = temp_path("renamed.json");
        std::fs::write(&renamed, [0x50u8, 0x4b, 0x03, 0x04]).unwrap();
        assert!(is_zip(&renamed));
        let _ = std::fs::remove_file(&zip);
        let _ = std::fs::remove_file(&plain);
        let _ = std::fs::remove_file(&renamed);
    }

    #[test]
    fn a_file_is_read_back_as_written() {
        let p = temp_path("roundtrip.txt");
        std::fs::write(&p, "hello").unwrap();
        assert_eq!(read_text_file(&p.to_string_lossy()).unwrap(), "hello");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn a_directory_is_refused_rather_than_read() {
        let dir = std::env::temp_dir();
        let err = read_text_file(&dir.to_string_lossy()).unwrap_err();
        assert!(err.contains("not a file"), "got: {err}");
    }

    #[test]
    fn a_missing_file_is_an_error_rather_than_an_empty_read() {
        let p = temp_path("absent.json");
        let err = read_text_file(&p.to_string_lossy()).unwrap_err();
        assert!(!err.is_empty(), "the user must be told something");
        assert!(
            !err.contains("0 bytes"),
            "a missing file is not an empty one"
        );
    }

    #[test]
    fn binary_content_is_refused_not_returned_as_mangled_text() {
        let p = temp_path("binary.json");
        std::fs::write(&p, [0xff, 0xfe, 0x00, 0x01]).unwrap();
        assert!(read_text_file(&p.to_string_lossy()).is_err());
        let _ = std::fs::remove_file(&p);
    }
}

#[cfg(test)]
mod scene_tests {
    use super::sanitize_for_filename;

    #[test]
    fn a_generated_id_passes_through_unchanged() {
        assert_eq!(sanitize_for_filename("scene-1a2b3c"), "scene-1a2b3c");
    }

    #[test]
    fn path_separators_cannot_escape_the_media_directory() {
        assert_eq!(sanitize_for_filename("../../evil"), "evil");
        assert_eq!(sanitize_for_filename(r"..\..\evil"), "evil");
        assert!(!sanitize_for_filename("a/b").contains('/'));
        assert!(!sanitize_for_filename("a\\b").contains('\\'));
    }

    #[test]
    fn an_id_that_sanitizes_to_nothing_still_names_a_file() {
        assert_eq!(sanitize_for_filename(""), "scene");
        assert_eq!(sanitize_for_filename("///"), "scene");
    }

    #[test]
    fn a_long_id_is_truncated_rather_than_rejected() {
        let long = "a".repeat(200);
        assert_eq!(sanitize_for_filename(&long).len(), 64);
    }
}


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
fn media_aspect_size(url: &str, base: u32) -> (u32, u32) {
    let path = crate::media::decode_media_ref(url);
    let dims = (|| -> Option<(u32, u32)> {
        let bytes = std::fs::read(&path).ok()?;
        if bytes.len() > 64 * 1024 * 1024 {
            return None;
        }
        let img = image::load_from_memory(&bytes).ok()?;
        Some((img.width(), img.height()))
    })();
    let Some((iw, ih)) = dims else {
        return (base, base);
    };
    if iw == 0 || ih == 0 {
        return (base, base);
    }
    let aspect = iw as f64 / ih as f64;
    if aspect >= 1.0 {
        (base, ((base as f64) / aspect).round().max(48.0) as u32)
    } else {
        (((base as f64) * aspect).round().max(crate::tokens::sticker_min_size() as f64) as u32, base)
    }
}

fn clamp_placement(x: i32, y: i32) -> (i32, i32) {
    use crate::tokens::{sticker_default_h, sticker_default_w};
    let mons = crate::win32::monitors();
    let (vx0, vy0, vx1, vy1) = mons.iter().fold(
        (i32::MAX, i32::MAX, i32::MIN, i32::MIN),
        |(a, b, c, d), m| (a.min(m.x), b.min(m.y), c.max(m.x + m.w), d.max(m.y + m.h)),
    );
    let cx = x + sticker_default_w() as i32 / 2;
    let cy = y + sticker_default_h() as i32 / 2;
    let half_w = sticker_default_w() as i32 / 2;
    let half_h = sticker_default_h() as i32 / 2;
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



#[tauri::command]
pub async fn media_transport(action: String) -> Result<(), String> {
    crate::media_session::transport_async(action).await
}

#[tauri::command]
pub async fn media_seek(position_sec: f64) -> Result<(), String> {
    crate::media_session::seek_async(position_sec).await
}

#[tauri::command]
pub async fn media_shuffle(active: bool) -> Result<(), String> {
    crate::media_session::set_shuffle_async(active).await
}

#[tauri::command]
pub async fn media_repeat(current: Option<u8>) -> Result<(), String> {
    crate::media_session::cycle_repeat_async(current).await
}

#[tauri::command]
pub fn volume_get() -> Result<[f32; 2], String> {
    #[cfg(windows)]
    {
        Ok([
            crate::volume::get()? * 100.0,
            if crate::volume::muted()? { 1.0 } else { 0.0 },
        ])
    }
    #[cfg(not(windows))]
    Ok([0.0, 0.0])
}

#[tauri::command]
pub fn volume_set(percent: f32) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::volume::set(percent / 100.0)
    }
    #[cfg(not(windows))]
    Ok(())
}

#[tauri::command]
pub fn volume_mute_toggle() -> Result<bool, String> {
    #[cfg(windows)]
    {
        crate::volume::toggle_mute()
    }
    #[cfg(not(windows))]
    Ok(false)
}

#[tauri::command]
pub fn media_current() -> Option<crate::media_session::MediaInfo> {
    crate::media_session::current()
}

#[tauri::command]
pub fn system_accent() -> Option<[u8; 3]> {
    crate::sys_theme::get_system_accent()
}

#[tauri::command]
pub fn system_language() -> String {
    crate::i18n::system_language().to_string()
}

#[tauri::command]
pub fn account_name() -> String {
    crate::account::name().to_string()
}

#[tauri::command]
pub fn hotkey_validate(accelerator: String) -> Result<(), String> {
    crate::hotkeys::validate(&accelerator)
}

#[cfg(test)]
mod dev_info_tests {
    use super::*;

    #[test]
    fn dev_info_reports_populated_paths_and_version() {
        let info = dev_info();
        assert!(!info.version.is_empty());
        assert!(!info.build_id.is_empty());
        assert!(
            !info.build_dirty || info.build_id.ends_with("-dirty"),
            "dirty build reported a clean-looking id: {}",
            info.build_id
        );
        assert!(info.config_path.ends_with("config.json"), "{}", info.config_path);
        assert!(info.log_path.ends_with("lumendeck.log"), "{}", info.log_path);
        assert!(!info.data_dir.is_empty());
        let data_dir = std::path::Path::new(&info.data_dir);
        assert_eq!(
            std::path::Path::new(&info.config_path).parent(),
            Some(data_dir),
            "config is not in the data dir: {}",
            info.config_path
        );
        assert_eq!(
            std::path::Path::new(&info.log_path).parent(),
            Some(data_dir),
            "log is not in the data dir: {}",
            info.log_path
        );
    }

    #[test]
    fn dev_info_report_header_carries_the_build_id() {
        let info = dev_info();
        assert!(
            info.report_header.contains(info.build_id),
            "header {:?} does not name build {}",
            info.report_header,
            info.build_id
        );
        assert!(info.report_header.contains(info.version), "{}", info.report_header);
    }

    #[test]
    fn dev_info_log_level_parses() {
        let info = dev_info();
        let parsed: log::LevelFilter = info
            .log_level
            .parse()
            .unwrap_or_else(|_| panic!("unparseable log level {:?}", info.log_level));
        assert!(parsed <= log::LevelFilter::Trace);
    }
}
