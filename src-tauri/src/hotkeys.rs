
use crate::config::HotkeyConfig;
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const VOLUME_STEP: f32 = 0.05;

static ACTIVE: Mutex<Option<(bool, HotkeyConfig)>> = Mutex::new(None);

static REPORTED: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn failure_key(action: &str, accelerator: &str, message: &str) -> String {
    format!("{action}\u{1}{accelerator}\u{1}{message}")
}

fn note_failures(reported: &mut Vec<String>, refused: &[HotkeyError]) -> Vec<HotkeyError> {
    let live: HashSet<String> = refused
        .iter()
        .map(|e| failure_key(&e.action, &e.accelerator, &e.message))
        .collect();
    let fresh: Vec<HotkeyError> = refused
        .iter()
        .filter(|e| !reported.contains(&failure_key(&e.action, &e.accelerator, &e.message)))
        .cloned()
        .collect();
    reported.retain(|k| live.contains(k));
    for key in live {
        if !reported.contains(&key) {
            reported.push(key);
        }
    }
    fresh
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyError {
    pub action: String,
    pub accelerator: String,
    pub message: String,
}

pub fn sync(app: &tauri::AppHandle, enabled: bool, cfg: &HotkeyConfig) {
    {
        let active = ACTIVE.lock().expect("hotkey mutex poisoned");
        if active.as_ref().is_some_and(|(on, c)| *on == enabled && c == cfg) {
            return;
        }
    }
    register_all(app, enabled, cfg);
    if let Ok(mut active) = ACTIVE.lock() {
        *active = Some((enabled, cfg.clone()));
    }
}

fn register_all(app: &tauri::AppHandle, enabled: bool, cfg: &HotkeyConfig) {
    release_all(app, cfg);

    if !enabled {
        log::info!("hotkey: disabled by the user; no keys are held");
        publish_status(app, &Vec::new());
        return;
    }

    let mut bound = 0usize;
    let mut refused: Vec<HotkeyError> = Vec::new();
    for (action, binding) in cfg.entries() {
        if binding.is_empty() {
            continue;
        }
        let accel = binding.accelerator.trim();
        match register_one(app, action, accel) {
            Ok(()) => {
                bound += 1;
                log::info!("hotkey: {action} = {accel}");
            }
            Err(message) => {
                log::debug!("hotkey: {action} ({accel}) refused: {message}");
                refused.push(HotkeyError {
                    action: action.to_string(),
                    accelerator: accel.to_string(),
                    message,
                });
            }
        }
    }

    if let Ok(mut reported) = REPORTED.lock() {
        for err in note_failures(&mut reported, &refused) {
            log::warn!(
                "hotkey: {action} ({accel}) could not be bound: {message}",
                action = err.action,
                accel = err.accelerator,
                message = err.message,
            );
            report(app, err);
        }
    }

    publish_status(app, &refused);
    log::info!("hotkey: {bound} bound, {} refused", refused.len());
}

fn release_all(app: &tauri::AppHandle, cfg: &HotkeyConfig) {
    let gs = app.global_shortcut();
    if let Err(e) = gs.unregister_all() {
        log::debug!("hotkey: bulk release reported {e}; releasing individually");
    }
    for (_, binding) in cfg.entries() {
        if binding.is_empty() {
            continue;
        }
        let accel = binding.accelerator.trim();
        let Ok(shortcut) = accel.parse::<Shortcut>() else {
            continue;
        };
        if let Err(e) = gs.unregister(shortcut) {
            log::debug!("hotkey: release {accel} failed: {e}");
        }
    }
}

fn publish_status(app: &tauri::AppHandle, refused: &Vec<HotkeyError>) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            crate::events::emit_all(app, crate::events::HOTKEY_STATUS, refused);
        }
    }
}

pub fn set_enabled(app: &tauri::AppHandle, enabled: bool) -> bool {
    let next = match crate::config_store::update(|c| c.general.hotkeys_enabled = enabled) {
        Ok(fresh) => fresh.general.hotkeys_enabled,
        Err(e) => {
            log::warn!("hotkey: could not save the switch: {e}");
            return !enabled;
        }
    };
    sync(app, next, &crate::config_store::get().general.hotkeys);
    log::info!("hotkey: switch -> {next}");
    next
}

fn register_one(app: &tauri::AppHandle, action: &'static str, accel: &str) -> Result<(), String> {
    let parsed: Shortcut = accel.parse().map_err(parse_error)?;
    if !is_safe(&parsed) {
        return Err("needs a modifier (Ctrl/Alt/Shift/Win) or an F1-F24 key".into());
    }
    app.global_shortcut()
        .on_shortcut(parsed, move |app, _shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            dispatch(app, action);
        })
        .map_err(|e| e.to_string())
}

