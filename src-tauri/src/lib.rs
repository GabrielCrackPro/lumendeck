//! LumenDeck backend library: wallpaper-driven RGB, live wallpapers, stickers.

pub mod bgremove;
pub mod balloon;
pub mod config;
pub mod config_store;
pub mod config_watch;
pub mod constants_sticker;
pub mod dev_watchdog;
pub mod display_watch;
pub mod error;
pub mod events;
pub mod idle;
pub mod ipc;
pub mod media;
pub mod media_session;
pub mod mouse_hook;
pub mod pause;
pub mod placement_overlay;
pub mod playlist;
pub mod rgb;
pub mod stickers;
pub mod sys_theme;
pub mod sticker_windows;
pub mod taskbar_thumbnail;
pub mod thumbs;
pub mod tray;
pub mod wallpaper;
pub mod wallpaper_bg;
pub mod win32;
pub mod window_utils;
pub mod workerw;

#[cfg(not(windows))]
compile_error!("LumenDeck currently targets Windows only.");

/// Argument appended to the autostart registration. A boot launch should
/// light up the wallpaper and lighting and then get out of the way: the tray
/// icon is the only window the user needs to see, so setup() builds the
/// dashboard but leaves it hidden until they ask for it.
const START_HIDDEN_ARG: &str = "--minimized";

/// True when this process was started by Windows at logon rather than by a
/// double-click. Existing installs were registered without the flag, so
/// setup() re-writes the Run key with it on the next launch.
fn launched_at_autostart() -> bool {
    std::env::args().any(|a| a == START_HIDDEN_ARG)
}

/// Whether this launch should come up in the tray instead of showing the
/// dashboard. A login start is quiet unless the user asked otherwise; a
/// manual start always shows the window, however the setting is configured.
fn start_hidden(general: &crate::config::GeneralConfig, at_login: bool) -> bool {
    at_login && !general.show_dashboard_on_login
}

/// The first time LumenDeck comes up silently, say so. Without this, a tray
/// icon and a changed wallpaper are easy to miss on a fresh boot, and the
/// obvious question — where did the window go? — has no answer. Shown once,
/// ever; clicking it opens the dashboard.
fn first_hidden_start_hint(app: &tauri::AppHandle) {
    if config_store::get().general.startup_hint_shown {
        return;
    }
    // Mark it before showing, not after: if the shell refuses the balloon,
    // nagging on every single boot is worse than never saying anything.
    let mut cfg = config_store::get();
    cfg.general.startup_hint_shown = true;
    if let Err(e) = config_store::set(cfg) {
        log::warn!("startup hint: could not record that it was shown: {e}");
    }

    let app = app.clone();
    balloon::spawn(
        "LumenDeck is running in the background",
        "Your wallpaper and lights are live. Click here to open the dashboard, \
         or turn on \"Show the dashboard at login\" in settings.",
        move || {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.unminimize();
                let _ = main.show();
                let _ = main.set_focus();
            }
        },
    );
}

use std::sync::OnceLock;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// WebView2 promotes playing <video> elements to DirectComposition hardware
/// overlays, which paint ABOVE all other DOM content — stickers layered over
/// a video wallpaper silently vanish (DOM reports them rendered; pixels show
/// only the video). Disabling video overlays keeps the video in the normal
/// compositing tree so the sticker layer can stack over it.
///
/// Note: hardware video DECODE stays enabled. Software-decoding 4K wallpaper
/// loops stalls the pipeline and Chromium tears it down with recurring
/// PIPELINE_ERROR_DISCONNECTED / PIPELINE_ERROR_DECODE errors.
fn disable_video_overlays() {
    // CalculateNativeWinOcclusion is the other half of wallpaper viability:
    // once the video window sits behind the desktop icons (as it must),
    // Chromium's occlusion tracker sees it as fully covered and backgrounds
    // the renderer — pausing <video> and rAF loops. The wallpaper webview
    // must always believe it is visible.
    let mut extra = "--disable-direct-composition-video-overlays \
--disable-features=CalculateNativeWinOcclusion"
        .to_string();
    // Optional low-end fallback: software decode is light on GPU but burns
    // CPU and destabilizes 4K pipelines — off by default (General tab).
    if let Ok(cfg) = std::fs::read_to_string(config_store::config_path()) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&cfg) {
            if parsed["general"]["softwareVideoDecode"].as_bool() == Some(true) {
                extra.push_str(" --disable-hardware-video-decode");
            }
        }
    }
    match std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
        Some(existing) => {
            let merged = format!(
                "{} {}",
                existing.to_string_lossy(),
                extra
            );
            std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", merged);
        }
        None => std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", extra),
    }
}

