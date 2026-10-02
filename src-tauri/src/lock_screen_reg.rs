// The registry half of the lock screen sync: read what is there, then carry out
// whatever `lock_screen::plan` decides.
//
// Written as its own module because the two halves fail differently. The
// decision is pure and tested; this is the part that can only be verified by
// locking a machine, so it is kept thin and logs every outcome — a silent
// failure here looks exactly like a working feature from the log alone.

use crate::lock_screen::{
    plan, same_path, LockScreenPlan, LockScreenState, LOCK_SCREEN_IMAGE_VALUE,
    LOCK_SCREEN_TYPE_PICTURE, LOCK_SCREEN_TYPE_VALUE, ORIG_LOCK_SCREEN_VALUE,
};
use std::path::Path;
use windows::core::HSTRING;
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegGetValueW, RegOpenKeyExW, RegSetValueExW,
    HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_OPEN_CREATE_OPTIONS,
    REG_VALUE_TYPE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
};

/// REG_SZ, spelled numerically because the `REG_SZ` constant collides with the
/// type alias of the same name.
const REG_SZ_TYPE: REG_VALUE_TYPE = REG_VALUE_TYPE(1);
/// REG_DWORD.
const REG_DWORD_TYPE: REG_VALUE_TYPE = REG_VALUE_TYPE(4);

fn personalization_key() -> HSTRING {
    HSTRING::from(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Personalization")
}

/// Open the Personalization key, creating it if this profile never had one.
///
/// The create branch is not defensive: on a machine that has never touched
/// Personalization the key genuinely does not exist, and `RegOpenKeyExW`
/// fails with ERROR_FILE_NOT_FOUND (the 9 `reg open failed` lines in the logs
/// are all that, before the fallback took over).
fn open_key() -> Option<HKEY> {
    let path = personalization_key();
    let sam = KEY_SET_VALUE | KEY_QUERY_VALUE;
    let mut hkey = HKEY::default();
    unsafe {
        if RegOpenKeyExW(HKEY_CURRENT_USER, &path, Some(0), sam, &mut hkey).is_ok() {
            return Some(hkey);
        }
        let created = RegCreateKeyExW(
            HKEY_CURRENT_USER,
            &path,
            None,
            None,
            REG_OPEN_CREATE_OPTIONS(0),
            sam,
            None,
            &mut hkey,
            None,
        );
        if created.is_err() {
            log::warn!("lock-screen: could not open Personalization key: {created:?}");
            return None;
        }
    }
    Some(hkey)
}

fn read_string(hkey: HKEY, name: &str) -> Option<String> {
    let value = HSTRING::from(name);
    let mut buf = [0u16; 2048];
    let mut len = (buf.len() * 2) as u32;
    let got = unsafe {
        RegGetValueW(
            hkey,
            None,
            &value,
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr().cast()),
            Some(&mut len),
        )
    };
    if got.is_err() || len < 2 {
        return None;
    }
    let chars = ((len / 2) - 1) as usize;
    Some(String::from_utf16_lossy(&buf[..chars.min(buf.len())]))
}

fn write_string(hkey: HKEY, name: &str, value: &str) -> bool {
    let bytes: Vec<u8> = value
        .encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(u16::to_le_bytes)
        .collect();
    let vname = HSTRING::from(name);
    unsafe { RegSetValueExW(hkey, &vname, Some(0), REG_SZ_TYPE, Some(&bytes)).is_ok() }
}

fn delete_value(hkey: HKEY, name: &str) {
    let vname = HSTRING::from(name);
    unsafe {
        let _ = RegDeleteValueW(hkey, &vname);
    }
}

/// What the lock screen currently holds, and whether we are the ones holding it.
pub fn current_state() -> LockScreenState {
    use crate::config_store;
    let Some(hkey) = open_key() else {
        return LockScreenState {
            follows_wallpaper: false,
            current: None,
            backup: None,
            current_is_ours: false,
        };
    };
    let current = read_string(hkey, LOCK_SCREEN_IMAGE_VALUE);
    let backup = read_string(hkey, ORIG_LOCK_SCREEN_VALUE);
    unsafe {
        let _ = RegCloseKey(hkey);
    }
    let ours = crate::wallpaper_bg::bg_path().to_string_lossy().to_string();

    LockScreenState {
        follows_wallpaper: config_store::get().general.lock_screen_follows_wallpaper,
        current_is_ours: current.as_deref().map(|c| same_path(c, &ours)).unwrap_or(false),
        current,
        backup,
    }
}

/// Tell the shell that the lock screen changed.
///
/// The desktop path gets this for free from `SPIF_SENDCHANGE`. The lock screen
/// has no equivalent, so without a broadcast the new image may not appear until
/// something else forces a redraw — which is why "it works but only sometimes"
/// was the symptom.
fn broadcast_settings_change() {
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPIF_SENDCHANGE, SPI_SETDESKWALLPAPER,
    };
    // A no-op desktop call whose only effect is the broadcast. Setting the same
    // wallpaper path again is harmless and is the documented way to make the
    // shell re-read the personalization values.
    let any = std::path::PathBuf::from(r"C:\Windows\Web\Wallpaper\Windows\img0.jpg");
    let wide = HSTRING::from(any.to_string_lossy().as_ref());
    unsafe {
        let _ = SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, Some(wide.as_ptr() as _), SPIF_SENDCHANGE);
    }
}

