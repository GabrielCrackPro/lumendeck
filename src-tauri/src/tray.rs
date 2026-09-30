//! Tray quick-controls: pause/resume wallpaper, cycle lighting modes, switch
//! RGB profiles — all without opening the dashboard.
//!
//! The tray menu cannot be mutated in place reliably across platforms, so
//! `refresh` rebuilds the whole menu from current state and replaces it on the
//! existing tray icon. Call `refresh` after any state change that the menu
//! displays (pause toggle, mode change, profile edit).
//!
//! Every action below is also a public function, because `crate::hotkeys`
//! binds the same set to system-wide keys. The menu is a front end for these
//! actions, not a second implementation of them.

#![cfg(windows)]

use crate::config::RgbMode;
use tauri::Manager;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};

pub const ID_DASHBOARD: &str = "dashboard";
pub const ID_PAUSE: &str = "pause";
pub const ID_EDIT: &str = "edit";
pub const ID_MODE: &str = "mode-";
pub const ID_PROFILE: &str = "profile-";
pub const ID_RESTORE_WP: &str = "restore-wallpaper";
pub const ID_QUIT: &str = "quit";
pub const ID_HOTKEYS: &str = "hotkeys";

/// The tray tooltip for the current state. Pure, so the wording is testable
/// without an AppHandle — the tooltip is the only thing the notification
/// area says about us, and a wrong one is worse than a bare "LumenDeck".
/// Returns a catalog key; [current_tooltip] resolves it.
pub fn tooltip_key(wallpaper_on: bool, lights_on: bool, paused: bool) -> &'static str {
    if paused {
        return "tray.tooltip-paused";
    }
    match (wallpaper_on, lights_on) {
        (true, true) => "tray.tooltip-all-live",
        (true, false) => "tray.tooltip-wallpaper-live",
        (false, true) => "tray.tooltip-lights-live",
        (false, false) => "tray.tooltip-idle",
    }
}

/// [tooltip_key] for the live app state, in the user's language.
pub fn current_tooltip() -> String {
    let cfg = crate::config_store::get();
    crate::i18n::t(tooltip_key(
        cfg.general.wallpaper_enabled,
        cfg.rgb.enabled,
        crate::wallpaper::is_paused(),
    ))
}

/// Rebuild the tray menu from current config/pause state.
pub fn refresh(app: &tauri::AppHandle) {
    let tray = match app.tray_by_id("lumendeck-tray") {
        Some(t) => t,
        None => return,
    };
    // Set from the same call sites as the menu below, so the tooltip cannot
    // drift out of step with the checkmarks it sits next to.
    let tooltip = current_tooltip();
    if let Err(e) = tray.set_tooltip(Some(&tooltip)) {
        log::warn!("tray set_tooltip failed: {e}");
    }
    log::debug!("tray tooltip -> {tooltip}");
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
    let paused = crate::wallpaper::is_paused();    let dashboard = MenuItem::with_id(
      app,
      ID_DASHBOARD,
      crate::i18n::t("tray.open-dashboard"),
      true,
      None::<&str>,
    )?;
    let pause = CheckMenuItem::with_id(
      app,
      ID_PAUSE,
      crate::i18n::t("tray.pause-wallpaper"),
      true,
      paused,
      None::<&str>,
    )?;
    let edit = MenuItem::with_id(
      app,
      ID_EDIT,
      crate::i18n::t("tray.edit-stickers"),
      true,
      None::<&str>,
    )?;
    // Lighting mode submenu; checked item = active mode. Also offers
    // "Next mode" cycling on the main level. Order matches ALL_MODES, which
    // is what the hotkey cycle walks.
    let mode_items: Vec<CheckMenuItem<tauri::Wry>> = ALL_MODES
        .iter()
        .map(|m| {
            CheckMenuItem::with_id(
                app,
                format!("{ID_MODE}{m:?}"),
                mode_label_t(*m),
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
    // Master switch for the system-wide keys. The emergency off-ramp: a combo
    // that misbehaves can be released from the notification area without
    // opening the dashboard.
    let hotkeys = CheckMenuItem::with_id(
        app,
        ID_HOTKEYS,
        crate::i18n::t("tray.global-hotkeys"),
        true,
        cfg.general.hotkeys_enabled,
        None::<&str>,
    )?;

    let mode_sub = Submenu::with_id_and_items(
        app,
        "mode-sub",
        crate::i18n::t("tray.lighting-mode"),
        true,
        &mode_refs,
    )?;
    let next_mode = MenuItem::with_id(
        app,
        "next-mode",
        crate::i18n::t("tray.next-lighting-mode"),
        true,
        None::<&str>,
    )?;

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
            crate::i18n::t("tray.profiles"),
            true,
            &profile_refs,
        )?)
    };

    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(
        app,
        ID_QUIT,
        crate::i18n::t("tray.quit"),
        true,
        None::<&str>,
    )?;

    let mut items: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        vec![&dashboard, &sep, &pause, &hotkeys, &sep2, &next_mode, &mode_sub];
    if let Some(sub) = &profile_sub {
        items.push(sub);
    }
    let restore_wp = MenuItem::with_id(
        app,
        ID_RESTORE_WP,
        crate::i18n::t("tray.restore-wallpaper"),
        true,
        None::<&str>,
    )?;
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
            toggle_wallpaper(app);
            true
        }
        "next-mode" => {
            cycle_lighting_mode(app);
            true
        }
        ID_HOTKEYS => {
            let next = !crate::config_store::get().general.hotkeys_enabled;
            crate::hotkeys::set_enabled(app, next);
            // The config write already refreshes the menu, but the checkmark
            // is the whole point of this entry — rebuild explicitly rather
            // than depending on that indirect side effect.
            refresh(app);
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
    log::info!("lighting mode -> {mode:?}");
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
        log::info!("profile \"{name}\" applied");
        refresh(app);
    }
}

