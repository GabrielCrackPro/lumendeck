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
    /// Crossfade seconds for playlist/config-driven source changes (the
    /// active playlist's setting; 0 = instant cut).
    pub crossfade_sec: f64,
    pub config: WallpaperConfig,
    pub paused: bool,
    /// All stickers (virtual-screen coords); each window clips to its monitor.
    pub stickers: Vec<StickerDef>,
    /// Every connected monitor (virtual-screen coords) — used for alignment
    /// guides when dragging stickers.
    pub monitors: Vec<crate::win32::MonitorRect>,
    /// Snap behavior for the sticker editor.
    pub snap: crate::config::StickerSnap,
    /// Mirror wallpaper-layer stickers on every monitor.
    pub sticker_all_monitors: bool,
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
    // Accent sync lifecycle: back up the original OS accent on first enable,
    // restore it when sync is turned off.
    if cfg.general.accent_sync_enabled && !cfg.general.accent_sync_armed {
        crate::sys_theme::remember_original_accent();
        cfg.general.accent_sync_armed = true;
    } else if !cfg.general.accent_sync_enabled && cfg.general.accent_sync_armed {
        crate::sys_theme::restore_original_accent();
        cfg.general.accent_sync_armed = false;
    }
    // Once sync is off we no longer own the accent, so the watcher must stop
    // treating our last write as an echo — otherwise a user change that happens
    // to match it would be silently dropped.
    if !cfg.general.accent_sync_enabled {
        crate::sys_theme::forget_last_write();
    }
    // Lock screen lifecycle: back up the user's image on first enable, and
    // put it back when the toggle goes off.
    //
    // Without the release half the toggle is one-way — the registry keeps
    // pointing at wallpaper-bg.jpg forever after the user said no. The arming
    // flag mirrors the accent sync above: it records that we took over, which
    // is the only thing that distinguishes "never touched" from "took over and
    // the user has since turned it off".
    let lock_screen_taking_over =
        cfg.general.lock_screen_follows_wallpaper && !cfg.general.lock_screen_armed;
    let lock_screen_releasing =
        !cfg.general.lock_screen_follows_wallpaper && cfg.general.lock_screen_armed;
    if lock_screen_taking_over {
        cfg.general.lock_screen_armed = true;
    } else if lock_screen_releasing {
        cfg.general.lock_screen_armed = false;
    }
    // Persist before touching the registry: the lock screen decision reads the
    // config store to see whether the feature is on, so doing it first would
    // plan against the *previous* toggle and do the opposite of what was asked.
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