fn is_safe(shortcut: &Shortcut) -> bool {
    if !shortcut.mods.is_empty() {
        return true;
    }
    is_function_key(&format!("{:?}", shortcut.key))
}

fn is_function_key(name: &str) -> bool {
    let Some(digits) = name.strip_prefix('F') else {
        return false;
    };
    digits
        .parse::<u8>()
        .is_ok_and(|n| (1..=24).contains(&n))
}

fn parse_error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn validate(accel: &str) -> Result<(), String> {
    let trimmed = accel.trim();
    if trimmed.is_empty() {
        return Err("empty accelerator".into());
    }
    let parsed: Shortcut = trimmed.parse().map_err(parse_error)?;
    if !is_safe(&parsed) {
        return Err("needs a modifier (Ctrl/Alt/Shift/Win) or an F1-F24 key".into());
    }
    Ok(())
}

fn dispatch(app: &tauri::AppHandle, action: &'static str) {
    crate::rgb::wake_if_sleeping();
    crate::rgb::request_hotkey_blink();

    if let Some(verb) = media_transport_action(action) {
        let app = app.clone();
        let name = action;
        let _ = tauri::async_runtime::spawn(async move {
            let result = crate::media_session::transport_async(verb.to_string()).await;
            report_result(&app, name, result);
        });
        return;
    }

    let result: Result<(), String> = match action {
        "toggleDashboard" => {
            crate::tray::toggle_dashboard(app);
            Ok(())
        }
        "toggleMute" => crate::volume::toggle_mute().map(|_| ()),
        "volumeUp" => nudge_volume(VOLUME_STEP),
        "volumeDown" => nudge_volume(-VOLUME_STEP),
        "toggleWallpaper" => {
            crate::tray::toggle_wallpaper(app);
            Ok(())
        }
        "cycleLightingMode" => {
            crate::tray::cycle_lighting_mode(app);
            Ok(())
        }
        "nextProfile" => guard(crate::tray::cycle_scene(app), "no profiles saved yet"),
        "nextWallpaper" => guard(
            crate::playlist::advance().is_some(),
            "the wallpaper vault is empty",
        ),
        other => Err(format!("unknown hotkey action: {other}")),
    };
    report_result(app, action, result);
}

fn media_transport_action(action: &str) -> Option<&'static str> {
    match action {
        "playPause" => Some("toggle"),
        "nextTrack" => Some("next"),
        "prevTrack" => Some("previous"),
        _ => None,
    }
}

fn report_result(app: &tauri::AppHandle, action: &str, result: Result<(), String>) {
    match result {
        Ok(()) => log::debug!("hotkey: {action}"),
        Err(e) => {
            log::info!("hotkey {action}: {e}");
            report(
                app,
                HotkeyError {
                    action: action.to_string(),
                    accelerator: String::new(),
                    message: e,
                },
            );
        }
    }
}

fn guard(ok: bool, empty_reason: &'static str) -> Result<(), String> {
    if ok {
        Ok(())
    } else {
        Err(empty_reason.into())
    }
}

fn nudge_volume(delta: f32) -> Result<(), String> {
    let current = crate::volume::get()?;
    let next = (current + delta).clamp(0.0, 1.0);
    if crate::volume::muted()? {
        crate::volume::set_mute(false)?;
    }
    crate::volume::set(next)
}

