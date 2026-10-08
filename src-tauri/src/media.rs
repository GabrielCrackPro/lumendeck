
use tauri::http::{header, Request, Response, StatusCode};
use std::path::PathBuf;
use std::sync::Mutex;

static ALLOWED_ROOTS: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

pub fn allow_thumbs_dir() {
    let dir = crate::thumbs::thumbs_dir();
    let _ = std::fs::create_dir_all(&dir);
    let mut roots = ALLOWED_ROOTS.lock().expect("roots poisoned");
    if !roots.contains(&dir) {
        roots.push(dir);
    }
}

pub fn allow_root(path: &std::path::Path) {
    let mut roots = ALLOWED_ROOTS.lock().expect("roots poisoned");
    if let Some(parent) = path.parent() {
        if !roots.contains(&parent.to_path_buf()) {
            roots.push(parent.to_path_buf());
        }
    }
}

pub fn decode_media_ref(path_or_url: &str) -> PathBuf {
    if let Some(idx) = path_or_url.find("://") {
        let rest = &path_or_url[idx + 3..];
        let path = rest.split_once('/').map(|(_, p)| p).unwrap_or(rest);
        PathBuf::from(urldecode(path))
    } else {
        PathBuf::from(path_or_url)
    }
}

pub fn allow_media_ref(path_or_url: &str) {
    allow_root(&decode_media_ref(path_or_url));
}

pub fn allow_dir(path: &std::path::Path) {
    let mut roots = ALLOWED_ROOTS.lock().expect("roots poisoned");
    if path.is_dir() && !roots.contains(&path.to_path_buf()) {
        roots.push(path.to_path_buf());
    }
}

pub fn allowed_roots() -> Vec<PathBuf> {
    ALLOWED_ROOTS.lock().expect("roots poisoned").clone()
}

fn is_allowed(path: &std::path::Path) -> bool {
    let roots = ALLOWED_ROOTS.lock().expect("roots poisoned");
    roots.is_empty() || roots.iter().any(|r| path.starts_with(r))
}

pub fn media_url_for_file(path_or_url: &str) -> String {
    let raw = decode_media_ref(path_or_url).to_string_lossy().to_string();
    let path = PathBuf::from(&raw);
    allow_root(&path);
    let encoded = raw
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();
    let encoded: String = encoded
        .split('/')
        .map(|seg| {
            let mut out = String::new();
            for b in seg.bytes() {
                match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                        out.push(b as char)
                    }
                    _ => out.push_str(&format!("%{b:02X}")),
                }
            }
            out
        })
        .collect::<Vec<_>>()
        .join("/");
    format!("http://media.localhost/{encoded}")
}

const EXT_MIME: &[(&str, &str)] = &[
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("bmp", "image/bmp"),
    ("mp4", "video/mp4"),
    ("webm", "video/webm"),
    ("mov", "video/quicktime"),
    ("mkv", "video/x-matroska"),
    ("html", "text/html"),
];

fn mime_for(path: &std::path::Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    EXT_MIME
        .iter()
        .find(|(e, _)| *e == ext)
        .map(|(_, m)| *m)
        .unwrap_or("application/octet-stream")
}

fn cache_policy(path: &std::path::Path) -> &'static str {
    if path.starts_with(crate::thumbs::thumbs_dir()) {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    }
}

fn file_etag(meta: &std::fs::Metadata) -> String {
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("\"{mtime:x}-{:x}\"", meta.len())
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(b"not found".to_vec())
        .unwrap()
}

const OPEN_ENDED_CHUNK: u64 = 48 * 1024 * 1024;
const CHUNK_READ: usize = 64 * 1024;

struct ByteRange {
    status: StatusCode,
    start: u64,
    end: u64,
    content_range: Option<String>,
}

impl ByteRange {
    fn whole(len: u64) -> Self {
        ByteRange {
            status: StatusCode::OK,
            start: 0,
            end: len.saturating_sub(1),
            content_range: None,
        }
    }

    fn partial(start: u64, end: u64, len: u64) -> Self {
        let content_range = Some(format!("bytes {start}-{end}/{len}"));
        ByteRange {
            status: StatusCode::PARTIAL_CONTENT,
            start,
            end,
            content_range,
        }
    }

    fn unsatisfiable(len: u64) -> Self {
        ByteRange {
            status: StatusCode::RANGE_NOT_SATISFIABLE,
            start: 0,
            end: 0,
            content_range: Some(format!("bytes */{len}")),
        }
    }
}