/// Apply config-dependent windows/RGB state. Shared by UI saves and external
/// config reloads.
pub fn apply_side_effects(app: &AppHandle, cfg: &Config) {
    // Coalesce rapid-fire saves (slider gestures used to fire dozens): only
    // the last call within 150ms actually runs the window-sync pass.
    static PENDING: std::sync::Mutex<Option<Config>> = std::sync::Mutex::new(None);
    if let Ok(mut slot) = PENDING.lock() {
        if slot.is_some() {
            *slot = Some(cfg.clone()); // a sync is already scheduled
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

/// The actual side-effect pass (window ensure/remove, BG capture, sticker
/// sync). Always runs on the dedicated worker thread.
fn apply_side_effects_now(app: &AppHandle, cfg: &Config) {
    if cfg.general.wallpaper_enabled {
        if let Err(e) = crate::wallpaper::ensure(app) {
            log::warn!("wallpaper ensure failed: {e}");
        }
        // Static snapshot for desktop/lock-screen BG: async, coalesced.
        crate::wallpaper_bg::request_bg(cfg.wallpaper.clone());
    } else if let Err(e) = crate::wallpaper::remove(app) {
        log::warn!("wallpaper remove failed: {e}");
    }
    // Keep the OS autostart entry in sync with the preference. The plugin
    // is only consulted once at startup, so toggling in the UI must apply
    // here — otherwise the change only takes effect after a restart.
    {
        use tauri_plugin_autostart::ManagerExt;
        let manager = app.autolaunch();
        let result = if cfg.general.autostart {
            manager.enable()
        } else {
            manager.disable()
        };
        if let Err(e) = result {
            log::warn!("autostart sync failed: {e}");
        }
    }
    // Topmost sticker windows track their per-sticker onTop flag.
    crate::sticker_windows::sync(app);
    // Re-bind system-wide hotkeys when the binding set or the master switch
    // changed. Cheap no-op otherwise, so it is safe on every (heavily
    // debounced) config save.
    crate::hotkeys::sync(
        app,
        cfg.general.hotkeys_enabled,
        &cfg.general.hotkeys,
    );
    log::debug!(
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
    // Per-display wallpaper: when this monitor has an override, hand the
    // webview an effective config carrying it (kind+source swapped in).
    // resolve_for_monitor returns an already-resolved media URL — do NOT run
    // resolve_source over it again (that would double-encode and break video).
    let (pm_kind, pm_source) =
        crate::wallpaper::resolve_for_monitor(&cfg.wallpaper, &mon.device);
    let mut effective = cfg.wallpaper.clone();
    effective.kind = pm_kind;
    effective.source = pm_source.clone();
    // Per-entry playback overrides, layered on last. They are matched against
    // the *raw* source, because the gallery stores the path it was given while
    // the webview renders a resolved media:// URL, and those two are different
    // strings. An entry with nothing set leaves the global config untouched, so
    // the other four hundred clips in the vault are unaffected.
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
        // Auto-exit: an editor session left on blocks desktop clicks forever
        // (the hook swallows button events while active). 5 minutes without
        // any input ends the session safely; ESC exits immediately.
        const IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);
        let mut last_input = std::time::Instant::now();
        loop {
            if last_input.elapsed() > IDLE_TIMEOUT {
                log::info!("sticker editor: auto-exit after 5 min idle");
                break;
            }
            if crate::mouse_hook::editor_mode_on() {
                // any mouse activity resets the idle clock (LAST_INPUT_MS is
                // touched by both hooks on every event)
                last_input = std::time::Instant::now();
            }
            // ESC ends the session (keyboard hook flags it) — same convention
            // as Wallpaper Engine / Lively interactive flows.
            if crate::mouse_hook::ESC_PRESSED.swap(false, std::sync::atomic::Ordering::SeqCst) {
                log::info!("sticker editor: exit (ESC)");
                break;
            }
            match tokio::time::timeout(std::time::Duration::from_millis(50), rx.recv()).await {
                Ok(Some((x, y, l, r))) => {
                    crate::events::emit_all(&app, crate::events::EDITOR_MOUSE, &(x, y, l, r));
                }
                Ok(None) => break, // stream closed
                Err(_) => continue, // poll tick: re-check ESC
            }
        }
        // Only end the session if this forwarder still owns it (a new
        // session may have started after our timeout fired).
        if crate::mouse_hook::editor_mode_on() {
            log::info!("sticker editor: auto-exit after 5 min idle");
            let _ = end_sticker_editor();
        }
    });
}

/// Frontend diagnostics channel: webview console messages don't reach the
/// log file, so wallpaper/sticker pages forward important events here.
///
/// What a bug report needs to have in it, read from the process rather than
/// guessed in the UI.
///
/// Everything here used to be assembled in React: the version came from a Vite
/// define, the log level was hardcoded to "info", and the paths were not shown
/// at all. Each of those is a way to be confidently wrong. The build mode is
/// still a compile-time constant, because that is the only place it is true;
/// everything else the backend already knows.
///
/// One command rather than five, so the panel cannot render a half-populated
/// grid while the facts trickle in one invoke at a time.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevInfo {
    /// `Cargo.toml` version. The backend's own copy, so it cannot drift from
    /// the binary the user is actually running.
    pub version: &'static str,
    /// `true` for a `tauri dev` build.
    pub debug: bool,
    /// The commit this binary was built from, with `-dirty` when the tree had
    /// uncommitted changes. `unknown` outside a git checkout.
    ///
    /// This is what makes a bug report actionable. "0.2.7" alone cannot
    /// distinguish a shipped installer from a build of a branch that happens to
    /// sit at the same version, and with a long-running uncommitted working tree
    /// it cannot even distinguish two local builds.
    pub build_id: &'static str,
    /// Whether the tree was dirty when this binary was built.
    pub build_dirty: bool,
    /// The level [crate::log_level] resolved to, as the logger will print it.
    pub log_level: String,
    /// Absolute path of the config file, so a hand edit has a target.
    pub config_path: String,
    /// Absolute path of the log file, the same one `reveal_log` opens.
    pub log_path: String,
    /// The folder holding both, for "open the data dir".
    pub data_dir: String,
    /// The most recent panic, if the process survived one.
    ///
    /// `None` until something panics. Present because a thread that panics can
    /// be caught at a join point or simply be a background task, in which case
    /// the app keeps running and the only trace is the log line nobody reads.
    pub last_panic: Option<String>,
    /// The first line of a pasted bug report: version, build and log level.
    ///
    /// Composed in Rust rather than in the frontend so this header and the
    /// panic line in the log cannot drift apart, and so the build identity the
    /// user pastes is the one compiled into the binary they are running.
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

/// A path as the user would type it into Explorer.
///
/// `Path::display` on its own can emit a lossy or environment-dependent form,
/// and this string is meant to be pasted into a bug report by a human. Windows
/// paths here carry no secrets, so the full path is the useful thing.
fn display_path(p: &std::path::Path) -> String {
    p.display().to_string()
}

/// Open the log folder in Explorer.
///
/// Every "attach your log to a bug report" instruction starts with a path the
/// user then has to find on their own — `%APPDATA%` is hidden, and a wrong
/// guess costs the report. The path is stable, but knowing it is not the same as
/// being able to reach it, so the button does the reaching.
///
/// `select`, not just open: the log is one of a dozen files in the folder and
/// the one they want is the one highlighted.
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
    // The file may not exist yet on a machine that has never hit an error;
    // opening the folder is still the right answer, so fall back rather than
    // failing the button over a log that is simply empty.
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

/// The last `limit` lines of the log, newest last.
///
/// Bounded on purpose: the file rotates at 5 MB and reading all of it into a
/// webview to show 200 lines is the kind of thing that looks instant on a
/// dev machine and hangs a laptop. The tail is read backwards in chunks so a
/// 5 MB file costs about as much as the text actually returned.
#[tauri::command]
pub fn log_tail(limit: Option<usize>) -> Result<Vec<String>, String> {
    let path = crate::config_store::log_path();
    if !path.is_file() {
        // No log yet is a normal state, not an error. An empty view with a
        // "nothing logged yet" line beats a red toast on a fresh install.
        return Ok(Vec::new());
    }
    let want = limit.unwrap_or(200).clamp(1, 5_000);
    crate::logtail::tail(&path, want).map_err(|e| format!("log_tail: {e}"))
}

/// Last-modified time and size of every gallery entry's file, keyed by entry id.
///
/// This exists because the vault index is cached by source path, which is wrong
/// the moment a file is replaced in place: the path is unchanged, so the cached
/// resolution and duration survive a re-encode and the grid sorts and filters
/// on numbers that no longer describe the file. "Rescan" could not fix it
/// either, because it only ever checked that the file was still there.
///
/// The stamp is what makes staleness detectable without decoding anything. It
/// is not a content hash — hashing every file in the vault would cost more than
/// the probes this avoids — so it is a heuristic in one direction: a file edited
/// without changing its size or mtime keeps a stale measurement. That is
/// vanishingly rare next to the re-encode case, which changes both.
///
/// Only file-backed kinds are included; a web URL and a shader preset id have
/// no file to stat, and reporting a zero stamp for them would make the frontend
/// think they were cached when nothing was measured.
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

/// What the filesystem can tell us about a file without reading it.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    /// Modification time in milliseconds since the Unix epoch.
    pub mtime_ms: u64,
    /// Size in bytes.
    pub size: u64,
}

