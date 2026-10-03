//! Windows System Media Transport Controls (SMTC) integration.
//!
//! Every app that plays media on Windows (Spotify, browsers, media players)
//! registers a session with the OS media flyout. That session carries what
//! WASAPI capture can never provide: *metadata* — title, artist, playback
//! state — plus transport control (play/pause/skip from outside the player).
//!
//! Threading model: WinRT event handlers must run on an ASTA thread, which is
//! fragile in a thread that also talks to Tauri. The pragmatic pattern is a
//! 1 Hz polling thread (mirrors `rgb::audio`'s capture loop) that diffed-
//! checks the payload and only emits when something changed — near-zero cost
//! while nothing plays.
//!
//! Album art is normalized to PNG through the image crate and downscaled
//! before being sent as a data URI, so even monster covers stay cheap.
//!
//! Consumers:
//! - `media-session` event → dashboard Now playing card (metadata + transport)
//! - `media_session::take_track_change()` → RGB engine, one-shot track flash
//! - `media_transport` IPC → play/pause/next/previous from the dashboard

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Everything the dashboard needs to render the Now playing card.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Source app display name, e.g. "Spotify" — package-family suffix and
    /// `.exe` extension stripped.
    pub app_id: String,
    /// True while the session reports Playing.
    pub playing: bool,
    /// Album art as a data URI (PNG/JPEG), decoded from the session
    /// thumbnail. Empty = the UI renders a placeholder.
    #[serde(default)]
    pub art: String,
    /// Source app icon as a PNG data URI, extracted from the app's
    /// executable. Empty = the UI falls back to a generic glyph.
    #[serde(default)]
    pub app_icon: String,
    /// Playback position at sampling time, seconds (timeline may be absent).
    #[serde(default)]
    pub position_sec: f64,
    /// Track duration, seconds. 0 = the sender reports no timeline.
    #[serde(default)]
    pub duration_sec: f64,
    /// Unix ms when `position_sec` was sampled; the UI advances the bar
    /// locally between polls instead of waiting for the next one.
    #[serde(default)]
    pub position_updated_ms: u64,
    /// Shuffle state reported by the sender. None = the app doesn't expose
    /// it (button renders disabled rather than wrong).
    #[serde(default)]
    pub shuffle: Option<bool>,
    /// Repeat mode reported by the sender: 0 off, 1 track, 2 list/queue.
    #[serde(default)]
    pub repeat: Option<u8>,
}

impl MediaInfo {
    /// Which track this is, ignoring the playing toggle: the RGB flash
    /// should fire on a track change, not on pause/resume.
    fn track_key(&self) -> (&str, &str, &str, &str) {
        (&self.title, &self.artist, &self.album, &self.app_id)
    }

    fn key(&self) -> (String, String, String, String, bool) {
        (
            self.title.clone(),
            self.artist.clone(),
            self.album.clone(),
            self.app_id.clone(),
            self.playing,
        )
    }
}

/// Set by the poller when the identity of the track changed (new title/
/// artist, not just a state toggle). The RGB engine drains it once per
/// frame for the track-flash effect.
static TRACK_CHANGED: AtomicBool = AtomicBool::new(false);

pub fn take_track_change() -> bool {
    TRACK_CHANGED.swap(false, Ordering::Relaxed)
}

static STARTED: std::sync::OnceLock<()> = std::sync::OnceLock::new();

/// Latest session snapshot, for IPC consumers that want the current value
/// without waiting up to a poll cycle for the next change event.
static CURRENT: std::sync::Mutex<Option<MediaInfo>> = std::sync::Mutex::new(None);

pub fn current() -> Option<MediaInfo> {
    CURRENT.lock().ok().and_then(|g| g.clone())
}

/// Spawn the poller once. Idempotent like `audio::ensure_started`.
pub fn ensure_started() {
    if STARTED.set(()).is_err() {
        return;
    }
    let _ = std::thread::Builder::new()
        .name("media-session".into())
        .spawn(poll_loop);
}

