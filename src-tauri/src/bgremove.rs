//! Sticker background removal at import/placement time.
//!
//! Writes a *processed copy* next to the original (`<stem>.nobg.png`) and
//! returns its path; the original file is never modified. Static images and
//! single-frame GIFs become transparent PNGs; **animated GIFs become
//! transparent APNGs** — every frame is processed and frame timing is
//! preserved — which WebView2 renders as a normal animation in `<img>`.
//!
//! Algorithm: a border-seeded flood fill. Pixels connected to the image
//! border within a color tolerance become transparent, so subject colors that
//! match the background stay intact when the background doesn't touch them.
//! Sources that already have alpha (PNG with transparency) pass through
//! untouched. The fill is iterative (explicit queue, no recursion).

use image::{ImageFormat, RgbaImage};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};

/// Result of processing one source file.
#[derive(Debug, Clone, PartialEq)]
pub struct Processed {
    /// Path of the processed `<stem>.nobg.png` copy.
    pub path: PathBuf,
    /// True when the output is animated (APNG).
    pub animated: bool,
    /// Number of frames processed (1 for stills).
    pub frames: usize,
    /// True when the source already had transparency and was kept as-is.
    pub passthrough: bool,
}

/// Color distance tolerance for background membership (0..441 scale).
const TOLERANCE: f32 = 40.0;

/// Process `src` and return the processed artifact. Idempotent: an up-to-date
/// `<stem>.nobg.png` (mtime >= source mtime) is reused.
pub fn process_file(src: &Path) -> Result<Processed, String> {
    let out_path = out_path(src);
    if let (Ok(s), Ok(o)) = (std::fs::metadata(src), std::fs::metadata(&out_path)) {
        if let (Ok(s), Ok(o)) = (s.modified(), o.modified()) {
            if o >= s {
                return Ok(Processed {
                    animated: is_apng(&out_path),
                    path: out_path,
                    frames: 1,
                    passthrough: false,
                });
            }
        }
    }

    let bytes = std::fs::read(src).map_err(|e| format!("read {}: {e}", src.display()))?;
    match detect_format(&bytes, src)? {
        ImageFormat::Gif => process_gif(&bytes, &out_path),
        ImageFormat::Png => process_png(&bytes, &out_path),
        _ => process_png(&bytes, &out_path),
    }
}

/// `<dir>/<stem>.nobg.png` next to the source file.
pub fn out_path(src: &Path) -> PathBuf {
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("sticker");
    src.with_file_name(format!("{stem}.nobg.png"))
}

/// Sniff the real container format from magic bytes (extensions lie).
fn detect_format(bytes: &[u8], src: &Path) -> Result<ImageFormat, String> {
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Ok(ImageFormat::Gif);
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Ok(ImageFormat::Png);
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Ok(ImageFormat::Jpeg);
    }
    if bytes.starts_with(b"RIFF") && bytes.len() > 11 && &bytes[8..12] == b"WEBP" {
        return Ok(ImageFormat::WebP);
    }
    image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(crate::error::err_str)?
        .format()
        .ok_or_else(|| format!("unsupported image: {}", src.display()))
}

/// Does this PNG contain an `acTL` chunk before the first `IDAT` (valid APNG)?
fn is_apng(path: &Path) -> bool {
    let Ok(data) = std::fs::read(path) else {
        return false;
    };
    let actl = data.windows(4).position(|w| w == b"acTL");
    let idat = data.windows(4).position(|w| w == b"IDAT");
    matches!((actl, idat), (Some(a), Some(i)) if a < i)
}

// ---------- Static images ----------

fn process_png(bytes: &[u8], out_path: &Path) -> Result<Processed, String> {
    let img = image::load_from_memory(bytes).map_err(|e| format!("decode failed: {e}"))?;
    finish_still(img.to_rgba8(), bytes, out_path)
}

/// Shared tail for single-frame sources: passthrough when alpha exists,
/// otherwise border flood-fill, then save as PNG.
fn finish_still(rgba: RgbaImage, original: &[u8], out_path: &Path) -> Result<Processed, String> {
    if rgba.pixels().any(|p| p.0[3] == 0) {
        std::fs::write(out_path, original).map_err(|e| format!("write: {e}"))?;
        return Ok(Processed {
            path: out_path.to_path_buf(),
            animated: false,
            frames: 1,
            passthrough: true,
        });
    }
    let (w, h) = (rgba.width(), rgba.height());
    let mut raw = rgba.into_raw();
    flood_fill_inplace(&mut raw, w, h, TOLERANCE);
    let img = RgbaImage::from_raw(w, h, raw).ok_or("rgba buffer mismatch")?;
    img.save_with_format(out_path, ImageFormat::Png)
        .map_err(|e| format!("save {}: {e}", out_path.display()))?;
    Ok(Processed {
        path: out_path.to_path_buf(),
        animated: false,
        frames: 1,
        passthrough: false,
    })
}

