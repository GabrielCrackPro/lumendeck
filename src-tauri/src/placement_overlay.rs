//! Placement overlay windows: one transparent, topmost, click-through window
//! per monitor shown while a sticker placement is armed. Gives the user
//! explicit on-screen feedback (veil + cursor-following preview) on every
//! display, above desktop icons and normal windows.

#![cfg(windows)]

use tauri::Manager;

fn label(index: usize) -> String {
    format!("placement-{index}")
}

/// Show overlays on every monitor with the given placement media URL.
pub fn show(app: &tauri::AppHandle, url: &str, name: &str) -> Result<(), String> {
    let mons = crate::win32::monitors();
    for (index, m) in mons.iter().enumerate() {
        let lbl = label(index);
        if let Some(existing) = app.get_webview_window(&lbl) {
            crate::window_utils::reposition_window(&existing, m.x, m.y, m.w.max(1), m.h.max(1));
            let _ = existing.show();
            let _ = existing.set_focus();
            let _ = existing.eval(&format!(
                "window.__placementSet({});",
                serde_json::json!({ "url": url, "name": name })
            ));
            continue;
        }
        let window = crate::window_utils::build_overlay(
            app,
            &lbl,
            tauri::WebviewUrl::App("placement.html".into()),
            "LumenDeck Placement",
            m.x,
            m.y,
            m.w.max(1),
            m.h.max(1),
        )?;
        if let Ok(hwnd) = crate::wallpaper::hwnd_of(&window) {
            crate::win32::set_input_transparent(hwnd, true);
        }
        let _ = window.set_always_on_top(true);
        let _ = window.eval(&format!(
            "window.__placementSet({});",
            serde_json::json!({ "url": url, "name": name })
        ));
    }
    Ok(())
}

/// Hide and destroy all placement overlays.
pub fn hide(app: &tauri::AppHandle) {
    crate::window_utils::close_by_prefix(app, "placement-");
}
