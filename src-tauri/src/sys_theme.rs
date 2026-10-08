
#![cfg(windows)]

use crate::config_store;
use std::sync::Mutex;
use windows::core::HSTRING;
use windows::Win32::System::Registry::{
    RegCloseKey, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY_CURRENT_USER, HKEY,
    KEY_QUERY_VALUE, KEY_SET_VALUE, REG_DWORD, REG_VALUE_TYPE,
};

static LAST_ACCENT: Mutex<Option<(u64, [u8; 3])>> = Mutex::new(None);
const MIN_ACCENT_UPDATE_MS: u64 = 10_000;
const ACCENT_DELTA_MIN: u8 = 24;

fn accent_update_allowed(
    now_ms: u64,
    last: Option<(u64, [u8; 3])>,
    rgb: [u8; 3],
) -> bool {
    let Some((ts, color)) = last else {
        return true;
    };
    if now_ms.saturating_sub(ts) < MIN_ACCENT_UPDATE_MS {
        return false;
    }
    let delta = rgb
        .iter()
        .zip(color.iter())
        .map(|(a, b)| a.abs_diff(*b))
        .max()
        .unwrap_or(0);
    delta >= ACCENT_DELTA_MIN
}

pub fn feed_wallpaper_color(rgb: [u8; 3]) {
    let cfg = config_store::get();
    if !cfg.general.accent_sync_enabled {
        return;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let now = now.min(u64::MAX as u128) as u64;

    let previous = {
        let mut guard = LAST_ACCENT.lock().unwrap_or_else(|e| e.into_inner());
        if !accent_update_allowed(now, *guard, rgb) {
            return;
        }
        *guard = Some((now, rgb));
        *guard
    };

    if set_accent_color(rgb) {
        if let Ok(mut guard) = LAST_WRITTEN.get_or_init(Mutex::default).lock() {
            *guard = Some(rgb);
        }
    } else {
        let mut guard = LAST_ACCENT.lock().unwrap_or_else(|e| e.into_inner());
        if guard.map(|(ts, color)| (ts, color)) == Some((now, rgb)) {
            *guard = previous;
        }
    }
}

static LAST_WRITTEN: std::sync::OnceLock<Mutex<Option<[u8; 3]>>> = std::sync::OnceLock::new();

fn last_write() -> Option<[u8; 3]> {
    LAST_WRITTEN
        .get()
        .and_then(|m| m.lock().ok().and_then(|g| *g))
}

pub fn forget_last_write() {
    if let Some(m) = LAST_WRITTEN.get() {
        if let Ok(mut g) = m.lock() {
            *g = None;
        }
    }
}

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
        let packed = 0xFFu32 << 24
            | (rgb[2] as u32) << 16
            | (rgb[1] as u32) << 8
            | rgb[0] as u32;
        let ok = write_dword(&hkey, "AccentColor", packed)
            && write_dword(&hkey, "StartColorMenu", packed)
            && write_dword(&hkey, "ColorPrecedence", 0);
        let _ = RegCloseKey(hkey);
        if ok {
            refresh_system_appearance();
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

pub fn spawn_accent_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        use crate::accent_watch::{AccentVerdict, AccentWatch};
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

pub fn get_system_accent() -> Option<[u8; 3]> {
    unsafe {
        let path = HSTRING::from(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Accent");
        let mut hkey = HKEY::default();
        if RegOpenKeyExW(HKEY_CURRENT_USER, &path, Some(0), KEY_QUERY_VALUE, &mut hkey).is_err() {
            return None;
        }
        let packed = read_dword(&hkey, "AccentColor");
        let _ = RegCloseKey(hkey);
        packed.map(|v| {
            [(v & 0xFF) as u8, ((v >> 8) & 0xFF) as u8, ((v >> 16) & 0xFF) as u8]
        })
    }
}

pub fn remember_original_accent() {
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
        .is_ok()
        {
            if let Some(v) = read_dword(&hkey, "AccentColor") {
                if write_dword(&hkey, "LumenDeckAccentBackup", v) {
                    log::debug!("sys-theme: backed up original accent {v:#010x}");
                } else {
                    log::warn!("sys-theme: could not back up the original accent; restore will be a no-op");
                }
            }
            let _ = RegCloseKey(hkey);
        }
    }
}

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
            refresh_system_appearance();
            log::info!("sys-theme: original accent restored");
        } else {
            log::warn!("sys-theme: no accent backup found; nothing to restore");
        }
        let _ = RegCloseKey(hkey);
    }
}

pub fn refresh_system_appearance() {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, SMTO_NORMAL,
        WM_SETTINGCHANGE,
    };
    for setting in ["ImmersiveColorSet", "WindowsThemeElement"] {
        unsafe {
            let name = HSTRING::from(setting);
            let _ = SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                WPARAM(0),
                LPARAM(name.as_ptr() as isize),
                SMTO_ABORTIFHUNG | SMTO_NORMAL,
                2000,
                None,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: [u8; 3] = [200, 40, 40];
    const BLUE: [u8; 3] = [40, 40, 200];

    #[test]
    fn first_accent_is_always_allowed() {
        assert!(accent_update_allowed(0, None, RED));
        assert!(accent_update_allowed(1_700_000_000_000, None, RED));
    }

    #[test]
    fn identical_colour_is_never_re_pushed() {
        let last = Some((0, RED));
        assert!(!accent_update_allowed(MIN_ACCENT_UPDATE_MS, last, RED));
        assert!(!accent_update_allowed(
            MIN_ACCENT_UPDATE_MS * 1_000,
            last,
            RED
        ));
    }

    #[test]
    fn rate_limit_holds_inside_the_window() {
        let last = Some((1_000, RED));
        assert!(!accent_update_allowed(1_000, last, BLUE));
        assert!(!accent_update_allowed(1_000 + MIN_ACCENT_UPDATE_MS - 1, last, BLUE));
        assert!(accent_update_allowed(1_000 + MIN_ACCENT_UPDATE_MS, last, BLUE));
    }

    #[test]
    fn delta_below_the_threshold_is_ignored_however_late() {
        let nudged: [u8; 3] = [RED[0] - (ACCENT_DELTA_MIN - 1), RED[1], RED[2]];
        assert!(!accent_update_allowed(u64::MAX, Some((0, RED)), nudged));
        let moved: [u8; 3] = [RED[0], RED[1], RED[2] + ACCENT_DELTA_MIN];
        assert!(accent_update_allowed(u64::MAX, Some((0, RED)), moved));
    }

    #[test]
    fn clock_going_backwards_is_a_rate_limited_not_a_panic() {
        let last = Some((5_000_000, RED));
        assert!(!accent_update_allowed(0, last, BLUE));
    }

    #[test]
    fn saturating_sub_covers_a_timestamp_from_the_future() {
        assert!(!accent_update_allowed(0, Some((u64::MAX, RED)), BLUE));
    }

    #[test]
    fn no_wrap_at_the_old_u32_horizon() {
        let horizon = 1u64 << 32;
        let last = Some((horizon - 1, RED));
        assert!(!accent_update_allowed(horizon, last, BLUE));
        assert!(accent_update_allowed(horizon + MIN_ACCENT_UPDATE_MS, last, BLUE));
    }
}
