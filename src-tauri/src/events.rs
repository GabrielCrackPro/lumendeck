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
/// Sticker-editor mouse stream: (x, y, leftDown, rightDown) physical px.
pub const EDITOR_MOUSE: &str = "sticker-editor-mouse";
/// Sticker-editor on/off; payload: bool.
pub const EDITOR_STATE: &str = "sticker-editor";
pub const RGB_STATUS: &str = "rgb-status";
pub const WALLPAUSE: &str = "wallpaper-pause";
/// Emitted after a display-topology resync; payload is the new monitor list.
pub const DISPLAY_CHANGED: &str = "display-changed";
/// Emitted by the RGB engine after each push; payload: Vec<{id, rgb}>.
pub const RGB_FRAME: &str = "rgb-frame";

/// Emit an event to all webviews (main app, wallpaper, stickers, placement).
pub fn emit_all<T: serde::Serialize + Clone>(app: &tauri::AppHandle, event: &str, payload: &T) {
    use tauri::Emitter;
    if let Err(e) = app.emit(event, payload) {
        log::warn!("emit {event} failed: {e}");
    }
}
