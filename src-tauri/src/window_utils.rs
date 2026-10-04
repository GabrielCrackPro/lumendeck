//! Shared window helpers: overlay builder, close-by-label-prefix.

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

/// Whether a webview may be opened in an inspector.
///
/// Always false. With no inspector, F12 and Ctrl+Shift+I are inert, which is the
/// only reliable way to stop them: they are host-level accelerators, consumed
/// before the page sees a key event, so a JavaScript handler cannot intercept
/// them and calling `preventDefault` would be theatre.
///
/// A release build was already covered by the absence of tauri's `devtools`
/// cargo feature, which a release webview needs before it can expose one at
/// all. Stating it at the window means a build that gains that feature later
/// does not quietly hand every user an inspector, and that the dev build is a
/// deliberate choice rather than an accident.
///
/// Development escape hatch: return true here to inspect `pnpm app:dev`, and
/// put it back before shipping.
pub fn devtools_allowed() -> bool {
    false
}

/// Build a borderless, non-resizable overlay window covering a monitor rect.
/// `transparent` and `always_on_top` are always enabled (suitable for stickers
/// and placement overlays). The window is positioned to exact physical coords.
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

/// Build a wallpaper window (opaque, not always-on-top, not transparent).
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

/// Force-reposition an existing window to a monitor rect.
pub fn reposition_window(window: &tauri::WebviewWindow, x: i32, y: i32, w: i32, h: i32) {
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.set_size(PhysicalSize::new(w.max(1) as u32, h.max(1) as u32));
}

/// Close every webview window whose label starts with `prefix`.
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
        // F12 and Ctrl+Shift+I are host-level accelerators: they are consumed
        // before the page sees a key event, so nothing in the frontend can stop
        // them. This flag is the whole mechanism, which makes it worth pinning --
        // returning true here while debugging is easy, and forgetting to put it
        // back is invisible until someone opens devtools in a shipped build.
        assert!(!devtools_allowed());
    }
}