/// Dual logger: stderr (visible in `tauri dev`) plus a log file next to the
/// config (`%APPDATA%/LumenDeck/lumendeck.log`) so behavior is always
/// observable, even for packaged runs.
fn init_logging() {
    use std::fs::OpenOptions;
    use std::io::Write as _;
    use std::sync::Mutex;
    use std::sync::atomic::AtomicU64;

    /// Max log size before rotating (5 MB), shared by startup and runtime checks.
    pub const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

    struct DualLog {
        file: Mutex<Option<std::fs::File>>,
        /// Bytes written since the last size check (cheaper than stat per line).
        written: AtomicU64,
    }

    impl DualLog {
        /// Rotate when the file has grown past the cap. Called at most every
        /// ~256 KB of written output, not per line.
        fn maybe_rotate(&self) {
            let written = self.written.load(std::sync::atomic::Ordering::Relaxed);
            if written < 256 * 1024 {
                return;
            }
            self.written.store(0, std::sync::atomic::Ordering::Relaxed);
            let Some(dir) = config_store::config_path().parent().map(|p| p.to_path_buf()) else {
                return;
            };
            let path = dir.join("lumendeck.log");
            let Ok(meta) = std::fs::metadata(&path) else {
                return;
            };
            if meta.len() <= MAX_LOG_BYTES {
                return;
            }
            // Reopen: rotate_log_if_large renames the file; keep writing to a
            // fresh handle so the old file stays self-contained for inspection.
            if rotate_log_if_large(&dir) {
                if let Ok(new) = OpenOptions::new().create(true).append(true).open(&path) {
                    if let Ok(mut slot) = self.file.lock() {
                        *slot = Some(new);
                    }
                }
            }
        }
    }

    impl log::Log for DualLog {
        fn enabled(&self, metadata: &log::Metadata) -> bool {
            metadata.level() <= log::max_level()
        }
        fn log(&self, record: &log::Record) {
            if !self.enabled(record.metadata()) {
                return;
            }
            self.maybe_rotate();
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default();
            let secs = now.as_secs();
            let millis = now.subsec_millis();

            // Short module: last segment only ("lumendeck_lib::ipc" → "ipc")
            let target = record
                .target()
                .rsplit_once("::")
                .map_or(record.target(), |(_, s)| s);

            let ts = format!(
                "{}.{:03}",
                chrono_datetime(secs),
                millis,
            );

            let line = format!(
                "[{ts} {:<5} {target}] {}\n",
                record.level(),
                record.args(),
            );

            // stderr with ANSI colors
            let colored = match record.level() {
                log::Level::Info  => format!("[\x1b[36m{ts}\x1b[0m \x1b[32mINFO \x1b[0m \x1b[90m{target}\x1b[0m] {}\n", record.args()),
                log::Level::Warn  => format!("[\x1b[36m{ts}\x1b[0m \x1b[33mWARN \x1b[0m \x1b[90m{target}\x1b[0m] {}\n", record.args()),
                log::Level::Error => format!("[\x1b[36m{ts}\x1b[0m \x1b[31mERROR\x1b[0m \x1b[90m{target}\x1b[0m] {}\n", record.args()),
                log::Level::Debug => format!("[\x1b[36m{ts}\x1b[0m \x1b[35mDEBUG\x1b[0m \x1b[90m{target}\x1b[0m] {}\n", record.args()),
                _ => line.clone(),
            };
            eprint!("{colored}");

            if let Ok(mut guard) = self.file.lock() {
                if let Some(f) = guard.as_mut() {
                    let _ = f.write_all(line.as_bytes());
                    self.written.fetch_add(line.len() as u64, std::sync::atomic::Ordering::Relaxed);
                }
            }
        }
        fn flush(&self) {}
    }

    let file = config_store::config_path()
        .parent()
        .map(|dir| {
            let _ = std::fs::create_dir_all(dir);
            rotate_log_if_large(dir);
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join("lumendeck.log"))
                .ok()
        })
        .flatten();

    let level = std::env::var("RUST_LOG")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(log::LevelFilter::Info);
    log::set_max_level(level);
    let _ = log::set_boxed_logger(Box::new(DualLog {
        file: Mutex::new(file),
        written: std::sync::atomic::AtomicU64::new(0),
    }));
}

