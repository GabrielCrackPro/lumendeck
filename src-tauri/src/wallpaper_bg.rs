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

pub fn bg_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("LumenDeck")
        .join("wallpaper-bg.jpg")
}

const ORIG_WALLPAPER_VALUE: &str = "LumenDeckOriginalWallpaper";

pub fn remember_original_wallpaper() {
    use windows::core::HSTRING;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegGetValueW, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_QUERY_VALUE, KEY_SET_VALUE, RRF_RT_REG_SZ, REG_VALUE_TYPE,
    };
    unsafe {
        let key_name = HSTRING::from("Control Panel\\Desktop");
        let mut hkey = HKEY::default();
        if RegOpenKeyExW(HKEY_CURRENT_USER, &key_name, Some(0), KEY_QUERY_VALUE | KEY_SET_VALUE, &mut hkey).is_err() {
            log::warn!("wallpaper-bg: could not open desktop key for backup");
            return;
        }
        let value_name = HSTRING::from(ORIG_WALLPAPER_VALUE);

        let mut buf = [0u16; 1024];
        let mut len = (buf.len() as u32) * 2;
        let mut kind = REG_VALUE_TYPE::default();
        let got = RegGetValueW(
            hkey,
            None,
            &value_name,
            RRF_RT_REG_SZ,
            Some(&mut kind),
            Some(buf.as_mut_ptr().cast()),
            Some(&mut len),
        );
        if got.is_ok() {
            let _ = RegCloseKey(hkey);
            return;
        }

        let mut cur = [0u16; 1024];
        let mut cur_len = (cur.len() as u32) * 2;
        let cur_name = HSTRING::from("Wallpaper");
        let got = RegGetValueW(
            hkey,
            None,
            &cur_name,
            RRF_RT_REG_SZ,
            None,
            Some(cur.as_mut_ptr().cast()),
            Some(&mut cur_len),
        );
        if got.is_ok() && cur_len >= 2 {
            let path = String::from_utf16_lossy(&cur[..((cur_len / 2) - 1) as usize]);
            if !path.is_empty()
                && path.to_ascii_lowercase() != bg_path().to_string_lossy().to_ascii_lowercase()
            {
                let bytes: Vec<u8> = path
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .flat_map(|u| u.to_le_bytes())
                    .collect();
                if RegSetValueExW(hkey, &value_name, Some(0), REG_VALUE_TYPE(1u32), Some(&bytes)).is_ok() {
                    log::info!("wallpaper-bg: original wallpaper backed up ({path})");
                }
            }
        }
        let _ = RegCloseKey(hkey);
    }
}

pub fn restore_original_wallpaper() -> bool {
    use windows::core::HSTRING;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegDeleteValueW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER,
        KEY_QUERY_VALUE, KEY_SET_VALUE, RRF_RT_REG_SZ,
    };
    unsafe {
        let key_name = HSTRING::from("Control Panel\\Desktop");
        let mut hkey = HKEY::default();
        if RegOpenKeyExW(HKEY_CURRENT_USER, &key_name, Some(0), KEY_QUERY_VALUE | KEY_SET_VALUE, &mut hkey).is_err() {
            log::warn!("wallpaper-bg: could not open desktop key for restore");
            return false;
        }
        let value_name = HSTRING::from(ORIG_WALLPAPER_VALUE);
        let mut buf = [0u16; 1024];
        let mut len = (buf.len() as u32) * 2;
        let got = RegGetValueW(
            hkey,
            None,
            &value_name,
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr().cast()),
            Some(&mut len),
        );
        let _ = RegCloseKey(hkey);
        if got.is_err() || len < 2 {
            log::info!("wallpaper-bg: no original wallpaper backup to restore");
            return false;
        }
        let path = String::from_utf16_lossy(&buf[..((len / 2) - 1) as usize]);
        let path = std::path::PathBuf::from(path);
        if !path.is_file() {
            log::warn!("wallpaper-bg: original wallpaper missing on disk: {}", path.display());
            return false;
        }
        let ok = set_desktop_wallpaper(&path);
        if ok {
            let mut hkey2 = HKEY::default();
            if RegOpenKeyExW(HKEY_CURRENT_USER, &key_name, Some(0), KEY_SET_VALUE, &mut hkey2).is_ok() {
                let _ = RegDeleteValueW(hkey2, &value_name);
                let _ = RegCloseKey(hkey2);
            }
            log::info!("wallpaper-bg: original wallpaper restored ({})", path.display());
        }
        ok
    }
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
    if is_near_black(jpeg) {
        log::debug!("wallpaper-bg: live frame rejected (near-black), keeping previous");
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
    remember_original_wallpaper();
    if !set_desktop_wallpaper(&out) {
        return false;
    }
    if lock_screen_follows() {
        set_lock_screen_wallpaper(&out);
    }
    log::info!(
        "wallpaper-bg: live frame installed ({} KB) for {source}",
        jpeg.len() / 1024
    );
    true
}

