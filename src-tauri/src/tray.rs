//! Tray quick-controls: pause/resume wallpaper, cycle lighting modes, switch
//! RGB profiles — all without opening the dashboard.
//!
//! The tray menu cannot be mutated in place reliably across platforms, so
//! `refresh` rebuilds the whole menu from current state and replaces it on the
//! existing tray icon. Call `refresh` after any state change that the menu
//! displays (pause toggle, mode change, profile edit).

#![cfg(windows)]

use crate::config::RgbMode;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};

pub const ID_DASHBOARD: &str = "dashboard";
pub const ID_PAUSE: &str = "pause";
pub const ID_EDIT: &str = "edit";
pub const ID_MODE: &str = "mode-";
pub const ID_PROFILE: &str = "profile-";
pub const ID_RESTORE_WP: &str = "restore-wallpaper";
pub const ID_QUIT: &str = "quit";

/// Rebuild the tray menu from current config/pause state.
pub fn refresh(app: &tauri::AppHandle) {
    let tray = match app.tray_by_id("lumendeck-tray") {
        Some(t) => t,
        None => return,
    };
    let menu = match build_menu(app) {
        Ok(m) => m,
        Err(e) => {
            log::warn!("tray menu rebuild failed: {e}");
            return;
        }
    };
    if let Err(e) = tray.set_menu(Some(menu)) {
        log::warn!("tray set_menu failed: {e}");
    }
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let cfg = crate::config_store::get();
    let paused = crate::wallpaper::is_paused();

    let dashboard =
        MenuItem::with_id(app, ID_DASHBOARD, "Open LumenDeck", true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(
        app,
        ID_PAUSE,
        "Pause wallpaper",
        true,
        paused,
        None::<&str>,
    )?;
    let edit = MenuItem::with_id(app, ID_EDIT, "Edit stickers", true, None::<&str>)?;

    // Lighting mode submenu; checked item = active mode. Also offers
    // "Next mode" cycling on the main level.
    let modes = [
        (RgbMode::Ambient, "Ambient (wallpaper)"),
        (RgbMode::Zone, "Zone sync"),
        (RgbMode::Pulse, "Pulse"),
        (RgbMode::Static, "Static"),
        (RgbMode::Wave, "Wave"),
        (RgbMode::Cycle, "Cycle"),
        (RgbMode::Breathe, "Breathe"),
        (RgbMode::AudioReactive, "Audio reactive"),
    ];
    let mode_items: Vec<CheckMenuItem<tauri::Wry>> = modes
        .iter()
        .map(|(m, label)| {
            CheckMenuItem::with_id(
                app,
                format!("{ID_MODE}{m:?}"),
                *label,
                true,
                cfg.rgb.mode == *m,
                None::<&str>,
            )
        })
        .collect::<Result<_, _>>()?;
    let mode_refs: Vec<&dyn IsMenuItem<tauri::Wry>> = mode_items
        .iter()
        .map(|m| m as &dyn IsMenuItem<tauri::Wry>)
        .collect();
    let mode_sub = Submenu::with_id_and_items(app, "mode-sub", "Lighting mode", true, &mode_refs)?;
    let next_mode = MenuItem::with_id(app, "next-mode", "Next lighting mode", true, None::<&str>)?;

    // Profiles submenu (only when the user has saved some).
    let profile_items: Vec<MenuItem<tauri::Wry>> = cfg
        .rgb
        .profiles
        .iter()
        .map(|p| {
            MenuItem::with_id(
                app,
                format!("{ID_PROFILE}{}", p.name),
                &p.name,
                true,
                None::<&str>,
            )
        })
        .collect::<Result<_, _>>()?;
    let profile_sub = if profile_items.is_empty() {
        None
    } else {
        let profile_refs: Vec<&dyn IsMenuItem<tauri::Wry>> = profile_items
            .iter()
            .map(|m| m as &dyn IsMenuItem<tauri::Wry>)
            .collect();
        Some(Submenu::with_id_and_items(
            app,
            "profile-sub",
            "Profiles",
            true,
            &profile_refs,
        )?)
    };

    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Quit LumenDeck", true, None::<&str>)?;

    let mut items: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        vec![&dashboard, &sep, &pause, &sep2, &next_mode, &mode_sub];
    if let Some(sub) = &profile_sub {
        items.push(sub);
    }
    let restore_wp = MenuItem::with_id(app, ID_RESTORE_WP, "Restore my wallpaper", true, None::<&str>)?;
    items.extend_from_slice(&[&edit, &sep3, &restore_wp, &quit]);
    Menu::with_items(app, &items)
}

/// Handle a quick-control menu event. Returns true when handled.
pub fn handle(app: &tauri::AppHandle, id: &str) -> bool {
    if let Some(mode_str) = id.strip_prefix(ID_MODE) {
        if let Some(mode) = parse_mode(mode_str) {
            set_mode(app, mode);
            return true;
        }
    }
    if let Some(name) = id.strip_prefix(ID_PROFILE) {
        apply_profile(app, name);
        return true;
    }
    match id {
        ID_PAUSE => {
            let now = crate::wallpaper::toggle_manual_pause();
            log::info!("tray: wallpaper pause -> {now}");
            refresh(app);
            true
        }
        "next-mode" => {
            let cfg = crate::config_store::get();
            let all = [
                RgbMode::Ambient,
                RgbMode::Zone,
                RgbMode::Pulse,
                RgbMode::Static,
                RgbMode::Wave,
                RgbMode::Cycle,
                RgbMode::Breathe,
                RgbMode::AudioReactive,
            ];
            let idx = all.iter().position(|m| *m == cfg.rgb.mode).unwrap_or(0);
            set_mode(app, all[(idx + 1) % all.len()]);
            true
        }
        ID_RESTORE_WP => {
            let restored = crate::wallpaper_bg::restore_original_wallpaper();
            if restored {
                // Stop the engine so the live wallpaper doesn't immediately
                // paint over the restored background. Reload-safe: the user
                // can re-enable from the dashboard or tray pause toggle.
                let _ = crate::config_store::update(|c| c.general.wallpaper_enabled = false);
                if let Some(a) = crate::app_handle() {
                    crate::wallpaper::remove(&a);
                }
            }
            restored
        }
        _ => false,
    }
}

fn parse_mode(s: &str) -> Option<RgbMode> {
    Some(match s {
        "Ambient" => RgbMode::Ambient,
        "Zone" => RgbMode::Zone,
        "Pulse" => RgbMode::Pulse,
        "Static" => RgbMode::Static,
        "Wave" => RgbMode::Wave,
        "Cycle" => RgbMode::Cycle,
        "Breathe" => RgbMode::Breathe,
        "AudioReactive" => RgbMode::AudioReactive,
        _ => return None,
    })
}

fn set_mode(app: &tauri::AppHandle, mode: RgbMode) {
    let _ = crate::config_store::update(|c| c.rgb.mode = mode);
    log::info!("tray: lighting mode -> {mode:?}");
    refresh(app);
}

fn apply_profile(app: &tauri::AppHandle, name: &str) {
    let cfg = crate::config_store::get();
    if let Some(p) = cfg.rgb.profiles.iter().find(|p| p.name == name) {
        let _ = crate::config_store::update(|c| {
            c.rgb.mode = p.mode;
            c.rgb.static_color = p.static_color;
            c.rgb.animation_speed = p.animation_speed;
        });
        log::info!("tray: profile \"{name}\" applied");
        refresh(app);
    }
}

/// Register the extra quick-control handlers on the tray builder's menu-event
/// closure. The builder closure in `lib.rs` calls this for unknown ids.
pub fn on_menu_event(app: &tauri::AppHandle, id: &str) {
    handle(app, id);
}
