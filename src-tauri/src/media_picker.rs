use serde::Serialize;
use std::path::{Path, PathBuf};

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "webm", "mov", "mkv"];
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif"];
const MAX_ENTRIES: usize = 2000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPickerEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size_bytes: Option<u64>,
    pub modified_ms: Option<u64>,
    pub location_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPickerListing {
    pub current_path: Option<String>,
    pub parent_path: Option<String>,
    pub entries: Vec<MediaPickerEntry>,
    pub truncated: bool,
}

pub fn list(path: Option<&str>) -> Result<MediaPickerListing, String> {
    match path {
        Some(path) => list_directory(path),
        None => Ok(list_roots()),
    }
}

pub fn media_kind(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        Some("video")
    } else if IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        Some("image")
    } else {
        None
    }
}

fn make_entry(
    path: PathBuf,
    kind: &str,
    location_id: Option<&str>,
    metadata: Option<std::fs::Metadata>,
) -> MediaPickerEntry {
    let display_path = display_path(&path);
    let name = location_id.map(str::to_string).or_else(|| {
        if kind == "drive" {
            Some(display_path.trim_end_matches('\\').to_string())
        } else {
            path.file_name().map(|name| name.to_string_lossy().to_string())
        }
    }).unwrap_or_else(|| display_path.clone());
    let modified_ms = metadata
        .as_ref()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|duration| u64::try_from(duration.as_millis()).ok());

    MediaPickerEntry {
        name,
        path: display_path,
        kind: kind.to_string(),
        size_bytes: metadata
            .as_ref()
            .filter(|meta| meta.is_file())
            .map(|meta| meta.len()),
        modified_ms,
        location_id: location_id.map(str::to_string),
    }
}

fn display_path(path: &Path) -> String {
    let path = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(unc_path) = path.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc_path}");
        }
        if let Some(local_path) = path.strip_prefix(r"\\?\") {
            return local_path.to_string();
        }
    }
    path.to_string()
}

fn add_location(entries: &mut Vec<MediaPickerEntry>, path: Option<PathBuf>, id: &str) {
    let Some(path) = path.filter(|path| path.is_dir()) else {
        return;
    };
    let Ok(path) = path.canonicalize() else {
        return;
    };
    let path_text = display_path(&path);
    if entries
        .iter()
        .any(|entry| entry.path == path_text)
    {
        return;
    }
    entries.push(make_entry(path, "location", Some(id), None));
}

fn list_roots() -> MediaPickerListing {
    let mut entries = Vec::new();
    add_location(&mut entries, dirs::home_dir(), "home");
    add_location(&mut entries, dirs::desktop_dir(), "desktop");
    add_location(&mut entries, dirs::download_dir(), "downloads");
    add_location(&mut entries, dirs::document_dir(), "documents");
    add_location(&mut entries, dirs::picture_dir(), "pictures");
    add_location(&mut entries, dirs::video_dir(), "videos");

    for letter in b'A'..=b'Z' {
        let path = PathBuf::from(format!("{}:\\", letter as char));
        if path.is_dir() {
            entries.push(make_entry(path, "drive", None, None));
        }
    }

    MediaPickerListing {
        current_path: None,
        parent_path: None,
        entries,
        truncated: false,
    }
}

fn list_directory(raw_path: &str) -> Result<MediaPickerListing, String> {
    let path = PathBuf::from(raw_path)
        .canonicalize()
        .map_err(|error| format!("Could not open folder: {error}"))?;
    if !path.is_dir() {
        return Err("The selected path is not a folder".into());
    }
    let read_dir = std::fs::read_dir(&path)
        .map_err(|error| format!("Could not read folder: {error}"))?;
    let mut entries = Vec::new();

    for result in read_dir {
        let dir_entry = result.map_err(|error| format!("Could not read folder entry: {error}"))?;
        let name = dir_entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let item_path = dir_entry.path();
        let metadata = match dir_entry.metadata() {
            Ok(metadata) => metadata,
            Err(error) => {
                log::debug!("media picker skipped an item whose metadata could not be read: {error}");
                continue;
            }
        };

        if metadata.is_dir() {
            entries.push(make_entry(item_path, "directory", None, Some(metadata)));
        } else if let Some(kind) = media_kind(&item_path) {
            entries.push(make_entry(item_path, kind, None, Some(metadata)));
        }
    }

    entries.sort_by(|a, b| {
        let a_order = if a.kind == "directory" { 0 } else { 1 };
        let b_order = if b.kind == "directory" { 0 } else { 1 };
        a_order
            .cmp(&b_order)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.path.cmp(&b.path))
    });
    let truncated = entries.len() > MAX_ENTRIES;
    entries.truncate(MAX_ENTRIES);

    Ok(MediaPickerListing {
        current_path: Some(display_path(&path)),
        parent_path: path.parent().map(display_path),
        entries,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEMP_ID: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn classifies_only_gallery_media_extensions_case_insensitively() {
        assert_eq!(media_kind(Path::new("wallpaper.MP4")), Some("video"));
        assert_eq!(media_kind(Path::new("photo.JPEG")), Some("image"));
        assert_eq!(media_kind(Path::new("notes.txt")), None);
        assert_eq!(media_kind(Path::new("without-extension")), None);
    }

    #[test]
    fn lists_folders_and_supported_media_but_not_other_files() {
        let path = std::env::temp_dir().join(format!(
            "lumendeck-media-picker-{}-{}",
            std::process::id(),
            TEMP_ID.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(path.join("Nested")).unwrap();
        std::fs::write(path.join("clip.MP4"), []).unwrap();
        std::fs::write(path.join("still.png"), []).unwrap();
        std::fs::write(path.join("readme.txt"), []).unwrap();

        let listing = list(Some(path.to_str().unwrap())).unwrap();
        let names: Vec<_> = listing.entries.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, ["Nested", "clip.MP4", "still.png"]);
        assert_eq!(listing.entries[0].kind, "directory");
        assert_eq!(listing.entries[1].kind, "video");
        assert_eq!(listing.entries[2].kind, "image");

        std::fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn rejects_nonexistent_and_non_directory_paths() {
        let missing = std::env::temp_dir().join(format!(
            "lumendeck-media-picker-missing-{}-{}",
            std::process::id(),
            TEMP_ID.fetch_add(1, Ordering::Relaxed)
        ));
        assert!(list(Some(missing.to_str().unwrap())).is_err());

        let file = std::env::temp_dir().join(format!(
            "lumendeck-media-picker-file-{}-{}",
            std::process::id(),
            TEMP_ID.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::write(&file, []).unwrap();
        assert!(list(Some(file.to_str().unwrap())).is_err());
        std::fs::remove_file(file).unwrap();
    }
}