fn poll_loop() {
    let mut last: Option<MediaInfo> = None;

    loop {
        let current = read_current().inspect_err(|e| log::debug!("media session read failed: {e}")).ok().flatten();

        match (&last, &current) {
            (None, None) => {}
            (Some(prev), Some(next)) => {
                if prev.key() != next.key() {
                    // Flash only when the track itself changed; a
                    // pause/resume of the same track is not a change.
                    if prev.track_key() != next.track_key() {
                        TRACK_CHANGED.store(true, Ordering::Relaxed);
                    }
                    if let Some(app) = crate::app_handle() {
                        crate::events::emit_all(&app, crate::events::MEDIA_SESSION, next);
                    }
                }
            }
            // First metadata after startup, or media started playing.
            (None, Some(next)) => {
                if let Some(app) = crate::app_handle() {
                    crate::events::emit_all(&app, crate::events::MEDIA_SESSION, next);
                }
            }
            // Everything stopped / player closed: clear the card once.
            (Some(_), None) => {
                if let Some(app) = crate::app_handle() {
                    crate::events::emit_all(
                        &app,
                        crate::events::MEDIA_SESSION,
                        &Option::<MediaInfo>::None,
                    );
                }
            }
        }
        last = current.clone();
        *CURRENT.lock().unwrap_or_else(|p| p.into_inner()) = current;
        std::thread::sleep(Duration::from_secs(1));
    }
}

/// Read the current session's metadata. `Ok(None)` = no session registered.
fn read_current() -> Result<Option<MediaInfo>, windows::core::Error> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };

    init_apartment();
    let manager = wait_op(&GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?)?;
    let session = match manager.GetCurrentSession() {
        Ok(s) => s,
        // No session at all — the normal "nothing playing" case.
        Err(_) => return Ok(None),
    };

    let status = session
        .GetPlaybackInfo()
        .and_then(|p| p.PlaybackStatus())
        .unwrap_or(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Closed);
    let playing = status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing;

    let props = wait_op(&session.TryGetMediaPropertiesAsync()?)?;
    let title = props.Title().unwrap_or_default().to_string();
    let artist = props.Artist().unwrap_or_default().to_string();
    let album = props.AlbumTitle().unwrap_or_default().to_string();
    // "Spotify.exe!App" / "Spotify.exe" / "Spotify" all end up "Spotify".
    let raw_aumid = session
        .SourceAppUserModelId()
        .unwrap_or_default()
        .to_string();
    let app_id = clean_app_name(raw_aumid.split('!').next().unwrap_or(""));

    // Album art: session thumbnail stream → PNG/JPEG bytes → data URI.
    let art = props
        .Thumbnail()
        .ok()
        .and_then(|t| decode_art(&t).ok())
        .unwrap_or_default();
    // App icon: resolve the AUMID to a window/pipeline and pull its icon.
    // Cached per AUMID: manifest parsing + logo decode are disk work that
    // would otherwise repeat on every SMTC poll (~1Hz).
    let app_icon = cached_app_icon(&raw_aumid);

    // Timeline: position + duration for the player bar. Some senders report
    // nothing (or a zero duration) — the UI hides the bar in that case.
    let (position_sec, duration_sec) = session
        .GetTimelineProperties()
        .map(|t| {
            let pos = t.Position().map(|p| p.Duration).unwrap_or(0) as f64 / 10_000_000.0;
            let dur = t.EndTime().map(|e| e.Duration).unwrap_or(0) as f64 / 10_000_000.0;
            (pos.max(0.0), dur.max(0.0))
        })
        .unwrap_or((0.0, 0.0));
    let position_updated_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    // Shuffle / repeat state. The capability gates live on PlaybackControls
    // (info.Controls()); the current values sit on PlaybackInfo itself. A
    // missing capability => None => the UI hides/disables the toggle.
    let info = session.GetPlaybackInfo().ok();
    let controls = info.as_ref().and_then(|i| i.Controls().ok());
    let shuffle = controls
        .as_ref()
        .and_then(|c| c.IsShuffleEnabled().ok())
        .unwrap_or(false)
        .then(|| {
            info.as_ref()
                .and_then(|i| i.IsShuffleActive().ok())
                .and_then(|r| r.Value().ok())
        })
        .flatten();
    let repeat = controls
        .as_ref()
        .and_then(|c| c.IsRepeatEnabled().ok())
        .unwrap_or(false)
        .then(|| {
            info.as_ref()
                .and_then(|i| i.AutoRepeatMode().ok())
                .and_then(|r| r.Value().ok())
                .map(|m| m.0 as u8)
        })
        .flatten();

    Ok(Some(MediaInfo {
        title,
        artist,
        album,
        app_id,
        art,
        app_icon,
        playing,
        position_sec,
        duration_sec,
        position_updated_ms,
        shuffle,
        repeat,
    }))
}