/// Keep the log bounded: past the cap, the current file becomes `.old` (one
/// generation kept) and a fresh log starts. Returns true when a rotation
/// happened (the logger then reopens its handle).
fn rotate_log_if_large(dir: &std::path::Path) -> bool {
    let path = dir.join("lumendeck.log");
    let Ok(meta) = std::fs::metadata(&path) else {
        return false;
    };
    if meta.len() <= 5 * 1024 * 1024 {
        return false;
    }
    let old = dir.join("lumendeck.log.old");
    let _ = std::fs::remove_file(&old);
    match std::fs::rename(&path, &old) {
        Ok(()) => {
            eprintln!("[lumendeck] log rotated ({} MB) -> lumendeck.log.old", meta.len() / 1024 / 1024);
            true
        }
        Err(_) => false,
    }
}

/// Convert unix epoch seconds to `HH:MM:SS` (UTC) without pulling in chrono.
fn chrono_datetime(secs: u64) -> String {
    let days = secs / 86400;
    let time = secs % 86400;
    let h = time / 3600;
    let m = (time % 3600) / 60;
    let s = time % 60;
    // Civil date from days since epoch (1970-01-01 is day 0, a Thursday).
    let (y, mo, d) = days_to_ymd(days + 719468);
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{m:02}:{s:02}")
}

fn days_to_ymd(g: u64) -> (u64, u64, u64) {
    let y = (10000 * g + 14780) / 3652425;
    let mut doy = g - (365 * y + y / 4 - y / 100 + y / 400);
    if doy > 365 {
        doy += 1;
    }
    let mi = (100 * doy + 52) / 3060;
    let mo = (mi + 2) % 12 + 1;
    let y = y + (mi + 2) / 12;
    let d = doy - (mi * 306 + 5) / 10 + 1;
    (y, mo, d)
}

pub fn app_handle() -> Option<tauri::AppHandle> {
    APP.get().cloned()
}

