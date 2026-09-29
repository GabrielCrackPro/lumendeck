//! System-wide hotkeys: bind the same quick actions the tray menu offers to
//! key combinations that keep working while the dashboard is hidden.
//!
//! The dashboard is the least interesting surface of this app — most of the
//! time it is closed and the wallpaper and lights are running from the tray.
//! Hotkeys are how you control that state without reopening a window.
//!
//! Design notes:
//!
//! * **Nothing is bound by default.** Registering OS-wide key grabs the user
//!   never asked for is the fastest way to make an ambient app feel hostile.
//!   The dashboard shows a suggested combo per action and the user opts in.
//! * **No modifier, no bind.** A bare key would be swallowed system-wide, so
//!   the backend refuses it even if a hand-edited config asks for one. F1-F24
//!   are the exception; they are not part of normal typing.
//! * **One implementation per action.** Every action routes through
//!   `crate::tray` / `crate::playlist`, the same functions the tray menu calls.
//! * **Failures are surfaced, never silent.** A combo another app already owns
//!   is a real problem, so it produces a log line plus a `HOTKEY_ERROR` event
//!   the dashboard turns into a toast (when it happens to be open).

use crate::config::HotkeyConfig;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Volume nudge per key press, as a fraction of full scale.
const VOLUME_STEP: f32 = 0.05;

/// The binding set currently registered with the OS. Used to skip redundant
/// re-registration: config saves fire constantly (a slider drag is dozens),
/// and each pass unregisters everything before rebuilding it.
static ACTIVE: Mutex<Option<HotkeyConfig>> = Mutex::new(None);

/// A hotkey that could not be taken, reported to the dashboard.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyError {
    /// Config action id (e.g. `"toggleMute"`).
    pub action: String,
    /// The accelerator that was refused, as typed by the user.
    pub accelerator: String,
    /// Human-readable reason.
    pub message: String,
}

/// Re-register every binding from `cfg`. No-op when the binding set is
/// unchanged, so this is safe to call on every config save and on every
/// external config reload.
pub fn sync(app: &tauri::AppHandle, cfg: &HotkeyConfig) {
    {
        let active = ACTIVE.lock().expect("hotkey mutex poisoned");
        if active.as_ref() == Some(cfg) {
            return;
        }
    }
    register_all(app, cfg);
    if let Ok(mut active) = ACTIVE.lock() {
        *active = Some(cfg.clone());
    }
}

/// Rebuild the whole OS registration from scratch. Drops every previous
/// binding first so a removed or re-pointed combo is actually released.
fn register_all(app: &tauri::AppHandle, cfg: &HotkeyConfig) {
    let gs = app.global_shortcut();
    if let Err(e) = gs.unregister_all() {
        log::warn!("hotkey: could not release previous bindings: {e}");
    }

    let mut bound = 0usize;
    let mut refused = 0usize;
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
                refused += 1;
                log::warn!("hotkey: {action} ({accel}) refused: {message}");
                report(
                    app,
                    HotkeyError {
                        action: action.to_string(),
                        accelerator: accel.to_string(),
                        message,
                    },
                );
            }
        }
    }
    log::info!("hotkey: {bound} bound, {refused} refused");
}

/// Parse, safety-check and register one accelerator with a handler that
/// dispatches its action on key-down.
fn register_one(app: &tauri::AppHandle, action: &'static str, accel: &str) -> Result<(), String> {
    let parsed: Shortcut = accel.parse().map_err(parse_error)?;
    if !is_safe(&parsed) {
        return Err("needs a modifier (Ctrl/Alt/Shift/Win) or an F1-F24 key".into());
    }
    app.global_shortcut()
        .on_shortcut(parsed, move |app, _shortcut, event| {
            // Windows sends one WM_HOTKEY per press, but the plugin surfaces
            // both edges; acting on release would double every action.
            if event.state() != ShortcutState::Pressed {
                return;
            }
            dispatch(app, action);
        })
        .map_err(|e| e.to_string())
}

/// A binding is safe when it cannot shadow ordinary typing. Anything with a
/// modifier qualifies; so do the function keys, which are not text entry.
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

/// Flatten the accelerator parser's error into a message the dashboard can
/// show next to the field. `global-hotkey`'s parse error already explains
/// what went wrong ("Unsupported key", "hotkeys should have the modifiers
/// first..."), so it is passed through as-is.
fn parse_error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Validate an accelerator without binding it. The dashboard calls this while
/// the user is recording a combo, so a typo is caught before it is saved.
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

/// Run the action behind a pressed combo.
fn dispatch(app: &tauri::AppHandle, action: &str) {
    let result: Result<(), String> = match action {
        "toggleDashboard" => {
            crate::tray::toggle_dashboard(app);
            Ok(())
        }
        "playPause" => crate::media_session::transport("toggle"),
        "nextTrack" => crate::media_session::transport("next"),
        "prevTrack" => crate::media_session::transport("previous"),
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
        "nextProfile" => guard(crate::tray::cycle_profile(app), "no RGB profiles saved yet"),
        "nextScene" => guard(crate::tray::cycle_scene(app), "no scenes saved yet"),
        "nextWallpaper" => guard(
            crate::playlist::advance().is_some(),
            "the wallpaper vault is empty",
        ),
        other => Err(format!("unknown hotkey action: {other}")),
    };
    match result {
        Ok(()) => log::debug!("hotkey: {action}"),
        // "Nothing to act on" is expected when the user presses a media key
        // with nothing playing. It is logged, and toasted only when there is a
        // window on screen to toast into.
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

/// Move the system output volume by `delta` (a fraction of full scale),
/// unmuting first so the key does something audible.
fn nudge_volume(delta: f32) -> Result<(), String> {
    let current = crate::volume::get()?;
    let next = (current + delta).clamp(0.0, 1.0);
    if crate::volume::muted()? {
        crate::volume::set_mute(false)?;
    }
    crate::volume::set(next)
}

/// Emit a failure for the dashboard. No-op when nothing is listening.
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
    fn surrounding_whitespace_does_not_break_parsing() {
        assert!(validate("  Ctrl+Alt+M  ").is_ok());
    }
}
