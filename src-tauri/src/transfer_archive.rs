
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::config::{Config, WallpaperKind};

pub const MEDIA_DIR: &str = "media";

pub const CONFIG_ENTRY: &str = "config.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedFile {
    pub source: PathBuf,
    pub member: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct BundlePlan {
    pub files: Vec<PlannedFile>,
    pub missing: Vec<String>,
}

pub fn is_portable(kind: WallpaperKind, source: &str) -> bool {
    match kind {
        WallpaperKind::Video | WallpaperKind::Image => is_abs_windows_path(source),
        _ => false,
    }
}

fn is_abs_windows_path(source: &str) -> bool {
    let b = source.as_bytes();
    if b.len() < 3 || !source.contains('\\') {
        return false;
    }
    let drive = b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'\\';
    let unc = b[0] == b'\\' && b[1] == b'\\';
    drive || unc
}

pub fn referenced_files(cfg: &Config) -> Vec<(WallpaperKind, String)> {
    let mut out: Vec<(WallpaperKind, String)> = Vec::new();
    let mut push = |kind: WallpaperKind, source: &str| {
        if is_portable(kind, source) && !out.iter().any(|(_, s)| s == source) {
            out.push((kind, source.to_string()));
        }
    };

    for entry in &cfg.gallery {
        push(entry.kind, &entry.source);
    }
    push(cfg.wallpaper.kind, &cfg.wallpaper.source);
    for per in cfg.wallpaper.per_monitor.values() {
        push(per.kind, &per.source);
    }
    for scene in &cfg.scenes {
        push(scene.wallpaper.kind, &scene.wallpaper.source);
        for per in scene.wallpaper.per_monitor.values() {
            push(per.kind, &per.source);
        }
    }
    out.sort_by(|a, b| a.1.cmp(&b.1));
    out
}

pub fn plan_bundle(cfg: &Config, exists: &dyn Fn(&str) -> bool) -> BundlePlan {
    let mut plan = BundlePlan::default();
    let mut index = 0usize;
    for (_kind, source) in referenced_files(cfg) {
        let member = format!("{MEDIA_DIR}/{index:04}{}", extension_of(&source));
        if exists(&source) {
            plan.files.push(PlannedFile {
                member,
                source: PathBuf::from(&source),
            });
        } else {
            plan.missing.push(source);
        }
        index += 1;
    }
    plan
}

pub fn plan_for_import(cfg: &Config) -> BundlePlan {
    plan_bundle(cfg, &|_| true)
}

fn extension_of(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| !e.is_empty() && e.len() <= 8 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(|e| format!(".{e}"))
        .unwrap_or_default()
}

pub fn local_name(id: &str, ext: &str, taken: &dyn Fn(&str) -> bool) -> String {
    let stem = safe_stem(id);
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    let ext = if ext.is_empty() {
        String::new()
    } else {
        format!(".{ext}")
    };
    let first = format!("import-{stem}{ext}");
    if !taken(&first) {
        return first;
    }
    for n in 2..1000 {
        let candidate = format!("import-{stem}-{n}{ext}");
        if !taken(&candidate) {
            return candidate;
        }
    }
    first
}

fn safe_stem(id: &str) -> String {
    let cleaned: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if cleaned.is_empty() {
        "entry".to_string()
    } else {
        cleaned.chars().take(64).collect()
    }
}

pub fn rewrite_paths(cfg: &mut Config, landed: &BTreeMap<String, String>) -> usize {
    let lookup = |s: &str| -> Option<&String> {
        landed
            .iter()
            .find(|(from, _)| from.eq_ignore_ascii_case(s))
            .map(|(_, to)| to)
    };
    let mut n = 0;

    for entry in cfg.gallery.iter_mut() {
        if let Some(new) = lookup(&entry.source) {
            entry.source = new.clone();
            n += 1;
        }
    }
    if let Some(new) = lookup(&cfg.wallpaper.source) {
        cfg.wallpaper.source = new.clone();
        n += 1;
    }
    for per in cfg.wallpaper.per_monitor.values_mut() {
        if let Some(new) = lookup(&per.source) {
            per.source = new.clone();
            n += 1;
        }
    }
    for scene in cfg.scenes.iter_mut() {
        if let Some(new) = lookup(&scene.wallpaper.source) {
            scene.wallpaper.source = new.clone();
            n += 1;
        }
        for per in scene.wallpaper.per_monitor.values_mut() {
            if let Some(new) = lookup(&per.source) {
                per.source = new.clone();
                n += 1;
            }
        }
    }
    n
}

pub fn is_media_member(name: &str) -> bool {
    let Some(rest) = name.strip_prefix(MEDIA_DIR) else {
        return false;
    };
    let Some(file) = rest.strip_prefix('/') else {
        return false;
    };
    let (stem, ext) = match file.rsplit_once('.') {
        Some((stem, ext)) => (stem, Some(ext)),
        None => (file, None),
    };
    let digits_ok = !stem.is_empty()
        && stem.len() <= 8
        && stem.bytes().all(|b| b.is_ascii_digit());
    if !digits_ok {
        return false;
    }
    match ext {
        Some(ext) => {
            !ext.is_empty() && ext.len() <= 8 && ext.bytes().all(|b| b.is_ascii_alphanumeric())
        }
        None => true,
    }
}

