
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

const REG_SZ_TYPE: REG_VALUE_TYPE = REG_VALUE_TYPE(1);

fn personalization_key() -> HSTRING {
    HSTRING::from(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Personalization")
}

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

fn windows_current_image() -> Option<String> {
    winrt(|_rt| {
        windows::System::UserProfile::LockScreen::OriginalImageFile()
            .ok()
            .and_then(|uri| uri.Path().ok())
            .and_then(|path| path_from_uri(&path.to_string()))
    })
}

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

fn path_from_uri(raw: &str) -> Option<String> {
    let trimmed = raw.trim_start_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    Some(percent_decode(trimmed).replace('/', r"\"))
}

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
    if ours_legacy || legacy.is_none() {
        delete_value(hkey, LOCK_SCREEN_TYPE_VALUE);
    }
    unsafe {
        let _ = RegCloseKey(hkey);
    }
}

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
        LockScreenPlan::Release { .. } => false,
    }
}

pub fn release() -> bool {
    drop_legacy_recipe();
    let state = current_state();
    let LockScreenPlan::Release { original } = plan(&state, "") else {
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
            log::warn!("lock-screen: nothing to restore; the lock screen keeps our image");
            false
        }
    };
    if restored {
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

    #[test]
    fn reading_a_value_that_does_not_exist_is_none() {
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
        assert_eq!(ORIG_LOCK_SCREEN_VALUE, "LumenDeckOriginalLockScreen");
        assert_ne!(ORIG_LOCK_SCREEN_VALUE, LOCK_SCREEN_IMAGE_VALUE);
        assert_ne!(ORIG_LOCK_SCREEN_VALUE, LOCK_SCREEN_TYPE_VALUE);
    }

    #[test]
    fn an_orphaned_legacy_type_value_is_removed() {
        let Some(hkey) = open_key() else {
            return;
        };
        if read_string(hkey, LOCK_SCREEN_IMAGE_VALUE).is_some() {
            unsafe {
                let _ = RegCloseKey(hkey);
            }
            return;
        }
        let vname = HSTRING::from(LOCK_SCREEN_TYPE_VALUE);
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
        assert_eq!(
            path_from_uri("/C:/Users/Me/Pictures/a%20b.png").as_deref(),
            Some(r"C:\Users\Me\Pictures\a b.png")
        );
        assert_eq!(
            path_from_uri("/C:/plain.jpg").as_deref(),
            Some(r"C:\plain.jpg")
        );
        assert!(!path_from_uri("/C:/plain.jpg").unwrap().contains('/'));
        assert_eq!(percent_decode(r"C:\a\b.jpg"), r"C:\a\b.jpg");
        assert_eq!(percent_decode("C:/a+b%c.jpg"), "C:/a+b%c.jpg");
        assert_eq!(percent_decode("100% done"), "100% done");
        assert_eq!(percent_decode("caf%C3%A9.png"), "caf\u{e9}.png");
        assert_eq!(path_from_uri(""), None);
        assert_eq!(path_from_uri("/"), None);
    }

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
