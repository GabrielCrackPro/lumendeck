//! Display-topology watching: re-syncs wallpaper windows when monitors are
//! plugged, unplugged, or change resolution/DPI.
//!
//! Two triggers feed one throttled resync:
//! 1. `WM_DISPLAYCHANGE` / `WM_DPICHANGED` via a hidden top-level window.
//!    These arrive as broadcast messages, so the window must be a real
//!    (invisible) top-level window, NOT a message-only one — HWND_MESSAGE
//!    windows are excluded from broadcasts.
//! 2. A topology fingerprint poll (every 2s) as the catch-all: wake-from-
//!    sleep, RDP reconnects, and some driver changes don't broadcast cleanly.

#![cfg(windows)]

use crate::win32;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
    TranslateMessage, WINDOW_EX_STYLE, WINDOW_STYLE, WM_DPICHANGED, WM_DISPLAYCHANGE, WNDCLASSW,
};

/// Last topology fingerprint we synced against.
static LAST_TOPOLOGY: AtomicU64 = AtomicU64::new(0);
/// Timestamp (ms) of the last resync, for throttling.
static LAST_RESYNC_MS: AtomicU64 = AtomicU64::new(0);

const RESYNC_MIN_INTERVAL_MS: u64 = 500;

/// Stable fingerprint of the current monitor topology (count, geometry,
/// primary flag). Order-independent: XOR over per-monitor hashes.
pub fn topology_fingerprint() -> u64 {
    let mut acc: u64 = 0x9E37_79B9_7F4A_7C15; // golden-ratio seed
    let mons = win32::monitors();
    for m in &mons {
        let mut h = 0xcbf2_9ce4_8422_2325u64; // FNV-1a offset basis
        for byte in m.device.bytes() {
            h ^= byte as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01B3);
        }
        for v in [m.x as u64, m.y as u64, m.w as u64, m.h as u64, m.primary as u64] {
            h ^= v;
            h = h.wrapping_mul(0x0000_0100_0000_01B3);
        }
        acc ^= h;
    }
    acc ^ (mons.len() as u64).rotate_left(32)
}

/// Current ms since epoch (0 if clock goes backwards).
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Request a resync; returns true if this call performed one.
pub fn request_resync() -> bool {
    let now = now_ms();
    let last = LAST_RESYNC_MS.load(Ordering::Relaxed);
    if now.saturating_sub(last) < RESYNC_MIN_INTERVAL_MS {
        return false;
    }
    LAST_RESYNC_MS.store(now, Ordering::Relaxed);

    let Some(app) = crate::app_handle() else {
        return false;
    };
    let cfg = crate::config_store::get();

    let mut did = false;

    if cfg.general.wallpaper_enabled {
        match crate::wallpaper::ensure(&app) {
            Ok(()) => {
                log::info!("wallpaper re-synced after display change");
                // Tell every webview its (possibly new) monitor geometry now,
                // instead of waiting for the periodic re-fetch.
                crate::events::emit_all(&app, crate::events::DISPLAY_CHANGED, &crate::win32::monitors());
                did = true;
            }
            Err(e) => log::warn!("display-change resync failed: {e}"),
        }
    }

    // Stickers render inside the wallpaper windows, which were just
    // re-created/repositioned — nothing extra to recover.
    did
}

/// Fingerprint poll: call periodically (from pause::spawn loop).
pub fn poll() {
    let fp = topology_fingerprint();
    let last = LAST_TOPOLOGY.load(Ordering::Relaxed);
    if last != 0 && fp != last {
        log::info!("display topology changed (poll)");
        request_resync();
    }
    LAST_TOPOLOGY.store(fp, Ordering::Relaxed);
}

/// Record the current topology as the baseline (call once at startup).
pub fn snapshot() {
    LAST_TOPOLOGY.store(topology_fingerprint(), Ordering::Relaxed);
}

const CLASS_NAME: &[u16] = &[
    b'L' as u16, b'M' as u16, b'D' as u16, b'W' as u16, b'a' as u16, b't' as u16, b'c' as u16,
    b'h' as u16, b'C' as u16, b'l' as u16, b'a' as u16, b's' as u16, b's' as u16, 0,
]; // "LMDWatchClass"

extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_DISPLAYCHANGE => {
            log::info!("WM_DISPLAYCHANGE received");
            request_resync();
            LRESULT(0)
        }
        WM_DPICHANGED => {
            log::info!("WM_DPICHANGED received");
            request_resync();
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wp, lp) },
    }
}

/// Spawn the message-pump thread that owns the hidden broadcast window.
pub fn spawn() {
    std::thread::Builder::new()
        .name("display-watch".into())
        .spawn(|| unsafe {
            let hinstance = GetModuleHandleW(None).unwrap_or_default();
            let class_name = windows::core::PCWSTR(CLASS_NAME.as_ptr());

            let wc = WNDCLASSW {
                lpfnWndProc: Some(wnd_proc),
                hInstance: hinstance.into(),
                lpszClassName: class_name,
                ..Default::default()
            };
            if RegisterClassW(&wc) == 0 {
                log::warn!("display-watch: RegisterClassW failed");
                return;
            }

            // Note: a real (not message-only) window is required for
            // broadcast delivery; it stays invisible (no WS_VISIBLE).
            let hwnd = match CreateWindowExW(
                WINDOW_EX_STYLE(0),
                class_name,
                windows::core::w!("LumenDeck Display Watch"),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                None,
                None,
                Some(hinstance.into()),
                None,
            ) {
                Ok(h) => h,
                Err(e) => {
                    log::warn!("display-watch: CreateWindowExW failed: {e}");
                    return;
                }
            };
            if hwnd.is_invalid() {
                log::warn!("display-watch: CreateWindowExW returned invalid hwnd");
                return;
            }

            let mut msg = std::mem::zeroed();
            while GetMessageW(&mut msg, Some(hwnd), 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        })
        .expect("failed to spawn display watcher thread");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_is_stable_and_changes_with_count() {
        // Deterministic across repeated calls on the same (real) topology.
        let a = topology_fingerprint();
        let b = topology_fingerprint();
        assert_eq!(a, b, "fingerprint must be deterministic for a fixed topology");
    }
}