fn drop_alpha_bytes(pixels: &[u8]) -> Vec<u8> {
    pixels
        .chunks_exact(4)
        .flat_map(|px| [px[0], px[1], px[2]])
        .collect()
}

fn is_near_black(jpeg: &[u8]) -> bool {
    let Ok(img) = image::load_from_memory_with_format(jpeg, image::ImageFormat::Jpeg) else {
        return false;
    };
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return true;
    }
    let img = img.to_rgb8();
    let step_x = (w / 32).max(1);
    let step_y = (h / 32).max(1);
    let mut dark = 0u32;
    let mut total = 0u32;
    for y in (0..h).step_by(step_y as usize) {
        for x in (0..w).step_by(step_x as usize) {
            let px = img.get_pixel(x, y);
            let lum = px[0].max(px[1]).max(px[2]);
            if lum < 12 {
                dark += 1;
            }
            total += 1;
        }
    }
    total > 0 && dark * 100 >= total * 98
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

pub fn ensure_installed_before_exit() {
    let cfg = crate::config_store::get();
    if cfg.general.wallpaper_enabled {
        apply_bg(&cfg.wallpaper);
    }
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
        remember_original_wallpaper();
        if set_desktop_wallpaper(&out) {
            *last = key;
            if lock_screen_follows() {
                set_lock_screen_wallpaper(&out);
            }
        }
    }
}

fn lock_screen_follows() -> bool {
    crate::config_store::get().general.lock_screen_follows_wallpaper
}

pub fn restore_original_lock_screen() -> bool {
    crate::lock_screen_reg::release()
}

pub fn force_lock_screen_sync() {
    if !lock_screen_follows() {
        return;
    }
    let out = bg_path();
    if !out.is_file() {
        log::info!("lock-screen: no background file yet, will follow the next frame");
        return;
    }
    set_lock_screen_wallpaper(&out);
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
        GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
        DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
    };
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        SHCreateItemFromParsingName, IShellItem, IShellItemImageFactory, SIIGBF_RESIZETOFIT,
        SIIGBF_THUMBNAILONLY,
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
                SIIGBF_RESIZETOFIT,
            )
            .or_else(|_| {
                factory.GetImage(
                    SIZE { cx: 1920, cy: 1080 },
                    SIIGBF_THUMBNAILONLY,
                )
            })
            .map_err(|e| format!("GetImage: {e}"))?;

        let mut bm = BITMAP::default();
        if GetObjectW(
            HGDIOBJ(hbitmap.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut _ as _),
        ) == 0
        {
            return Err("GetObjectW failed".into());
        }
        let (w, h) = (bm.bmWidth, bm.bmHeight.unsigned_abs());
        if w <= 0 || h == 0 {
            return Err("invalid bitmap dimensions".into());
        }
        let hdc = GetDC(None);
        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = w;
        bmi.bmiHeader.biHeight = -(h as i32);
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = DIB_RGB_COLORS.0 as u32;

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
        let rgb = drop_alpha_bytes(&pixels);
        let img = image::RgbImage::from_raw(w as u32, h, rgb)
            .ok_or("bitmap buffer mismatch")?;
        image::DynamicImage::ImageRgb8(img)
            .save_with_format(out, image::ImageFormat::Jpeg)
            .map_err(|e| format!("save jpeg: {e}"))?;

        drop(factory);
        drop(item);
        Ok(())
    }
}

pub(crate) fn set_desktop_wallpaper(path: &PathBuf) -> bool {
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
            true
        } else {
            log::warn!("wallpaper-bg: SystemParametersInfoW failed: {result:?}");
            false
        }
    }
}

fn set_lock_screen_wallpaper(path: &PathBuf) {
    crate::lock_screen_reg::adopt(path);
}

#[cfg(test)]
mod tests {
    use super::{
        drop_alpha_bytes, is_slideshow_image_extension, slideshow_image, wallpaper_key,
    };
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

    #[test]
    fn dropping_alpha_yields_exactly_the_length_the_encoder_demands() {
        let (w, h) = (4usize, 3usize);
        let bgra: Vec<u8> = (0..(w * h * 4) as u8).collect();
        let rgb = drop_alpha_bytes(&bgra);
        assert_eq!(rgb.len(), w * h * 3);
    }

    #[test]
    fn dropping_alpha_keeps_rgb_and_drops_only_the_fourth_byte() {
        let rgba: Vec<u8> = vec![10, 20, 30, 40, 50, 60, 70, 80];
        assert_eq!(drop_alpha_bytes(&rgba), vec![10, 20, 30, 50, 60, 70]);
    }

    #[test]
    fn the_converted_buffer_is_exactly_what_a_1920x1080_frame_needs() {
        let (w, h) = (1920usize, 1080usize);
        let bgra = vec![0u8; w * h * 4];
        let rgb = drop_alpha_bytes(&bgra);
        assert_eq!(rgb.len(), w * h * 3);
        assert_eq!(image::RgbImage::from_raw(w as u32, h as u32, rgb).is_some(), true);
    }
}
