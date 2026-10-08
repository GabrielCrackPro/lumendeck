
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use windows::core::HSTRING;
use windows::Win32::System::Registry::{
    RegCloseKey, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE,
    RRF_RT_REG_SZ,
};

const RUN_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
const UNINSTALL_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";

pub fn apply(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let registered = sync(&app.package_info().name, enabled)?;
    if let Some(target) = registered {
        log::info!("autostart: {} starts at logon", target.display());
    }
    Ok(())
}

fn sync(product_name: &str, enabled: bool) -> Result<Option<PathBuf>, String> {
    if !enabled {
        if read_value(RUN_KEY, product_name).is_none() {
            return Ok(None);
        }
        launch(target_exe(product_name), product_name)?
            .disable()
            .map_err(|e| e.to_string())?;
        log::info!("autostart: logon registration removed");
        return Ok(None);
    }

    let target = target_exe(product_name);
    let expected = expected_value(&target);
    if read_value(RUN_KEY, product_name).as_deref() == Some(expected.as_str()) {
        return Ok(None);
    }
    launch(target.clone(), product_name)?
        .enable()
        .map_err(|e| e.to_string())?;
    Ok(Some(target))
}

fn expected_value(exe: &Path) -> String {
    format!("\"{}\" {}", exe.display(), crate::START_HIDDEN_ARG)
}

fn launch(exe: PathBuf, product_name: &str) -> Result<auto_launch::AutoLaunch, String> {
    auto_launch::AutoLaunchBuilder::new()
        .set_app_name(product_name)
        .set_app_path(&format!("\"{}\"", exe.display()))
        .set_args(&[crate::START_HIDDEN_ARG])
        .build()
        .map_err(|e| e.to_string())
}

fn target_exe(product_name: &str) -> PathBuf {
    installed_exe(product_name)
        .or_else(|| std::env::current_exe().ok())
        .unwrap_or_else(|| PathBuf::from(format!("{}.exe", env!("CARGO_PKG_NAME"))))
}

fn installed_exe(product_name: &str) -> Option<PathBuf> {
    let key = format!(r"{UNINSTALL_KEY}\{product_name}");
    if let Some(icon) = read_value(&key, "DisplayIcon") {
        if let Some(path) = display_icon_path(&icon) {
            if path.is_file() {
                return Some(path);
            }
        }
    }
    if let Some(dir) = read_value(&key, "InstallLocation") {
        let path = PathBuf::from(dir.trim().trim_matches('"'))
            .join(format!("{}.exe", env!("CARGO_PKG_NAME")));
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

/// `"C:\...\lumendeck.exe"`, `"C:\...\lumendeck.exe",0`, or an unquoted path
/// → the path.
///
/// NSIS puts an icon index after a comma and quotes a path containing spaces.
/// The comma only starts an index when what follows is digits, because a
/// directory name may legitimately contain one.
fn display_icon_path(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let without_index = match trimmed.rsplit_once(',') {
        Some((head, index)) if !index.trim().is_empty() && index.trim().bytes().all(|b| b.is_ascii_digit()) => head,
        _ => trimmed,
    };
    let path = without_index.trim().trim_matches('"').trim();
    if path.is_empty() {
        None
    } else {
        Some(PathBuf::from(path))
    }
}

fn read_value(key_path: &str, value_name: &str) -> Option<String> {
    let path = HSTRING::from(key_path);
    let mut hkey = HKEY::default();
    unsafe {
        if RegOpenKeyExW(HKEY_CURRENT_USER, &path, Some(0), KEY_QUERY_VALUE, &mut hkey).is_err() {
            return None;
        }
        let mut buf = [0u16; 1024];
        let mut len = (buf.len() * 2) as u32;
        let got = RegGetValueW(
            hkey,
            None,
            &HSTRING::from(value_name),
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr().cast()),
            Some(&mut len),
        );
        let _ = RegCloseKey(hkey);
        if got.is_err() || len < 2 {
            return None;
        }
        let chars = ((len / 2) - 1) as usize;
        Some(String::from_utf16_lossy(&buf[..chars.min(buf.len())]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_icon_value_becomes_a_path() {
        assert_eq!(
            display_icon_path(r#""C:\Users\Me\AppData\Local\LumenDeck\lumendeck.exe""#),
            Some(PathBuf::from(r"C:\Users\Me\AppData\Local\LumenDeck\lumendeck.exe"))
        );
        assert_eq!(
            display_icon_path(r#""C:\Program Files\LumenDeck\lumendeck.exe",0"#),
            Some(PathBuf::from(r"C:\Program Files\LumenDeck\lumendeck.exe"))
        );
        assert_eq!(
            display_icon_path(r"C:\LumenDeck\lumendeck.exe"),
            Some(PathBuf::from(r"C:\LumenDeck\lumendeck.exe"))
        );
        assert_eq!(
            display_icon_path(r"C:\Apps, Inc\lumendeck.exe"),
            Some(PathBuf::from(r"C:\Apps, Inc\lumendeck.exe"))
        );
        assert_eq!(display_icon_path(""), None);
        assert_eq!(display_icon_path("   "), None);
    }

    #[test]
    fn the_registered_value_quotes_the_path() {
        let value = expected_value(Path::new(r"C:\Users\Me Folder\app.exe"));
        assert_eq!(value, r#""C:\Users\Me Folder\app.exe" --minimized"#);
        assert!(value.ends_with(crate::START_HIDDEN_ARG));
    }

    #[test]
    fn an_installed_copy_wins_over_the_running_exe() {
        if let Some(installed) = installed_exe(&env!("CARGO_PKG_NAME").to_string()) {
            assert!(installed.is_file());
            assert_ne!(
                installed,
                std::env::current_exe().ok().as_deref().unwrap_or(Path::new("")),
                "the installed path resolved to this very exe; check the lookup"
            );
        }
        assert!(!target_exe("NoSuchProductForTests").as_os_str().is_empty());
    }

    #[test]
    #[ignore = "changes this machine's logon registration; run by hand"]
    fn logon_registration_round_trip() {
        let name = "LumenDeck";
        let was_registered = read_value(RUN_KEY, name).is_some();

        assert!(sync(name, true).is_ok(), "enabling must succeed");
        let expected = expected_value(&target_exe(name));
        assert_eq!(
            read_value(RUN_KEY, name).as_deref(),
            Some(expected.as_str()),
            "the Run value does not name the app that should start at logon"
        );
        if let Some(installed) = installed_exe(name) {
            assert!(
                expected.contains(&installed.display().to_string()),
                "registered something other than the installed app: {expected}"
            );
        }
        assert_eq!(sync(name, true).unwrap(), None);

        assert!(sync(name, false).is_ok());
        assert!(read_value(RUN_KEY, name).is_none());
        assert_eq!(sync(name, false).unwrap(), None);

        if was_registered {
            assert!(sync(name, true).is_ok());
        }
        println!("final: {:?}", read_value(RUN_KEY, name));
    }
}
