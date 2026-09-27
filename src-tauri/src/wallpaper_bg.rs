#![cfg(windows)]

use crate::config::{WallpaperConfig, WallpaperKind};
use crate::media;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

static LAST_SOURCE: Mutex<String> = Mutex::new(String::new());

static LAST_FRAME_HASH: Mutex<Option<u64>> = Mutex::new(None);

static PENDING: Mutex<Option<WallpaperConfig>> = Mutex::new(None);
static WORKER_RUNNING: AtomicBool = AtomicBool::new(false);

pub fn request_bg(cfg: WallpaperConfig) {
    if let Ok(mut slot) = PENDING.lock() {
        *slot = Some(cfg);
    }
    start_worker();
}

fn start_worker() {
    if WORKER_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }

    let spawned = std::thread::Builder::new()
        .name("wallpaper-bg".into())
        .spawn(|| loop {
            let job = PENDING.lock().ok().and_then(|mut slot| slot.take());
            if let Some(cfg) = job {
                apply_bg(&cfg);
                continue;
            }
            WORKER_RUNNING.store(false, Ordering::Release);
            let has_pending = PENDING
                .lock()
                .map(|slot| slot.is_some())
                .unwrap_or(false);
            if has_pending
                && WORKER_RUNNING
                    .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
            {
                continue;
            }
            break;
        });

    if let Err(error) = spawned {
        WORKER_RUNNING.store(false, Ordering::Release);
        log::warn!("wallpaper-bg: worker spawn failed: {error}");
    }
}

fn bg_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("LumenDeck")
        .join("wallpaper-bg.jpg")
}

pub fn bg_media_url() -> String {
    let p = bg_path();
    if p.is_file() {
        media::media_url_for_file(&p.to_string_lossy())
    } else {
        String::new()
    }
}

pub fn install_live_frame(jpeg: &[u8], source: &str) -> bool {
    if jpeg.len() < 4_096 || jpeg[0] != 0xFF || jpeg[1] != 0xD8 {
        return false;
    }
    let out = bg_path();
    if let Err(e) = std::fs::create_dir_all(out.parent().unwrap()) {
        log::warn!("wallpaper-bg: live frame create dir failed: {e}");
        return false;
    }
    if let Err(e) = std::fs::write(&out, jpeg) {
        log::warn!("wallpaper-bg: live frame write failed: {e}");
        return false;
    }
    if let Ok(mut last) = LAST_SOURCE.lock() {
        *last = wallpaper_key(WallpaperKind::Video, source, "");
    }
    {
        let mut last = LAST_FRAME_HASH.lock().expect("frame hash poisoned");
        let hash = fnv_hash(jpeg);
        if *last == Some(hash) {
            return true;
        }
        *last = Some(hash);
    }
    set_desktop_wallpaper(&out);
    if lock_screen_follows() {
        set_lock_screen_wallpaper(&out);
    }
    log::info!(
        "wallpaper-bg: live frame installed ({} KB) for {source}",
        jpeg.len() / 1024
    );
    true
}

