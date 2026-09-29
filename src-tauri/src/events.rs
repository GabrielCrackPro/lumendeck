//! Event name constants and emit helpers.

pub const CONFIG_CHANGED: &str = "config-changed";
/// Emitted only when the config was reloaded from disk (external edit),
/// not for UI-driven saves. Listeners use it for feedback like toasts.
pub const CONFIG_RELOADED: &str = "config-reloaded";
pub const ZONE_SAMPLE: &str = "zone-sample";
/// Emitted when a sticker placement starts/ends; payload: Some(media URL)
/// while armed, None when finished. The wallpaper shows a live preview.
pub const PLACING: &str = "sticker-placing";
/// Live cursor position while placing; payload {x, y} physical screen px.
pub const PLACING_CURSOR: &str = "sticker-placing-cursor";
/// Live preview size while placing (mouse wheel); payload: i32 physical px.
pub const PLACING_SIZE: &str = "sticker-placing-size";
/// Sticker-editor mouse stream: (x, y, leftDown, rightDown) physical px.
pub const EDITOR_MOUSE: &str = "sticker-editor-mouse";
/// Sticker-editor on/off; payload: bool.
pub const EDITOR_STATE: &str = "sticker-editor";
pub const RGB_STATUS: &str = "rgb-status";
pub const WALLPAPER_COLOR: &str = "wallpaper-color";
pub const WALLPAUSE: &str = "wallpaper-pause";
/// Emitted after a display-topology resync; payload is the new monitor list.
pub const DISPLAY_CHANGED: &str = "display-changed";
/// Emitted by the RGB engine after each push; payload: Vec<{id, rgb}>.
pub const RGB_FRAME: &str = "rgb-frame";
/// Emitted with audio level data; payload: { volume: f32, beat: bool }.
pub const AUDIO_LEVEL: &str = "audio-level";
/// Emitted when the OS media session (SMTC) changes; payload: MediaInfo or
/// null when nothing is playing. At most once per track/state change.
pub const MEDIA_SESSION: &str = "media-session";
/// Emitted when the user (or the OS) changes the Windows accent color;
/// payload: [r, g, b]. Lets the dashboard retheme live without a restart.
pub const SYSTEM_ACCENT: &str = "system-accent-changed";
/// Emitted whenever the system master volume or mute changes (any source);
/// payload: [volume_percent, muted_flag] floats. Lets the player's volume
/// slider mirror keyboard/taskbar/other-app changes live.
pub const VOLUME_CHANGED: &str = "volume-changed";
/// Emitted when a global hotkey could not be taken (another app owns the
/// combo) or when a pressed hotkey had nothing to act on. Payload:
/// `HotkeyError { action, accelerator, message }`.
pub const HOTKEY_ERROR: &str = "hotkey-error";

/// Final preview size chosen with the wheel during the last placement.
static PLACEMENT_SIZE: std::sync::Mutex<Option<i32>> = std::sync::Mutex::new(None);

pub fn set_placement_size(px: i32) {
    *PLACEMENT_SIZE.lock().expect("size poisoned") = Some(px);
}

pub fn take_placement_size() -> Option<i32> {
    PLACEMENT_SIZE.lock().expect("size poisoned").take()
}

/// Emit an event to all webviews (main app, wallpaper, stickers, placement).
pub fn emit_all<T: serde::Serialize + Clone>(app: &tauri::AppHandle, event: &str, payload: &T) {
    use tauri::Emitter;
    if let Err(e) = app.emit(event, payload) {
        log::warn!("emit {event} failed: {e}");
    }
}
