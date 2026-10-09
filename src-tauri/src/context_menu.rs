#![cfg(windows)]

use std::path::Path;
use std::sync::Mutex;
use tauri::Manager;
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteKeyW, RegDeleteTreeW, RegOpenKeyExW, RegSetValueExW,
    HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_OPEN_CREATE_OPTIONS,
    REG_VALUE_TYPE, RRF_RT_REG_SZ, RegGetValueW,
};

const REG_SZ_TYPE: REG_VALUE_TYPE = REG_VALUE_TYPE(1);

pub const VERB_NAME: &str = "LumenDeckSetWallpaper";
pub const SET_WALLPAPER_FLAG: &str = "--set-wallpaper";

pub fn media_extensions() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for ext in crate::ipc::GALLERY_IMAGE_EXT.iter().chain(crate::ipc::GALLERY_VIDEO_EXT.iter()) {
        out.push(format!(".{ext}"));
    }
    out
}

pub fn verb_key_for(ext: &str) -> String {
    format!(r"Software\Classes\{ext}\shell\{VERB_NAME}")
}

pub fn command_line(exe: &str) -> String {
    format!("\"{exe}\" {SET_WALLPAPER_FLAG} \"%1\"")
}


pub fn parse_set_wallpaper_arg(args: &[String]) -> Option<String> {
    let idx = args.iter().position(|a| a == SET_WALLPAPER_FLAG)?;
    let raw = args.get(idx + 1)?;
    let trimmed = raw.trim().trim_matches('"');
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

/// Whether the path is a media kind the gallery classifies.
pub fn accepts(path: &str) -> bool {
    Path::new(path)
        .extension()
        .map(|e| {
            let ext = format!(".{}", e.to_string_lossy().to_ascii_lowercase());
            media_extensions().contains(&ext)
        })
        .unwrap_or(false)
}

fn open_key(path: &str) -> Option<HKEY> {
    let sub = HSTRING::from(path);
    let sam = KEY_SET_VALUE | KEY_QUERY_VALUE;
    let mut hkey = HKEY::default();
    unsafe {
        if RegOpenKeyExW(HKEY_CURRENT_USER, &sub, Some(0), sam, &mut hkey).is_ok() {
            return Some(hkey);
        }
        let created = RegCreateKeyExW(
            HKEY_CURRENT_USER,
            &sub,
            None,
            None,
            REG_OPEN_CREATE_OPTIONS(0),
            sam,
            None,
            &mut hkey,
            None,
        );
        if created.is_err() {
            return None;
        }
    }
    Some(hkey)
}

fn write_default_value(hkey: HKEY, value: &str) -> bool {
    let bytes: Vec<u8> = value
        .encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(u16::to_le_bytes)
        .collect();
    unsafe { RegSetValueExW(hkey, PCWSTR::null(), Some(0), REG_SZ_TYPE, Some(&bytes)).is_ok() }
}

fn read_default_value(hkey: HKEY) -> Option<String> {
    let mut buf = [0u16; 4096];
    let mut len = (buf.len() * 2) as u32;
    let got = unsafe {
        RegGetValueW(
            hkey,
            None,
            None,
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

fn close(hkey: HKEY) {
    unsafe {
        let _ = RegCloseKey(hkey);
    }
}

fn register(ext: &str, label: &str, command: &str) -> Result<(), String> {
    let verb = verb_key_for(ext);
    let verb_key = open_key(&verb).ok_or_else(|| format!("could not open {verb}"))?;
    let labelled = write_default_value(verb_key, label);
    let written_label = read_default_value(verb_key);
    close(verb_key);
    if !labelled || written_label.as_deref() != Some(label) {
        return Err(format!("could not write the label for {ext}"));
    }
    let command_path = format!(r"{verb}\command");
    let command_key = open_key(&command_path).ok_or_else(|| format!("could not open {command_path}"))?;
    let set = write_default_value(command_key, command);
    let written_command = read_default_value(command_key);
    close(command_key);
    if !set || written_command.as_deref() != Some(command) {
        return Err(format!("could not write the command for {ext}"));
    }
    Ok(())
}

fn unregister(ext: &str) {
    let verb = verb_key_for(ext);
    unsafe {
        let sub = HSTRING::from(&verb);
        let _ = RegDeleteTreeW(HKEY_CURRENT_USER, &sub);
        let shell = HSTRING::from(format!(r"Software\Classes\{ext}\shell"));
        let _ = RegDeleteKeyW(HKEY_CURRENT_USER, &shell);
    }
}


pub fn sync(exe: &Path, label: &str, enabled: bool) -> Result<(), String> {
    let exe = exe.to_string_lossy().to_string();
    let fingerprint = format!("{enabled}|{label}|{exe}");

    static LAST: Mutex<Option<String>> = Mutex::new(None);
    let mut last = LAST.lock().map_err(|_| "context-menu state poisoned")?;
    if *last == Some(fingerprint.clone()) {
        return Ok(());
    }

    let command = command_line(&exe);
    if enabled {
        let mut failures = 0usize;
        for ext in media_extensions() {
            if let Err(e) = register(&ext, label, &command) {
                failures += 1;
                log::warn!("explorer-menu: {e}");
            }
        }
        if failures == media_extensions().len() {
            return Err("explorer menu: every registration failed".into());
        }
        log::info!("explorer-menu: registered \"{label}\" for {} extensions", media_extensions().len());
    } else {
        for ext in media_extensions() {
            unregister(&ext);
        }
        log::info!("explorer-menu: removed the context-menu verb");
    }
    *last = Some(fingerprint);
    Ok(())
}

pub fn apply_current() -> Result<(), String> {
    let cfg = crate::config_store::get();
    let exe = std::env::current_exe().map_err(crate::error::err_str)?;
    let label = crate::i18n::t("explorer-menu.verb");
    sync(&exe, &label, cfg.general.explorer_menu)
}

pub fn handle_set_wallpaper_request(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    if !accepts(path) {
        return Err(format!("unsupported file type: {path}"));
    }
    let entries = crate::ipc::gallery_import_paths(vec![path.to_string()])?;
    let entry = entries
        .iter()
        .find(|e| e.source.eq_ignore_ascii_case(path))
        .ok_or_else(|| "the file was not added to the gallery".to_string())?;
    crate::ipc::gallery_apply(app.clone(), entry.id.clone())?;
    log::info!("explorer-menu: applied {path}");
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_command_passes_the_clicked_file_as_one_argument() {
        let cmd = command_line(r"C:\Users\Me\AppData\Local\LumenDeck\LumenDeck.exe");
        assert_eq!(
            cmd,
            r#""C:\Users\Me\AppData\Local\LumenDeck\LumenDeck.exe" --set-wallpaper "%1""#
        );
        assert!(cmd.starts_with('"'), "the exe path must be quoted");
        assert!(cmd.contains(&format!("{SET_WALLPAPER_FLAG} \"%1\"")));
    }

    #[test]
    fn the_verb_key_sits_under_the_extension_classes() {
        assert_eq!(
            verb_key_for(".png"),
            r"Software\Classes\.png\shell\LumenDeckSetWallpaper"
        );
    }

    #[test]
    fn a_plain_launch_is_not_a_set_request() {
        assert_eq!(
            parse_set_wallpaper_arg(&args(&["C:\\app.exe"])),
            None
        );
        assert_eq!(parse_set_wallpaper_arg(&args(&["--minimized"])), None);
        assert_eq!(
            parse_set_wallpaper_arg(&args(&[SET_WALLPAPER_FLAG])),
            None,
            "a flag with no operand must not reach the import"
        );
        assert_eq!(
            parse_set_wallpaper_arg(&args(&[SET_WALLPAPER_FLAG, "   "])),
            None
        );
    }

    #[test]
    fn the_flag_following_the_operand_wins_only_when_present() {
        let path = r"C:\Users\Me\Pictures\cat.png";
        assert_eq!(
            parse_set_wallpaper_arg(&args(&["C:\\app.exe", SET_WALLPAPER_FLAG, path])).as_deref(),
            Some(path)
        );
        assert_eq!(
            parse_set_wallpaper_arg(&args(&[SET_WALLPAPER_FLAG, "\"D:\\a b\\x.mp4\""]))
                .as_deref(),
            Some(r"D:\a b\x.mp4"),
            "quoted operands survive as a bare path"
        );
    }

    #[test]
    fn only_gallery_classifiable_extensions_are_accepted() {
        for ok in ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.bmp", "g.mp4", "h.webm", "i.mov", "j.mkv"] {
            assert!(accepts(ok), "{ok} should be accepted");
        }
        for bad in ["a.txt", "b.exe", "noextension", "d./png", "a.png.txt"] {
            assert!(!accepts(bad), "{bad} should be rejected");
        }
    }

    #[test]
    fn media_extensions_match_the_gallery_classifiers_exactly() {
        let mine = media_extensions();
        assert_eq!(mine.len(), crate::ipc::GALLERY_IMAGE_EXT.len() + crate::ipc::GALLERY_VIDEO_EXT.len());
        assert!(mine.contains(&".png".to_string()));
        assert!(mine.contains(&".mkv".to_string()));
        assert!(mine.iter().all(|e| e.starts_with('.')));
    }

    #[test]
    fn a_registered_verb_round_trips_through_the_registry() {
        // A throwaway extension keeps the test off the real file-type keys.
        const TEST_EXT: &str = ".lumendeck-menutest";
        let verb = verb_key_for(TEST_EXT);
        let command = command_line(r"C:\noop\LumenDeck.exe");
        register(TEST_EXT, "Set as live wallpaper", &command).expect("register must succeed");

        let key = open_key(&verb).expect("verb key must exist after register");
        assert_eq!(
            read_default_value(key).as_deref(),
            Some("Set as live wallpaper")
        );
        close(key);

        let cmd_path = format!(r"{verb}\command");
        let cmd_key = open_key(&cmd_path).expect("command key must exist after register");
        assert_eq!(read_default_value(cmd_key).as_deref(), Some(command.as_str()));
        close(cmd_key);

        unregister(TEST_EXT);
        let gone = open_key(&verb);
        if let Some(key) = gone {
            let still_there = read_default_value(key).is_some();
            close(key);
            unregister(TEST_EXT);
            assert!(!still_there, "unregister left the verb behind");
        }
    }

    #[test]
    fn the_flag_is_a_single_dashed_token() {
        assert!(!SET_WALLPAPER_FLAG.contains('='));
        assert!(SET_WALLPAPER_FLAG.starts_with("--"));
    }
}
