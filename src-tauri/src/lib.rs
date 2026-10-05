//! LumenDeck backend library: wallpaper-driven RGB, live wallpapers, stickers.

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
// The translation catalog is shared with the dashboard: `locales/*.json` at
// the repo root is read here by rust-i18n and in the window by i18next, so
// there is one set of strings rather than two that can drift.
//
// It must be invoked at the crate root: `rust_i18n::t!` expands to
// `crate::_rust_i18n_t!`, and that macro only exists where `i18n!` ran.
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
    let mut cfg = config_store::get();
    if cfg.general.startup_hint_shown {
        return;
    }
    // Mark it before showing, not after: if the shell refuses the balloon,
    // nagging on every single boot is worse than never saying anything.
    cfg.general.startup_hint_shown = true;
    let body = startup_hint_body(&cfg, crate::wallpaper::is_paused());
    if let Err(e) = config_store::set(cfg) {
        log::warn!("startup hint: could not record that it was shown: {e}");
    }

    let title = crate::i18n::t("tray.balloon-title");
    crate::notify::notify(&app, &title, &body);
}

/// The balloon's body line, as a catalog key. Pure, so the wording can be
/// asserted without depending on the machine's locale.
///
/// It promises what is actually live rather than a fixed sentence: "your
/// wallpaper and lights are live" is a lie on a machine with the lighting
/// switched off, and a notification that is confidently wrong is worse than
/// no notification at all.
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

/// [startup_hint_key] in the user's language.
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

/// What is persisted about the dashboard window, for both the plugin's own
/// save-on-exit and the debounced save on move/resize. One function so the two
/// cannot drift: a window saved with flags the restore does not honour is the
/// kind of bug that only shows up after a restart.
///
/// A `const fn` rather than a `const` because bitflags 2's `|` operator is not
/// const -- `union` is.
///
/// VISIBLE is excluded on purpose. Restore calls `show()` and `set_focus()` on
/// a window whose saved state was visible, and an autostart launch is meant to
/// come up in the tray with nothing on screen -- with it set, the dashboard
/// would appear on every login. DECORATIONS and FULLSCREEN are excluded for
/// the same kind of reason: the dashboard is frameless and draws its own
/// titlebar, so a stale value there is a bug waiting to happen.
const fn window_state_flags() -> tauri_plugin_window_state::StateFlags {
    use tauri_plugin_window_state::StateFlags;
    StateFlags::SIZE.union(StateFlags::POSITION).union(StateFlags::MAXIMIZED)
}

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