/// Point the lock screen at `image`, stashing the current value first.
///
/// Returns whether the registry write succeeded. Deliberately does *not*
/// decide whether to run — that is `lock_screen::plan`, and the caller, so the
/// transition logic can be tested without a lock screen.
pub fn adopt(image: &Path) -> bool {
    let image = image.to_string_lossy().to_string();
    let Some(hkey) = open_key() else {
        return false;
    };
    let result = match plan(&current_state()) {
        LockScreenPlan::Adopt { backup, .. } => {
            if let Some(original) = backup {
                if !write_string(hkey, ORIG_LOCK_SCREEN_VALUE, &original) {
                    log::warn!("lock-screen: could not stash the original image");
                }
            }
            // The companion DWORD is what makes the path take effect: a
            // machine whose type is still Spotlight keeps showing Spotlight.
            let kind: u32 = LOCK_SCREEN_TYPE_PICTURE;
            let bytes = kind.to_le_bytes();
            let vname = HSTRING::from(LOCK_SCREEN_TYPE_VALUE);
            let typed = unsafe {
                RegSetValueExW(hkey, &vname, Some(0), REG_DWORD_TYPE, Some(&bytes)).is_ok()
            };
            if !typed {
                log::warn!("lock-screen: could not set LockScreenImageType");
            }
            write_string(hkey, LOCK_SCREEN_IMAGE_VALUE, &image)
        }
        LockScreenPlan::Leave => false,
        LockScreenPlan::Release { .. } => false,
    };
    unsafe {
        let _ = RegCloseKey(hkey);
    }
    if result {
        broadcast_settings_change();
        log::info!("lock-screen: set to {image}");
    } else {
        log::warn!("lock-screen: adopt failed for {image}");
    }
    result
}

/// Hand the lock screen back: the user's own image, or nothing.
///
/// A no-op returning false when we never took over, so calling it on every
/// disable is safe and cannot clobber an image the user chose themselves.
pub fn release() -> bool {
    let state = current_state();
    let LockScreenPlan::Release { original } = plan(&state) else {
        return false;
    };
    let original = original.unwrap_or_default();
    let Some(hkey) = open_key() else {
        return false;
    };
    // An empty stash means there was nothing under LockScreenImage when we
    // arrived: remove our value so the lock screen falls back to the system's
    // own rather than pointing at our wallpaper forever.
    let restored = if original.is_empty() {
        delete_value(hkey, LOCK_SCREEN_IMAGE_VALUE);
        true
    } else {
        write_string(hkey, LOCK_SCREEN_IMAGE_VALUE, &original)
    };
    delete_value(hkey, ORIG_LOCK_SCREEN_VALUE);
    unsafe {
        let _ = RegCloseKey(hkey);
    }
    if restored {
        broadcast_settings_change();
        if original.is_empty() {
            log::info!("lock-screen: released our image");
        } else {
            log::info!("lock-screen: restored {original}");
        }
    } else {
        log::warn!("lock-screen: release failed");
    }
    restored
}

/// Read the `LockScreenImageType` DWORD. Exposed for the IPC surface so the
/// settings screen can show what Windows actually thinks the type is, which
/// is the difference between "we wrote it" and "Windows is using it".
pub fn current_type() -> Option<u32> {
    let Some(hkey) = open_key() else { return None };
    let value = HSTRING::from(LOCK_SCREEN_TYPE_VALUE);
    let mut out: u32 = 0;
    let mut len = 4u32;
    let got = unsafe {
        RegGetValueW(
            hkey,
            None,
            &value,
            RRF_RT_REG_DWORD,
            None,
            Some((&mut out as *mut u32).cast()),
            Some(&mut len),
        )
    };

    unsafe {
        let _ = RegCloseKey(hkey);
    }
    if got.is_err() || len < 4 {
        None
    } else {
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// These touch the live registry, so they only ever assert on the shape of
    /// the helpers rather than on a value, and the mutating one is skipped: a
    /// test run must not rewrite someone's lock screen.
    #[test]
    fn reading_a_value_that_does_not_exist_is_none() {
        // Absent is the normal case on a profile that never set a lock screen,
        // and it must not be reported as an empty string — "no image" and "the
        // empty image" lead to different restore decisions.
        if let Some(hkey) = open_key() {
            let got = read_string(hkey, "LumenDeckNoSuchValueForTests");
            unsafe {
                let _ = RegCloseKey(hkey);
            }
            assert!(got.is_none());
        }
    }

    #[test]
    fn the_key_name_is_the_one_windows_reads() {
        // A typo here fails silently at runtime and looks exactly like Windows
        // ignoring us, so it is pinned.
        assert_eq!(
            personalization_key().to_string(),
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Personalization"
        );
    }

    #[test]
    fn the_type_constant_is_the_user_picture_case() {
        assert_eq!(LOCK_SCREEN_TYPE_PICTURE, 1);
        assert_ne!(LOCK_SCREEN_TYPE_PICTURE, 2, "2 is Windows Spotlight");
    }
}
