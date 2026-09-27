//! Wallpaper window management: one window per monitor, each sized exactly to
//! its display, attached behind the desktop icons. Re-syncs on display changes.

use crate::config::{WallpaperConfig, WallpaperKind};
use crate::win32;
use std::sync::Mutex;
use tauri::Manager;

static PAUSED: Mutex<bool> = Mutex::new(false);
/// User-requested pause (tray / future hotkey), OR-ed with automatic rules.
static MANUAL_PAUSE: Mutex<bool> = Mutex::new(false);

pub fn is_paused() -> bool {
    *PAUSED.lock().expect("pause mutex poisoned")
        || *MANUAL_PAUSE.lock().expect("pause mutex poisoned")
}

pub fn set_paused(p: bool) {
    *PAUSED.lock().expect("pause mutex poisoned") = p;
}

/// Toggle the manual pause and emit the new combined state.
pub fn toggle_manual_pause() -> bool {
    let mut m = MANUAL_PAUSE.lock().expect("pause mutex poisoned");
    *m = !*m;
    let combined = is_paused();
    drop(m);
    if let Some(app) = crate::app_handle() {
        let _ = crate::events::emit_all(&app, crate::events::WALLPAUSE, &combined);
    }
    combined
}

/// Stable window label for a monitor index: "wallpaper-0", "wallpaper-1", …
pub fn label_for(index: usize) -> String {
    format!("wallpaper-{index}")
}

/// Create (or re-position/re-attach) one wallpaper window per monitor.
pub fn ensure(app: &tauri::AppHandle) -> Result<(), String> {
    let mons = win32::monitors();
    if mons.is_empty() {
        return Err("no monitors detected".into());
    }

    for (index, m) in mons.iter().enumerate() {
        let label = label_for(index);
        match app.get_webview_window(&label) {
            Some(existing) => {
                // Skip redundant work only when the window covers EXACTLY this
                // monitor's rect and is still attached under the shell.
                // Re-running SetParent/SetWindowPos + the Progman 0x052C
                // broadcast on every config save makes the layer flicker, but
                // a window that merely exists is NOT enough: after a monitor
                // reorder the label→monitor mapping shifts and every window
                // must be verified against its assigned rect, not its label.
                let pos = existing.outer_position().map(|p| (p.x, p.y));
                let size = existing.outer_size().map(|s| (s.width as i64, s.height as i64));
                let pos_ok = pos.map(|(x, y)| (x - m.x).abs() <= 1 && (y - m.y).abs() <= 1).unwrap_or(false);
                let size_ok = size
                    .map(|(w, h)| (w - m.w.max(1) as i64).abs() <= 1 && (h - m.h.max(1) as i64).abs() <= 1)
                    .unwrap_or(false);
                let attached = hwnd_of(&existing)
                    .map(crate::workerw::is_attached)
                    .unwrap_or(false);
                if !pos_ok || !size_ok || !attached {
                    log::info!(
                        "wallpaper-{label}: repairing (pos_ok={pos_ok} size_ok={size_ok} attached={attached})"
                    );
                    crate::window_utils::reposition_window(&existing, m.x, m.y, m.w.max(1), m.h.max(1));
                    attach_existing(&existing, (m.x, m.y, m.w.max(1) as u32, m.h.max(1) as u32))?;
                    // The webview's cached monitor geometry is now wrong —
                    // nudge it to re-fetch immediately.
                    if let Some(app) = crate::app_handle() {
                        crate::events::emit_all(
                            &app,
                            crate::events::DISPLAY_CHANGED,
                            &win32::monitors(),
                        );
                    }
                }
            }
            None => {
                let window = crate::window_utils::build_wallpaper(
                    app,
                    &label,
                    tauri::WebviewUrl::App("wallpaper.html".into()),
                    "LumenDeck Wallpaper",
                    m.x,
                    m.y,
                    m.w.max(1),
                    m.h.max(1),
                )?;
                attach_existing(&window, (m.x, m.y, m.w.max(1) as u32, m.h.max(1) as u32))?;
            }
        }
        // Ground truth for geometry debugging: monitor rect vs actual window
        // rect after placement.
        if let Some(w) = app.get_webview_window(&label) {
            let pos = w.outer_position().map(|p| (p.x, p.y)).unwrap_or((-1, -1));
            let size = w.outer_size().map(|s| (s.width, s.height)).unwrap_or((0, 0));
            // Geometry ground truth: pure diagnostics, hidden at default level.
            log::debug!(
                "wallpaper-{index}: monitor=({},{} {}x{}) window=({},{} {}x{})",
                m.x, m.y, m.w, m.h, pos.0, pos.1, size.0, size.1
            );
        }
    }

    // Close windows for monitors that no longer exist.
    close_orphans(app, mons.len());
    Ok(())
}