/// Logging: a file next to the config, plus stderr for `tauri dev`.
///
/// This used to be a hand-rolled `log::Log` impl with its own ANSI colouring,
/// byte counter and size-triggered rotation, all of which
/// `tauri-plugin-log` does natively. The real argument was not the line count:
/// the plugin also forwards the webview's `console.log` into the same file.
/// Before, a bug report from a user carried only the Rust half of the story,
/// because anything logged in the frontend went to devtools, which a user
/// cannot open.
///
/// Two things are deliberately preserved, because both are load-bearing:
///
/// - The file stays at `%APPDATA%/LumenDeck/lumendeck.log`. That path is what
///   people are told to attach, and moving it would strand every existing log.
/// - One generation is kept, at 5 MB. `RotationStrategy::KeepOne` is exactly
///   the old rename-to-.old behaviour; `KeepSome` would quietly accumulate.
///
/// The per-line format is set by [LogFormat] rather than left at the plugin
/// default, because the short module name and the fixed-width level are what
/// make this file readable when you are grepping it at 3am.
fn init_logging() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_log::{Target, TargetKind};

    let dir = config_store::data_dir();
    let _ = std::fs::create_dir_all(&dir);

    tauri_plugin_log::Builder::new()
        .targets([
            // stderr keeps `tauri dev` useful, exactly as the old dual sink did.
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
        // The per-line format, kept from the hand-rolled logger. Two details are
        // load-bearing rather than cosmetic: the target is shortened to its last
        // segment (`lumendeck_lib::ipc` reads as `ipc`, which is what you grep
        // for), and the level is padded to five columns so INFO and ERROR line up
        // when you scan a wall of startup output.
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

/// The dashboard window's OS title.
///
/// A dev build names its version, so this string is the one piece of build
/// identity visible when the window is *not* being looked at: the taskbar
/// tooltip, the Alt-Tab entry, and anything that screenshots the desktop.
///
/// The version rather than the commit, because the badge beside the wordmark
/// says the version and two surfaces showing different identities is worse than
/// either choice on its own. What this costs is real: every local build reports
/// the same version, so the title no longer distinguishes two of them, and the
/// commit has to be read off the badge tooltip or the Developer panel. What it
/// buys is that the number on screen is the one a user would compare against a
/// release, rather than a hash they cannot place.
///
/// Release builds are left alone. A shipped installer's title is part of its
/// polish, and a version there is noise the badge check already covers.
fn main_window_title() -> String {
    window_title(cfg!(debug_assertions), env!("CARGO_PKG_VERSION"))
}

/// The formatting, separated from the compile-time facts so it can be tested
/// against both branches without needing two builds.
fn window_title(is_dev: bool, version: &str) -> String {
    // An empty version would leave a dangling separator in the taskbar, which
    // reads as a truncated string rather than as missing information.
    if is_dev && !version.is_empty() {
        format!("LumenDeck \u{2014} {version}")
    } else {
        "LumenDeck".to_string()
    }
}

/// The level the logger was actually built with.
///
/// Split out of [init_logging] so the Developer section can report it instead of
/// guessing. A bug report that says "log level: info" when the process was
/// started with `RUST_LOG=debug` sends whoever reads it looking for debug lines
/// that were never written — the exact question a diagnostics panel exists to
/// answer.
pub fn log_level() -> log::LevelFilter {
    // RUST_LOG still wins, so `RUST_LOG=debug` keeps working for a bug
    // report without anyone editing code.
    std::env::var("RUST_LOG")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(log::LevelFilter::Info)
}

/// Max log size before rotating. Shared by the plugin's size check and by the
/// support instructions a user is pointed at; keep the two in step.
pub const MAX_LOG_BYTES: u128 = 5 * 1024 * 1024;

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default()
}

/// The wall-clock stamp at the front of every log line.
///
/// Time of day comes from the OS, not from arithmetic on Unix epoch seconds.
/// The previous version computed the date itself and was therefore UTC in a
/// local-time app: the machine said 10:59 while the log said 08:59, forever.
/// `GetLocalTime` also gets DST right for free, which the hand-rolled version
/// could not have done without a timezone database.
///
/// The milliseconds are the sub-second remainder of the system clock, kept
/// separate because `GetLocalTime` only resolves to the second — without them
/// every line written inside one second shares a stamp and ordering has to be
/// inferred from the file rather than read off it.
fn local_timestamp() -> String {
    use windows::Win32::Foundation::SYSTEMTIME;
    use windows::Win32::System::SystemInformation::GetLocalTime;
    let st: SYSTEMTIME = unsafe { GetLocalTime() };
    // SYSTEMTIME fields are u16; widen once here rather than at every use.
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
    // After the logger, or a panic before it exists has nowhere to be written.
    crate::panic::install();
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
        // Installed before every other plugin so their startup logs land in the
        // file rather than only on stderr. Takes the Logger by value, which is
        // what captures the webview's console output as well.
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
        // Installed before every other plugin so their startup logs land in the
        // file rather than only on stderr. Takes the Logger by value, which is
        // what captures the webview's console output as well.
        .plugin(logger)
        // Startup notifications, via WinRT toasts. Replaces a hand-written
        // Shell_NotifyIcon balloon that had to mint its own hidden tray icon,
        // hidden window and message-pump thread on every call — see `notify`.
        .plugin(tauri_plugin_notification::init())
        // Revealing a wallpaper in Explorer. The old implementation spawned
        // `explorer /select,` by hand, which is a subprocess for something the
        // platform already does properly.
        .plugin(tauri_plugin_opener::init())
        // Read-on-demand clipboard, for the "paste link" button. The window
        // paste listener needs none of this: it is driven by the user pressing
        // Ctrl+V, so the text arrives with the event.
        .plugin(tauri_plugin_clipboard_manager::init())
        // System-wide hotkeys. No shortcuts are registered by the plugin
        // itself; `hotkeys::sync` applies the user's bindings once the
        // dashboard and tray exist.
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Remember the dashboard's size, position and maximized state between
        // launches, so reopening the app lands it where the user left it
        // instead of centred at the default 1100x760 every single time.
        //
        // Scoped to one window on purpose. The sticker, placement and wallpaper
        // windows are positioned from config on every launch, and restoring a
        // previous run's geometry over the top would fight the code that owns
        // it -- a sticker placed at (400, 300) would reopen at wherever it
        // happened to be last night.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_filter(|label| label == "main")
                // Flags live in WINDOW_STATE_FLAGS, which also drives the
                // debounced save below; the rationale is documented there.
                .with_state_flags(window_state_flags())
                .build(),
        )
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

            // Watch the OS accent so the dashboard rethemes live when the
            // user changes it (Settings > Personalization, or an external app).
            crate::sys_theme::spawn_accent_watcher(app.handle().clone());
            crate::volume::spawn_watcher(app.handle().clone());

            // CPU/RAM for the header strip. Started here rather than when the
            // dashboard window first asks for it, so the strip has a reading by
            // the time it is painted. Idempotent, so a window recreated after a
            // display change does not start a second sampler.
            crate::perf::start();

            // Repair the lock screen on startup. Builds before the toggle had a
            // release path could leave `LockScreenImage` pointing at us with the
            // feature off, which means the user's lock screen silently shows our
            // wallpaper and nothing they set. Only acts when the value is ours,
            // so a user's own image is never touched.
            if !config_store::get().general.lock_screen_follows_wallpaper {
                crate::lock_screen_reg::release();
            }

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
                // refresh() below keeps this in step with the app state; this
                // is only what shows in the sliver of time before it runs.
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
                        // Left-click toggles the dashboard (the standard
                        // expectation; the context menu stays on right-click).
                        // Same code path as the tray menu and the hotkey.
                        crate::tray::toggle_dashboard(tray.app_handle());
                    }
                })
                .build(app)?;
            crate::tray::refresh(app.handle());
            // Bind the user's system-wide hotkeys. Nothing is bound until they
            // opt in from Settings > Global hotkeys.
            let hotkeys_cfg = &config_store::get().general;
            crate::hotkeys::sync(app.handle(), hotkeys_cfg.hotkeys_enabled, &hotkeys_cfg.hotkeys);

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
            // Stated rather than inherited: see `devtools_allowed` for why the
            // keys have to be stopped here rather than in the page.
            .devtools(crate::window_utils::devtools_allowed());
            if let Some(icon) = app.default_window_icon() {
                main_window_builder = main_window_builder.icon(icon.clone())?;
            }
            let main_window = main_window_builder.build()?;

            // Saved geometry is already on the window here: the window-state
            // plugin restored it in `on_window_ready`, before this setup
            // hook ran. A size saved before the minimum rose -- or onto a
            // monitor that has since changed DPI -- comes back below what
            // the UI can lay out, and `WM_GETMINMAXINFO` only constrains
            // user drags, never programmatic `set_size`. So the restored
            // rect is re-checked against the same policy the builder
            // stated, and everything this app sets afterwards is clamped by
            // the resize arm below.
            fn apply_constraints(win: &tauri::WebviewWindow) -> tauri::Result<()> {
                use window_constraints::RestoredSize;
                let scale = win.scale_factor().unwrap_or(1.0);
                let monitor = win.current_monitor()?.or_else(|| {
                    // Not on any monitor yet (early startup): measure
                    // against the primary rather than skipping the check.
                    // Windows puts the primary monitor's origin at (0,0).
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
                    // No monitor reported (headless, CI): assume the
                    // position is fine so a saved size is clamped but not
                    // discarded for lack of a monitor to judge it by.
                    .unwrap_or((i32::MIN, i32::MIN, u32::MAX, u32::MAX));
                let pos = win.outer_position().ok().map(|p| (p.x, p.y));
                let size = win.inner_size().ok().map(|s| (s.width, s.height));
                match window_constraints::plan_restore(size, pos, scale, work_area) {
                    RestoredSize::Clamp(w, h) => {
                        win.set_size(tauri::LogicalSize::new(w, h))?;
                    }
                    // Invisible on every monitor: do not guess which one
                    // the user meant. Windows will place the window on a
                    // display that exists, and the resize arm below keeps
                    // the size legal from there.
                    RestoredSize::Defaults => {
                        log::info!("startup: saved window geometry unusable; using defaults");
                    }
                }
                Ok(())
            }
            if let Err(e) = apply_constraints(&main_window) {
                log::debug!("window constraints not applied at startup: {e}");
            }

            // Frameless windows lose the rounded corners Windows gives
            // decorated ones for free; ask DWM for them back. Non-fatal.
            crate::window_chrome::apply(&main_window);
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

                // Persist the window state shortly after the user stops moving
                // or resizing, instead of only when the process exits cleanly.
                //
                // The plugin saves on `RunEvent::Exit`, and a tray app rarely
                // gets one: it is killed at logoff, stopped from a terminal,
                // or ended from Task Manager, none of which run the exit event.
                // Observed exactly that -- the state file was never written at
                // all, and the dashboard came back un-maximised.
                //
                // Debounced because a drag fires this continuously; the flag
                // collapses a burst of events into one write.
                fn save_now(handle: &tauri::AppHandle) {
                    if let Err(e) = handle.save_window_state(window_state_flags()) {
                        // Debug, not a warning: the file lives in the app
                        // config dir and a failure here is never fatal.
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
                // The debounced save is the wrong tool for the moment the window
                // goes away: maximize then immediately quit lands inside the
                // 800ms window, the sleeping thread dies with the process, and
                // the state is lost -- which is exactly the report this started
                // from. Closing is rare and already a deliberate act, so it
                // saves synchronously.
                let close_handle = app.handle().clone();

                win.on_window_event(move |ev| match ev {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        save_now(&close_handle);
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
                        save_now(&close_handle);
                        let _ = win_handle.hide();
                    }
                    // After the minimize arm above, so a minimize-to-tray does
                    // not record the icon-sized rect Windows reports mid-restore.
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                        // A user dragging the edge cannot produce a size
                        // under the minimum -- `WM_GETMINMAXINFO` stops that
                        // -- so one arriving here came from a programmatic
                        // set_size or a DPI change resizing the window under
                        // us. It is brought back to the floor against the
                        // same policy as everywhere else; legal sizes are
                        // left untouched and cost one comparison.
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

    /// The localised hint must be exactly the English sentence or its
    /// translation — never an empty balloon, and never a sentence that skips
    /// the "click to open" half.
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

    /// Every state the hint can be in must resolve, in every shipped locale.
    /// A missing key here would ship a blank notification balloon, which is the
    /// one failure a user cannot work around.
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
        // A shipped installer whose taskbar tooltip says "0.2.7" reads as
        // unpolished to anyone who has not seen the source, and the About card
        // already says it in full.
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
        // No dangling separator. The taskbar would otherwise show "LumenDeck —"
        // for a build whose version somehow failed to compile in, which reads as
        // a truncation rather than as an absent value.
        assert_eq!(window_title(true, ""), "LumenDeck");
    }
}