/// Read a file's stamp. `None` when the file is missing or unreadable, which
/// the frontend treats the same as "no cached measurement to trust".
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

/// Accepts a level so webview errors surface as ERROR in the file (grep-able)
/// instead of everything being INFO. Repetition storms (e.g. a decode error
/// retry loop) are rate-limited: identical messages within the window log
/// once plus a suppressed-count line.
#[tauri::command]
pub fn log_frontend(level: Option<String>, msg: String) {
    const WINDOW_MS: u128 = 2_000;
    static LAST: std::sync::Mutex<Option<(u128, String, u32, Option<String>)>> =
        std::sync::Mutex::new(None);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    // Rate-limit identical messages.
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
            // Suppression notice inherits the original line's level so debug
            // diagnostics don't resurface as warnings.
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
        // Debug diagnostics (perf counters etc.) are hidden at the default
        // log level; enable RUST_LOG=lumendeck=debug to see them.
        Some("debug") => log::debug!("[frontend] {msg}"),
        _ => log::info!("[frontend] {msg}"),
    }
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
                opts: None,
                favorite: false,
                last_applied_ms: None,
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
                opts: None,
                favorite: false,
                last_applied_ms: None,
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
                opts: None,
                favorite: false,
                last_applied_ms: None,
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
        // Stamped here rather than by the caller, so every path that puts a
        // wallpaper on a screen records it. That is what the "recently used"
        // sort reads, and it has to be the backend's job or a caller will
        // forget.
        if let Some(g) = c.gallery.iter_mut().find(|g| g.id == id) {
            g.last_applied_ms = Some(now_ms());
        }
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
                // Same stamp as gallery_apply: a wallpaper shown on one display
                // has been used, and the "recently used" sort should know it.
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
    // Config watcher broadcasts CONFIG_CHANGED; webviews re-resolve from it.
    if crate::config_store::get().general.wallpaper_enabled {
        crate::wallpaper::ensure(&app)?;
    }
    Ok(())
}

