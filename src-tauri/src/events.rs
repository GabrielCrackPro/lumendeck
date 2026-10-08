
pub const CONFIG_CHANGED: &str = "config-changed";
pub const CONFIG_RELOADED: &str = "config-reloaded";
pub const ZONE_SAMPLE: &str = "zone-sample";
pub const PLACING: &str = "sticker-placing";
pub const PLACING_CURSOR: &str = "sticker-placing-cursor";
pub const PLACING_SIZE: &str = "sticker-placing-size";
pub const EDITOR_MOUSE: &str = "sticker-editor-mouse";
pub const EDITOR_STATE: &str = "sticker-editor";
pub const RGB_STATUS: &str = "rgb-status";
pub const WALLPAPER_COLOR: &str = "wallpaper-color";
pub const WALLPAUSE: &str = "wallpaper-pause";
pub const DISPLAY_CHANGED: &str = "display-changed";
pub const RGB_FRAME: &str = "rgb-frame";
pub const AUDIO_LEVEL: &str = "audio-level";
pub const MEDIA_SESSION: &str = "media-session";
pub const SYSTEM_ACCENT: &str = "system-accent-changed";
pub const VOLUME_CHANGED: &str = "volume-changed";
pub const HOTKEY_ERROR: &str = "hotkey-error";
pub const HOTKEY_STATUS: &str = "hotkey-status";

static PLACEMENT_SIZE: std::sync::Mutex<Option<i32>> = std::sync::Mutex::new(None);

pub fn set_placement_size(px: i32) {
    *PLACEMENT_SIZE.lock().expect("size poisoned") = Some(px);
}

pub fn take_placement_size() -> Option<i32> {
    PLACEMENT_SIZE.lock().expect("size poisoned").take()
}

pub fn emit_all<T: serde::Serialize + Clone>(app: &tauri::AppHandle, event: &str, payload: &T) {
    use tauri::Emitter;
    if let Err(e) = app.emit(event, payload) {
        log::warn!("emit {event} failed: {e}");
    }
}