// ---------- art / icon / name helpers ----------

/// "Spotify.EXE" → "Spotify", "Microsoft.MicrosoftEdge_8wekyb3d8bbwe" →
/// "MicrosoftEdge"? No — package AUMIDs are handled by the `!` split before
/// this runs; what survives here is an exe-style name or a friendly one.
/// Strip a trailing `.exe` (any case) and trim.
fn clean_app_name(raw: &str) -> String {
    let s = raw.trim();
    let s = s.strip_suffix(".exe")
        .or_else(|| s.strip_suffix(".EXE"))
        .unwrap_or(s);
    s.trim().to_string()
}

/// Album art stream → `data:image/...;base64,...`. Re-encoded to PNG so the
/// payload is small and the <img> needs no content-type sniffing beyond the
/// URI itself. Fails soft: empty string on any error, UI shows a placeholder.
fn decode_art(reference: &windows::Storage::Streams::IRandomAccessStreamReference) -> Result<String, Box<dyn std::error::Error>> {
    use windows::Storage::Streams::InputStreamOptions;

    let stream = wait_op(&reference.OpenReadAsync()?)?;
    let size = stream.Size()? as usize;
    // Sanity cap: album art should be tens of KB. 4 MB = something is wrong.
    if size == 0 || size > 4 * 1024 * 1024 {
        return Ok(String::new());
    }
    let content_type = stream.ContentType()?.to_string();

    // ReadAsync is IAsyncOperationWithProgress; drain it with the same
    // SetCompleted trick as the plain operation.
    let buf = windows::Storage::Streams::Buffer::Create(size as u32)?;
    let read = drain_progress(&stream.ReadAsync(&buf, size as u32, InputStreamOptions::ReadAhead)?)?;
    let len = read.Length()? as usize;
    if len == 0 {
        return Ok(String::new());
    }
    // The buffer's backing bytes: read via DataReader over the buffer,
    // the portable WinRT way (IBuffer has no direct byte accessor in Rust).
    let mut bytes = vec![0u8; len];
    let reader =
        windows::Storage::Streams::DataReader::FromBuffer(&read)?;
    reader.ReadBytes(&mut bytes)?;

    // Normalize to PNG through the image crate we already ship: art comes
    // as jpeg/png/webp depending on the source, and re-encoding also lets
    // us downscale monster covers (some are 3000px) to something sane.
    let mime = if content_type.contains("png") {
        "image/png"
    } else if content_type.contains("webp") {
        "image/webp"
    } else {
        "image/jpeg"
    };
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

/// Per-AUMID icon cache. A failed lookup caches the empty string too, so a
/// sender without an extractable icon stops re-probing the disk every poll.
fn cached_app_icon(aumid: &str) -> String {
    use std::collections::HashMap;
    use std::sync::Mutex;
    static CACHE: std::sync::OnceLock<Mutex<HashMap<String, String>>> = std::sync::OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut map = cache.lock().expect("app icon cache poisoned");
    if let Some(hit) = map.get(aumid) {
        return hit.clone();
    }
    let icon = app_icon_data_uri(aumid).unwrap_or_default();
    map.insert(aumid.to_string(), icon.clone());
    icon
}

/// Extract the source app's icon and return it as a PNG data URI.
///
/// Resolution order:
/// 1. Packaged app (AUMID like `SpotifyAB.SpotifyMusic_...!App`): resolve the
///    package install dir from the full name, parse AppxManifest.xml for the
///    app's Square44x44Logo / Square150x150Logo / default tile logo, find the
///    best scale variant on disk, decode + PNG-encode.
/// 2. Classic exe (AUMID endswith `.exe`): the AUMID often *is* the path.
///    SHGetFileInfoW pulls the icon handle, CopyIcon + GetIconInfo give the
///    bitmaps, PNG-encode.
/// 3. Fallback: empty (UI shows a glyph). Non-fatal — names still display.
fn app_icon_data_uri(aumid: &str) -> Option<String> {
    let path = aumid.trim();
    if path.to_ascii_lowercase().ends_with(".exe") {
        if std::path::Path::new(path).is_file() {
            return extract_exe_icon(path);
        }
        return None;
    }
    // Packaged AUMID: `<PackageFamily>!<AppId>` — the part before `!` is the
    // package full name (no `!` means the whole string is it).
    let full_name = raw_aumid_package_full_name(path);
    extract_package_icon(&full_name)
}

/// The package full name portion of a raw AUMID (before the `!App` suffix).
fn raw_aumid_package_full_name(aumid: &str) -> &str {
    aumid.split('!').next().unwrap_or(aumid).trim()
}

/// Extract a packaged app's tile logo as a PNG data URI.
fn extract_package_icon(package_full_name: &str) -> Option<String> {
    use windows::Win32::Storage::Packaging::Appx::GetPackagePathByFullName;
    use windows::core::HSTRING;

    if package_full_name.is_empty() {
        return None;
    }
    unsafe {
        // Two-call pattern: first with no buffer to get the length.
        let mut len = 0u32;
        let err = GetPackagePathByFullName(
            &HSTRING::from(package_full_name),
            &mut len,
            None,
        );
        if err.is_err() || len == 0 {
            return None;
        }
        let mut buf = vec![0u16; len as usize];
        let pw = windows::core::PWSTR(buf.as_mut_ptr());
        let err = GetPackagePathByFullName(
            &HSTRING::from(package_full_name),
            &mut len,
            Some(pw),
        );
        if err.is_err() {
            return None;
        }
        let install = String::from_utf16_lossy(&buf[..(len as usize - 1).max(0)]);
        let manifest = std::path::Path::new(&install).join("AppxManifest.xml");
        let xml = std::fs::read_to_string(&manifest).ok()?;
        let logo = manifest_logo_path(&xml)?;
        let png = load_logo_png(&install, &logo, 48)?;
        Some(png_to_data_uri(png))
    }
}

/// Pull the app's logo attribute out of AppxManifest.xml without a real XML
/// parser: the manifest is machine-written, so the first `Attr="value"` hit
/// for a known logo attribute is reliable. A tiny scan keeps deps flat.
fn manifest_logo_path(xml: &str) -> Option<String> {
    for attr in [
        "Square44x44Logo=",
        "Square150x150Logo=",
        "Square310x310Logo=",
        "Square71x71Logo=",
        "Logo=",
    ] {
        if let Some(pos) = xml.find(attr) {
            let rest = &xml[pos + attr.len()..];
            // Value must be a double-quoted attribute; manifests always use
            // `"`. Accept single quotes defensively.
            for quote in ['"', '\''] {
                if let Some(stripped) = rest.strip_prefix(quote) {
                    if let Some(end) = stripped.find(quote) {
                        let v = stripped[..end].trim();
                        if !v.is_empty() {
                            return Some(v.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

/// Resolve a manifest logo path (no extension, scale-agnostic) to the best
/// available PNG/JPG file on disk and decode it. Tries the highest useful
/// scales first, falls back to the extensionless base name.
fn load_logo_png(install: &str, logo: &str, edge: u32) -> Option<Vec<u8>> {
    let base = std::path::Path::new(install).join(logo.replace('\\', "/"));
    let dir = base.parent()?;
    let name = base.file_name()?.to_string_lossy().to_string();
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    // Highest-first: scale 200 is the sweet spot for a 48px thumb; skip
    // the rest unless missing. Also try the theme-neutral fallbacks.
    for scale in ["scale-200", "scale-150", "scale-100", "scale-400"] {
        for ext in [".png", ".jpg"] {
            candidates.push(dir.join(format!("{name}.{scale}{ext}")));
        }
    }
    for ext in [".png", ".jpg"] {
        candidates.push(dir.join(format!("{name}{ext}")));
    }
    for c in candidates {
        if let Ok(bytes) = std::fs::read(&c) {
            if let Ok(img) = image::load_from_memory(&bytes) {
                let resized = img.resize_to_fill(edge, edge, image::imageops::FilterType::Lanczos3);
                let mut out = Vec::with_capacity(8 * 1024);
                if resized
                    .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
                    .is_ok()
                {
                    return Some(out);
                }
            }
        }
    }
    None
}

fn png_to_data_uri(png: Vec<u8>) -> String {
    use base64::Engine as _;
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&png))
}

/// Pull the first (large) icon out of an .exe and PNG-encode it at 48px.
fn extract_exe_icon(path: &str) -> Option<String> {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::{SHGetFileInfoW, SHGFI_ICON, SHGFI_LARGEICON, SHFILEINFOW};
    use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
    use windows::Win32::UI::WindowsAndMessaging::{CopyIcon, DestroyIcon, GetIconInfo, HICON, ICONINFO};

    unsafe {
        let mut info = SHFILEINFOW::default();
        let ok = SHGetFileInfoW(
            &HSTRING::from(path),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        );
        if ok == 0 || info.hIcon.is_invalid() {
            return None;
        }
        let owned: HICON = match CopyIcon(info.hIcon) {
            Ok(h) => h,
            Err(_) => return None,
        };
        DestroyIcon(info.hIcon).ok();

        let mut ii = ICONINFO::default();
        if GetIconInfo(owned, &mut ii).is_err() {
            let _ = DestroyIcon(owned);
            return None;
        }
        // ii.hbmColor / hbmMask are GDI bitmaps we now own.
        let png = icon_bitmap_to_png(ii.hbmColor, 48);
        let _ = windows::Win32::Graphics::Gdi::DeleteObject(windows::Win32::Graphics::Gdi::HGDIOBJ(ii.hbmColor.0));
        let _ = windows::Win32::Graphics::Gdi::DeleteObject(windows::Win32::Graphics::Gdi::HGDIOBJ(ii.hbmMask.0));
        let _ = DestroyIcon(owned);
        png
    }
}

/// GDI HBITMAP → downscale-to-size PNG bytes → data URI. BGRA row order,
/// top-down after a positive-height BITMAPINFOHEADER.
fn icon_bitmap_to_png(hbm: windows::Win32::Graphics::Gdi::HBITMAP, edge: u32) -> Option<String> {
    use windows::Win32::Graphics::Gdi::{
        GetDIBits, GetDC, ReleaseDC, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, BI_RGB,
    };

    let hdc = unsafe { GetDC(None) };
    if hdc.is_invalid() {
        return None;
    }
    let mut bi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: 0,
            biHeight: 0,
            ..Default::default()
        },
        ..Default::default()
    };
    // First call fills the header (dimensions), second fetches the bits.
    let _ = unsafe { GetDIBits(hdc, hbm, 0, 0, None, &mut bi, DIB_RGB_COLORS) };
    let (w, h) = (bi.bmiHeader.biWidth, bi.bmiHeader.biHeight);
    if w <= 0 || h == 0 {
        unsafe { ReleaseDC(None, hdc) };
        return None;
    }
    // Request top-down rows: positive height.
    bi.bmiHeader.biHeight = h.abs();
    bi.bmiHeader.biCompression = BI_RGB.0;
    let mut pixels = vec![0u8; (w as usize) * (h.abs() as usize) * 4];
    let drawn = unsafe {
        GetDIBits(
            hdc,
            hbm,
            0,
            h.abs() as u32,
            Some(pixels.as_mut_ptr() as _),
            &mut bi,
            DIB_RGB_COLORS,
        )
    };
    unsafe { ReleaseDC(None, hdc) };
    if drawn == 0 {
        return None;
    }

    // BGRA → RGBA.
    for px in pixels.chunks_exact_mut(4) {
        px.swap(0, 2);
    }
    let img: image::RgbaImage = image::ImageBuffer::from_raw(w.unsigned_abs(), h.unsigned_abs(), pixels)?;
    let resized = image::imageops::resize(&img, edge, edge, image::imageops::FilterType::Lanczos3);
    let mut out = Vec::with_capacity(8 * 1024);
    image::DynamicImage::ImageRgba8(resized)
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .ok()?;
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&out);
    Some(format!("data:image/png;base64,{b64}"))
}

// ---------- transport control ----------

/// Actions the dashboard can send. Kept as a plain string over IPC; parsed
/// here so the frontend needs no enum import.
pub fn transport(action: &str) -> Result<(), String> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };

    init_apartment();
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| format!("SMTC unavailable: {e}"))?;
    let manager = wait_op(&manager).map_err(|e| format!("SMTC unavailable: {e}"))?;
    let session = manager
        .GetCurrentSession()
        .map_err(|_| "no media session".to_string())?;

    let result = match action {
        "play" => session.TryPlayAsync(),
        "pause" => session.TryPauseAsync(),
        "toggle" => {
            let playing = session
                .GetPlaybackInfo()
                .and_then(|p| p.PlaybackStatus())
                .map(|s| s == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
                .unwrap_or(false);
            if playing {
                session.TryPauseAsync()
            } else {
                session.TryPlayAsync()
            }
        }
        "next" => session.TrySkipNextAsync(),
        "previous" => session.TrySkipPreviousAsync(),
        other => return Err(format!("unknown transport action: {other}")),
    };
    match result {
        Ok(op) => wait_op(&op).map(|_| ()).map_err(|e| format!("transport failed: {e}")),
        Err(e) => Err(format!("transport failed: {e}")),
    }
}

/// Toggle shuffle on the current session. Fails informatively when the sender
/// doesn't support shuffle (the UI disables the button in that case anyway).
pub fn set_shuffle(active: bool) -> Result<(), String> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

    init_apartment();
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| format!("SMTC unavailable: {e}"))?;
    let manager = wait_op(&manager).map_err(|e| format!("SMTC unavailable: {e}"))?;
    let session = manager
        .GetCurrentSession()
        .map_err(|_| "no media session".to_string())?;
    session
        .TryChangeShuffleActiveAsync(active)
        .map_err(|e| format!("shuffle failed: {e}"))
        .and_then(|op| wait_op(&op).map(|_| ()).map_err(|e| format!("shuffle failed: {e}")))
}

