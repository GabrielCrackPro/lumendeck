
#![cfg(windows)]

use tauri::Manager;

fn label(id: &str) -> String {
    format!("sticker-top-{id}")
}

pub fn sync(app: &tauri::AppHandle) {
    let cfg = crate::config_store::get();
    let wanted: Vec<&crate::config::StickerDef> =
        cfg.stickers.iter().filter(|s| s.on_top && s.visible).collect();

    let current: Vec<String> = app
        .webview_windows()
        .into_keys()
        .filter(|l| l.starts_with("sticker-top-"))
        .collect();
    for lbl in current {
        let id = lbl.trim_start_matches("sticker-top-").to_string();
        if !wanted.iter().any(|s| s.id == id) {
            if let Some(w) = app.get_webview_window(&lbl) {
                let _ = w.close();
            }
        }
    }

    for s in wanted {
        let lbl = label(&s.id);
        match app.get_webview_window(&lbl) {
            Some(existing) => {
                crate::window_utils::reposition_window(&existing, s.x, s.y, s.w.max(8) as i32, s.h.max(8) as i32);
                let _ = existing.set_always_on_top(true);
            }
            None => {
                let window = match crate::window_utils::build_overlay(
                    app,
                    &lbl,
                    tauri::WebviewUrl::App("sticker.html".into()),
                    "LumenDeck Sticker",
                    s.x,
                    s.y,
                    s.w.max(8) as i32,
                    s.h.max(8) as i32,
                ) {
                    Ok(w) => w,
                    Err(e) => {
                        log::warn!("top sticker window build failed: {e}");
                        continue;
                    }
                };
                if let Ok(hwnd) = crate::wallpaper::hwnd_of(&window) {
                    crate::win32::set_click_through(hwnd, true);
                    crate::win32::make_tool_window(hwnd);
                }
                log::info!("top sticker window created: id={}", s.id);
            }
        }
    }
}

pub fn close_all(app: &tauri::AppHandle) {
    crate::window_utils::close_by_prefix(app, "sticker-top-");
}