// ---------- GIF (static + animated) ----------

fn process_gif(bytes: &[u8], out_path: &Path) -> Result<Processed, String> {
    let decoder = image::codecs::gif::GifDecoder::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("gif decode failed: {e}"))?;
    let frames: Vec<image::Frame> = image::AnimationDecoder::into_frames(decoder)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("gif frames: {e}"))?;
    if frames.is_empty() {
        return Err("gif has no frames".into());
    }
    if frames.len() == 1 {
        let buf = frames.into_iter().next().unwrap().into_buffer();
        return finish_still(buf, bytes, out_path);
    }
    let n = composite_and_encode(frames, out_path)?;
    Ok(Processed {
        path: out_path.to_path_buf(),
        animated: true,
        frames: n,
        passthrough: false,
    })
}

/// Composite GIF sub-rect frames onto a full canvas (region-replace
/// semantics: each frame's rect fully overwrites the canvas region — correct
/// for full-frame and replace-style animated stickers), clear each canvas
/// frame's background, and encode as APNG with the original timings.
fn composite_and_encode(frames: Vec<image::Frame>, out_path: &Path) -> Result<usize, String> {
    // Canvas = union of all frame rects (GIFs are usually consistent).
    let mut cw = 0u32;
    let mut ch = 0u32;
    for f in &frames {
        cw = cw.max(f.left().saturating_add(f.buffer().width()));
        ch = ch.max(f.top().saturating_add(f.buffer().height()));
    }
    if cw == 0 || ch == 0 {
        return Err("gif has empty frames".into());
    }

    let mut canvas = RgbaImage::new(cw, ch);
    let mut out: Vec<(RgbaImage, u32)> = Vec::with_capacity(frames.len());
    for f in &frames {
        let delay = {
            let (n, d) = f.delay().numer_denom_ms();
            (n as f64 / d.max(1) as f64).round() as u32
        };
        // Region-replace blit: copy the whole sub-rect, transparency included.
        let (fw, fh) = (f.buffer().width(), f.buffer().height());
        let (lx, ly) = (f.left() as u32, f.top() as u32);
        for y in 0..fh {
            for x in 0..fw {
                let p = f.buffer().get_pixel(x, y);
                canvas.put_pixel(lx + x, ly + y, *p);
            }
        }
        out.push((canvas.clone(), delay));
    }

    // Clear each canvas frame, then encode as APNG via the `png` crate
    // (image 0.25 can decode APNG but not encode it).
    for (img, _) in out.iter_mut() {
        let (w, h) = (img.width(), img.height());
        flood_fill_inplace(img.as_mut(), w, h, TOLERANCE);
    }

    let file = std::fs::File::create(out_path)
        .map_err(|e| format!("create {}: {e}", out_path.display()))?;
    let first = out.first().map(|(i, _)| i).unwrap();
    let mut enc = png::Encoder::new(file, first.width(), first.height());
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.set_animated(out.len() as u32, 0).map_err(crate::error::err_str)?;
    let mut writer = enc.write_header().map_err(|e| format!("apng header: {e}"))?;
    for (img, ms) in &out {
        writer
            .set_frame_delay(0, 1)
            .and_then(|_| writer.set_frame_delay((*ms).min(u16::MAX as u32) as u16, 1000))
            .map_err(|e| format!("apng delay: {e}"))?;
        writer
            .set_dispose_op(png::DisposeOp::Background)
            .map_err(crate::error::err_str)?;
        writer
            .write_image_data(img.as_raw())
            .map_err(|e| format!("apng frame: {e}"))?;
    }
    writer.finish().map_err(|e| format!("apng finish: {e}"))?;
    Ok(out.len())
}

// ---------- Flood fill ----------

#[inline]
fn px(buf: &[u8], idx: usize) -> [u8; 4] {
    [
        buf[idx * 4],
        buf[idx * 4 + 1],
        buf[idx * 4 + 2],
        buf[idx * 4 + 3],
    ]
}

#[inline]
fn color_dist(a: [u8; 4], b: [u8; 3]) -> f32 {
    let dr = a[0] as f32 - b[0] as f32;
    let dg = a[1] as f32 - b[1] as f32;
    let db = a[2] as f32 - b[2] as f32;
    (dr * dr + dg * dg + db * db).sqrt()
}

