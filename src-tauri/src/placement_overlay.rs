
#![cfg(windows)]

use tauri::Manager;

fn label(index: usize) -> String {
    format!("placement-{index}")
}

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

pub fn hide(app: &tauri::AppHandle) {
    crate::window_utils::close_by_prefix(app, "placement-");
}