fn resolve_range(range_header: Option<&str>, len: u64, is_video: bool) -> ByteRange {
    let Some(h) = range_header.map(|s| s.trim()).filter(|s| !s.is_empty()) else {
        return ByteRange::whole(len);
    };
    let Some(rest) = h.strip_prefix("bytes=") else {
        return ByteRange::whole(len);
    };
    let spec = rest.split(',').next().unwrap_or("").trim();
    let clamp = |end: u64| end.min(len.saturating_sub(1));

    if let Some(sfx) = spec.strip_prefix('-') {
        let Ok(n) = sfx.parse::<u64>() else { return ByteRange::whole(len) };
        if n == 0 {
            return ByteRange::unsatisfiable(len);
        }
        let start = len.saturating_sub(n);
        return ByteRange::partial(start, clamp(len - 1), len);
    }

    let (a, b) = spec
        .split_once('-')
        .map(|(a, b)| (a.trim(), b.trim()))
        .unwrap_or((spec, ""));
    let Ok(start) = a.parse::<u64>() else {
        return ByteRange::whole(len);
    };
    if start >= len {
        return ByteRange::unsatisfiable(len);
    }
    let end = if b.is_empty() {
        if is_video {
            clamp(start + OPEN_ENDED_CHUNK - 1)
        } else {
            len - 1
        }
    } else {
        match b.parse::<u64>() {
            Ok(e) => clamp(e),
            Err(_) => len - 1,
        }
    };
    if end < start {
        return ByteRange::unsatisfiable(len);
    }
    ByteRange::partial(start, end, len)
}

fn read_range(path: &std::path::Path, start: u64, end: u64) -> Option<Vec<u8>> {
    use std::io::{Read as _, Seek as _, SeekFrom};
    let mut file = std::fs::File::open(path).ok()?;
    file.seek(SeekFrom::Start(start)).ok()?;
    let n = end.saturating_sub(start) + 1;
    let mut buf = Vec::with_capacity(n as usize);
    let mut reader = file.take(n);
    let mut chunk = [0u8; CHUNK_READ];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(k) => buf.extend_from_slice(&chunk[..k]),
            Err(_) => return None,
        }
    }
    Some(buf)
}

pub fn handle(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let raw = request.uri().to_string();
    let path_part = raw
        .split_once("://")
        .map(|(_, rest)| rest)
        .and_then(|rest| rest.split_once('/'))
        .map(|(_, path)| path)
        .unwrap_or("");

    let decoded = urldecode(path_part);
    let win_path = decoded.trim_start_matches('/');
    let path = PathBuf::from(win_path);

    let mime = mime_for(&path);
    if mime == "application/octet-stream" {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(b"non-media file".to_vec())
            .unwrap();
    }
    if !is_allowed(&path) {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(b"path not allowed".to_vec())
            .unwrap();
    }

    let meta = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(_) => return not_found(),
    };
    let len = meta.len();
    if len == 0 {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            .header(header::CACHE_CONTROL, "no-cache")
            .header(header::ETAG, "\"0\"")
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_LENGTH, "0")
            .body(Vec::new())
            .unwrap();
    }
    let cc = cache_policy(&path);
    let etag = file_etag(&meta);

    if let Some(given) = request.headers().get(header::IF_NONE_MATCH) {
        if given.to_str().map(|s| s.trim() == etag).unwrap_or(false) {
            return Response::builder()
                .status(StatusCode::NOT_MODIFIED)
                .header(header::CACHE_CONTROL, cc)
                .header(header::ETAG, etag)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(Vec::new())
                .unwrap();
        }
    }

    let range = resolve_range(
        request
            .headers()
            .get(header::RANGE)
            .and_then(|v| v.to_str().ok()),
        len,
        mime.starts_with("video/"),
    );

    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, cc)
        .header(header::ETAG, etag)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");

    if let Some(cr) = &range.content_range {
        builder = builder.header(header::CONTENT_RANGE, cr);
    }

    if request.method().as_str() == "HEAD" {
        let body_len = if range.status == StatusCode::OK || range.status == StatusCode::PARTIAL_CONTENT {
            range.end.saturating_sub(range.start) + 1
        } else {
            0
        };
        return builder
            .status(range.status)
            .header(header::CONTENT_LENGTH, body_len.to_string())
            .body(Vec::new())
            .unwrap();
    }

    if range.status == StatusCode::RANGE_NOT_SATISFIABLE {
        return builder
            .status(range.status)
            .body(Vec::new())
            .unwrap();
    }

    match read_range(&path, range.start, range.end) {
        Some(bytes) => builder
            .status(range.status)
            .header(header::CONTENT_LENGTH, bytes.len().to_string())
            .body(bytes)
            .unwrap(),
        None => not_found(),
    }
}