pub const MAX_MEDIA_BYTES: u64 = 512 * 1024 * 1024;

pub const MAX_BUNDLE_BYTES: u64 = 4 * 1024 * 1024 * 1024;

pub fn check_member_size(size: u64, running_total: u64) -> Result<(), String> {
    if size > MAX_MEDIA_BYTES {
        return Err(format!(
            "the bundle contains a file of {} MB, which is too large to restore",
            size / (1024 * 1024)
        ));
    }
    if running_total.saturating_add(size) > MAX_BUNDLE_BYTES {
        return Err("the bundle's media is larger than the 4 GB restore limit".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{GalleryEntry, PerMonitorWallpaper, SceneProfile};

    fn entry(kind: WallpaperKind, source: &str) -> GalleryEntry {
        GalleryEntry {
            id: "g1".into(),
            name: "x".into(),
            kind,
            source: source.into(),
            origin: None,
            added_ms: 0,
            thumb: None,
            opts: None,
            favorite: false,
            last_applied_ms: None,
        }
    }

    #[test]
    fn a_local_video_is_portable_and_a_url_is_not() {
        assert!(is_portable(WallpaperKind::Video, r"C:\clips\a.mp4"));
        assert!(is_portable(WallpaperKind::Image, r"C:\pics\b.png"));
        assert!(!is_portable(WallpaperKind::Web, "https://x.test/a.mp4"));
        assert!(!is_portable(WallpaperKind::Shader, "aurora"));
        assert!(!is_portable(WallpaperKind::Slideshow, r"C:\clips"));
    }

    #[test]
    fn a_media_url_is_not_treated_as_a_file() {
        assert!(!is_portable(
            WallpaperKind::Video,
            "media://thumbs/abc.png"
        ));
    }

    #[test]
    fn a_backslash_url_is_refused() {
        assert!(!is_portable(WallpaperKind::Video, r"https:\\evil.test\a.mp4"));
    }

    #[test]
    fn a_relative_or_bare_name_is_not_treated_as_a_file() {
        assert!(!is_portable(WallpaperKind::Video, r"a.mp4"));
        assert!(!is_portable(WallpaperKind::Video, r"clips\a.mp4"));
    }

    #[test]
    fn a_unc_share_is_a_real_file_and_is_bundled() {
        assert!(is_portable(WallpaperKind::Video, r"\\nas\clips\a.mp4"));
    }

    #[test]
    fn the_plan_lists_what_exists_and_names_what_does_not() {
        let mut cfg = Config::default();
        cfg.gallery = vec![
            entry(WallpaperKind::Video, r"C:\have\a.mp4"),
            entry(WallpaperKind::Video, r"C:\gone\b.mp4"),
        ];
        let plan = plan_bundle(&cfg, &|p| p.contains("have"));
        assert_eq!(plan.files.len(), 1);
        assert_eq!(plan.missing, vec![r"C:\gone\b.mp4".to_string()]);
    }

    #[test]
    fn a_missing_file_does_not_renumber_the_ones_after_it() {
        let mut cfg = Config::default();
        cfg.gallery = vec![
            entry(WallpaperKind::Video, r"C:\gone\a.mp4"),
            entry(WallpaperKind::Video, r"C:\have\b.mp4"),
        ];
        let exported = plan_bundle(&cfg, &|p| p.contains("have"));
        let imported = plan_for_import(&cfg);
        let member_of = |plan: &crate::transfer_archive::BundlePlan, src: &str| {
            plan.files
                .iter()
                .find(|f| f.source.to_string_lossy() == src)
                .map(|f| f.member.clone())
                .unwrap()
        };
        let have = r"C:\have\b.mp4";
        assert_eq!(member_of(&exported, have), "media/0001.mp4");
        assert_eq!(
            member_of(&imported, have),
            member_of(&exported, have),
            "both sides must agree on the name for the same file"
        );
        assert_eq!(
            member_of(&imported, r"C:\gone\a.mp4"),
            "media/0000.mp4",
            "the absent file keeps its slot, or everything after it shifts"
        );
    }

    #[test]
    fn the_import_side_does_not_ask_whether_a_path_exists_here() {
        let mut cfg = Config::default();
        cfg.gallery = vec![entry(WallpaperKind::Video, r"C:\their-machine\a.mp4")];
        let import_plan = plan_for_import(&cfg);
        assert_eq!(import_plan.files.len(), 1, "a foreign path is still a reference");
        assert!(import_plan.missing.is_empty());
        assert_eq!(import_plan.files[0].member, "media/0000.mp4");
    }

    #[test]
    fn member_names_are_indices_not_original_filenames() {
        let mut cfg = Config::default();
        cfg.gallery = vec![entry(
            WallpaperKind::Video,
            r"C:\..\..\Windows\System32\evil.mp4",
        )];
        let plan = plan_bundle(&cfg, &|_| true);
        assert_eq!(plan.files[0].member, "media/0000.mp4");
        assert!(!plan.files[0].member.contains("evil"));
    }

    #[test]
    fn a_duplicate_reference_is_bundled_once() {
        let mut cfg = Config::default();
        cfg.gallery = vec![entry(WallpaperKind::Video, r"C:\a.mp4")];
        cfg.wallpaper.kind = WallpaperKind::Video;
        cfg.wallpaper.source = r"C:\a.mp4".into();
        let plan = plan_bundle(&cfg, &|_| true);
        assert_eq!(plan.files.len(), 1);
    }

    #[test]
    fn every_path_bearing_field_is_rewritten() {
        let mut cfg = Config::default();
        cfg.gallery = vec![entry(WallpaperKind::Video, r"C:\a.mp4")];
        cfg.wallpaper.kind = WallpaperKind::Video;
        cfg.wallpaper.source = r"C:\a.mp4".into();
        cfg.wallpaper.per_monitor.insert(
            r"\.\\DISPLAY1".into(),
            PerMonitorWallpaper {
                kind: WallpaperKind::Video,
                source: r"C:\a.mp4".into(),
            },
        );
        let mut scene = SceneProfile::default();
        scene.wallpaper.kind = WallpaperKind::Video;
        scene.wallpaper.source = r"C:\a.mp4".into();
        cfg.scenes.push(scene);

        let mut landed = BTreeMap::new();
        landed.insert(r"C:\a.mp4".to_string(), r"X:\import-g1.mp4".to_string());
        let n = rewrite_paths(&mut cfg, &landed);

        assert_eq!(n, 4, "gallery, wallpaper, per-monitor, scene wallpaper");
        assert_eq!(cfg.gallery[0].source, r"X:\import-g1.mp4");
        assert_eq!(cfg.wallpaper.source, r"X:\import-g1.mp4");
        assert_eq!(
            cfg.wallpaper.per_monitor[r"\.\\DISPLAY1"].source,
            r"X:\import-g1.mp4"
        );
        assert_eq!(cfg.scenes[0].wallpaper.source, r"X:\import-g1.mp4");
    }

    #[test]
    fn a_path_from_another_machine_is_matched_case_insensitively() {
        let mut cfg = Config::default();
        cfg.gallery = vec![entry(WallpaperKind::Video, r"c:\clips\A.MP4")];
        let mut landed = BTreeMap::new();
        landed.insert(r"C:\Clips\a.mp4".to_string(), r"X:\import-g1.mp4".into());
        assert_eq!(rewrite_paths(&mut cfg, &landed), 1);
        assert_eq!(cfg.gallery[0].source, r"X:\import-g1.mp4");
    }

    #[test]
    fn a_source_that_did_not_travel_is_left_alone() {
        let mut cfg = Config::default();
        cfg.gallery = vec![entry(WallpaperKind::Video, r"C:\gone\b.mp4")];
        let mut landed = BTreeMap::new();
        landed.insert(r"C:\a.mp4".to_string(), r"X:\import-g1.mp4".into());
        assert_eq!(rewrite_paths(&mut cfg, &landed), 0);
        assert_eq!(cfg.gallery[0].source, r"C:\gone\b.mp4");
    }

    #[test]
    fn a_traversal_member_name_is_refused() {
        assert!(!is_media_member("media/../../../Windows/System32/evil.dll"));
        assert!(!is_media_member("media/0000/../../evil"));
        assert!(!is_media_member("../media/0000.mp4"));
        assert!(!is_media_member("config.json"));
        assert!(!is_media_member("media/"));
        assert!(!is_media_member("media/0000."));
        assert!(!is_media_member("media/abc.mp4"));
    }

    #[test]
    fn our_own_member_names_are_accepted() {
        for name in [
            "media/0000.mp4",
            "media/0012.webp",
            "media/0007",
            "media/0123.mkv",
        ] {
            assert!(is_media_member(name), "{name} should be accepted");
        }
    }

    #[test]
    fn a_media_url_member_is_refused() {
        assert!(!is_media_member("media/C:/Windows/evil.dll"));
    }

    #[test]
    fn local_names_avoid_a_collision_rather_than_overwriting() {
        let taken = |n: &str| n == "import-g1.mp4";
        assert_eq!(local_name("g1", ".mp4", &taken), "import-g1-2.mp4");
        assert_eq!(local_name("g1", ".mp4", &|_| false), "import-g1.mp4");
    }

    #[test]
    fn a_local_name_cannot_escape_the_media_directory() {
        let name = local_name("../../evil", ".mp4", &|_| false);
        assert!(!name.contains('/'), "got {name}");
        assert!(!name.contains('\\'), "got {name}");
        assert!(!name.contains(".."), "got {name}");
    }

    #[test]
    fn an_oversized_member_is_refused_before_it_is_read() {
        assert!(check_member_size(1024, 0).is_ok());
        assert!(check_member_size(MAX_MEDIA_BYTES + 1, 0).is_err());
        assert!(check_member_size(MAX_MEDIA_BYTES, MAX_BUNDLE_BYTES).is_err());
    }
}