/// Border-seeded flood fill: clears the alpha of every pixel connected to the
/// image border within `tol` of the background color (median of the corners).
/// Returns the number of pixels cleared. `rgba` is a tightly packed RGBA8
/// buffer, `w * h * 4` bytes, modified in place.
pub fn flood_fill_inplace(rgba: &mut [u8], w: u32, h: u32, tol: f32) -> usize {
    let w = w as usize;
    let h = h as usize;
    if w == 0 || h == 0 {
        return 0;
    }
    let n = w * h;
    if rgba.len() < n * 4 {
        return 0;
    }

    // Background reference: median RGB of the 4 corners (robust when the
    // subject covers one corner).
    let mut rs = [0u8; 4];
    let mut gs = [0u8; 4];
    let mut bs = [0u8; 4];
    for (k, idx) in [0usize, w - 1, n - w, n - 1].into_iter().enumerate() {
        let p = px(rgba, idx);
        rs[k] = p[0];
        gs[k] = p[1];
        bs[k] = p[2];
    }
    let med = |mut v: [u8; 4]| {
        v.sort_unstable();
        v[2]
    };
    let bg: [u8; 3] = [med(rs), med(gs), med(bs)];

    let is_bg = |buf: &[u8], idx: usize| -> bool {
        let p = px(buf, idx);
        p[3] == 0 || color_dist(p, bg) <= tol
    };

    let mut visited = vec![false; n];
    let mut queue: VecDeque<usize> = VecDeque::with_capacity(n.min(1 << 20));
    let mut cleared = 0usize;

    // Seed the border ring.
    for x in 0..w {
        for &y in &[0usize, h - 1] {
            let idx = y * w + x;
            if !visited[idx] && is_bg(rgba, idx) {
                visited[idx] = true;
                queue.push_back(idx);
            }
        }
    }
    for y in 0..h {
        for &x in &[0usize, w - 1] {
            let idx = y * w + x;
            if !visited[idx] && is_bg(rgba, idx) {
                visited[idx] = true;
                queue.push_back(idx);
            }
        }
    }

    while let Some(idx) = queue.pop_front() {
        rgba[idx * 4 + 3] = 0;
        cleared += 1;
        let x = idx % w;
        let y = idx / w;
        let push = |nx: usize, ny: usize, visited: &mut [bool], queue: &mut VecDeque<usize>| {
            let nidx = ny * w + nx;
            if !visited[nidx] && is_bg(rgba, nidx) {
                visited[nidx] = true;
                queue.push_back(nidx);
            }
        };
        if x > 0 {
            push(x - 1, y, &mut visited, &mut queue);
        }
        if x + 1 < w {
            push(x + 1, y, &mut visited, &mut queue);
        }
        if y > 0 {
            push(x, y - 1, &mut visited, &mut queue);
        }
        if y + 1 < h {
            push(x, y + 1, &mut visited, &mut queue);
        }
    }
    cleared
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn solid(w: u32, h: u32, color: [u8; 4]) -> Vec<u8> {
        vec![color; (w * h) as usize]
            .into_iter()
            .flatten()
            .collect()
    }

    #[test]
    fn clears_uniform_background() {
        // 10x10 white background, red center 4x4 subject.
        let w = 10u32;
        let h = 10u32;
        let mut pxbuf = solid(w, h, [255, 255, 255, 255]);
        for y in 3..7 {
            for x in 3..7 {
                let i = ((y * w + x) * 4) as usize;
                pxbuf[i..i + 3].copy_from_slice(&[255, 0, 0]);
            }
        }
        let cleared = flood_fill_inplace(&mut pxbuf, w, h, TOLERANCE);
        assert_eq!(cleared, 100 - 16);
        // Subject untouched.
        assert_eq!(pxbuf[((5 * w + 5) * 4) as usize + 3], 255);
        // Border cleared.
        assert_eq!(pxbuf[3], 0);
    }

    #[test]
    fn keeps_matching_color_inside_subject() {
        // White background, red ring subject that ENCLOSES a white center.
        // The enclosed white must survive (not connected to the border).
        let w = 9u32;
        let h = 9u32;
        let mut pxbuf = solid(w, h, [255, 255, 255, 255]);
        let ring = [
            (2, 2), (3, 2), (4, 2), (5, 2), (6, 2), //
            (2, 3), (6, 3), //
            (2, 4), (6, 4), //
            (2, 5), (6, 5), //
            (2, 6), (3, 6), (4, 6), (5, 6), (6, 6),
        ];
        for (x, y) in ring {
            let i = ((y * w + x) * 4) as usize;
            pxbuf[i..i + 3].copy_from_slice(&[255, 0, 0]);
        }
        flood_fill_inplace(&mut pxbuf, w, h, TOLERANCE);
        let c = ((4 * w + 4) * 4) as usize;
        assert_eq!(pxbuf[c + 3], 255);
        assert_eq!(&pxbuf[c..c + 3], &[255, 255, 255]);
    }

    #[test]
    fn tolerant_background_with_gradient() {
        // Background gradient 240..255 grey; tolerance clears it all.
        let w = 8u32;
        let h = 8u32;
        let mut pxbuf = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let v = 240 + ((x + y) % 16) as u8;
                let i = ((y * w + x) * 4) as usize;
                pxbuf[i] = v;
                pxbuf[i + 1] = v;
                pxbuf[i + 2] = v;
                pxbuf[i + 3] = 255;
            }
        }
        for y in 3..5 {
            for x in 3..5 {
                let i = ((y * w + x) * 4) as usize;
                pxbuf[i] = 200;
                pxbuf[i + 1] = 30;
                pxbuf[i + 2] = 30;
            }
        }
        let cleared = flood_fill_inplace(&mut pxbuf, w, h, TOLERANCE);
        assert_eq!(cleared, 64 - 4);
    }

    #[test]
    fn already_transparent_source_is_passthrough() {
        let dir = std::env::temp_dir().join("lumendeck-bgtest");
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("alpha.png");
        let mut rgba = RgbaImage::new(4, 4);
        rgba.get_pixel_mut(0, 0).0[3] = 0;
        rgba.save_with_format(&src, ImageFormat::Png).unwrap();
        let res = process_file(&src).unwrap();
        assert!(res.passthrough);
        assert!(!res.animated);
    }

    #[test]
    fn animated_gif_becomes_apng() {
        let dir = std::env::temp_dir().join("lumendeck-bgtest");
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("anim.gif");
        let f1 = RgbaImage::from_pixel(8, 8, Rgba([255, 255, 255, 255]));
        let f2 = RgbaImage::from_pixel(8, 8, Rgba([0, 0, 255, 255]));
        let file = std::fs::File::create(&src).unwrap();
        {
            let mut enc = image::codecs::gif::GifEncoder::new(file);
            enc.set_repeat(image::codecs::gif::Repeat::Infinite).unwrap();
            enc.encode_frame(image::Frame::new(f1)).unwrap();
            enc.encode_frame(image::Frame::new(f2)).unwrap();
        }

        let res = process_file(&src).unwrap();
        assert!(res.animated);
        assert_eq!(res.frames, 2);
        // Output is a PNG with acTL before IDAT (valid APNG).
        let data = std::fs::read(&res.path).unwrap();
        assert!(data.starts_with(&[0x89, b'P', b'N', b'G']));
        let actl = data.windows(4).position(|w| w == b"acTL").unwrap();
        let idat = data.windows(4).position(|w| w == b"IDAT").unwrap();
        assert!(actl < idat);
    }

    #[test]
    fn static_gif_becomes_transparent_png() {
        let dir = std::env::temp_dir().join("lumendeck-bgtest");
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("still.gif");
        RgbaImage::from_pixel(6, 6, Rgba([255, 0, 255, 255]))
            .save_with_format(&src, ImageFormat::Gif)
            .unwrap();
        let res = process_file(&src).unwrap();
        assert!(!res.animated);
        let img = image::open(&res.path).unwrap().to_rgba8();
        // Single-color image: everything is background → all cleared.
        assert!(img.pixels().all(|p| p.0[3] == 0));
    }

    #[test]
    fn animated_gif_background_is_cleared_per_frame() {
        let dir = std::env::temp_dir().join("lumendeck-bgtest");
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("animbg.gif");
        // Frame 1: white bg + red center; frame 2: white bg + blue center.
        let mut f1 = RgbaImage::from_pixel(8, 8, Rgba([255, 255, 255, 255]));
        for y in 3..5 {
            for x in 3..5 {
                f1.put_pixel(x, y, Rgba([255, 0, 0, 255]));
            }
        }
        let mut f2 = RgbaImage::from_pixel(8, 8, Rgba([255, 255, 255, 255]));
        for y in 3..5 {
            for x in 3..5 {
                f2.put_pixel(x, y, Rgba([0, 0, 255, 255]));
            }
        }
        let file = std::fs::File::create(&src).unwrap();
        {
            let mut enc = image::codecs::gif::GifEncoder::new(file);
            enc.encode_frame(image::Frame::new(f1)).unwrap();
            enc.encode_frame(image::Frame::new(f2)).unwrap();
        }
        let res = process_file(&src).unwrap();
        assert!(res.animated);
        // The APNG's first frame must have a transparent background and an
        // opaque red subject.
        let img = image::open(&res.path).unwrap();
        let dyn_img = img;
        let frames = match dyn_img {
            image::DynamicImage::ImageRgba8(rgba) => vec![rgba],
            other => vec![other.to_rgba8()],
        };
        let first = &frames[0];
        assert_eq!(first.get_pixel(0, 0).0[3], 0, "corner must be cleared");
        assert_eq!(first.get_pixel(4, 4).0[3], 255, "subject must survive");
    }

    #[test]
    fn out_path_sits_next_to_source() {
        let p = out_path(Path::new("C:/x/y/Cat.gif"));
        assert!(p.to_string_lossy().ends_with("Cat.nobg.png"));
    }
}