/// Cycle repeat: off -> track -> list -> off. Senders only expose the modes
/// they support; cycling just moves to the next mode in the enum order.
pub fn cycle_repeat(current: Option<u8>) -> Result<(), String> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
    use windows::Media::MediaPlaybackAutoRepeatMode;

    init_apartment();
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| format!("SMTC unavailable: {e}"))?;
    let manager = wait_op(&manager).map_err(|e| format!("SMTC unavailable: {e}"))?;
    let session = manager
        .GetCurrentSession()
        .map_err(|_| "no media session".to_string())?;
    let next = match current {
        Some(1) => MediaPlaybackAutoRepeatMode::List,
        Some(2) | None => MediaPlaybackAutoRepeatMode::None,
        _ => MediaPlaybackAutoRepeatMode::Track,
    };
    session
        .TryChangeAutoRepeatModeAsync(next)
        .map_err(|e| format!("repeat failed: {e}"))
        .and_then(|op| wait_op(&op).map(|_| ()).map_err(|e| format!("repeat failed: {e}")))
}

/// Seek the current session to `position_sec`. Uses SMTC's playback-position
/// change; senders opt in — Spotify, most desktop players honor it, some web
/// players silently ignore it (the bar self-corrects on the next sample).
pub fn seek(position_sec: f64) -> Result<(), String> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

    init_apartment();
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| format!("SMTC unavailable: {e}"))?;
    let manager = wait_op(&manager).map_err(|e| format!("SMTC unavailable: {e}"))?;
    let session = manager
        .GetCurrentSession()
        .map_err(|_| "no media session".to_string())?;
    // SMTC wants the position in 100ns ticks; clamp to sane bounds.
    let ticks = (position_sec.max(0.0) * 10_000_000.0) as i64;
    session
        .TryChangePlaybackPositionAsync(ticks)
        .map_err(|e| format!("seek failed: {e}"))
        .and_then(|op| {
            wait_op(&op)
                .map(|accepted| {
                    if accepted {
                        ()
                    } else {
                        // Sender refused silently; not fatal, the UI resyncs.
                    }
                })
                .map_err(|e| format!("seek failed: {e}"))
        })
}

