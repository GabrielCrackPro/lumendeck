//! Windows theming hub: OS-level personalization driven by LumenDeck.
//!
//! - **Accent color sync**: the Windows accent color (taskbar/start highlights,
//!   window borders) follows the wallpaper's dominant color — the whole OS
//!   shifts tone with the wallpaper. Sampled from the same zone samples the
//!   RGB engine already receives, so it's zero extra capture work.
//! - **Taskbar colorization**: optionally let Windows color the taskbar /
//!   Start menu from the accent (Win11 "Show accent color on start and
//!   taskbar").
//!
//! All settings are opt-in (`general.*` config) and read live by the poller.

#![cfg(windows)]

use crate::config_store;
use std::sync::Mutex;
use windows::core::HSTRING;
use windows::Win32::System::Registry::{
    RegCloseKey, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY_CURRENT_USER, HKEY,
    KEY_QUERY_VALUE, KEY_SET_VALUE, REG_DWORD, REG_VALUE_TYPE,
};

/// Wallpaper->accent color sync is rate-limited: the OS applies accent
/// changes with a noticeable animation, so don't nudge it more than once
/// per MIN_UPDATE_MS, and only on meaningful color shifts.
static LAST_ACCENT: Mutex<Option<(u32, [u8; 3])>> = Mutex::new(None);
const MIN_ACCENT_UPDATE_MS: u32 = 10_000;
/// Color must drift at least this far (max per-channel delta) before we
/// push a new accent — avoids constant tiny animations on subtle video shifts.
const ACCENT_DELTA_MIN: u8 = 24;

/// Feed the current wallpaper dominant color. Call from the sample path;
/// cheap (one mutex + possibly a registry write) and rate-limited internally.
pub fn feed_wallpaper_color(rgb: [u8; 3]) {
    let cfg = config_store::get();
    if !cfg.general.accent_sync_enabled {
        return;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u32)
        .unwrap_or(0);

    {
        let last = LAST_ACCENT.lock().expect("accent mutex poisoned");
        if let Some((ts, color)) = *last {
            let delta = rgb
                .iter()
                .zip(color.iter())
                .map(|(a, b)| a.abs_diff(*b))
                .max()
                .unwrap_or(0);
            if now - ts < MIN_ACCENT_UPDATE_MS || delta < ACCENT_DELTA_MIN {
                return;
            }
        }
    }

    if set_accent_color(rgb) {
        *LAST_ACCENT.lock().expect("accent mutex poisoned") = Some((now, rgb));
        // Record what we wrote so the registry poll can tell our own write from
        // a user's change. Shared across threads because the write happens on
        // the sampling path and the poll on the watcher thread.
        if let Ok(mut guard) = LAST_WRITTEN.get_or_init(Mutex::default).lock() {
            *guard = Some(rgb);
        }
    }
}

/// The last accent this process wrote to the registry, or `None` if it has
/// never written one (accent sync off, or every write so far was rejected).
static LAST_WRITTEN: std::sync::OnceLock<Mutex<Option<[u8; 3]>>> = std::sync::OnceLock::new();

fn last_write() -> Option<[u8; 3]> {
    LAST_WRITTEN
        .get()
        .and_then(|m| m.lock().ok().and_then(|g| *g))
}

/// Forget our last recorded write, so a later genuine change that happens to
/// match it is still reported. Called when accent sync is switched off.
pub fn forget_last_write() {
    if let Some(m) = LAST_WRITTEN.get() {
        if let Ok(mut g) = m.lock() {
            *g = None;
        }
    }
}

/// Set the Windows accent color (ColorPrecedence + AccentColor, ABGR packed).
/// Also enables "Show accent color on Start and taskbar" when
/// `taskbar_colorization` is on (via ColorPrecedence=0).
pub fn set_accent_color(rgb: [u8; 3]) -> bool {
    unsafe {
        let path = HSTRING::from(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Accent");
        let mut hkey = HKEY::default();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            &path,
            Some(0),
            KEY_SET_VALUE | KEY_QUERY_VALUE,
            &mut hkey,
        )
        .is_err()
        {
            return false;
        }
        // AccentColor is 0xAABBGGRR. Alpha 0 = fully opaque accent.
        let packed = 0xFFu32 << 24
            | (rgb[2] as u32) << 16
            | (rgb[1] as u32) << 8
            | rgb[0] as u32;
        let ok = write_dword(&hkey, "AccentColor", packed)
            && write_dword(&hkey, "StartColorMenu", packed)
            && write_dword(&hkey, "ColorPrecedence", 0);
        let _ = RegCloseKey(hkey);
        if ok {
            log::info!("sys-theme: accent color -> rgb({},{},{})", rgb[0], rgb[1], rgb[2]);
        }
        ok
    }
}

