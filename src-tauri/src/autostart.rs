//! Start with Windows — and the one rule that decides *which* exe starts.
//!
//! Registration used to be handed to whatever build happened to be running:
//! `tauri-plugin-autostart` writes `current_exe()`, so toggling any setting
//! while a debug build was open made that debug build the thing Windows
//! launches at logon. That is how a boot ended up opening a terminal window
//! (a debug binary had the console subsystem) and a dashboard pointed at
//! `http://localhost:1420`, where no Vite is listening — WebView2's "can't
//! reach this page".
//!
//! So the entry names the **installed** app when there is one: the build that
//! survives a `cargo clean`, starts with no dev server behind it, and is what
//! a user would recognise as LumenDeck. A machine running only from source
//! falls back to the current exe, because that is the app there is.

use std::path::{Path, PathBuf};
use tauri::AppHandle;
use windows::core::HSTRING;
use windows::Win32::System::Registry::{
    RegCloseKey, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE,
    RRF_RT_REG_SZ,
};

/// Where Windows keeps per-user logon entries.
const RUN_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
/// Where the installer records where it put things.
const UNINSTALL_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";

/// Apply the preference: register for logon, or remove the registration.
///
/// Logs only when it actually writes something — the preference itself is
/// applied on every save and every boot, and neither of those is an event.
pub fn apply(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let registered = sync(&app.package_info().name, enabled)?;
    if let Some(target) = registered {
        log::info!("autostart: {} starts at logon", target.display());
    }
    Ok(())
}

/// The actual work, separated from the app handle so a test can drive it.
///
/// Returns the path that ends up registered, when enabling, so the caller can
/// decide whether that is worth a log line.
fn sync(product_name: &str, enabled: bool) -> Result<Option<PathBuf>, String> {
    if !enabled {
        // Absent is the normal state for a machine that never turned it on,
        // and `auto-launch` reports a missing value as an error — which would
        // put a warning in the log on every single boot. Nothing registered
        // is already the requested state.
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
        // Already what we would write. A log line per boot for an unchanged
        // value is exactly the noise this log cannot afford.
        return Ok(None);
    }
    launch(target.clone(), product_name)?
        .enable()
        .map_err(|e| e.to_string())?;
    Ok(Some(target))
}

/// Quote the path: an unquoted Run value containing spaces is ambiguous —
/// Windows tries progressively longer prefixes of it — and any user profile
/// folder can contain one. `auto-launch` writes `"{path} {args}"` verbatim,
/// so the quoting has to arrive with the path.
fn expected_value(exe: &Path) -> String {
    format!("\"{}\" {}", exe.display(), crate::START_HIDDEN_ARG)
}

/// Build the `auto-launch` handle for a specific exe.
///
/// The value name is the product name — the same name the plugin used, so an
/// entry written by an older build is the entry this replaces in place, and
/// disabling still finds it no matter who wrote it.
fn launch(exe: PathBuf, product_name: &str) -> Result<auto_launch::AutoLaunch, String> {
    auto_launch::AutoLaunchBuilder::new()
        .set_app_name(product_name)
        .set_app_path(&format!("\"{}\"", exe.display()))
        .set_args(&[crate::START_HIDDEN_ARG])
        .build()
        .map_err(|e| e.to_string())
}

/// The exe the Run value should name: the installed app if this machine has
/// one, otherwise the exe that is running.
fn target_exe(product_name: &str) -> PathBuf {
    installed_exe(product_name)
        .or_else(|| std::env::current_exe().ok())
        .unwrap_or_else(|| PathBuf::from(format!("{}.exe", env!("CARGO_PKG_NAME"))))
}

/// The installed copy, found through the record the installer wrote.
///
/// The uninstall entry rather than a hard-coded `%LOCALAPPDATA%\<name>`: it
/// exists only when an install does, and it points at wherever that install
/// actually went.
fn installed_exe(product_name: &str) -> Option<PathBuf> {
    let key = format!(r"{UNINSTALL_KEY}\{product_name}");
    if let Some(icon) = read_value(&key, "DisplayIcon") {
        if let Some(path) = display_icon_path(&icon) {
            if path.is_file() {
                return Some(path);
            }
        }
    }
    // Some installers record only the folder; the binary name is ours.
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

/// Read one `REG_SZ` value, or `None` when it is absent or unreadable.
///
/// Key path first, value name second — the two are both plain strings, so the
/// round-trip test below is what keeps a swap from silently reading nothing.
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
        // The three shapes an installer writes, and the one thing that must
        // survive them: the path, verbatim.
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
        // A comma in the directory name is not an icon index.
        assert_eq!(
            display_icon_path(r"C:\Apps, Inc\lumendeck.exe"),
            Some(PathBuf::from(r"C:\Apps, Inc\lumendeck.exe"))
        );
        assert_eq!(display_icon_path(""), None);
        assert_eq!(display_icon_path("   "), None);
    }

    #[test]
    fn the_registered_value_quotes_the_path() {
        // Unquoted, a path with a spaces in it is read by Windows as several
        // candidates, and the `--minimized` flag would land on the wrong one.
        let value = expected_value(Path::new(r"C:\Users\Me Folder\app.exe"));
        assert_eq!(value, r#""C:\Users\Me Folder\app.exe" --minimized"#);
        // The flag is what tells setup() this is a logon launch, so it cannot
        // drift out of the value unnoticed.
        assert!(value.ends_with(crate::START_HIDDEN_ARG));
    }

    /// The point of the module: on a machine with an installed copy, that copy
    /// is what gets registered — never the debug build under `target`.
    #[test]
    fn an_installed_copy_wins_over_the_running_exe() {
        if let Some(installed) = installed_exe(&env!("CARGO_PKG_NAME").to_string()) {
            // Registered under the product name the installer used.
            assert!(installed.is_file());
            assert_ne!(
                installed,
                std::env::current_exe().ok().as_deref().unwrap_or(Path::new("")),
                "the installed path resolved to this very exe; check the lookup"
            );
        }
        // Without an install the running exe is all there is, and it still
        // has to be a path we could write into the Run value.
        assert!(!target_exe("NoSuchProductForTests").as_os_str().is_empty());
    }

    /// End-to-end check of the registration — ignored because it rewrites the
    /// machine's logon entry. Run it by hand:
    ///
    /// ```text
    /// cargo test autostart -- --include-ignored --nocapture
    /// ```
    ///
    /// Enables, asserts the value names the installed app rather than this
    /// build, disables, and then puts back the state it found.
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
        // Applied again: unchanged, so nothing to write and nothing to log.
        assert_eq!(sync(name, true).unwrap(), None);

        // Off: the value is gone — and with nothing registered, applying off
        // a second time must still be Ok, or every boot logs a warning.
        assert!(sync(name, false).is_ok());
        assert!(read_value(RUN_KEY, name).is_none());
        assert_eq!(sync(name, false).unwrap(), None);

        if was_registered {
            assert!(sync(name, true).is_ok());
        }
        println!("final: {:?}", read_value(RUN_KEY, name));
    }
}