/// Download a remote wallpaper (direct video/image URL) into the app media
/// folder and add it to the gallery. Returns the new entry (full list).
/// Safety: HTTPS-only, 200 MB cap, extension sniffed from Content-Type —
/// never executed, only served back through the media:// scheme.
#[tauri::command]
pub async fn gallery_add_from_url(
    url: String,
    name: Option<String>,
) -> Result<Vec<crate::config::GalleryEntry>, String> {
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

    // Deterministic name from the URL path (fallback: hash) to keep
    // re-imports idempotent at the same target path.
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
    Ok(gallery_add(display, kind, path_str, None))
}

/// Tiny FNV-1a hash for collision fallback names (not security-sensitive).
fn md5_lite(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// One browse dialog for every media kind, with multi-select.
///
/// It used to be two commands — one labelled "video", one "image" — but the
/// filter list was already the union of both, so all the choice ever decided
/// was which kind string the caller hardcoded alongside the same dialog. The
/// kind is now inferred from the extension. Taking a list rather than one path
/// is the part that matters: selecting a folder's worth of wallpapers in one go
/// is the difference between one dialog and twenty.
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

/// Star or unstar one entry.
#[tauri::command]
pub fn gallery_set_favorite(id: String, favorite: bool) -> Result<Vec<crate::config::GalleryEntry>, String> {
    let cfg = crate::config_store::update(|c| {
        if let Some(g) = c.gallery.iter_mut().find(|g| g.id == id) {
            g.favorite = favorite;
        }
    })?;
    Ok(cfg.gallery)
}

/// Set (or clear) one gallery entry's playback overrides.
///
/// An all-`None` bag is stored as `None` rather than as an empty object, so
/// "back to the global setting" leaves no residue in the config file and the
/// entry compares equal to one that never had the drawer opened.
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

/// Open the containing folder in Explorer with this file selected.
///
/// `/select,` is what makes it a "show me where this lives" rather than a
/// folder open that leaves you to hunt for the file yourself.
/// The clipboard's text, if it is a bare http(s) URL.
///
/// This exists because a `paste` event is the *wrong* trigger for a button. A
/// paste only works where the user is already typing, which is why the window
/// listener has to work so hard: bail on every input, bail on any text that is
/// not exactly a URL. A "Paste link" button has no such ambiguity — the user
/// asked for the clipboard, so anything non-URL is simply nothing to do.
///
/// Returns `Ok(None)` rather than an error for the same reason. A clipboard
/// holding a half-typed sentence is the normal state of a clipboard, not a
/// failure worth a red toast.
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

/// Whether a string is exactly one http(s) URL and nothing else.
///
/// A URL cannot contain whitespace, so that single test rejects the "paragraph
/// that happens to include a link" case that would otherwise start a download
/// because someone pressed the wrong button. `URL::parse` accepts a trailing
/// newline on some inputs, hence the trim at the call site.
fn is_bare_http_url(s: &str) -> bool {
    if s.is_empty() || s.chars().any(char::is_whitespace) {
        return false;
    }
    match url::Url::parse(s) {
        Ok(u) => u.scheme() == "http" || u.scheme() == "https",
        Err(_) => false,
    }
}

/// The membership half of `collection_add_entries`, without the config store.
///
/// The command itself needs an initialised store, which a unit test cannot
/// provide. What actually has rules — dedup, add-only, order — lives here so it
/// can be tested directly.
fn add_ids(entry_ids: &mut Vec<String>, incoming: &[String]) {
    // `Vec::contains` rather than a HashSet: a collection holds tens of ids, and
    // this keeps the existing order intact, which a HashSet would not.
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
        // The behaviour that separates this from the toggle: "add these" must
        // not remove what was already filed.
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
        // Order is the collection's own; a user's arrangement has to survive
        // someone adding to it.
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
        // Otherwise "paste this" would execute something, which is a very
        // different thing from downloading a wallpaper.
        assert!(!is_bare_http_url("file:///C:/Windows/System32/cmd.exe"));
        assert!(!is_bare_http_url("javascript:alert(1)"));
    }

    #[test]
    fn rejects_prose_that_merely_contains_a_link() {
        // The case the whole check exists for.
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
    // Was `Command::new("explorer").arg("/select,...")`: a subprocess spawned
    // for something the platform already does properly.
    use tauri_plugin_opener::OpenerExt;
    let Some(app) = crate::app_handle() else {
        return Err("app not ready".into());
    };
    app.opener()
        .reveal_item_in_dir(&p)
        .map_err(|e| format!("explorer: {e}"))?;
    Ok(())
}

/// Gallery entry ids whose file is no longer on disk.
///
/// Only the kinds that point at a path are checked: a web wallpaper is a URL
/// and a shader is a preset id, and calling either of them "missing" would be a
/// lie rather than a warning. The duplicate half of the health check is
/// computed in the frontend, where it can be unit-tested without a filesystem.
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

/// Throw away a cached poster frame and extract a fresh one.
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

/// One image, for the sticker picker.
///
/// Stickers are images only, so this stays a single-file dialog with an
/// image-only filter. It is deliberately not `pick_media_files` with a `[0]`
/// on the end: a picker that lets you select five and silently uses one is
/// worse than one that never offered you the choice.
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
            let size = placed_size.unwrap_or(crate::tokens::sticker_default_w() as i32) as u32;
            // Aspect-aware default: probe the media's natural dimensions and
            // scale the wheel-chosen size to fit, so a wide banner doesn't
            // land as a letterboxed square. Video probe is best-effort; the
            // square default remains the fallback.
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

/// Duplicate a sticker: new id/name, offset +24px so both stay grabbable.
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

/// Reorder within the sticker list (render order in the wallpaper layer =
/// list order; later entries draw on top). delta -1 = back, +1 = forward.
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

/// Manual pause toggle (dashboard / command palette; the tray has the same
/// control). Returns the new paused state.
#[tauri::command]
pub fn toggle_pause(app: AppHandle) -> bool {
    let now = crate::wallpaper::toggle_manual_pause();
    log::info!("pause toggled -> {now}");
    crate::events::emit_all(&app, crate::events::WALLPAUSE, &now);
    now
}

/// The active wallpaper webview pushes a real decoded frame here (JPEG,
/// captured from its presentation canvas). Installed as the static fallback
/// AND the Windows desktop/lock-screen background — always a genuine frame
/// of exactly what the user was watching, unlike Shell thumbnails.
#[tauri::command]
pub fn set_live_frame(
    webview_window: tauri::WebviewWindow,
    frame: Vec<u8>,
    source: String,
) -> bool {
    // Only wallpaper windows may push frames.
    if !webview_window.label().starts_with("wallpaper-") {
        return false;
    }
    crate::wallpaper_bg::install_live_frame(&frame, &source)
}

#[tauri::command]
pub fn monitors() -> Vec<crate::win32::MonitorRect> {
    crate::win32::monitors()
}

/// The titlebar minimize button. The destination is a user preference, so it
/// is resolved here (against the live config) rather than in the frontend:
/// `general.minimize_to_tray` sends the dashboard to the notification area,
/// anything else parks it on the taskbar.
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
    // The wallpaper windows die with the process: leave the OS desktop
    // showing the current scene's static frame, not a black void.
    crate::wallpaper_bg::ensure_installed_before_exit();
    // Destroy webview windows before the process dies, so WebView2's DLL
    // unregisters its window classes cleanly instead of racing live windows
    // (Chrome_WidgetWin_0 unregister error 1412 in the console).
    app.cleanup_before_exit();
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
    // Let Tauri destroy the remaining webview windows first: exiting cold
    // while WebView2 child windows are alive makes its DLL fail to unregister
    // Chrome_WidgetWin_* at teardown (benign but noisy error 1412).
    app.cleanup_before_exit();
    app.exit(0);
    Ok(())
}

