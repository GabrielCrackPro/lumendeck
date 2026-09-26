//! Save the current wallpaper as a static image and apply it as the Windows
//! desktop + lock screen background, so the user has a matching wallpaper if
//! LumenDeck is closed.

#![cfg(windows)]

use crate::config::{WallpaperConfig, WallpaperKind};
use crate::media;
use std::path::PathBuf;
use std::sync::Mutex;

/// Track the last wallpaper source we applied as a background, so we don't
/// re-set it on every unrelated config save.
static LAST_SOURCE: Mutex<String> = Mutex::new(String::new());

/// Hash of the last live frame pushed — dedupes identical frames so the OS
/// background isn't repainted (flicker) when nothing changed.
static LAST_FRAME_HASH: Mutex<Option<u64>> = Mutex::new(None);

/// Coalescing job slot for the background worker: holds the latest requested
/// config while a previous capture is still running. Rapid config saves
/// (dragging sliders) collapse into at most one pending capture.
static PENDING: Mutex<Option<WallpaperConfig>> = Mutex::new(None);

/// Queue a static-background capture on the dedicated worker thread. Captures
/// (especially Shell video thumbnails on 4K files) block for 100ms+ — doing
/// that inline stalled the config-save and IPC paths.
pub fn request_bg(cfg: WallpaperConfig) {
    // Coalesce: drop any queued-but-not-started request, keep only the latest.
    if let Ok(mut slot) = PENDING.lock() {
        *slot = Some(cfg);
    }
    std::thread::Builder::new()
        .name("wallpaper-bg".into())
        .spawn(| | {
            loop {
                let job = PENDING.lock().ok().and_then(|mut s| s.take());
                let Some(cfg) = job else { break };
                apply_bg(&cfg);
            }
        })
        .ok();
    // Note: multiple worker threads can briefly coexist (each spawn drains
    // until the slot is empty); LAST_SOURCE keeps the work idempotent.
}

/// Resolved background image path under %APPDATA%/LumenDeck/.
fn bg_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("LumenDeck")
        .join("wallpaper-bg.jpg")
}

/// Servable URL for the static fallback frame, for the wallpaper webview's
/// under-video layer. Empty string when no snapshot exists yet.
pub fn bg_media_url() -> String {
    let p = bg_path();
    if p.is_file() {
        media::media_url_for_file(&p.to_string_lossy())
    } else {
        String::new()
    }
}

/// Install a live frame captured by the wallpaper webview itself. Called via
/// the `set_live_frame` IPC command after the webview blits a real decoded
/// frame. This is the highest-fidelity fallback: an actual mid-playback frame
/// (Shell thumbnails can be stale, generic, or fail entirely).
/// Also pushes it as the Windows desktop + lock-screen background.
/// Returns false when the payload is not usable, so the caller can fall back.
pub fn install_live_frame(jpeg: &[u8], source: &str) -> bool {
    // Sanity: must be a plausible JPEG (SOI marker) and non-trivial size.
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
    // This frame corresponds to `source`; remember it so the async worker
    // doesn't immediately overwrite it with a Shell thumbnail of the same file.
    if let Ok(mut last) = LAST_SOURCE.lock() {
        *last = source.to_string();
    }
    // Only re-apply the OS background when the frame actually differs from
    // the last one pushed (same-size JPEGs of near-identical frames still
    // differ, so compare content): SystemParametersInfoW triggers a desktop
    // repaint, and two monitors pushing every 5 min each = visible flicker.
    {
        let mut last = LAST_FRAME_HASH.lock().expect("frame hash poisoned");
        let hash = fnv_hash(jpeg);
        if *last == Some(hash) {
            return true; // frame identical; skip the OS repaint
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

/// FNV-1a hash of frame bytes — enough to detect "identical frame" without
/// hashing collisions mattering in practice.
fn fnv_hash(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Resolve the wallpaper source to a local file path (images and videos only).
fn resolve_file(source: &str) -> Option<PathBuf> {
    let raw = media::decode_media_ref(source);
    if raw.is_file() {
        Some(raw)
    } else {
        None
    }
}

/// Capture the current wallpaper as a static JPEG and set it as the Windows
/// desktop + lock screen background. Called whenever the wallpaper changes.
///
/// - **Images**: copied directly (no re-encode).
/// - **Videos**: a poster frame is extracted via the Shell thumbnail API.
/// - **Shaders / Web**: no static fallback available; silently skipped.
pub fn apply_bg(cfg: &WallpaperConfig) {
    // Skip if the wallpaper source hasn't changed since the last apply.
    let mut last = LAST_SOURCE.lock().expect("last_source poisoned");
    if *last == cfg.source {
        return;
    }
    *last = cfg.source.clone();

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

// ---------------------------------------------------------------------------
// Per-kind helpers
// ---------------------------------------------------------------------------

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
    // Use the first image in the slideshow folder as the static fallback.
    let folder = std::path::PathBuf::from(&cfg.slideshow.folder);
    if !folder.is_dir() {
        log::warn!("wallpaper-bg: slideshow folder not found: {}", cfg.slideshow.folder);
        return false;
    }
    let exts: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp"];
    let mut first: Option<PathBuf> = None;
    if let Ok(entries) = std::fs::read_dir(&folder) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_file() {
                if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    if exts.contains(&ext.to_ascii_lowercase().as_str()) {
                        first = Some(p);
                        break;
                    }
                }
            }
        }
    }
    let Some(path) = first else {
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

// ---------------------------------------------------------------------------
// Video frame extraction via Windows Shell (same approach as thumbs.rs)
// ---------------------------------------------------------------------------

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

        // Request a monitor-sized thumbnail for best quality.
        let hbitmap: HBITMAP = factory
            .GetImage(
                SIZE { cx: 1920, cy: 1080 },
                SIIGBF_THUMBNAILONLY,
            )
            .map_err(|e| format!("GetImage: {e}"))?;

        // DDB → top-down 32bpp DIB.
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

        // BGRA → RGB for JPEG encoding.
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

// ---------------------------------------------------------------------------
// Win32 wallpaper setting
// ---------------------------------------------------------------------------

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
    use windows::Win32::System::Registry::{
        RegCreateKeyExW, RegOpenKeyExW, RegSetValueExW, RegCloseKey, HKEY_CURRENT_USER,
        KEY_QUERY_VALUE, KEY_SET_VALUE, REG_OPEN_CREATE_OPTIONS, REG_VALUE_TYPE, REG_SAM_FLAGS,
    };

    unsafe {
        let reg_path = windows::core::HSTRING::from(
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Personalization",
        );
        let mut hkey = windows::Win32::System::Registry::HKEY::default();
        // The key may not exist on systems where the user never customized the
        // lock screen — open read-write first, fall back to creating it.
        // (WIN32_ERROR(2) = ERROR_FILE_NOT_FOUND from KEY_SET_VALUE-only open.)
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
        // Registry REG_SZ requires a null-terminated string.
        let mut value_bytes = path.to_string_lossy().as_bytes().to_vec();
        value_bytes.push(0);
        let result = RegSetValueExW(hkey, &value_name, Some(0), REG_VALUE_TYPE(1), Some(&value_bytes));
        let _ = RegCloseKey(hkey);

        if result.is_ok() {
            log::info!("wallpaper-bg: lock screen wallpaper set via registry");
        } else {
            log::warn!("wallpaper-bg: lock screen reg set failed: {result:?}");
        }
    }
}