// ---------- Actions shared with the global hotkeys ----------
//
// These are the single implementation behind both the tray menu entries and
// the key bindings; each one refreshes the tray afterwards so the checkmarks
// never drift from the state they represent.

/// Every lighting mode in cycling order. Also drives the tray submenu.
pub const ALL_MODES: [RgbMode; 8] = [
    RgbMode::Ambient,
    RgbMode::Zone,
    RgbMode::Pulse,
    RgbMode::Static,
    RgbMode::Wave,
    RgbMode::Cycle,
    RgbMode::Breathe,
    RgbMode::AudioReactive,
];

/// Pause or resume the live wallpaper. Returns the new paused state.
pub fn toggle_wallpaper(app: &tauri::AppHandle) -> bool {
    let now = crate::wallpaper::toggle_manual_pause();
    log::info!("wallpaper pause -> {now}");
    refresh(app);
    now
}

/// Catalog key for a lighting mode.
///
/// These are the SAME `lighting.*` keys the dashboard's mode picker uses, not
/// a tray-specific copy. That is the whole point of the shared catalog: a user
/// who learns "Color cycle" in the window meets the identical wording in the
/// tray, and there is no second place for the two to drift apart.
fn mode_key(mode: RgbMode) -> &'static str {
  match mode {
    RgbMode::Ambient => "lighting.ambient",
    RgbMode::Zone => "lighting.zone-sync",
    RgbMode::Pulse => "lighting.pulse",
    RgbMode::Static => "lighting.static",
    RgbMode::Wave => "lighting.wave",
    RgbMode::Cycle => "lighting.color-cycle",
    RgbMode::Breathe => "lighting.breathe",
    RgbMode::AudioReactive => "lighting.audio-reactive",
  }
}

/// [mode_key] in the user's language. The tray's wording is the one place
/// the app talks before the window is ever opened, so it cannot be left in
/// English on a Spanish machine.
fn mode_label_t(mode: RgbMode) -> String {
  crate::i18n::t(mode_key(mode))
}

/// Step to the next lighting mode, wrapping at the end.
pub fn cycle_lighting_mode(app: &tauri::AppHandle) {
    let cfg = crate::config_store::get();
    let idx = ALL_MODES.iter().position(|m| *m == cfg.rgb.mode).unwrap_or(0);
    set_mode(app, ALL_MODES[(idx + 1) % ALL_MODES.len()]);
}

/// Apply the next saved RGB profile (wrapping). No-op without profiles.
pub fn cycle_profile(app: &tauri::AppHandle) -> bool {
    let cfg = crate::config_store::get();
    if cfg.rgb.profiles.is_empty() {
        return false;
    }
    let idx = cfg
        .rgb
        .profiles
        .iter()
        .position(|p| p.mode == cfg.rgb.mode && p.static_color == cfg.rgb.static_color)
        .map(|i| (i + 1) % cfg.rgb.profiles.len())
        .unwrap_or(0);
    let name = cfg.rgb.profiles[idx].name.clone();
    apply_profile(app, &name);
    true
}