fn close_orphans(app: &tauri::AppHandle, valid_count: usize) {
    for (label, _win) in app.webview_windows() {
        if let Some(idx) = label.strip_prefix("wallpaper-").and_then(|s| s.parse::<usize>().ok()) {
            if idx >= valid_count {
                if let Some(w) = app.get_webview_window(&label) {
                    let _ = w.close();
                }
            }
        }
    }
}

fn attach_existing(
    window: &tauri::WebviewWindow,
    monitor: (i32, i32, u32, u32),
) -> Result<(), String> {
    let hwnd = hwnd_of(window)?;
    match crate::workerw::attach(hwnd, monitor) {
        Ok(()) => Ok(()),
        Err(e) => {
            log::warn!("WorkerW attach failed ({e}); falling back to bottom-most window");
            win32::send_to_back(hwnd);
            Err(e)
        }
    }
}

pub fn hwnd_of(window: &tauri::WebviewWindow) -> Result<windows::Win32::Foundation::HWND, String> {
    let hwnd = window.hwnd().map_err(|e| format!("hwnd: {e}"))?;
    Ok(windows::Win32::Foundation::HWND(hwnd.0))
}

/// Detach and close every wallpaper window.
pub fn remove(app: &tauri::AppHandle) -> Result<(), String> {
    let mut labels: Vec<String> = app
        .webview_windows()
        .into_keys()
        .filter(|l| l.starts_with("wallpaper-"))
        .collect();
    labels.sort();
    for label in labels {
        if let Some(w) = app.get_webview_window(&label) {
            if let Ok(hwnd) = hwnd_of(&w) {
                let _ = crate::workerw::detach(hwnd);
            }
            let _ = w.close();
        }
    }
    Ok(())
}

/// Which media source string should a wallpaper webview render?
pub fn resolve_source(cfg: &WallpaperConfig) -> String {
    match cfg.kind {
        WallpaperKind::Video | WallpaperKind::Image => crate::media::to_media_url(&cfg.source),
        WallpaperKind::Slideshow => String::new(), // webview scans folder via IPC
        WallpaperKind::Web => cfg.source.clone(),
        WallpaperKind::Shader => cfg.source.clone(),
    }
}

/// Resolve the effective (kind, source) for one display: the per-monitor
/// override when present, else the global wallpaper.
pub fn resolve_for_monitor(cfg: &WallpaperConfig, device: &str) -> (WallpaperKind, String) {
    match cfg.per_monitor.get(device) {
        Some(pm) => (pm.kind, resolve_source_of(pm.kind, &pm.source)),
        None => (cfg.kind, resolve_source(cfg)),
    }
}

fn resolve_source_of(kind: WallpaperKind, source: &str) -> String {
    match kind {
        WallpaperKind::Video | WallpaperKind::Image => crate::media::to_media_url(source),
        WallpaperKind::Slideshow => String::new(),
        WallpaperKind::Web | WallpaperKind::Shader => source.to_string(),
    }
}
