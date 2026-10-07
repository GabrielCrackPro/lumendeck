// The Windows half of the lock screen sync: ask Windows what it is showing,
// then carry out whatever `lock_screen::plan` decides.
//
// Written as its own module because the two halves fail differently. The
// decision is pure and tested; this is the part that can only be verified by
// locking a machine, so it is kept thin and logs every outcome — a silent
// failure here looks exactly like a working feature from the log alone.
//
// The mechanism is `Windows.System.UserProfile.LockScreen`, not the registry.
// The first version wrote `LockScreenImage` into the Personalization key and
// logged "set to ..." whenever the write succeeded, and the lock screen never
// moved: on Windows 11 24H2 that key holds no `LockScreenImage` at all and
// Windows never writes one, so we were recording success against a value no
// component reads. The API below is the documented per-user path, and unlike
// a registry write it is observable — `winrt_lock_screen_round_trip` sets an
// image and reads it back before restoring it.
//
// The companion bug lived in the old `broadcast_settings_change`, which
// "told the shell" by passing a hard-coded `C:\Windows\Web\Wallpaper\
// Windows\img0.jpg` to `SPI_SETDESKWALLPAPER` — a no-op in name only: it set
// the desktop to the stock Windows wallpaper on every adopt and release, and
// `Explorer\Wallpapers` still carries that entry in its history. The API
// notifies Windows itself, so the broadcast is gone with it.

use crate::lock_screen::{
    plan, same_path, LockScreenPlan, LockScreenState, LOCK_SCREEN_IMAGE_VALUE,
    LOCK_SCREEN_TYPE_VALUE, ORIG_LOCK_SCREEN_VALUE,
};
use std::path::Path;
use windows::core::HSTRING;
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegGetValueW, RegOpenKeyExW, RegSetValueExW,
    HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_OPEN_CREATE_OPTIONS,
    REG_VALUE_TYPE, RRF_RT_REG_SZ,
};

/// REG_SZ, spelled numerically because the `REG_SZ` constant collides with the
/// type alias of the same name.
const REG_SZ_TYPE: REG_VALUE_TYPE = REG_VALUE_TYPE(1);

fn personalization_key() -> HSTRING {
    HSTRING::from(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Personalization")
}

/// Open the Personalization key, creating it if this profile never had one.
///
/// The create branch is not defensive: on a machine that has never touched
/// Personalization the key genuinely does not exist, and `RegOpenKeyExW`
/// fails with ERROR_FILE_NOT_FOUND. The key is now only where *our* stash
/// lives — Windows' own lock-screen state is not here — so creating it is
/// correct for a first enable.
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

/// Run a WinRT call on a thread that owns a COM apartment, blocking for it.
///
/// The callers are three different threads — the IPC command, the side-effects
/// worker, the wallpaper frame path — and none of them initializes WinRT, on
/// which a call fails with CO_E_NOTINITIALIZED. Owning the apartment here
/// keeps that from depending on which caller showed up. The runtime is a
/// plain current-thread one: the WinRT futures complete on the system thread
/// pool and only need a waker, not any Tokio driver.
fn winrt<T: Send + 'static>(
    work: impl FnOnce(&tokio::runtime::Runtime) -> T + Send + 'static,
) -> T {
    let joined = std::thread::spawn(move || {
        let initialized = unsafe { windows::Win32::System::Com::CoInitializeEx(
            None,
            windows::Win32::System::Com::COINIT_MULTITHREADED,
        ) }
        .is_ok();
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("lock-screen runtime");
        let out = work(&rt);
        if initialized {
            unsafe {
                windows::Win32::System::Com::CoUninitialize();
            }
        }
        out
    })
    .join();
    match joined {
        Ok(value) => value,
        Err(panic) => std::panic::resume_unwind(panic),
    }
}

/// What Windows says the lock screen is showing right now.
///
/// `LockScreen.OriginalImageFile` is the documented read and it tracks a set
/// immediately — the round-trip test writes an image and sees this change in
/// the same run. The old code read `LockScreenImage` out of the Personalization
/// key instead, which on this build is always `None`, and that `None` then
/// drove every decision below it.
fn windows_current_image() -> Option<String> {
    winrt(|_rt| {
        windows::System::UserProfile::LockScreen::OriginalImageFile()
            .ok()
            .and_then(|uri| uri.Path().ok())
            .and_then(|path| path_from_uri(&path.to_string()))
    })
}