// ---------- Collections & playlists ----------

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
        // Playlists referencing the deleted collection fall back to `all`.
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

/// Add several vault entries to a collection in one pass.
///
/// Exists because "file this selection into a collection" is a bulk action, and
/// doing it through the single-entry toggle costs one config read, write, watch
/// notification and IPC round-trip *per wallpaper*. Twenty wallpapers is twenty
/// writes and twenty frontend config events for one user gesture — and the
/// frontend has to serialize them itself to avoid a race, which is a fragile
/// thing to depend on for correctness.
///
/// Ids already in the collection are left where they are rather than toggled:
/// an "add these" that silently removes half of what it was given is worse than
/// doing nothing.
///
/// Returns the collection's membership afterwards, so the caller does not have
/// to guess what landed.
#[tauri::command]
pub fn collection_add_entries(id: String, entry_ids: Vec<String>) -> Result<Vec<String>, String> {
    let mut result: Vec<String> = Vec::new();
    let mut found = false;
    crate::config_store::update(|c| {
        if let Some(col) = c.collections.iter_mut().find(|x| x.id == id) {
            found = true;
            // Dedup and add-only; see `add_ids` for the rules and the tests.
            add_ids(&mut col.entry_ids, &entry_ids);
            result = col.entry_ids.clone();
        }
    })?;
    if !found {
        return Err("collection not found".into());
    }
    Ok(result)
}

