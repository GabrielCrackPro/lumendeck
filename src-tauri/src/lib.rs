
pub mod notify;
pub mod panic;
pub mod bgremove;
pub mod config;
pub mod config_store;
pub mod config_watch;
pub mod dev_watchdog;
pub mod display_watch;
pub mod error;
pub mod events;
pub mod hotkeys;
pub mod idle;
pub mod ipc;
pub mod account;
rust_i18n::i18n!("../locales");

pub mod i18n;
pub mod tokens;
pub mod media;
pub mod media_session;pub mod mouse_hook;
pub mod pause;
pub mod perf;
pub mod placement_overlay;
pub mod playlist;
pub mod rgb;
pub mod accent_watch;
pub mod logfmt;
pub mod logtail;
pub mod stickers;
pub mod sys_theme;
pub mod autostart;
pub mod lock_screen;
pub mod lock_screen_reg;
pub mod sticker_windows;
pub mod taskbar_thumbnail;
pub mod openrgb_setup;
pub mod thumbs;
pub mod transfer;
pub mod transfer_archive;
pub mod transfer_bundle;
pub mod tray;
pub mod wallpaper;
pub mod volume;
pub mod wallpaper_bg;
pub mod win32;
pub mod window_chrome;
pub mod window_constraints;
pub mod window_utils;
pub mod workerw;

#[cfg(not(windows))]
compile_error!("LumenDeck currently targets Windows only.");

pub(crate) const START_HIDDEN_ARG: &str = "--minimized";

fn launched_at_autostart() -> bool {
    std::env::args().any(|a| a == START_HIDDEN_ARG)
}

fn start_hidden(general: &crate::config::GeneralConfig, at_login: bool) -> bool {
    at_login && !general.show_dashboard_on_login
}

fn first_hidden_start_hint(app: &tauri::AppHandle) {
    let mut cfg = config_store::get();
    if cfg.general.startup_hint_shown {
        return;
    }
    cfg.general.startup_hint_shown = true;
    let body = startup_hint_body(&cfg, crate::wallpaper::is_paused());
    if let Err(e) = config_store::set(cfg) {
        log::warn!("startup hint: could not record that it was shown: {e}");
    }

    let title = crate::i18n::t("tray.balloon-title");
    crate::notify::notify(&app, &title, &body);
}

fn startup_hint_key(cfg: &crate::config::Config, paused: bool) -> &'static str {
    if paused {
        return "tray.balloon-paused";
    }
    match (cfg.general.wallpaper_enabled, cfg.rgb.enabled) {
        (true, true) => "tray.balloon-all-live",
        (true, false) => "tray.balloon-wallpaper-live",
        (false, true) => "tray.balloon-lights-live",
        (false, false) => "tray.balloon-ready",
    }
}

fn startup_hint_body(cfg: &crate::config::Config, paused: bool) -> String {
    crate::i18n::t(startup_hint_key(cfg, paused))
}

use std::sync::OnceLock;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_window_state::AppHandleExt;

const fn window_state_flags() -> tauri_plugin_window_state::StateFlags {
    use tauri_plugin_window_state::StateFlags;
    StateFlags::SIZE.union(StateFlags::POSITION).union(StateFlags::MAXIMIZED)
}

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

fn disable_video_overlays() {
    let mut extra = "--disable-direct-composition-video-overlays \
--disable-features=CalculateNativeWinOcclusion"
        .to_string();
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

fn init_logging() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_log::{Target, TargetKind};

    let dir = config_store::data_dir();
    let _ = std::fs::create_dir_all(&dir);

    tauri_plugin_log::Builder::new()
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::Folder {
                path: dir,
                file_name: config_store::log_path()
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string()),
            }),
        ])
        .max_file_size(MAX_LOG_BYTES)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
        .format(|out, message, record| {
            let short_target = record
                .target()
                .rsplit_once("::")
                .map_or(record.target(), |(_, s)| s);
            out.finish(format_args!(
                "[{} {:<5} {}] {}",
                local_timestamp(),
                record.level(),
                short_target,
                message
            ))
        })
        .level(log_level())
        .build()
}