// ---------- off-thread entry points ----------

// The four operations above all end in a `wait_op` park, which can last as long
// as the target player takes to answer a `Try*Async` request. Run from the main
// thread that is a visible freeze, so IPC and hotkey callers go through these
// instead: the blocking half moves to the async runtime's blocking pool, where
// a slow player delays nothing but its own reply.
//
// `init_apartment` is called inside each blocking function, so whichever thread
// the pool hands us gets its own COM apartment before touching WinRT. That is
// the same shape as the poller, which has always read SMTC off the main thread
// on its own MTA thread, so nothing here depends on the caller's apartment.

/// Same as [`transport`], on a worker thread. The error string is preserved;
/// a panic in the closure surfaces as a task failure rather than a silent hang.
pub async fn transport_async(action: String) -> Result<(), String> {
    join(tauri::async_runtime::spawn_blocking(move || transport(&action))).await
}

/// Same as [`seek`], on a worker thread.
pub async fn seek_async(position_sec: f64) -> Result<(), String> {
    join(tauri::async_runtime::spawn_blocking(move || seek(position_sec))).await
}

/// Same as [`set_shuffle`], on a worker thread.
pub async fn set_shuffle_async(active: bool) -> Result<(), String> {
    join(tauri::async_runtime::spawn_blocking(move || set_shuffle(active))).await
}