/// Add/remove a vault entry to/from a collection (single membership toggle).
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

/// Upsert a full playlist definition (edited from the dashboard).
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

/// Enable one playlist and disable the rest (single-active model).
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

// ---------- Scenes (full-look snapshots) ----------

/// Snapshot the CURRENT look into a scene: wallpaper config (incl. per-monitor
/// overrides) + RGB config. `name` labels it; an id is generated.
#[tauri::command]
pub fn scene_save(name: String) -> Result<crate::config::SceneProfile, String> {
    let cfg = crate::config_store::get();
    let scene = crate::config::SceneProfile {
        id: format!("scene-{}", nanoid_like()),
        name,
        wallpaper: cfg.wallpaper.clone(),
        rgb: cfg.rgb.clone(),
        created_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    };
    crate::config_store::update(|c| c.scenes.push(scene.clone()))?;
    Ok(scene)
}

/// Recall a scene: swap in the wallpaper + RGB configs and re-apply side
/// effects. Sticker placements are intentionally NOT touched (they're
/// positional, not mood); playlist state is paused during recall so the
/// scheduler doesn't immediately override the restored wallpaper.
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
    })?;
    let fresh = crate::config_store::get();
    apply_side_effects(&app, &fresh);
    log::info!("scene applied: {}", scene.name);
    Ok(())
}