fn main_window_title() -> String {
    window_title(cfg!(debug_assertions), env!("CARGO_PKG_VERSION"))
}

fn window_title(is_dev: bool, version: &str) -> String {
    if is_dev && !version.is_empty() {
        format!("LumenDeck \u{2014} {version}")
    } else {
        "LumenDeck".to_string()
    }
}

pub fn log_level() -> log::LevelFilter {
    std::env::var("RUST_LOG")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(log::LevelFilter::Info)
}

pub const MAX_LOG_BYTES: u128 = 5 * 1024 * 1024;

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default()
}

fn local_timestamp() -> String {
    use windows::Win32::Foundation::SYSTEMTIME;
    use windows::Win32::System::SystemInformation::GetLocalTime;
    let st: SYSTEMTIME = unsafe { GetLocalTime() };
    let ms = now_millis();
    logfmt::timestamp(&logfmt::WallClock {
        year: st.wYear as u64,
        month: st.wMonth as u64,
        day: st.wDay as u64,
        hour: st.wHour as u64,
        minute: st.wMinute as u64,
        second: st.wSecond as u64,
        millis: (ms % 1_000) as u64,
    })
}

pub fn app_handle() -> Option<tauri::AppHandle> {
    APP.get().cloned()
}

pub fn run() {
    let boot = std::time::Instant::now();
    let logger = init_logging();
    crate::panic::install();
    let _ = config_store::init();
    disable_video_overlays();
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
    crate::stickers::spawn_bg_removal_pass();
    log::info!("startup: pre-tauri init done in {:?}", boot.elapsed());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.unminimize();
                let _ = main.show();
                let _ = main.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(logger)
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_filter(|label| label == "main")
                .with_state_flags(window_state_flags())
                .build(),
        )
        .register_uri_scheme_protocol("media", |_ctx, request| {
            use std::borrow::Cow;
            let resp = media::handle(request);
            resp.map(|body| Cow::Owned(body))
        })
        .manage(rgb::EngineState::new())
        .invoke_handler(tauri::generate_handler![
            ipc::get_config,
            ipc::perf_snapshot,
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
            ipc::pick_media_files,
            ipc::gallery_set_opts,
            ipc::gallery_set_favorite,
            ipc::reveal_in_folder,
            ipc::clipboard_url,
            ipc::vault_missing,
            ipc::gallery_regenerate_thumb,
            ipc::pick_image_file,
            ipc::pick_media_folder,
            ipc::list_images,
            ipc::rgb_status,
            ipc::openrgb_status,
            ipc::openrgb_install,
            ipc::openrgb_launch,
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
            ipc::system_language,
            ipc::account_name,
            ipc::set_live_frame,
            ipc::monitors,
            ipc::quit,
            ipc::factory_reset,
            ipc::collection_create,
            ipc::collection_rename,
            ipc::collection_delete,
            ipc::collection_toggle_entry,
            ipc::collection_add_entries,
            ipc::playlist_create,
            ipc::playlist_save,
            ipc::playlist_delete,
            ipc::playlist_set_active,
            ipc::scene_save,
            ipc::scene_apply,
            ipc::scene_delete,
            ipc::scene_rename,
            ipc::scene_set_logo,
            ipc::transfer_pick_save_path,
            ipc::transfer_pick_open_path,
            ipc::transfer_export,
            ipc::transfer_preview,
            ipc::transfer_import,
            ipc::media_transport,
            ipc::media_seek,
            ipc::media_shuffle,
            ipc::media_repeat,
            ipc::volume_get,
            ipc::volume_set,
            ipc::volume_mute_toggle,
            ipc::media_current,
            ipc::system_accent,
            ipc::hotkey_validate,
            ipc::reveal_log,
            ipc::log_tail,
            ipc::dev_info,
            ipc::vault_stamps
        ])
        .setup(|app| {
            let setup_at = std::time::Instant::now();
            let _ = APP.set(app.handle().clone());

            crate::sys_theme::spawn_accent_watcher(app.handle().clone());
            crate::volume::spawn_watcher(app.handle().clone());

            crate::perf::start();

            if !config_store::get().general.lock_screen_follows_wallpaper {
                crate::lock_screen_reg::release();
            }

            if let Err(e) = crate::autostart::apply(
                app.handle(),
                config_store::get().general.autostart,
            ) {
                log::warn!("autostart: could not apply preference: {e}");
            }

            let dashboard =
                MenuItem::with_id(app, "dashboard", "Open LumenDeck", true, None::<&str>)?;
            let edit = MenuItem::with_id(app, "edit", "Edit stickers", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit LumenDeck", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&dashboard, &edit, &quit])?;
            let tray_builder = TrayIconBuilder::with_id("lumendeck-tray")
                .tooltip(crate::tray::current_tooltip())
                .menu(&menu);
            let tray_builder = if let Some(icon) = app.default_window_icon() {
                tray_builder.icon(icon.clone())
            } else {
                tray_builder
            };
            tray_builder
                .on_menu_event(|app, ev| match ev.id.as_ref() {
                    "quit" => {
                        crate::wallpaper_bg::ensure_installed_before_exit();
                        crate::mouse_hook::disarm();
                        app.cleanup_before_exit();
                        app.exit(0);
                    }
                    "edit" => {
                    }
                    "dashboard" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    other => crate::tray::on_menu_event(app, other),
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                        crate::tray::toggle_dashboard(tray.app_handle());
                    }
                })
                .build(app)?;
            crate::tray::refresh(app.handle());
            let hotkeys_cfg = &config_store::get().general;
            crate::hotkeys::sync(app.handle(), hotkeys_cfg.hotkeys_enabled, &hotkeys_cfg.hotkeys);

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

            let mut main_window_builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("main-app.html".into()),
            )
            .title(main_window_title())
            .inner_size(
                window_constraints::DEFAULT_LOGICAL_WIDTH,
                window_constraints::DEFAULT_LOGICAL_HEIGHT,
            )
            .min_inner_size(
                window_constraints::min_inner_size().0,
                window_constraints::min_inner_size().1,
            )
            .resizable(true)
            .decorations(false)
            .visible(false)
            .devtools(crate::window_utils::devtools_allowed());
            if let Some(icon) = app.default_window_icon() {
                main_window_builder = main_window_builder.icon(icon.clone())?;
            }
            let main_window = main_window_builder.build()?;

            fn apply_constraints(win: &tauri::WebviewWindow) -> tauri::Result<()> {
                use window_constraints::RestoredSize;
                let scale = win.scale_factor().unwrap_or(1.0);
                let monitor = win.current_monitor()?.or_else(|| {
                    win.available_monitors().ok().and_then(|ms| {
                        ms.into_iter()
                            .find(|m| m.position().x == 0 && m.position().y == 0)
                    })
                });
                let work_area = monitor
                    .map(|m| {
                        let area = m.work_area();
                        (
                            area.position.x,
                            area.position.y,
                            area.size.width,
                            area.size.height,
                        )
                    })
                    .unwrap_or((i32::MIN, i32::MIN, u32::MAX, u32::MAX));
                let pos = win.outer_position().ok().map(|p| (p.x, p.y));
                let size = win.inner_size().ok().map(|s| (s.width, s.height));
                match window_constraints::plan_restore(size, pos, scale, work_area) {
                    RestoredSize::Clamp(w, h) => {
                        win.set_size(tauri::LogicalSize::new(w, h))?;
                    }
                    RestoredSize::Defaults => {
                        log::info!("startup: saved window geometry unusable; using defaults");
                    }
                }
                Ok(())
            }
            if let Err(e) = apply_constraints(&main_window) {
                log::debug!("window constraints not applied at startup: {e}");
            }

            crate::window_chrome::apply(&main_window);
            if let Err(e) = taskbar_thumbnail::attach(&main_window) {
                log::warn!("taskbar thumbnail buttons unavailable: {e}");
            }
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

            if let Some(win) = app.get_webview_window("main") {
                let win_handle = win.clone();

                fn save_now(handle: &tauri::AppHandle) {
                    if let Err(e) = handle.save_window_state(window_state_flags()) {
                        log::debug!("window state not saved: {e}");
                    }
                }
                let save_pending = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                let save_handle = app.handle().clone();
                let schedule_window_state_save = move || {
                    if save_pending.swap(true, std::sync::atomic::Ordering::SeqCst) {
                        return;
                    }
                    let pending = save_pending.clone();
                    let handle = save_handle.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(800));
                        pending.store(false, std::sync::atomic::Ordering::SeqCst);
                        save_now(&handle);
                    });
                };
                let close_handle = app.handle().clone();

                win.on_window_event(move |ev| match ev {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        save_now(&close_handle);
                        api.prevent_close();
                        let _ = win_handle.hide();
                    }
                    tauri::WindowEvent::Resized(_)
                        if win_handle.is_minimized().unwrap_or(false)
                            && config_store::get().general.minimize_to_tray =>
                    {
                        save_now(&close_handle);
                        let _ = win_handle.hide();
                    }
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                        if let (Ok(size), Ok(scale)) =
                            (win_handle.inner_size(), win_handle.scale_factor())
                        {
                            let lw = size.width as f64 / scale;
                            let lh = size.height as f64 / scale;
                            if lw + 0.5 < window_constraints::MIN_LOGICAL_WIDTH
                                || lh + 0.5 < window_constraints::MIN_LOGICAL_HEIGHT
                            {
                                let (w, h) =
                                    window_constraints::clamp_to_min(lw, lh);
                                let _ =
                                    win_handle.set_size(tauri::LogicalSize::new(w, h));
                            }
                        }
                        schedule_window_state_save();
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

    #[test]
    fn startup_hint_only_claims_what_is_actually_running() {
        let _guard = crate::i18n::test_locale_lock();
        let mut cfg = crate::config::Config::default();
        for (wallpaper, lights) in [
            (true, true),
            (true, false),
            (false, true),
            (false, false),
        ] {
            cfg.general.wallpaper_enabled = wallpaper;
            cfg.rgb.enabled = lights;
            let body = crate::i18n::t_in_locked("en", startup_hint_key(&cfg, false));
            assert!(body.ends_with("Click to open the dashboard."), "{body}");
            assert_eq!(body.contains("wallpaper"), wallpaper, "{body}");
            assert_eq!(body.contains("lights"), lights, "{body}");
        }
    }

    #[test]
    fn a_paused_start_says_nothing_is_moving() {
        let cfg = crate::config::Config::default();
        let body = crate::i18n::t_in("en", startup_hint_key(&cfg, true));
        assert!(!body.contains("live"), "{body}");
        assert!(body.contains("paused"), "{body}");
    }

    #[test]
    fn the_localised_hint_comes_from_the_catalog() {
        let cfg = crate::config::Config::default();
        let key = startup_hint_key(&cfg, false);
        let localised = startup_hint_body(&cfg, false);
        assert!(!localised.is_empty());
        assert_eq!(localised, crate::i18n::t(key));
        assert!(
            localised.contains("dashboard") || localised.contains("panel"),
            "the hint lost its call to action: {localised}"
        );
    }

    #[test]
    fn every_startup_hint_state_resolves() {
        let _guard = crate::i18n::test_locale_lock();
        for wallpaper_on in [true, false] {
            for lights_on in [true, false] {
                for paused in [true, false] {
                    let mut cfg = crate::config::Config::default();
                    cfg.general.wallpaper_enabled = wallpaper_on;
                    cfg.rgb.enabled = lights_on;
                    for locale in crate::i18n::SUPPORTED {
                        let body = crate::i18n::t_in_locked(
                            locale,
                            startup_hint_key(&cfg, paused),
                        );
                        assert!(
                            !body.is_empty(),
                            "empty {locale} hint for wallpaper={wallpaper_on} lights={lights_on} paused={paused}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn release_window_title_carries_no_version() {
        assert_eq!(window_title(false, "0.2.7"), "LumenDeck");
    }

    #[test]
    fn dev_window_title_carries_the_version() {
        let title = window_title(true, "0.2.7");
        assert!(title.starts_with("LumenDeck"), "{title}");
        assert!(title.contains("0.2.7"), "{title}");
    }

    #[test]
    fn dev_window_title_omits_an_empty_version() {
        assert_eq!(window_title(true, ""), "LumenDeck");
    }
}