fn fnv_hash(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn resolve_file(source: &str) -> Option<PathBuf> {
    let raw = media::decode_media_ref(source);
    if raw.is_file() {
        Some(raw)
    } else {
        None
    }
}

fn wallpaper_key(kind: WallpaperKind, source: &str, slideshow_folder: &str) -> String {
    let source = match kind {
        WallpaperKind::Video | WallpaperKind::Image => {
            media::decode_media_ref(source)
                .to_string_lossy()
                .replace('/', "\\")
        }
        WallpaperKind::Slideshow | WallpaperKind::Web | WallpaperKind::Shader => source.to_string(),
    };
    format!("{kind:?}:{source}:{slideshow_folder}")
}

pub fn apply_bg(cfg: &WallpaperConfig) {
    let mut last = LAST_SOURCE.lock().expect("last_source poisoned");
    let key = wallpaper_key(cfg.kind, &cfg.source, &cfg.slideshow.folder);
    if *last == key {
        return;
    }
    let out = bg_path();
    if let Err(e) = std::fs::create_dir_all(out.parent().unwrap()) {
        log::warn!("wallpaper-bg: create dir failed: {e}");
        return;
    }

    let ok = match cfg.kind {
        WallpaperKind::Image => apply_image(&cfg.source, &out),
        WallpaperKind::Video => apply_video_frame(&cfg.source, &out),
        WallpaperKind::Slideshow => apply_slideshow(&cfg, &out),
        _ => {
            log::debug!("wallpaper-bg: skipping {:?} (no static fallback)", cfg.kind);
            return;
        }
    };

    if ok {
        *last = key;
        set_desktop_wallpaper(&out);
        if lock_screen_follows() {
            set_lock_screen_wallpaper(&out);
        }
    }
}

/// Should the Windows lock screen follow wallpaper changes? (General tab
/// toggle; default off — some users keep a personal lock image.)
fn lock_screen_follows() -> bool {
    crate::config_store::get().general.lock_screen_follows_wallpaper
}

fn apply_image(source: &str, out: &PathBuf) -> bool {
    let Some(path) = resolve_file(source) else {
        log::warn!("wallpaper-bg: image source not found: {source}");
        return false;
    };
    match std::fs::copy(&path, out) {
        Ok(_) => {
            log::info!("wallpaper-bg: image saved from {}", path.display());
            true
        }
        Err(e) => {
            log::warn!("wallpaper-bg: copy failed: {e}");
            false
        }
    }
}

fn apply_video_frame(source: &str, out: &PathBuf) -> bool {
    let Some(path) = resolve_file(source) else {
        log::warn!("wallpaper-bg: video source not found: {source}");
        return false;
    };
    match extract_video_frame(&path, out) {
        Ok(()) => {
            log::info!("wallpaper-bg: video frame saved from {}", path.display());
            true
        }
        Err(e) => {
            log::warn!("wallpaper-bg: video frame extraction failed: {e}");
            false
        }
    }
}

fn apply_slideshow(cfg: &WallpaperConfig, out: &PathBuf) -> bool {
    let folder = std::path::PathBuf::from(&cfg.slideshow.folder);
    if !folder.is_dir() {
        log::warn!("wallpaper-bg: slideshow folder not found: {}", cfg.slideshow.folder);
        return false;
    }
    let Some(path) = slideshow_image(&folder) else {
        log::warn!("wallpaper-bg: no images in slideshow folder");
        return false;
    };
    match std::fs::copy(&path, out) {
        Ok(_) => {
            log::info!("wallpaper-bg: slideshow frame saved from {}", path.display());
            true
        }
        Err(e) => {
            log::warn!("wallpaper-bg: slideshow copy failed: {e}");
            false
        }
    }
}

fn slideshow_image(folder: &std::path::Path) -> Option<PathBuf> {
    let mut paths: Vec<PathBuf> = std::fs::read_dir(folder)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(is_slideshow_image_extension)
        })
        .collect();
    paths.sort();
    paths.into_iter().next()
}

fn is_slideshow_image_extension(extension: &str) -> bool {
    ["png", "jpg", "jpeg", "webp", "bmp"]
        .iter()
        .any(|candidate| extension.eq_ignore_ascii_case(candidate))
}

fn extract_video_frame(source: &std::path::Path, out: &PathBuf) -> Result<(), String> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::{
        GetDC, GetDIBits, ReleaseDC, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, HBITMAP,
    };
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        SHCreateItemFromParsingName, IShellItem, IShellItemImageFactory, SIIGBF_THUMBNAILONLY,
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let path = HSTRING::from(source.to_string_lossy().as_ref());
        let item: IShellItem =
            SHCreateItemFromParsingName(&path, None).map_err(|e| format!("parse: {e}"))?;

        let factory: IShellItemImageFactory =
            item.cast().map_err(|e| format!("cast: {e}"))?;

        let hbitmap: HBITMAP = factory
            .GetImage(
                SIZE { cx: 1920, cy: 1080 },
                SIIGBF_THUMBNAILONLY,
            )
            .map_err(|e| format!("GetImage: {e}"))?;

        let hdc = GetDC(None);
        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = DIB_RGB_COLORS.0 as u32;
        let _ = GetDIBits(hdc, hbitmap, 0, 0, None, &mut bmi, DIB_RGB_COLORS);
        let (w, h) = (bmi.bmiHeader.biWidth, bmi.bmiHeader.biHeight.unsigned_abs());
        if w <= 0 || h == 0 {
            return Err("invalid bitmap dimensions".into());
        }
        bmi.bmiHeader.biHeight = -(h as i32);

        let buf_len = (w as usize) * (h as usize) * 4;
        let mut pixels = vec![0u8; buf_len];
        let drawn = GetDIBits(
            hdc,
            hbitmap,
            0,
            h,
            Some(pixels.as_mut_ptr().cast()),
            &mut bmi,
            DIB_RGB_COLORS,
        );
        let _ = ReleaseDC(None, hdc);
        if drawn == 0 {
            return Err("GetDIBits failed".into());
        }

        for px in pixels.chunks_exact_mut(4) {
            px.swap(0, 2);
        }
        let img = image::RgbImage::from_raw(w as u32, h, pixels)
            .ok_or("bitmap buffer mismatch")?;
        image::DynamicImage::ImageRgb8(img)
            .save_with_format(out, image::ImageFormat::Jpeg)
            .map_err(|e| format!("save jpeg: {e}"))?;

        drop(factory);
        drop(item);
        Ok(())
    }
}