fn report(app: &tauri::AppHandle, error: HotkeyError) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            crate::events::emit_all(app, crate::events::HOTKEY_ERROR, &error);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn function_keys_are_recognised() {
        for name in ["F1", "F5", "F12", "F24"] {
            assert!(is_function_key(name), "{name} should count as a function key");
        }
        for name in ["F0", "F25", "KeyM", "Numpad0", "Escape", ""] {
            assert!(!is_function_key(name), "{name} is not a function key");
        }
    }

    #[test]
    fn bare_keys_are_rejected_so_typing_is_not_swallowed() {
        for accel in ["KeyM", "Digit7", "Space", "Escape"] {
            assert!(
                validate(accel).is_err(),
                "{accel} would shadow normal typing and must be refused"
            );
        }
    }

    #[test]
    fn function_keys_alone_are_allowed() {
        for accel in ["F5", "F12"] {
            assert!(validate(accel).is_ok(), "{accel} should be bindable");
        }
    }

    #[test]
    fn modifier_combos_parse_and_pass() {
        for accel in [
            "Ctrl+Alt+M",
            "Ctrl+Shift+F9",
            "Alt+Space",
            "Ctrl+Alt+Shift+ArrowRight",
            "Ctrl+Numpad0",
        ] {
            assert!(validate(accel).is_ok(), "{accel} should be bindable: {err:?}", err = validate(accel).err());
        }
    }

    #[test]
    fn empty_and_malformed_accelerators_are_rejected() {
        for accel in ["", "   ", "Ctrl+", "Ctrl+Nonsense", "Ctrl+A+B"] {
            assert!(validate(accel).is_err(), "{accel:?} must not validate");
        }
    }

    #[test]
    fn media_actions_map_to_smtc_verbs() {
        assert_eq!(media_transport_action("playPause"), Some("toggle"));
        assert_eq!(media_transport_action("nextTrack"), Some("next"));
        assert_eq!(media_transport_action("prevTrack"), Some("previous"));
        assert_eq!(media_transport_action("toggleDashboard"), None);
        assert_eq!(media_transport_action("volumeUp"), None);
    }

    #[test]
    fn validation_is_independent_of_the_master_switch() {
        assert!(validate("Ctrl+Alt+M").is_ok());
    }


    fn refused(action: &str, accelerator: &str, message: &str) -> HotkeyError {
        HotkeyError {
            action: action.into(),
            accelerator: accelerator.into(),
            message: message.into(),
        }
    }

    #[test]
    fn the_same_conflict_is_only_announced_once() {
        let mut reported: Vec<String> = Vec::new();
        let errs = [refused("toggleMute", "Ctrl+Alt+M", "already registered")];

        assert_eq!(note_failures(&mut reported, &errs).len(), 1, "first pass announces");
        for pass in 2..6 {
            assert!(
                note_failures(&mut reported, &errs).is_empty(),
                "re-registration (pass {pass}) must not re-announce an unchanged conflict"
            );
        }
        assert_eq!(reported.len(), 1);
    }

    #[test]
    fn switching_off_and_on_does_not_re_raise_a_permanent_conflict() {
        let mut reported: Vec<String> = Vec::new();
        let errs = [refused("toggleMute", "Ctrl+Alt+M", "already registered")];

        assert_eq!(note_failures(&mut reported, &errs).len(), 1, "announced when first bound");

        for _ in 0..4 {
            assert!(
                note_failures(&mut reported, &errs).is_empty(),
                "re-enabling must not repeat a conflict the user already saw"
            );
        }
    }

    #[test]
    fn a_different_combo_or_message_is_still_announced() {
        let mut reported: Vec<String> = Vec::new();
        note_failures(&mut reported, &[refused("toggleMute", "Ctrl+Alt+M", "already registered")]);

        assert_eq!(
            note_failures(&mut reported, &[refused("toggleMute", "Ctrl+Alt+N", "already registered")]).len(),
            1
        );
        assert_eq!(
            note_failures(&mut reported, &[refused("toggleMute", "Ctrl+Alt+M", "access denied")]).len(),
            1
        );
        assert_eq!(
            note_failures(&mut reported, &[refused("playPause", "Ctrl+Alt+M", "already registered")]).len(),
            1
        );
    }

    #[test]
    fn a_fixed_binding_does_not_suppress_a_later_different_failure() {
        let mut reported: Vec<String> = Vec::new();
        note_failures(&mut reported, &[refused("toggleMute", "Ctrl+Alt+M", "already registered")]);

        assert!(note_failures(&mut reported, &[]).is_empty());
        assert!(reported.is_empty(), "a resolved failure should be forgotten");

        assert_eq!(
            note_failures(&mut reported, &[refused("toggleMute", "Ctrl+Alt+7", "already registered")]).len(),
            1
        );
    }

    #[test]
    fn failures_still_live_are_kept_across_a_sync() {
        let mut reported: Vec<String> = Vec::new();
        note_failures(&mut reported, &[
            refused("toggleMute", "Ctrl+Alt+M", "already registered"),
            refused("playPause", "Ctrl+Alt+Space", "already registered"),
        ]);

        let fresh = note_failures(
            &mut reported,
            &[refused("toggleMute", "Ctrl+Alt+M", "already registered")],
        );
        assert!(fresh.is_empty(), "the untouched conflict should stay quiet");
        assert_eq!(reported.len(), 1, "the resolved one is forgotten");
    }

    #[test]
    fn a_failure_key_cannot_collide_across_its_fields() {
        assert_ne!(
            failure_key("toggleMute", "Ctrl+Alt+M", "x"),
            failure_key("toggleMute", "Ctrl+Alt+Mx", "")
        );
    }

    #[test]
    fn surrounding_whitespace_does_not_break_parsing() {
        assert!(validate("  Ctrl+Alt+M  ").is_ok());
    }
}
