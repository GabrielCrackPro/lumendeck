
#![cfg(windows)]

use crate::config::{GalleryEntry, WallpaperKind};
use std::path::PathBuf;

pub fn thumbs_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("LumenDeck")
        .join("thumbs")
}

fn thumb_path(source: &str) -> PathBuf {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in source.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01B3);
    }
    thumbs_dir().join(format!("{h:016x}.png"))
}

pub fn ensure_thumb(source: &str, size: u32) -> Result<PathBuf, String> {
    let out = thumb_path(source);
    if out.exists() {
        return Ok(out);
    }
    std::fs::create_dir_all(out.parent().ok_or("no parent")?)
        .map_err(|e| format!("mkdir: {e}"))?;
    extract_shell_thumb(source, size, &out)?;
    Ok(out)
}

pub fn wants_thumb(entry: &GalleryEntry) -> bool {
    matches!(entry.kind, WallpaperKind::Video | WallpaperKind::Image)
        && entry.thumb.is_none()
        && std::path::Path::new(&entry.source).is_file()
}

pub fn regenerate_thumb(source: &str, size: u32) -> Result<PathBuf, String> {
    let out = thumb_path(source);
    if out.exists() {
        std::fs::remove_file(&out).map_err(|e| format!("remove thumb: {e}"))?;
    }
    ensure_thumb(source, size)
}

fn extract_shell_thumb(source: &str, size: u32, out: &PathBuf) -> Result<(), String> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::Graphics::Gdi::{
        GetDC, GetDIBits, GetObjectW, ReleaseDC, HGDIOBJ, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
        DIB_RGB_COLORS,
    };
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        SHCreateItemFromParsingName, IShellItem, IShellItemImageFactory, SIIGBF_ICONONLY,
        SIIGBF_RESIZETOFIT, SIIGBF_THUMBNAILONLY,
    };
    use windows::Win32::Graphics::Gdi::HBITMAP;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let path = HSTRING::from(source);
        let item: IShellItem = SHCreateItemFromParsingName(&path, None)
            .map_err(|e| format!("parse name: {e}"))?;

        let factory: IShellItemImageFactory = item
            .cast()
            .map_err(|e| format!("no image factory: {e}"))?;

        let hbitmap: HBITMAP = factory
            .GetImage(
                SIZE {
                    cx: size as i32,
                    cy: size as i32,
                },
                SIIGBF_RESIZETOFIT,
            )
            .or_else(|_| {
                factory.GetImage(
                    SIZE {
                        cx: size as i32,
                        cy: size as i32,
                    },
                    SIIGBF_THUMBNAILONLY,
                )
            })
            .or_else(|_| {
                factory.GetImage(
                    SIZE {
                        cx: size as i32,
                        cy: size as i32,
                    },
                    SIIGBF_ICONONLY,
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
        let img = image::RgbaImage::from_raw(w as u32, h, pixels)
            .ok_or("bitmap buffer mismatch")?;
        image::DynamicImage::ImageRgba8(img)
            .save_with_format(out, image::ImageFormat::Png)
            .map_err(|e| format!("save png: {e}"))?;

        drop(factory);
        drop(item);
        Ok(())
    }
}

pub fn thumb_media_url(path: &PathBuf) -> String {
    crate::media::to_media_url(&path.to_string_lossy())
}

pub fn spawn_gallery_thumb_worker() {
    std::thread::Builder::new()
        .name("gallery-thumbs".into())
        .spawn(|| loop {
            let pending: Vec<GalleryEntry> = {
                let cfg = crate::config_store::get();
                cfg.gallery.into_iter().filter(wants_thumb).collect()
            };
            if pending.is_empty() {
                std::thread::sleep(std::time::Duration::from_secs(5));
                continue;
            }
            for entry in &pending {
                match ensure_thumb(&entry.source, 512) {
                    Ok(png) => {
                        log::debug!("gallery thumb ok: {}", entry.name);
                        let url = thumb_media_url(&png);
                        let _ = crate::config_store::update(|c| {
                            if let Some(slot) = c.gallery.iter_mut().find(|g| g.id == entry.id) {
                                slot.thumb = Some(url);
                            }
                        });
                        if let Some(app) = crate::app_handle() {
                            let cfg = crate::config_store::get();
                            crate::events::emit_all(&app, crate::events::CONFIG_CHANGED, &cfg);
                        }
                    }
                    Err(e) => {
                        log::warn!(
                            "gallery thumb FAILED: {} ({}): {}",
                            entry.name,
                            entry.source,
                            e
                        );
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        })
        .expect("failed to spawn gallery thumbnail worker");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumb_path_is_deterministic_and_safe() {
        let a = thumb_path("C:\\video a.mp4");
        let b = thumb_path("C:\\video a.mp4");
        let c = thumb_path("C:\\video b.mp4");
        assert_eq!(a, b, "same input must map to same file");
        assert_ne!(a, c, "different inputs must differ");
        assert!(a.extension().and_then(|e| e.to_str()) == Some("png"));
        assert!(a.to_string_lossy().contains("thumbs"));
    }
}