fn set_desktop_wallpaper(path: &PathBuf) {
    use windows::core::HSTRING;
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPIF_UPDATEINIFILE, SPI_SETDESKWALLPAPER, SPIF_SENDCHANGE,
    };

    let wide = HSTRING::from(path.to_string_lossy().as_ref());
    unsafe {
        let result = SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            Some(wide.as_ptr() as _),
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        );
        if result.is_ok() {
            log::info!("wallpaper-bg: desktop wallpaper set");
        } else {
            log::warn!("wallpaper-bg: SystemParametersInfoW failed: {result:?}");
        }
    }
}

fn set_lock_screen_wallpaper(path: &PathBuf) {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::System::Registry::{
        RegCreateKeyExW, RegOpenKeyExW, RegSetValueExW, RegCloseKey, HKEY_CURRENT_USER,
        KEY_QUERY_VALUE, KEY_SET_VALUE, REG_OPEN_CREATE_OPTIONS, REG_VALUE_TYPE,
    };

    unsafe {
        let reg_path = windows::core::HSTRING::from(
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Personalization",
        );
        let mut hkey = windows::Win32::System::Registry::HKEY::default();
        let sam = KEY_SET_VALUE | KEY_QUERY_VALUE;
        let open_result = RegOpenKeyExW(HKEY_CURRENT_USER, &reg_path, Some(0), sam, &mut hkey);
        if open_result.is_err() {
            let created = RegCreateKeyExW(
                HKEY_CURRENT_USER,
                &reg_path,
                None,
                None,
                REG_OPEN_CREATE_OPTIONS(0),
                sam,
                None,
                &mut hkey,
                None,
            );
            if created.is_err() {
                log::warn!("wallpaper-bg: lock screen reg open failed: {created:?}");
                return;
            }
        }

        let value_name = windows::core::HSTRING::from("LockScreenImage");
        let value_bytes: Vec<u8> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .flat_map(u16::to_le_bytes)
            .collect();
        let result = RegSetValueExW(hkey, &value_name, Some(0), REG_VALUE_TYPE(1), Some(&value_bytes));
        let _ = RegCloseKey(hkey);

        if result.is_ok() {
            log::info!("wallpaper-bg: lock screen wallpaper set via registry");
        } else {
            log::warn!("wallpaper-bg: lock screen reg set failed: {result:?}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{is_slideshow_image_extension, slideshow_image, wallpaper_key};
    use crate::config::WallpaperKind;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn slideshow_image_extensions_are_case_insensitive() {
        assert!(is_slideshow_image_extension("JpEg"));
        assert!(!is_slideshow_image_extension("gif"));
    }

    #[test]
    fn wallpaper_key_normalizes_media_urls_and_includes_kind_and_folder() {
        let path = r"C:\Wallpapers\scene one.mp4";
        let media_url = crate::media::media_url_for_file(path);

        assert_eq!(
            wallpaper_key(WallpaperKind::Video, path, ""),
            wallpaper_key(WallpaperKind::Video, &media_url, "")
        );
        assert_ne!(
            wallpaper_key(WallpaperKind::Video, path, ""),
            wallpaper_key(WallpaperKind::Image, path, "")
        );
        assert_ne!(
            wallpaper_key(WallpaperKind::Slideshow, "", "first"),
            wallpaper_key(WallpaperKind::Slideshow, "", "second")
        );
    }

    #[test]
    fn slideshow_fallback_selects_the_first_image_in_sorted_order() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let folder = std::env::temp_dir().join(format!("lumendeck-wallpaper-{unique}"));
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("z-last.JPG"), []).unwrap();
        fs::write(folder.join("a-first.png"), []).unwrap();
        fs::write(folder.join("ignored.gif"), []).unwrap();

        assert_eq!(
            slideshow_image(&folder),
            Some(folder.join("a-first.png"))
        );

        fs::remove_dir_all(folder).unwrap();
    }
}
