
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

pub fn devtools_allowed() -> bool {
    false
}

pub fn build_overlay(
    app: &AppHandle,
    label: &str,
    url: WebviewUrl,
    title: &str,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
) -> Result<tauri::WebviewWindow, String> {
    let window = WebviewWindowBuilder::new(app, label, url)
        .title(title)
        .position(x as f64, y as f64)
        .inner_size(w.max(1) as f64, h.max(1) as f64)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .focused(false)
        .transparent(true)
        .always_on_top(true)
        .visible(true)
        .devtools(devtools_allowed())
        .build()
        .map_err(|e| format!("{title} build failed: {e}"))?;
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.set_size(PhysicalSize::new(w.max(1) as u32, h.max(1) as u32));
    Ok(window)
}

pub fn build_wallpaper(
    app: &AppHandle,
    label: &str,
    url: WebviewUrl,
    title: &str,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
) -> Result<tauri::WebviewWindow, String> {
    let window = WebviewWindowBuilder::new(app, label, url)
        .title(title)
        .position(x as f64, y as f64)
        .inner_size(w.max(1) as f64, h.max(1) as f64)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .focused(false)
        .visible(true)
        .devtools(devtools_allowed())
        .build()
        .map_err(|e| format!("wallpaper window build failed: {e}"))?;
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.set_size(PhysicalSize::new(w.max(1) as u32, h.max(1) as u32));
    Ok(window)
}

pub fn reposition_window(window: &tauri::WebviewWindow, x: i32, y: i32, w: i32, h: i32) {
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.set_size(PhysicalSize::new(w.max(1) as u32, h.max(1) as u32));
}

pub fn close_by_prefix(app: &AppHandle, prefix: &str) {
    let labels: Vec<String> = app
        .webview_windows()
        .into_keys()
        .filter(|l| l.starts_with(prefix))
        .collect();
    for lbl in labels {
        if let Some(w) = app.get_webview_window(&lbl) {
            let _ = w.close();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::devtools_allowed;

    #[test]
    fn no_webview_may_be_opened_in_an_inspector() {
        assert!(!devtools_allowed());
    }
}
