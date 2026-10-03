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
//!   is a real problem, so it is reported once and then shown persistently on
//!   its settings row — not re-toasted on every re-registration, which turned
//!   a single stale conflict into an error every time the switch was toggled.
//! * **One stuck combo must not cascade.** The plugin's `unregister_all` stops
//!   at the first failure *after* clearing its own map, so one unregisterable
//!   key would leave the rest held by the OS with nothing left to release them.
//!   Release is therefore done per key, tolerating individual failures.

use crate::config::HotkeyConfig;
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Volume nudge per key press, as a fraction of full scale.
const VOLUME_STEP: f32 = 0.05;

/// The binding set currently registered with the OS, plus the master switch it
/// was registered under. Used to skip redundant re-registration: config saves
/// fire constantly (a slider drag is dozens), and each pass unregisters
/// everything before rebuilding it.
static ACTIVE: Mutex<Option<(bool, HotkeyConfig)>> = Mutex::new(None);

/// Registration failures already surfaced, keyed by `failure_key`. A conflict
/// like "Ctrl+Alt+M belongs to another app" is permanent until the user
/// changes the binding, so re-announcing it on every re-registration — every
/// slider save, every switch toggle — would be pure noise.
static REPORTED: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Stable identity for one registration failure, so the same problem is only
/// announced once. A user who changes the combo, or frees it, gets a fresh
/// report if it fails again.
fn failure_key(action: &str, accelerator: &str, message: &str) -> String {
    format!("{action}\u{1}{accelerator}\u{1}{message}")
}

/// Fold this pass's refusals into what has already been announced, and return
/// only the ones worth telling the user about.
///
/// A remembered failure is dropped as soon as the combo stops failing, so a
/// binding the user fixed and later breaks again is reported again rather than
/// silently swallowed by its own past.
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
    // `retain` keeps a failure that is still live, so only genuinely new keys
    // need adding — extending blindly would duplicate every repeat.
    for key in live {
        if !reported.contains(&key) {
            reported.push(key);
        }
    }
    fresh
}

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

/// Re-register every binding from `cfg`. No-op when the binding set and the
/// master switch are both unchanged, so this is safe to call on every config
/// save and on every external config reload.
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

/// Rebuild the whole OS registration from scratch. Drops every previous
/// binding first so a removed, re-pointed, or switched-off combo is actually
/// released rather than lingering as an invisible key grab.
fn register_all(app: &tauri::AppHandle, enabled: bool, cfg: &HotkeyConfig) {
    release_all(app, cfg);

    if !enabled {
        log::info!("hotkey: disabled by the user; no keys are held");
        // REPORTED is deliberately left alone. Nothing is held, but the reason
        // a combo was refused — another program owns those keys — is a fact
        // about that program, not about us, and it is still true. Forgetting it
        // here is what made switching off and on again re-raise the very same
        // "already registered" error the user had already been shown.
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
                // Deliberately not `warn`: a refusal that is already known is
                // expected on every re-registration, and logging it loudly each
                // time is what made the log look like the app was failing.
                log::debug!("hotkey: {action} ({accel}) refused: {message}");
                refused.push(HotkeyError {
                    action: action.to_string(),
                    accelerator: accel.to_string(),
                    message,
                });
            }
        }
    }

    // Announce each distinct failure once, then keep it on the settings row.
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

    // The full current picture, so the dashboard can show what is actually
    // bound rather than only what the user asked for.
    publish_status(app, &refused);
    log::info!("hotkey: {bound} bound, {} refused", refused.len());
}

/// Release every combo we might be holding, one at a time.
///
/// The plugin's own `unregister_all` takes its map and then stops at the first
/// failure, so one un-unregisterable key leaves the rest held by the OS with
/// nothing left in the map to release them — and the next registration pass
/// then fails with "already registered" against *our own* keys, permanently.
/// Releasing per key and tolerating failures makes that impossible.
fn release_all(app: &tauri::AppHandle, cfg: &HotkeyConfig) {
    let gs = app.global_shortcut();
    // Best effort: clears the plugin's bookkeeping in one call.
    if let Err(e) = gs.unregister_all() {
        log::debug!("hotkey: bulk release reported {e}; releasing individually");
    }
    // Then per key, so a single failure cannot skip the ones after it.
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

/// Tell the dashboard which bindings the OS actually refused, so a combo that
/// silently does nothing is visible on its own row.
fn publish_status(app: &tauri::AppHandle, refused: &Vec<HotkeyError>) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            crate::events::emit_all(app, crate::events::HOTKEY_STATUS, refused);
        }
    }
}