#[tauri::command]
pub fn scene_delete(id: String) -> Result<(), String> {
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
/// Aspect-aware placed size: probe natural media dimensions and scale the
/// target `base` (the wheel-chosen box) to fit inside it while preserving
/// aspect. Falls back to a `base × base` square when the probe fails (video
/// headers need a demuxer; images decode cheaply and reliably).
fn media_aspect_size(url: &str, base: u32) -> (u32, u32) {
    let path = crate::media::decode_media_ref(url);
    let dims = (|| -> Option<(u32, u32)> {
        let bytes = std::fs::read(&path).ok()?;
        if bytes.len() > 64 * 1024 * 1024 {
            return None; // probing huge files isn't worth the stall
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

// ---------- Media session (SMTC) ----------

/// Fire a transport action (play/pause/next/previous) at whatever the OS
/// media session is currently playing — Spotify, a browser, any SMTC client.
#[tauri::command]
pub fn media_transport(action: String) -> Result<(), String> {
    crate::media_session::transport(&action)
}

/// Seek the current SMTC session to the given position (seconds).
#[tauri::command]
pub fn media_seek(position_sec: f64) -> Result<(), String> {
    crate::media_session::seek(position_sec)
}

/// Toggle shuffle on the current SMTC session.
#[tauri::command]
pub fn media_shuffle(active: bool) -> Result<(), String> {
    crate::media_session::set_shuffle(active)
}

/// Cycle repeat mode (off -> track -> list -> off) on the current session.
#[tauri::command]
pub fn media_repeat(current: Option<u8>) -> Result<(), String> {
    crate::media_session::cycle_repeat(current)
}

/// System master volume (0..100) + mute state, for the player card.
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

/// Set the system master volume (0..100).
#[tauri::command]
pub fn volume_set(percent: f32) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::volume::set(percent / 100.0)
    }
    #[cfg(not(windows))]
    Ok(())
}

/// Toggle system mute; returns the new state.
#[tauri::command]
pub fn volume_mute_toggle() -> Result<bool, String> {
    #[cfg(windows)]
    {
        crate::volume::toggle_mute()
    }
    #[cfg(not(windows))]
    Ok(false)
}

/// Current media session snapshot, for the dashboard's initial render before
/// the first `media-session` event arrives (poller only emits on change).
#[tauri::command]
pub fn media_current() -> Option<crate::media_session::MediaInfo> {
    crate::media_session::current()
}

/// The user's current Windows accent color, for the dashboard's UI accent
/// fallback (the interface matches the OS theme out of the box).
#[tauri::command]
pub fn system_accent() -> Option<[u8; 3]> {
    crate::sys_theme::get_system_accent()
}

/// The Windows display language as a BCP-47 tag ("es-ES"). The dashboard
/// resolves its own preference against this; the backend does the same for
/// the tray, and both read the same config field so they cannot disagree.
#[tauri::command]
pub fn system_language() -> String {
    crate::i18n::system_language().to_string()
}

/// Parse-check a hotkey accelerator without binding it. The settings UI calls
/// this the moment the user finishes recording a combo, so a combo the OS
/// could never accept is caught before it is written to the config.
#[tauri::command]
pub fn hotkey_validate(accelerator: String) -> Result<(), String> {
    crate::hotkeys::validate(&accelerator)
}

#[cfg(test)]
mod dev_info_tests {
    use super::*;

    /// The panel reads these as strings and shows them verbatim, so the useful
    /// assertions are that each one is populated and points where the user
    /// expects. A version that failed to compile in would show as an empty
    /// field rather than a wrong one.
    #[test]
    fn dev_info_reports_populated_paths_and_version() {
        let info = dev_info();
        assert!(!info.version.is_empty());
        assert!(!info.build_id.is_empty());
        // The invariant is one-directional: a dirty build has to announce it,
        // because a clean-looking id over a dirty tree is the exact ambiguity
        // this field exists to remove. The converse does not hold — a build with
        // no git checkout is legitimately "unknown" and clean.
        assert!(
            !info.build_dirty || info.build_id.ends_with("-dirty"),
            "dirty build reported a clean-looking id: {}",
            info.build_id
        );
        assert!(info.config_path.ends_with("config.json"), "{}", info.config_path);
        assert!(info.log_path.ends_with("lumendeck.log"), "{}", info.log_path);
        assert!(!info.data_dir.is_empty());
        // The log and the config have to be siblings, or "open the data dir"
        // would show half of what the panel describes.
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

    /// The report header is the first line of every pasted bug report, so the
    /// build identity it carries has to be the same one the panel shows. Two
    /// spellings of the same build is how a report becomes unattributable.
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

    /// Whatever the panel prints has to be a level the logger could actually be
    /// set to — it is parsed straight into a filter by whoever reads the report.
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
