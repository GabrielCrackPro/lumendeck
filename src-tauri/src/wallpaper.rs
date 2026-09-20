//! Wallpaper window management: one window per monitor, each sized exactly to
//! its display, attached behind the desktop icons. Re-syncs on display changes.

use crate::config::{WallpaperConfig, WallpaperKind};
use crate::win32;
use std::sync::Mutex;
use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

static PAUSED: Mutex<bool> = Mutex::new(false);

pub fn is_paused() -> bool {
    *PAUSED.lock().expect("pause mutex poisoned")
}

pub fn set_paused(p: bool) {
    *PAUSED.lock().expect("pause mutex poisoned") = p;
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
                // Skip redundant work when the window already covers the right
                // monitor rect and is still attached under the shell. Re-running
                // SetParent/SetWindowPos + the Progman 0x052C broadcast on every
                // config save is what makes the wallpaper layer flicker.
                let pos_ok = existing
                    .outer_position()
                    .map(|p| (p.x - m.x).abs() <= 1 && (p.y - m.y).abs() <= 1)
                    .unwrap_or(false);
                let size_ok = existing
                    .outer_size()
                    .map(|s| {
                        (s.width as i64 - m.w.max(1) as i64).abs() <= 1
                            && (s.height as i64 - m.h.max(1) as i64).abs() <= 1
                    })
                    .unwrap_or(false);
                let attached = hwnd_of(&existing)
                    .map(crate::workerw::is_attached)
                    .unwrap_or(false);
                if !pos_ok || !size_ok || !attached {
                    let _ = existing.set_position(PhysicalPosition::new(m.x, m.y));
                    let _ = existing.set_size(PhysicalSize::new(
                        m.w.max(1) as u32,
                        m.h.max(1) as u32,
                    ));
                    attach_existing(&existing, (m.x, m.y, m.w.max(1) as u32, m.h.max(1) as u32))?;
                }
            }
            None => {
                let window = WebviewWindowBuilder::new(
                    app,
                    label.clone(),
                    WebviewUrl::App("wallpaper.html".into()),
                )
                .title("LumenDeck Wallpaper")
                // Builder values are logical (DPI-scaled); pass the raw monitor
                // rect only as an initial guess, then force the exact physical
                // rect below before attaching.
                .position(m.x as f64, m.y as f64)
                .inner_size(m.w.max(1) as f64, m.h.max(1) as f64)
                .decorations(false)
                .shadow(false)
                .skip_taskbar(true)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .focused(false)
                .visible(true)
                .build()
                .map_err(|e| format!("wallpaper window build failed: {e}"))?;
                // Lively-style DPI correctness: the window must cover the
                // monitor's physical rect exactly, regardless of scale factor.
                let _ = window.set_position(PhysicalPosition::new(m.x, m.y));
                let _ = window.set_size(PhysicalSize::new(
                    m.w.max(1) as u32,
                    m.h.max(1) as u32,
                ));
                attach_existing(&window, (m.x, m.y, m.w.max(1) as u32, m.h.max(1) as u32))?;
            }
        }
        // Ground truth for geometry debugging: monitor rect vs actual window
        // rect after placement.
        if let Some(w) = app.get_webview_window(&label) {
            let pos = w.outer_position().map(|p| (p.x, p.y)).unwrap_or((-1, -1));
            let size = w.outer_size().map(|s| (s.width, s.height)).unwrap_or((0, 0));
            log::info!(
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