/// Apply the next saved scene profile (wrapping). No-op without scenes.
pub fn cycle_scene(app: &tauri::AppHandle) -> bool {
    let cfg = crate::config_store::get();
    if cfg.scenes.is_empty() {
        return false;
    }
    let idx = cfg
        .scenes
        .iter()
        .position(|s| s.rgb == cfg.rgb && s.wallpaper == cfg.wallpaper)
        .map(|i| (i + 1) % cfg.scenes.len())
        .unwrap_or(0);
    let scene = cfg.scenes[idx].clone();
    if crate::ipc::scene_apply(app.clone(), scene.id).is_err() {
        return false;
    }
    log::info!("scene \"{}\" applied", scene.name);
    refresh(app);
    true
}

/// Show the dashboard if it is hidden or unfocused, hide it when it is
/// already up. Shared by the tray icon, the tray menu and the hotkey.
pub fn toggle_dashboard(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let up = w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false);
        if up {
            let _ = w.hide();
        } else {
            // The window may be hidden (closed-to-tray) or minimized when
            // reopened, so unminimize before showing.
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

/// Bring the dashboard to the front without hiding it.
pub fn show_dashboard(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Register the extra quick-control handlers on the tray builder's menu-event
/// closure. The builder closure in `lib.rs` calls this for unknown ids.
pub fn on_menu_event(app: &tauri::AppHandle, id: &str) {
    handle(app, id);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The tooltip must always name the app and never come back blank — a
    /// bare empty tooltip is indistinguishable from a broken tray icon.
    ///
    /// Asserted against the RESOLVED text, not the key, because that is what
    /// the notification area actually shows.
    #[test]
    fn tooltip_leads_with_the_app_name_and_never_goes_blank() {
        let _guard = crate::i18n::test_locale_lock();
        for wallpaper in [false, true] {
            for lights in [false, true] {
                for paused in [false, true] {
                    let key = tooltip_key(wallpaper, lights, paused);
                    for locale in crate::i18n::SUPPORTED {
                        let shown = crate::i18n::t_in_locked(locale, key);
                        assert!(
                            shown.starts_with("LumenDeck"),
                            "blank-ish tooltip in {locale}: {shown}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn tooltip_describes_what_is_actually_running() {
        let _guard = crate::i18n::test_locale_lock();
        assert_eq!(
            crate::i18n::t_in_locked("en", tooltip_key(true, true, false)),
            "LumenDeck — wallpaper and lights are live"
        );
        assert_eq!(
            crate::i18n::t_in_locked("en", tooltip_key(true, false, false)),
            "LumenDeck — wallpaper is live, lights are off"
        );
        assert_eq!(
            crate::i18n::t_in_locked("en", tooltip_key(false, true, false)),
            "LumenDeck — lights are live, wallpaper is off"
        );
        assert_eq!(
            crate::i18n::t_in_locked("en", tooltip_key(false, false, false)),
            "LumenDeck — idle"
        );
    }

    #[test]
    fn pause_wins_over_everything_else() {
        // Whether the wallpaper is on, paused, or the whole app is idle, the
        // one thing the user needs to know is that nothing is moving.
        for wallpaper in [false, true] {
            for lights in [false, true] {
                assert_eq!(
                    tooltip_key(wallpaper, lights, true),
                    "tray.tooltip-paused"
                );
            }
        }
    }

    /// Every lighting mode must have a catalog entry, or the tray's mode
    /// submenu shows a raw key to the user. This is the check that would have
    /// caught a mode added to `ALL_MODES` without a catalog entry.
    #[test]
    fn every_lighting_mode_has_a_translated_menu_label() {
        let _guard = crate::i18n::test_locale_lock();
        for mode in ALL_MODES {
            for locale in crate::i18n::SUPPORTED {
                let label = crate::i18n::t_in_locked(locale, mode_key(mode));
                assert!(!label.is_empty(), "{mode:?} produced an empty label in {locale}");
                assert!(
                    !label.starts_with("lighting."),
                    "{mode:?} fell through to its raw key in {locale}: {label}"
                );
            }
        }
    }
}