/// Point the lock screen at `image` and wait for Windows to take it.
fn set_image(image: &str) -> Result<(), String> {
    let image = image.to_string();
    winrt(move |rt| {
        rt.block_on(async move {
            use windows::Storage::StorageFile;
            use windows::System::UserProfile::LockScreen;
            let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(image.as_str()))
                .map_err(|e| format!("could not open {image}: {e}"))?
                .await
                .map_err(|e| format!("could not open {image}: {e}"))?;
            LockScreen::SetImageFileAsync(&file)
                .map_err(|e| e.to_string())?
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        })
    })
}

/// `Uri::Path()` hands back `/C:/Users/Me/a%20b.png`: a leading slash,
/// forward separators and percent escapes. All three have to go before the
/// result can be used, and a name containing a space — a user folder, a
/// screenshot — is the ordinary case here rather than the exotic one.
///
/// The separators matter as much as the escapes: `GetFileFromPathAsync`
/// rejects `C:/Users/...` outright with ERROR_INVALID_NAME (0x800700A1), so a
/// `current` kept in URI form would compare fine and then fail the moment
/// anything tried to put that path back. That is exactly how the round-trip
/// test's first restore failed.
fn path_from_uri(raw: &str) -> Option<String> {
    let trimmed = raw.trim_start_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    Some(percent_decode(trimmed).replace('/', r"\"))
}

/// Decode `%XX` sequences, leaving everything else byte-for-byte alone.
///
/// Slicing by byte index would panic on a multi-byte character, so the hex
/// digits are checked before any slice is taken — a path is user data and a
/// literal `%` followed by non-ASCII is entirely possible.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &bytes[i + 1..i + 3];
            if hex.iter().all(|b| b.is_ascii_hexdigit()) {
                let hi = (hex[0] as char).to_digit(16).unwrap_or(0) as u8;
                let lo = (hex[1] as char).to_digit(16).unwrap_or(0) as u8;
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// What we know about the lock screen right now.
pub fn current_state() -> LockScreenState {
    let current = windows_current_image();
    let backup = match open_key() {
        Some(hkey) => {
            let backup = read_string(hkey, ORIG_LOCK_SCREEN_VALUE);
            unsafe {
                let _ = RegCloseKey(hkey);
            }
            backup
        }
        None => {
            // Without the stash we would adopt again and record no original,
            // so the next release has nothing to put back. Worth saying out
            // loud rather than discovering it at toggle-off.
            log::warn!("lock-screen: no personalization key, cannot read our stash");
            None
        }
    };
    let ours = crate::wallpaper_bg::bg_path().to_string_lossy().to_string();

    LockScreenState {
        follows_wallpaper: crate::config_store::get().general.lock_screen_follows_wallpaper,
        current_is_ours: current
            .as_deref()
            .map(|c| same_path(c, &ours))
            .unwrap_or(false),
        current,
        backup,
    }
}

/// Delete what the registry recipe left behind.
///
/// Windows never reads these on Windows 11 24H2, but builds of this app wrote
/// them, and the companion DWORD outlived every release: `release()` removed
/// the image and the stash and left `LockScreenImageType = 1` sitting in a key
/// it does not belong to, claiming the lock screen was a user picture after
/// the toggle had been off for days. The path decides ownership, so a build
/// that *does* keep its own picture in these values is left alone.
fn drop_legacy_recipe() {
    let Some(hkey) = open_key() else {
        return;
    };
    let ours = crate::wallpaper_bg::bg_path().to_string_lossy().to_string();
    let legacy = read_string(hkey, LOCK_SCREEN_IMAGE_VALUE);
    let ours_legacy = legacy
        .as_deref()
        .map(|p| same_path(p, &ours))
        .unwrap_or(false);
    if ours_legacy {
        delete_value(hkey, LOCK_SCREEN_IMAGE_VALUE);
    }
    // The DWORD is ours when it sits beside an image we wrote, and also when
    // it sits beside no image at all — that orphan is exactly what every
    // release used to leave behind. A present, non-ours image means somebody
    // else owns this key, so both values stay.
    if ours_legacy || legacy.is_none() {
        delete_value(hkey, LOCK_SCREEN_TYPE_VALUE);
    }
    unsafe {
        let _ = RegCloseKey(hkey);
    }
}

/// Record the user's original image so it can be put back later.
fn stash(backup: Option<String>) {
    let Some(original) = backup else {
        return;
    };
    let Some(hkey) = open_key() else {
        log::warn!("lock-screen: could not stash the original image: no key");
        return;
    };
    if !write_string(hkey, ORIG_LOCK_SCREEN_VALUE, &original) {
        log::warn!("lock-screen: could not stash the original image");
    }
    unsafe {
        let _ = RegCloseKey(hkey);
    }
}

/// Point the lock screen at `image`, stashing what is there first.
///
/// Returns false only when Windows rejected the write. A `Leave` — the feature
/// is off, or this exact file is already installed — is reported as true: there
/// is nothing to do and nothing to log, and the wallpaper republishing its
/// background frame must not produce a warning every time.
pub fn adopt(image: &Path) -> bool {
    let image = image.to_string_lossy().to_string();
    let state = current_state();
    match plan(&state, &image) {
        LockScreenPlan::Leave => true,
        LockScreenPlan::Adopt { image, backup } => {
            drop_legacy_recipe();
            stash(backup);
            match set_image(&image) {
                Ok(()) => {
                    log::info!("lock-screen: set to {image}");
                    true
                }
                Err(e) => {
                    log::warn!("lock-screen: adopt failed for {image}: {e}");
                    false
                }
            }
        }
        // adopt() is asked for an install; handing the lock screen back is
        // `release()`'s job, and the call sites already gate on the toggle.
        LockScreenPlan::Release { .. } => false,
    }
}

/// Hand the lock screen back: the user's own image, or an honest warning.
///
/// False when we never took over, so calling it on every startup and on every
/// disable is safe and cannot clobber an image the user chose themselves.
pub fn release() -> bool {
    drop_legacy_recipe();
    let state = current_state();
    let LockScreenPlan::Release { original } = plan(&state, "") else {
        // Off and not ours — the path every machine that never enabled the
        // feature takes at startup. Deliberately silent: this is not a state
        // change.
        return false;
    };
    let restored = match original.filter(|p| !p.is_empty()) {
        Some(path) => match set_image(&path) {
            Ok(()) => {
                log::info!("lock-screen: restored {path}");
                true
            }
            Err(e) => {
                log::warn!("lock-screen: release failed restoring {path}: {e}");
                false
            }
        },
        None => {
            // Nothing was there when we took over, and Windows has no "no
            // image" setting to go back to — so ours stays until the user
            // picks something. Saying so beats a silent one-way toggle.
            log::warn!("lock-screen: nothing to restore; the lock screen keeps our image");
            false
        }
    };
    if restored {
        // Only on success: a stash kept after a failed restore is what lets a
        // later attempt still find the user's original.
        if let Some(hkey) = open_key() {
            delete_value(hkey, ORIG_LOCK_SCREEN_VALUE);
            unsafe {
                let _ = RegCloseKey(hkey);
            }
        }
    }
    restored
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
    fn the_stash_is_a_name_windows_does_not_use() {
        // Our backup lives in a key Windows owns, so it has to be a name
        // Windows ignores: a collision would mean overwriting the user's own
        // lock-screen state with our copy of it.
        assert_eq!(ORIG_LOCK_SCREEN_VALUE, "LumenDeckOriginalLockScreen");
        assert_ne!(ORIG_LOCK_SCREEN_VALUE, LOCK_SCREEN_IMAGE_VALUE);
        assert_ne!(ORIG_LOCK_SCREEN_VALUE, LOCK_SCREEN_TYPE_VALUE);
    }

    /// The residue the old recipe left behind: a `LockScreenImageType` DWORD
    /// with no `LockScreenImage` beside it. Every release used to delete the
    /// image and the stash and forget the DWORD, so a machine that had used
    /// the feature carried it indefinitely — this machine still did.
    ///
    /// It writes the orphan form and asserts the cleanup removes it, so the
    /// test also tidies the key it touches.
    #[test]
    fn an_orphaned_legacy_type_value_is_removed() {
        let Some(hkey) = open_key() else {
            return;
        };
        if read_string(hkey, LOCK_SCREEN_IMAGE_VALUE).is_some() {
            // An image is present and it is not ours to judge; `release` and
            // `adopt` leave that case alone, and so does this test.
            unsafe {
                let _ = RegCloseKey(hkey);
            }
            return;
        }
        let vname = HSTRING::from(LOCK_SCREEN_TYPE_VALUE);
        // Written and read back as a DWORD, which is what the residue is: a
        // string read would report `None` for it whatever happens, and an
        // assertion that cannot fail is not covering the bug.
        const REG_DWORD_TYPE: REG_VALUE_TYPE = REG_VALUE_TYPE(4);
        let written = unsafe {
            RegSetValueExW(
                hkey,
                &vname,
                Some(0),
                REG_DWORD_TYPE,
                Some(&1u32.to_le_bytes()),
            )
            .is_ok()
        };
        unsafe {
            let _ = RegCloseKey(hkey);
        }
        if !written {
            return;
        }
        drop_legacy_recipe();
        let Some(hkey) = open_key() else {
            return;
        };
        let mut left = 0u32;
        let mut len = 4u32;
        let got = unsafe {
            windows::Win32::System::Registry::RegGetValueW(
                hkey,
                None,
                &vname,
                windows::Win32::System::Registry::RRF_RT_REG_DWORD,
                None,
                Some((&mut left as *mut u32).cast()),
                Some(&mut len),
            )
        };
        unsafe {
            let _ = RegCloseKey(hkey);
        }
        assert!(got.is_err(), "the orphan DWORD outlived its cleanup");
    }

    #[test]
    fn a_uri_path_becomes_a_real_path() {
        // The read side and a path Windows will accept have to agree, and
        // they differ in three ways: a leading slash, forward separators, and
        // percent escapes.
        assert_eq!(
            path_from_uri("/C:/Users/Me/Pictures/a%20b.png").as_deref(),
            Some(r"C:\Users\Me\Pictures\a b.png")
        );
        assert_eq!(
            path_from_uri("/C:/plain.jpg").as_deref(),
            Some(r"C:\plain.jpg")
        );
        // The form Windows accepts, not the form the URI API returns — a
        // forward-slash path is rejected by GetFileFromPathAsync.
        assert!(!path_from_uri("/C:/plain.jpg").unwrap().contains('/'));
        assert_eq!(percent_decode(r"C:\a\b.jpg"), r"C:\a\b.jpg");
        // Nothing to decode still has to survive the trip.
        assert_eq!(percent_decode("C:/a+b%c.jpg"), "C:/a+b%c.jpg");
        // A stray percent must not be treated as an escape, and must not make
        // the slicing panic on whatever follows it.
        assert_eq!(percent_decode("100% done"), "100% done");
        assert_eq!(percent_decode("caf%C3%A9.png"), "caf\u{e9}.png");
        // No path at all is reported as absent rather than as an empty string.
        assert_eq!(path_from_uri(""), None);
        assert_eq!(path_from_uri("/"), None);
    }

    /// End-to-end check of the mechanism — ignored because it changes this
    /// machine's lock screen. Run it by hand:
    ///
    /// ```text
    /// cargo test winrt_lock_screen -- --include-ignored --nocapture
    /// ```
    ///
    /// It sets our background snapshot, asserts Windows reports it back, then
    /// restores whatever was there and asserts that too: a mechanism that can
    /// take over but not hand back would leave the test machine stuck.
    #[test]
    #[ignore = "changes this machine's lock screen; run by hand"]
    fn winrt_lock_screen_round_trip() {
        let before = windows_current_image();
        println!("before: {before:?}");

        let ours = crate::wallpaper_bg::bg_path();
        assert!(ours.is_file(), "no background snapshot to install");
        let ours = ours.to_string_lossy().to_string();

        set_image(&ours).expect("setting the lock screen must work");
        let during = windows_current_image();
        println!("after set: {during:?}");
        assert_eq!(
            during.as_deref().map(|p| same_path(p, &ours)),
            Some(true),
            "Windows did not report the image back — the mechanism is wrong again"
        );

        match before {
            Some(original) => {
                set_image(&original).expect("restoring the original must work");
                let after = windows_current_image();
                println!("after restore: {after:?}");
                assert_eq!(
                    after.as_deref().map(|p| same_path(p, &original)),
                    Some(true)
                );
            }
            None => panic!("no original image was reported; refusing to leave ours installed"),
        }
    }
}