/// Flip the master switch without going through the dashboard. Returns the
/// new state. The tray menu uses this so a bad binding can be killed from
/// the notification area instead of requiring a window.
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
fn dispatch(app: &tauri::AppHandle, action: &'static str) {
    // Blink before the action runs, and regardless of whether it then has
    // anything to act on: the whole point is to confirm the key registered,
    // and "nothing is playing" is still a response the user pressed a key for.
    //
    // A key press is also proof the user is present, so wake the lights here
    // rather than trusting the input hook's timing: the blink sits behind
    // `sleeping` in the engine's branch order, and idling is exactly when
    // someone reaches for a global hotkey with their eyes off the screen.
    crate::rgb::wake_if_sleeping();
    crate::rgb::request_hotkey_blink();

    // Media transport blocks until the target player answers its `Try*Async`,
    // so it goes to the blocking pool rather than stalling the shortcut
    // callback (and, on the dashboard's key path, the UI thread behind it).
    // The result is reported from the worker for the same reason.
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
        "nextProfile" => guard(crate::tray::cycle_profile(app), "no RGB profiles saved yet"),
        "nextScene" => guard(crate::tray::cycle_scene(app), "no scenes saved yet"),
        "nextWallpaper" => guard(
            crate::playlist::advance().is_some(),
            "the wallpaper vault is empty",
        ),
        other => Err(format!("unknown hotkey action: {other}")),
    };
    report_result(app, action, result);
}

/// The SMTC transport verb behind a media hotkey, if this action is one.
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
    fn media_actions_map_to_smtc_verbs() {
        assert_eq!(media_transport_action("playPause"), Some("toggle"));
        assert_eq!(media_transport_action("nextTrack"), Some("next"));
        assert_eq!(media_transport_action("prevTrack"), Some("previous"));
        // Everything else stays on the synchronous path; a stray Some here
        // would send an unknown verb to SMTC and silently do nothing.
        assert_eq!(media_transport_action("toggleDashboard"), None);
        assert_eq!(media_transport_action("volumeUp"), None);
    }

    #[test]
    fn validation_is_independent_of_the_master_switch() {
        // The recorder asks "would the OS take this combo?", not "are hotkeys
        // on right now" — a user must be able to edit their bindings while the
        // switch is off and turn it on afterwards.
        assert!(validate("Ctrl+Alt+M").is_ok());
    }

    // ---------- failure reporting ----------

    /// A refused binding, as the registration pass reports it.
    fn refused(action: &str, accelerator: &str, message: &str) -> HotkeyError {
        HotkeyError {
            action: action.into(),
            accelerator: accelerator.into(),
            message: message.into(),
        }
    }

    #[test]
    fn the_same_conflict_is_only_announced_once() {
        // The reported symptom: every re-registration re-raised a conflict that
        // had not changed.
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
        // The exact user report: disable the hotkeys, enable them again, and
        // the same "already registered" error came back every single time.
        let mut reported: Vec<String> = Vec::new();
        let errs = [refused("toggleMute", "Ctrl+Alt+M", "already registered")];

        assert_eq!(note_failures(&mut reported, &errs).len(), 1, "announced when first bound");

        // Switching off runs no registration pass, so it must not touch the
        // remembered failures. Another app owning Ctrl+Alt+M is a fact about
        // that app and is still true with our switch off.
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

        // Same action, different combo.
        assert_eq!(
            note_failures(&mut reported, &[refused("toggleMute", "Ctrl+Alt+N", "already registered")]).len(),
            1
        );
        // Same combo, different reason.
        assert_eq!(
            note_failures(&mut reported, &[refused("toggleMute", "Ctrl+Alt+M", "access denied")]).len(),
            1
        );
        // Different action, same combo.
        assert_eq!(
            note_failures(&mut reported, &[refused("playPause", "Ctrl+Alt+M", "already registered")]).len(),
            1
        );
    }

    #[test]
    fn a_fixed_binding_does_not_suppress_a_later_different_failure() {
        let mut reported: Vec<String> = Vec::new();
        note_failures(&mut reported, &[refused("toggleMute", "Ctrl+Alt+M", "already registered")]);

        // The user re-points the combo and it registers cleanly: nothing is
        // refused, so the stale entry is dropped.
        assert!(note_failures(&mut reported, &[]).is_empty());
        assert!(reported.is_empty(), "a resolved failure should be forgotten");

        // If the new combo later fails too, it must not be swallowed by the
        // old one's memory.
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

        // One of the two is fixed; the other is still refused and must be
        // remembered, but the fixed one is announced a second time only if it
        // is genuinely refused again.
        let fresh = note_failures(
            &mut reported,
            &[refused("toggleMute", "Ctrl+Alt+M", "already registered")],
        );
        assert!(fresh.is_empty(), "the untouched conflict should stay quiet");
        assert_eq!(reported.len(), 1, "the resolved one is forgotten");
    }

    #[test]
    fn a_failure_key_cannot_collide_across_its_fields() {
        // The separator must not be typeable into a combo, so "a|b" and
        // "a" + "b" cannot produce the same key.
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