/// Same as [`cycle_repeat`], on a worker thread.
pub async fn cycle_repeat_async(current: Option<u8>) -> Result<(), String> {
    join(tauri::async_runtime::spawn_blocking(move || cycle_repeat(current))).await
}

async fn join(
    handle: tauri::async_runtime::JoinHandle<Result<(), String>>,
) -> Result<(), String> {
    handle.await.unwrap_or_else(|e| Err(format!("media session task failed: {e}")))
}

// ---------- WinRT async helpers ----------

// The `windows_future::Async::join` helper trait is private to that crate, so
// blocking waits go through the WinRT `Completed` callback + a channel. The
// SetCompleted closure runs on the COM callback thread; `rx.recv()` parks
// this thread until then.

fn wait_op<T: windows::core::RuntimeType + 'static>(
    op: &windows_future::IAsyncOperation<T>,
) -> windows::core::Result<T> {
    if op.Status()? != windows_future::AsyncStatus::Completed {
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        op.SetCompleted(&windows_future::AsyncOperationCompletedHandler::new(
            move |_, _| {
                let _ = tx.send(());
                Ok(())
            },
        ))?;
        let _ = rx.recv();
    }
    op.GetResults()
}

/// Drain an `IAsyncOperationWithProgress` (the stream ReadAsync shape).
fn drain_progress<T: windows::core::RuntimeType + 'static, P: windows::core::RuntimeType + 'static>(
    op: &windows_future::IAsyncOperationWithProgress<T, P>,
) -> windows::core::Result<T> {
    if op.Status()? != windows_future::AsyncStatus::Completed {
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        op.SetCompleted(
            &windows_future::AsyncOperationWithProgressCompletedHandler::new(move |_, _| {
                let _ = tx.send(());
                Ok(())
            }),
        )?;
        let _ = rx.recv();
    }
    op.GetResults()
}