pub fn run() {
    let boot = std::time::Instant::now();
    init_logging();
    let _ = config_store::init();
    // Must run before any WebView2 environment is created (and after config
    // init so the software-decode preference can be read from disk).
    disable_video_overlays();
    // Gallery entries and sticker sources must stay servable across restarts.
    crate::media::allow_thumbs_dir();
    for g in &config_store::get().gallery {
        match g.kind {
            crate::config::WallpaperKind::Slideshow | crate::config::WallpaperKind::Web | crate::config::WallpaperKind::Shader => {}
            _ => crate::media::allow_root(std::path::Path::new(&g.source)),
        }
    }
    for s in &config_store::get().stickers {
        crate::media::allow_media_ref(&s.url);
    }
    // Generate transparent variants for stickers placed before background
    // removal existed (no-op when everything is already processed). Runs on a
    // background thread — never blocks the first webview paint.
    crate::stickers::spawn_bg_removal_pass();
    log::info!("startup: pre-tauri init done in {:?}", boot.elapsed());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(main) = app.get_webview_window("main") {
                // The first instance may be sitting in the tray (autostart,
                // or a minimize-to-tray hide), so restore it properly.
                let _ = main.unminimize();
                let _ = main.show();
                let _ = main.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // Windows runs the exe straight out of the Run key, so this flag
            // is the only way setup() can tell a boot launch from a manual
            // one. See START_HIDDEN_ARG below.
            Some(vec![START_HIDDEN_ARG]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Serve local media to webviews over http://media.localhost (WebView2
        // treats custom schemes this way, which enables range requests).
        .register_uri_scheme_protocol("media", |_ctx, request| {
            use std::borrow::Cow;
            let resp = media::handle(request);
            resp.map(|body| Cow::Owned(body))
        })
        .manage(rgb::EngineState::new())
        .invoke_handler(tauri::generate_handler![
            ipc::get_config,
            ipc::set_config,
            ipc::reload_config,
            ipc::log_sticker_render,
            ipc::log_frontend,
            ipc::begin_sticker_editor,
            ipc::end_sticker_editor,
            ipc::get_wallpaper_info,
            ipc::apply_wallpaper,
            ipc::gallery_add,
            ipc::gallery_remove,
            ipc::gallery_apply,
            ipc::gallery_apply_monitor,
            ipc::gallery_import_folder,
            ipc::gallery_import_paths,
            ipc::gallery_add_from_url,
            ipc::set_wallpaper_enabled,
            ipc::pick_media_file,
            ipc::pick_media_folder,
            ipc::list_images,
            ipc::rgb_status,
            ipc::rgb_refresh,
            ipc::send_zone_samples,
            ipc::update_rgb_config,
            ipc::begin_sticker_placement,
            ipc::cancel_sticker_placement,
            ipc::get_placement_info,
            ipc::placement_resize,
            ipc::placement_set_interactive,
            ipc::placement_place_at,
            ipc::add_sticker,
            ipc::update_sticker,
            ipc::remove_sticker,
            ipc::duplicate_sticker,
            ipc::reorder_sticker,
            ipc::is_paused,
            ipc::toggle_pause,
            ipc::minimize_window,
            ipc::set_live_frame,
            ipc::monitors,
            ipc::quit,
            ipc::factory_reset,
            ipc::collection_create,
            ipc::collection_rename,
            ipc::collection_delete,
            ipc::collection_toggle_entry,
            ipc::playlist_create,
            ipc::playlist_save,
            ipc::playlist_delete,
            ipc::playlist_set_active,
            ipc::scene_save,
            ipc::scene_apply,
            ipc::scene_delete,
            ipc::scene_rename,
            ipc::media_transport,
            ipc::media_current
        ])
        .setup(|app| {
            let setup_at = std::time::Instant::now();
            let _ = APP.set(app.handle().clone());

            // Apply autostart preference.
            use tauri_plugin_autostart::ManagerExt;
            let autostart = config_store::get().general.autostart;
            let manager = app.autolaunch();
            let result = if autostart {
                manager.enable()
            } else {
                manager.disable()
            };
            if let Err(e) = result {
                log::warn!("autostart: could not apply preference: {e}");
            } else {
                log::debug!("autostart: preference applied ({})", autostart);
            }

            // Tray icon.
            let dashboard =
                MenuItem::with_id(app, "dashboard", "Open LumenDeck", true, None::<&str>)?;
            let edit = MenuItem::with_id(app, "edit", "Edit stickers", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit LumenDeck", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&dashboard, &edit, &quit])?;
            let tray_builder = TrayIconBuilder::with_id("lumendeck-tray")
                .tooltip("LumenDeck")
                .menu(&menu);
            let tray_builder = if let Some(icon) = app.default_window_icon() {
                tray_builder.icon(icon.clone())
            } else {
                tray_builder
            };
            tray_builder
                .on_menu_event(|app, ev| match ev.id.as_ref() {
                    "quit" => {
                        // Leave the OS desktop showing the current scene.
                        crate::wallpaper_bg::ensure_installed_before_exit();
                        crate::mouse_hook::disarm();
                        app.cleanup_before_exit();
                        app.exit(0);
                    }
                    "edit" => {
                        // No edit mode without sticker windows; arrangement is
                        // numeric in the dashboard.
                    }
                    "dashboard" => {
                        if let Some(w) = app.get_webview_window("main") {
                            // unminimize + show: the window may be hidden
                            // (closed-to-tray) or minimized when reopened.
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    other => crate::tray::on_menu_event(app, other),
                })
                // Left-click on the tray icon toggles the dashboard (the
                // standard expectation; the context menu stays on right-click).
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.unminimize();
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;
            crate::tray::refresh(app.handle());

            // First-run: create dashboard + wallpaper.
            let cfg = config_store::get();
            if cfg.general.wallpaper_enabled {
                if let Err(e) = wallpaper::ensure(app.handle()) {
                    log::warn!("initial wallpaper attach failed: {e}");
                }
            }
            thumbs::spawn_gallery_thumb_worker();
            crate::config_watch::spawn();
            crate::playlist::spawn();
            display_watch::snapshot();
            display_watch::spawn();
            pause::spawn();
            crate::mouse_hook::spawn();
            crate::mouse_hook::spawn_keyboard_hook();
            crate::idle::spawn();
            #[cfg(debug_assertions)]
            dev_watchdog::spawn(app.handle().clone());

            // Main dashboard window — frameless: the UI draws its own
            // titlebar (drag region + window controls) matching the glass
            // design. Resizing stays native via WM_NCHITTEST handled by tao.
            let mut main_window_builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("main-app.html".into()),
            )
            .title("LumenDeck")
            .inner_size(1100.0, 760.0)
            .min_inner_size(900.0, 640.0)
            .resizable(true)
            .decorations(false)
            .visible(false);
            if let Some(icon) = app.default_window_icon() {
                main_window_builder = main_window_builder.icon(icon.clone())?;
            }
            let main_window = main_window_builder.build()?;
            if let Err(e) = taskbar_thumbnail::attach(&main_window) {
                log::warn!("taskbar thumbnail buttons unavailable: {e}");
            }
            // Autostart launches come up in the tray only — the window is
            // built (so the webview warms up and the taskbar thumbnail is
            // ready) but never shown. The tray icon is built above, so the
            // app is always one left-click away. Users who want the window
            // at login opt back in from General.
            let hidden_at_start = start_hidden(
                &config_store::get().general,
                launched_at_autostart(),
            );
            if hidden_at_start {
                log::info!("startup: autostart launch — starting in the tray");
                first_hidden_start_hint(app.handle());
            } else {
                main_window.show()?;
            }

            // Close-to-tray: the dashboard X hides the window (wallpapers and
            // RGB keep running); the tray's "Quit LumenDeck" is the real exit.
            // This matches wallpaper/lighting apps, where quitting via X would
            // otherwise leave the tray-only app undiscoverable or kill the
            // wallpaper the user expects to keep.
            if let Some(win) = app.get_webview_window("main") {
                let win_handle = win.clone();
                win.on_window_event(move |ev| match ev {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = win_handle.hide();
                    }
                    // The titlebar's minimize button routes through the
                    // `minimize_window` command, but Windows can minimize us
                    // on its own (taskbar button, Win+D, snap layouts). Catch
                    // those here so "minimize to tray" means what it says.
                    // The resize event is the reliable signal; the reported
                    // size is the *restored* rect, not 0x0, so ask the window
                    // whether it is actually minimized. A hidden window is
                    // never "minimized", which keeps this from re-firing.
                    tauri::WindowEvent::Resized(_)
                        if win_handle.is_minimized().unwrap_or(false)
                            && config_store::get().general.minimize_to_tray =>
                    {
                        let _ = win_handle.hide();
                    }
                    _ => {}
                });
            }

            log::info!("startup: tauri setup done in {:?}", setup_at.elapsed());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running LumenDeck");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::GeneralConfig;

    #[test]
    fn manual_launch_always_shows_the_dashboard() {
        for show_on_login in [true, false] {
            let mut g = GeneralConfig::default();
            g.show_dashboard_on_login = show_on_login;
            assert!(!start_hidden(&g, false));
        }
    }

    #[test]
    fn login_launch_is_tray_only_unless_opted_in() {
        let quiet = GeneralConfig::default();
        assert!(start_hidden(&quiet, true), "the default boot is tray-only");

        let mut loud = GeneralConfig::default();
        loud.show_dashboard_on_login = true;
        assert!(!start_hidden(&loud, true));
    }
}