fn urldecode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() + 1 && i + 2 < bytes.len() + 1 => {
                let hex = &s[i + 1..(i + 3).min(s.len())];
                if hex.len() == 2 {
                    if let Ok(b) = u8::from_str_radix(hex, 16) {
                        out.push(b);
                        i += 3;
                        continue;
                    }
                }
                out.push(b'%');
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

pub fn to_media_url(abs_path: &str) -> String {
    let p = abs_path.replace('\\', "/");
    let p = p.trim_start_matches('/');
    let mut out = String::from("http://media.localhost/");
    for b in p.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b':' | b'.' | b'_' | b'-' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_url_from_plain_windows_path() {
        let url = media_url_for_file(r"C:\Users\GB\Pics\my cat & dog.png");
        assert_eq!(url, "http://media.localhost/C%3A/Users/GB/Pics/my%20cat%20%26%20dog.png");
    }

    #[test]
    fn media_url_from_existing_media_url_roundtrips() {
        let url = media_url_for_file("http://media.localhost/C%3A/Users/GB/video.mp4");
        assert_eq!(url, "http://media.localhost/C%3A/Users/GB/video.mp4");
    }

    #[test]
    fn decode_media_ref_handles_both_forms() {
        assert_eq!(
            decode_media_ref(r"C:\Users\GB\a.png"),
            PathBuf::from(r"C:\Users\GB\a.png")
        );
        assert_eq!(
            decode_media_ref("http://media.localhost/C%3A%5CUsers%5CGB%5Ca.png"),
            PathBuf::from(r"C:\Users\GB\a.png")
        );
    }

    #[test]
    fn media_url_preserves_slashes_and_encodes_spaces() {
        let url = media_url_for_file(r"D:\Wallpapers\04 - sunrise.jpg");
        assert!(url.starts_with("http://media.localhost/D%3A/Wallpapers/"));
        assert!(url.contains("04%20-%20sunrise.jpg"));
        assert!(!url.contains('%') == false);
    }

    #[test]
    fn no_range_header_serves_whole_file() {
        let r = resolve_range(None, 10_000, true);
        assert_eq!(r.status, StatusCode::OK);
        assert_eq!((r.start, r.end), (0, 9_999));
        assert!(r.content_range.is_none());
    }

    #[test]
    fn finite_range_is_exact() {
        let r = resolve_range(Some("bytes=100-199"), 10_000, false);
        assert_eq!(r.status, StatusCode::PARTIAL_CONTENT);
        assert_eq!((r.start, r.end), (100, 199));
        assert_eq!(r.content_range.as_deref(), Some("bytes 100-199/10000"));
    }

    #[test]
    fn open_ended_range_clamped_to_file() {
        let r = resolve_range(Some("bytes=9000-"), 10_000, false);
        assert_eq!((r.start, r.end), (9000, 9_999));
    }

    #[test]
    fn open_ended_video_range_is_chunk_capped() {
        let r = resolve_range(Some("bytes=0-"), 1_000_000_000, true);
        assert_eq!(r.status, StatusCode::PARTIAL_CONTENT);
        assert_eq!((r.start, r.end), (0, OPEN_ENDED_CHUNK - 1));
    }

    #[test]
    fn open_ended_image_range_is_not_capped() {
        let r = resolve_range(Some("bytes=0-"), 1_000_000_000, false);
        assert_eq!((r.start, r.end), (0, 999_999_999));
    }

    #[test]
    fn suffix_range_takes_last_bytes() {
        let r = resolve_range(Some("bytes=-500"), 10_000, false);
        assert_eq!(r.status, StatusCode::PARTIAL_CONTENT);
        assert_eq!((r.start, r.end), (9_500, 9_999));
    }

    #[test]
    fn out_of_bounds_range_is_unsatisfiable() {
        let r = resolve_range(Some("bytes=10000-"), 10_000, false);
        assert_eq!(r.status, StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(r.content_range.as_deref(), Some("bytes */10000"));
    }

    #[test]
    fn read_range_streams_requested_window() {
        let dir = std::env::temp_dir().join(format!("lumendeck-media-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("sample.bin");
        let data: Vec<u8> = (0..1024u16).map(|i| (i % 256) as u8).collect();
        std::fs::write(&file, &data).unwrap();

        let got = read_range(&file, 256, 511).expect("range read");
        assert_eq!(got.len(), 256);
        assert_eq!(got[0], 0);
        assert_eq!(got[255], data[511]);

        let full = read_range(&file, 0, 1023).unwrap();
        assert_eq!(full, data);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