/// Best-effort MTA init; media info is never critical, so failure is ignored.
/// RPC_E_CHANGED_MODE also means "an apartment exists" — fine for our use.
fn init_apartment() {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aumid_package_full_name_splits_on_bang() {
        assert_eq!(
            raw_aumid_package_full_name("SpotifyAB.SpotifyMusic_pzzapqpve3rjg!App"),
            "SpotifyAB.SpotifyMusic_pzzapqpve3rjg"
        );
        // No `!`: the whole string is treated as the package name.
        assert_eq!(
            raw_aumid_package_full_name("Microsoft.ZuneMusic_8wekyb3d8bbwe"),
            "Microsoft.ZuneMusic_8wekyb3d8bbwe"
        );
    }

    #[test]
    fn manifest_parser_finds_square44_logo_first() {
        let xml = r#"<?xml version="1.0"?><Package xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10">
            <Applications><Application Id="App">
            <uap:VisualElements DisplayName="Spotify" Square150x150Logo="Images\Logo150.png" Square44x44Logo="Images\Logo44.png" BackgroundColor="transparent"/>
            </Application></Applications></Package>"#;
        assert_eq!(manifest_logo_path(xml).unwrap(), r"Images\Logo44.png");
    }

    #[test]
    fn manifest_parser_falls_back_to_logo_attribute() {
        let xml = r#"<VisualElements DisplayName="X" Logo="assets\tile.png" />"#;
        assert_eq!(manifest_logo_path(xml).unwrap(), r"assets\tile.png");
    }

    #[test]
    fn manifest_parser_handles_single_quotes_and_missing() {
        assert_eq!(
            manifest_logo_path("<VisualElements Square44x44Logo='a/b.png'/>").unwrap(),
            "a/b.png"
        );
        assert_eq!(manifest_logo_path("<VisualElements />"), None);
    }

    #[test]
    fn package_icon_missing_name_is_none() {
        assert_eq!(extract_package_icon(""), None);
        assert_eq!(extract_package_icon("NoSuch.Package_deadbeef"), None);
    }
}
