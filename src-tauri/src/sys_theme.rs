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
///
/// The timestamp is u64. It was u32, which truncated the millisecond clock
/// every 49.7 days and then underflowed on the subtraction below — a panic in
/// every debug build that crossed the boundary, taken while the mutex below is
/// held, so one panic poisoned the lock and turned into a permanent panic on the
/// sample path.
static LAST_ACCENT: Mutex<Option<(u64, [u8; 3])>> = Mutex::new(None);
const MIN_ACCENT_UPDATE_MS: u64 = 10_000;
/// Color must drift at least this far (max per-channel delta) before we
/// push a new accent — avoids constant tiny animations on subtle video shifts.
const ACCENT_DELTA_MIN: u8 = 24;

/// Is this colour worth pushing to the OS? Split out from the sampling path so
/// the rate limit can be tested without a registry or a clock.
///
/// Pure, and every input is explicit, which is the point: the bug this replaced
/// was arithmetic on a value that had silently lost its high bits.
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

/// Feed the current wallpaper dominant color. Call from the sample path;
/// cheap (one mutex + possibly a registry write) and rate-limited internally.
pub fn feed_wallpaper_color(rgb: [u8; 3]) {
    let cfg = config_store::get();
    if !cfg.general.accent_sync_enabled {
        return;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    // `as_millis` is u128; a u64 saturates some five centuries out, so the cast
    // is lossless for any run of this app.
    let now = now.min(u64::MAX as u128) as u64;

    // `into_inner` rather than `expect`. This runs on the sampling thread, where
    // a panic is not recoverable and a poisoned lock would make every later
    // frame panic at the lock itself — one failure turning into a permanent one.
    //
    // Decide and claim under one lock. Reading the guard, then deciding, then
    // writing the new timestamp back in a second critical section left a window
    // where two threads both read the same `last`, both concluded they were
    // allowed, and both wrote — so the rate limit was advisory rather than a
    // limit. The registry write stays outside the lock; the claim is what has
    // to be atomic, not the slow part.
    let previous = {
        let mut guard = LAST_ACCENT.lock().unwrap_or_else(|e| e.into_inner());
        if !accent_update_allowed(now, *guard, rgb) {
            return;
        }
        *guard = Some((now, rgb));
        *guard
    };

    if set_accent_color(rgb) {
        // Record what we wrote so the registry poll can tell our own write from
        // a user's change. Shared across threads because the write happens on
        // the sampling path and the poll on the watcher thread.
        if let Ok(mut guard) = LAST_WRITTEN.get_or_init(Mutex::default).lock() {
            *guard = Some(rgb);
        }
    } else {
        // Hand the slot back. Nothing changed, so holding the timestamp would
        // idle the sync for a whole interval on a write that never landed. The
        // identity check means a newer claim is not rolled back over.
        let mut guard = LAST_ACCENT.lock().unwrap_or_else(|e| e.into_inner());
        if guard.map(|(ts, color)| (ts, color)) == Some((now, rgb)) {
            *guard = previous;
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
            // The registry write alone does not repaint the shell; without this
            // the new colour can sit there unapplied.
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
        // KEY_SET_VALUE is load-bearing, not decoration. Opened for query only,
        // the write below fails with ERROR_ACCESS_DENIED, `let _ =` throws the
        // error away, and the backup silently never exists — which leaves
        // `restore_original_accent` a no-op and the feature one-way.
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
                    // Logged, because the alternative is a user who turned sync
                    // off and got their old accent back never.
                    log::warn!("sys-theme: could not back up the original accent; restore will be a no-op");
                }
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
            refresh_system_appearance();
            log::info!("sys-theme: original accent restored");
        } else {
            // Worth saying out loud. The most likely cause is a backup that never
            // landed, and the user is owed the truth rather than a silent no-op.
            log::warn!("sys-theme: no accent backup found; nothing to restore");
        }
        let _ = RegCloseKey(hkey);
    }
}

/// Tell Windows that the accent changed, so Explorer repaints the taskbar and
/// Start menu without waiting for the next login.
///
/// The previous implementation called `SystemParametersInfoW` with
/// `SPI_SETNONCLIENTMETRICS`, a null pointer and a zero size — which per the API
/// contract sets nothing at all. It was also never called, so the accent could
/// sit in the registry unapplied until something else happened to repaint. The
/// broadcast is what Settings itself sends, and the two names are the ones
/// Explorer listens for.
///
/// A broadcast is a best-effort nudge, not a command: `SendMessageTimeoutW`
/// abandons the hung-window case rather than blocking the sampling thread.
pub fn refresh_system_appearance() {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, SMTO_NORMAL,
        WM_SETTINGCHANGE,
    };
    for setting in ["ImmersiveColorSet", "WindowsThemeElement"] {
        unsafe {
            // The string has to outlive the call, hence the binding rather than
            // a temporary dropped at the end of the expression.
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
        // Nothing pushed yet, so the very first wallpaper frame is the one the
        // user should see take effect.
        assert!(accent_update_allowed(0, None, RED));
        assert!(accent_update_allowed(1_700_000_000_000, None, RED));
    }

    #[test]
    fn identical_colour_is_never_re_pushed() {
        // The delta test is about change, not time: without it a static
        // wallpaper would re-animate the OS accent every interval forever.
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
        // The boundary itself is allowed: "at most one write per interval".
        assert!(accent_update_allowed(1_000 + MIN_ACCENT_UPDATE_MS, last, BLUE));
    }

    #[test]
    fn delta_below_the_threshold_is_ignored_however_late() {
        // One channel off by exactly ACCENT_DELTA_MIN - 1: a slow video fade
        // drifting a shade at a time should not nudge the OS every 10s.
        let nudged: [u8; 3] = [RED[0] - (ACCENT_DELTA_MIN - 1), RED[1], RED[2]];
        assert!(!accent_update_allowed(u64::MAX, Some((0, RED)), nudged));
        // Off by the threshold exactly: allowed, in whichever channel moved.
        let moved: [u8; 3] = [RED[0], RED[1], RED[2] + ACCENT_DELTA_MIN];
        assert!(accent_update_allowed(u64::MAX, Some((0, RED)), moved));
    }

    #[test]
    fn clock_going_backwards_is_a_rate_limited_not_a_panic() {
        // The u32 timestamp this replaced wrapped every 49.7 days and then
        // underflowed here: a debug-build panic, taken while the lock was
        // held, which poisoned the mutex and made every later frame panic at
        // the lock. Saturating subtraction turns that into a refusal.
        let last = Some((5_000_000, RED));
        assert!(!accent_update_allowed(0, last, BLUE));
    }

    #[test]
    fn saturating_sub_covers_a_timestamp_from_the_future() {
        // A clock jump (NTP correction, resume from sleep) can land `now`
        // below the stored stamp; a huge stamp must not wrap to "very old".
        assert!(!accent_update_allowed(0, Some((u64::MAX, RED)), BLUE));
    }

    #[test]
    fn no_wrap_at_the_old_u32_horizon() {
        // 2^32 ms is 49.7 days. Under the u32 timestamp this was the exact
        // moment the stored time became smaller than "now"; assert the real
        // arithmetic at and past that boundary stays monotonic.
        let horizon = 1u64 << 32;
        let last = Some((horizon - 1, RED));
        assert!(!accent_update_allowed(horizon, last, BLUE));
        assert!(accent_update_allowed(horizon + MIN_ACCENT_UPDATE_MS, last, BLUE));
    }
}
