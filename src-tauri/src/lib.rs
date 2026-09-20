//! LumenDeck backend library: wallpaper-driven RGB, live wallpapers, stickers.

pub mod bgremove;
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
pub mod mouse_hook;
pub mod pause;
pub mod rgb;
pub mod stickers;
pub mod thumbs;
pub mod wallpaper;
pub mod wallpaper_bg;
pub mod win32;
pub mod workerw;

#[cfg(not(windows))]
compile_error!("LumenDeck currently targets Windows only.");

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
fn disable_video_overlays() {
    let extra = "--disable-direct-composition-video-overlays --disable-hardware-video-decode";
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

    struct DualLog(Mutex<Option<std::fs::File>>);

    impl log::Log for DualLog {
        fn enabled(&self, metadata: &log::Metadata) -> bool {
            metadata.level() <= log::max_level()
        }
        fn log(&self, record: &log::Record) {
            if !self.enabled(record.metadata()) {
                return;
            }
            let secs = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let line = format!(
                "[{secs} {:<5} {}] {}\n",
                record.level(),
                record.target(),
                record.args()
            );
            eprint!("{line}");
            if let Ok(mut guard) = self.0.lock() {
                if let Some(f) = guard.as_mut() {
                    let _ = f.write_all(line.as_bytes());
                }
            }
        }
        fn flush(&self) {}
    }

    let file = config_store::config_path()
        .parent()
        .map(|dir| {
            let _ = std::fs::create_dir_all(dir);
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
    let _ = log::set_boxed_logger(Box::new(DualLog(Mutex::new(file))));
}

pub fn app_handle() -> Option<tauri::AppHandle> {
    APP.get().cloned()
}

pub fn run() {
    // Must run before any WebView2 environment is created.
    disable_video_overlays();
    init_logging();
    let _ = config_store::init();
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
    // removal existed (no-op when everything is already processed).
    crate::stickers::spawn_bg_removal_pass();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
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
            ipc::get_wallpaper_payload,
            ipc::log_sticker_render,
            ipc::begin_sticker_editor,
            ipc::end_sticker_editor,
            ipc::get_wallpaper_info,
            ipc::apply_wallpaper,
            ipc::gallery_add,
            ipc::gallery_remove,
            ipc::gallery_apply,
            ipc::gallery_import_folder,
            ipc::gallery_import_paths,
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
            ipc::add_sticker,
            ipc::update_sticker,
            ipc::remove_sticker,
            ipc::is_paused,
            ipc::monitors,
            ipc::quit
        ])
        .setup(|app| {
            let _ = APP.set(app.handle().clone());

            // Apply autostart preference.
            use tauri_plugin_autostart::ManagerExt;
            let autostart = config_store::get().general.autostart;
            let manager = app.autolaunch();
            let _ = if autostart {
                manager.enable()
            } else {
                manager.disable()
            };

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
                        crate::mouse_hook::disarm();
                        app.exit(0);
                    }
                    "edit" => {
                        // No edit mode without sticker windows; arrangement is
                        // numeric in the dashboard.
                    }
                    "dashboard" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // First-run: create dashboard + wallpaper.
            let cfg = config_store::get();
            if cfg.general.wallpaper_enabled {
                if let Err(e) = wallpaper::ensure(app.handle()) {
                    log::warn!("initial wallpaper attach failed: {e}");
                }
            }
            thumbs::spawn_gallery_thumb_worker();
            crate::config_watch::spawn();
            display_watch::snapshot();
            display_watch::spawn();
            pause::spawn();
            crate::mouse_hook::spawn();
            crate::mouse_hook::spawn_keyboard_hook();
            crate::idle::spawn();
            #[cfg(debug_assertions)]
            dev_watchdog::spawn(app.handle().clone());

            // Main dashboard window.
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("main-app.html".into()),
            )
            .title("LumenDeck")
            .inner_size(1100.0, 760.0)
            .min_inner_size(900.0, 640.0)
            .resizable(true)
            .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running LumenDeck");
}