unsafe fn write_dword(hkey: &HKEY, name: &str, value: u32) -> bool {
    let wide = HSTRING::from(name);
    let bytes = value.to_le_bytes();
    RegSetValueExW(
        *hkey,
        &wide,
        Some(0),
        REG_DWORD,
        Some(&bytes),
    )
    .is_ok()
}

unsafe fn read_dword(hkey: &HKEY, name: &str) -> Option<u32> {
    let wide = HSTRING::from(name);
    let mut value: u32 = 0;
    let mut size = 4u32;
    let mut vtype = REG_VALUE_TYPE::default();
    let ok = RegQueryValueExW(
        *hkey,
        &wide,
        None,
        Some(&mut vtype),
        Some(&mut value as *mut u32 as *mut u8),
        Some(&mut size),
    )
    .is_ok();
    ok.then_some(value)
}

/// Spawns a background watcher that polls the Windows accent color and
/// emits `system-accent-changed` when it changes. Polling the registry every
/// few seconds is far cheaper and simpler than a message-only window for
/// WM_SETTINGCHANGE, and a few seconds of latency is fine for a theme change.
pub fn spawn_accent_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        use crate::accent_watch::{AccentVerdict, AccentWatch};
        // Seeded from what is already in the registry, so the first poll does
        // not report the user's existing accent as a change.
        let mut watch = AccentWatch::new();
        watch.seed(get_system_accent());
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3));
            let cur = get_system_accent();
            if let AccentVerdict::Emit = watch.observe(cur, last_write()) {
                if let Some(rgb) = cur {
                    log::info!(
                        "sys-theme: system accent changed -> rgb({},{},{})",
                        rgb[0], rgb[1], rgb[2]
                    );
                    crate::events::emit_all(&app, crate::events::SYSTEM_ACCENT, &rgb);
                }
            }
        }
    });
}

/// Read the user's current Windows accent color (the taskbar/Start
/// highlight). Returns None when the registry read fails. Used by the
/// dashboard as its UI accent fallback so the interface matches the system
/// theme out of the box.
pub fn get_system_accent() -> Option<[u8; 3]> {
    unsafe {
        let path = HSTRING::from(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Accent");
        let mut hkey = HKEY::default();
        if RegOpenKeyExW(HKEY_CURRENT_USER, &path, Some(0), KEY_QUERY_VALUE, &mut hkey).is_err() {
            return None;
        }
        let packed = read_dword(&hkey, "AccentColor");
        let _ = RegCloseKey(hkey);
        // 0xAABBGGRR — alpha byte may be 0 or FF; mask it off either way.
        packed.map(|v| {
            [(v & 0xFF) as u8, ((v >> 8) & 0xFF) as u8, ((v >> 16) & 0xFF) as u8]
        })
    }
}

/// Preserve the user's original accent so "restore" puts it back.
pub fn remember_original_accent() {
    unsafe {
        let path = HSTRING::from(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Accent");
        let mut hkey = HKEY::default();
        if RegOpenKeyExW(HKEY_CURRENT_USER, &path, Some(0), KEY_QUERY_VALUE, &mut hkey).is_ok() {
            if let Some(v) = read_dword(&hkey, "AccentColor") {
                let _ = write_dword(&hkey, "LumenDeckAccentBackup", v);
                log::debug!("sys-theme: backed up original accent {v:#010x}");
            }
            let _ = RegCloseKey(hkey);
        }
    }
}

/// Restore the accent saved before the first sync (no-op if never synced).
pub fn restore_original_accent() {
    unsafe {
        let path = HSTRING::from(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Accent");
        let mut hkey = HKEY::default();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            &path,
            Some(0),
            KEY_QUERY_VALUE | KEY_SET_VALUE,
            &mut hkey,
        )
        .is_err()
        {
            return;
        }
        if let Some(v) = read_dword(&hkey, "LumenDeckAccentBackup") {
            let _ = write_dword(&hkey, "AccentColor", v);
            let _ = write_dword(&hkey, "StartColorMenu", v);
            log::info!("sys-theme: original accent restored");
        }
        let _ = RegCloseKey(hkey);
    }
}

/// The Windows accent changes take effect for new windows; broadcast a
/// settings-change so Explorer picks it up. Implemented via a trivial
/// SystemParametersInfo call with SPI_SETNONCLIENTMETRICS (harmless refresh).
pub fn refresh_system_appearance() {
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    };
    unsafe {
        let _ = SystemParametersInfoW(
            windows::Win32::UI::WindowsAndMessaging::SPI_SETNONCLIENTMETRICS,
            0,
            None,
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        );
    }
}
