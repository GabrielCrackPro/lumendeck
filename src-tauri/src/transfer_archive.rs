// A config export as a zip: the JSON envelope plus the media it references.
//
// A JSON export carries a vault of absolute paths. On the machine that wrote
// them they resolve; anywhere else they are strings pointing at `C:\Users\<the
// other person's name>\...`, and every tile in the restored vault is a broken
// one. That is the whole reason this file exists, and it is why the format is a
// bundle rather than a smarter JSON: the paths cannot be made to work, so the
// files have to come with them.
//
// Three decisions are load-bearing, and in each case the obvious
// implementation is the dangerous one:
//
// * **The archive names files; it never names where they land.** Every entry
//   inside the zip is called `media/<index>.<ext>` — an index we assigned, not
//   a path anybody supplied. The on-disk name is minted from the gallery entry
//   id, through the same sanitizer the logo path already uses. A zip is a
//   format a stranger can author, and `media/../../../../Windows/System32/x.dll`
//   is a name the crate will happily hand back. Deriving the destination from
//   our own index rather than the archive's name is what makes a traversal
//   attempt inert instead of merely unlikely.
//
// * **Only files that exist locally are bundled, and a missing one is not a
//   failure.** A vault legitimately holds entries whose file has since been
//   moved or deleted. Exporting must not refuse over that, and must not record
//   a member it cannot fill — so the plan lists what it *found*, and the
//   unpacked config points only at what arrived.
//
// * **Paths are rewritten everywhere, not just in the vault.** A config holds
//   the wallpaper's own source, a per-monitor override per display, a
//   slideshow folder and a profile's saved wallpaper, and each of those
//   references the same files the gallery does. Rewriting only `gallery[]`
//   restores a vault of working tiles pointed at by a wallpaper that still
//   points at the exporting machine — the most visible thing in the app broken
//   while everything on screen looks fine.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::config::{Config, WallpaperKind};

/// Member name for one bundled file, assigned by index.
///
/// Deliberately not derived from the original path or filename. See the module
/// comment: the archive's names are untrusted input, so the destination on this
/// machine is computed from our own numbering instead.
pub const MEDIA_DIR: &str = "media";

/// The envelope's name inside the bundle.
pub const CONFIG_ENTRY: &str = "config.json";

/// One file to bundle, and the name it travels under.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedFile {
    /// The path as it exists on the exporting machine.
    pub source: PathBuf,
    /// Name inside the archive, e.g. `media/0007.mp4`.
    pub member: String,
}

/// A config and the files it needs, worked out without touching the disk.
///
/// Separate from the write for the same reason `plan_import` is: the answer has
/// to be inspectable and testable, and "which files will this export carry" is
/// the one question a user would reasonably want asked before a multi-gigabyte
/// zip is written.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BundlePlan {
    /// Referenced files that exist and will be written, in a stable order.
    pub files: Vec<PlannedFile>,
    /// Referenced paths that do not exist here, so they will not travel.
    pub missing: Vec<String>,
}

/// Whether a `source` string names a local file that can travel.
///
/// Three kinds of source are deliberately excluded:
///
/// * `Web` entries are URLs, and `Shader` entries are preset ids. Neither is a
///   path and both are already portable — copying a file that does not exist
///   would fail the whole export.
/// * A `Slideshow` entry names a *folder*, and a folder of unknown size is not
///   something to copy into a backup without being asked.
/// * A `media://` URL is how this app addresses its own cached files, and it
///   resolves only here.
pub fn is_portable(kind: WallpaperKind, source: &str) -> bool {
    match kind {
        WallpaperKind::Video | WallpaperKind::Image => is_abs_windows_path(source),
        _ => false,
    }
}

/// Is this a Windows absolute path, and therefore worth copying?
///
/// Shape rather than substring tests, because a loose test lets anything
/// containing a backslash through: `https:\\evil.test\a.mp4` has no `://` and
/// would otherwise be treated as a file. Two accepted shapes, both of which
/// name something on this disk:
///
/// * a drive letter — `C:\clips\a.mp4`
/// * a UNC share — `\\nas\clips\a.mp4`, which is how a vault on a network
///   drive is addressed and is just as real a file as one on `C:`
fn is_abs_windows_path(source: &str) -> bool {
    let b = source.as_bytes();
    if b.len() < 3 || !source.contains('\\') {
        return false;
    }
    let drive = b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'\\';
    let unc = b[0] == b'\\' && b[1] == b'\\';
    drive || unc
}

/// Every distinct local file a config references.
///
/// Walks all four places a path can hide rather than just `gallery[]`, for the
/// reason in the module comment: the vault is where the paths are visible and
/// the wallpaper is where their absence is noticed. Order is sorted, so two
/// exports of the same config produce the same bundle.
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

/// Decide what to bundle, given a way to ask whether a path exists.
///
/// `exists` is injected rather than calling the filesystem directly so the
/// decision is testable without fixtures on disk — and so the same plan can be
/// computed for a preview, where nothing is read.
///
/// The index advances for every referenced file, **including the ones that do
/// not exist**. It has to: the numbering is what a member is called, and the
/// importing side recomputes the same list from the same config. Skipping the
/// index for a missing file would renumber everything after it on one side
/// only, and every later file would land under the wrong name — a bundle that
/// unpacks with the wrong clip on every tile.
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

/// The same numbering, computed for a machine the files did not come from.
///
/// Deliberately separate from `plan_bundle` rather than a call with an
/// always-true predicate, because getting that wrong is silent and total: the
/// importing side must ask "what would this config's references be called",
/// never "does this path exist here". Those paths belong to another computer
/// and answer false for every one of them, which would empty the plan and
/// reject every member as unplanned.
pub fn plan_for_import(cfg: &Config) -> BundlePlan {
    plan_bundle(cfg, &|_| true)
}

/// The file extension to keep, lowercased, or nothing.
///
/// Only the tail after the last dot, and only when it looks like an extension:
/// `C:\Users\me\video.2024.mp4` must keep `.mp4` and not `.2024.mp4`, and a
/// path with no dot at all must not gain one.
fn extension_of(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| !e.is_empty() && e.len() <= 8 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(|e| format!(".{e}"))
        .unwrap_or_default()
}

/// Where a bundled file lands on this machine.
///
/// The name is `import-<id>.<ext>`: ours, from the gallery entry's own id, run
/// through the sanitizer. Two imports of the same file must not collide, so the
/// id is in the name — and the id is reminted on import, which is what makes it
/// safe to use here.
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
    // Unreachable in practice: a thousand entries sharing one id is a vault
    // that is already broken. Returning the first name keeps the import
    // overwriting one file rather than looping.
    first
}

/// Reduce an id to something safe as a filename.
///
/// Ids are generated, but they also arrive from a migrated config and from an
/// import file, which is a JSON document a person can edit. Disallowed
/// characters are dropped rather than replaced, so `../../night` becomes
/// `night` and not `------night`.
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

/// Rewrite every path in a config to where its file landed.
///
/// Returns the count of fields changed, which the caller logs: a bundle that
/// restored nothing means the archive was read but the paths did not match, and
/// that is worth a line in the log rather than a silent no-op.
///
/// The mapping is keyed by the *exporting* machine's path, because that is what
/// the file still says. Comparison is case-insensitive because Windows paths
/// are, and an export that came off a different casing would otherwise rewrite
/// nothing and leave every tile broken.
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

/// Is this archive member name one of ours?
///
/// The gate on every name that comes out of a zip before it is used for
/// anything. `starts_with("media/")` is the whole check on purpose: the member
/// name is only ever compared against names *we* generated, so anything that
/// fails this is refused rather than sanitised. Sanitising is how
/// `..\..\evil` becomes `evil` and someone wonders why the file they expected is
/// not the file that arrived.
pub fn is_media_member(name: &str) -> bool {
    let Some(rest) = name.strip_prefix(MEDIA_DIR) else {
        return false;
    };
    let Some(file) = rest.strip_prefix('/') else {
        return false;
    };
    // `<digits>` with an optional `.<ext>`, and nothing else: no separators, so
    // no traversal can be spelled, and no leading dot, so a member cannot be a
    // dotfile. The extension is optional because the exporter mints one only
    // when the original file had one, and a refusal here would silently drop a
    // file that exported fine.
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

/// Ceiling on one bundled file, in bytes.
///
/// A vault entry is a wallpaper, not a film. Anything this large is either a
/// mistake or something that should not be in a backup, and a zip write that
/// stops halfway leaves a file the user cannot use.
pub const MAX_MEDIA_BYTES: u64 = 512 * 1024 * 1024;

/// Ceiling on the whole bundle's media, in bytes.
///
/// Bounded rather than streaming to whatever disk allows, because the failure
/// mode of running out of space halfway is a corrupt file that looks like a
/// valid one until someone tries to import it.
pub const MAX_BUNDLE_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// Refuse a member whose declared size is implausible before reading it.
///
/// Guards the zip-bomb shape: an entry claiming to decompress to far more than
/// it costs to hold. Checked against the sum, not per file alone, since the
/// damage is in the total.
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
        // The three sources that are already portable, and would fail a copy.
        assert!(!is_portable(WallpaperKind::Web, "https://x.test/a.mp4"));
        assert!(!is_portable(WallpaperKind::Shader, "aurora"));
        assert!(!is_portable(WallpaperKind::Slideshow, r"C:\clips"));
    }

    #[test]
    fn a_media_url_is_not_treated_as_a_file() {
        // How this app addresses its own cached files. Resolves here only, so
        // bundling it would produce a member that cannot be restored anywhere.
        assert!(!is_portable(
            WallpaperKind::Video,
            "media://thumbs/abc.png"
        ));
    }

    #[test]
    fn a_backslash_url_is_refused() {
        // `is_portable` checks the shape of a Windows path, not for `://`.
        // This string has no `://` and does have backslashes, so a substring
        // test would wave it through and the export would try to copy it.
        assert!(!is_portable(WallpaperKind::Video, r"https:\\evil.test\a.mp4"));
    }

    #[test]
    fn a_relative_or_bare_name_is_not_treated_as_a_file() {
        // A wallpaper source that is a bare filename resolves against the
        // process's working directory, which is not something to copy.
        assert!(!is_portable(WallpaperKind::Video, r"a.mp4"));
        assert!(!is_portable(WallpaperKind::Video, r"clips\a.mp4"));
    }

    #[test]
    fn a_unc_share_is_a_real_file_and_is_bundled() {
        // A vault on a network drive is as real as one on C:, and refusing it
        // would mean the export silently skips every entry a lab machine has.
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
        // The importing side recomputes this same list from the same config, so
        // the numbering has to be a function of the reference order alone. A
        // gap here means every later file lands under the wrong member name and
        // every tile after it shows the wrong clip — with no error anywhere,
        // because each member was found and unpacked perfectly.
        let mut cfg = Config::default();
        cfg.gallery = vec![
            entry(WallpaperKind::Video, r"C:\gone\a.mp4"),
            entry(WallpaperKind::Video, r"C:\have\b.mp4"),
        ];
        let exported = plan_bundle(&cfg, &|p| p.contains("have"));
        let imported = plan_for_import(&cfg);
        // Looked up by path, not by position: the two plans are filtered
        // differently — the export side drops the missing file, the import side
        // cannot — so `files[0]` is a different entry in each. The numbering is
        // what has to agree, and it is per-reference.
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
        // And the missing one consumed its index on both sides.
        assert_eq!(
            member_of(&imported, r"C:\gone\a.mp4"),
            "media/0000.mp4",
            "the absent file keeps its slot, or everything after it shifts"
        );
    }

    #[test]
    fn the_import_side_does_not_ask_whether_a_path_exists_here() {
        // The bug this module would otherwise ship: the importing machine does
        // not have the exporting machine's files, so an existence check empties
        // the plan, every member is rejected as unplanned, and the import
        // silently restores a vault of dead paths — which is the exact state
        // the bundle exists to fix.
        let mut cfg = Config::default();
        cfg.gallery = vec![entry(WallpaperKind::Video, r"C:\their-machine\a.mp4")];
        let import_plan = plan_for_import(&cfg);
        assert_eq!(import_plan.files.len(), 1, "a foreign path is still a reference");
        assert!(import_plan.missing.is_empty());
        assert_eq!(import_plan.files[0].member, "media/0000.mp4");
    }

    #[test]
    fn member_names_are_indices_not_original_filenames() {
        // The traversal defence, stated as a test: nothing from the source path
        // reaches the member name.
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
        // A vault entry and the live wallpaper pointing at one file is the
        // normal state, not an edge case. Two members for one file doubles the
        // archive and doubles the unpack.
        let mut cfg = Config::default();
        cfg.gallery = vec![entry(WallpaperKind::Video, r"C:\a.mp4")];
        cfg.wallpaper.kind = WallpaperKind::Video;
        cfg.wallpaper.source = r"C:\a.mp4".into();
        let plan = plan_bundle(&cfg, &|_| true);
        assert_eq!(plan.files.len(), 1);
    }

    #[test]
    fn every_path_bearing_field_is_rewritten() {
        // The bug this guards: restoring the vault but not the wallpaper leaves
        // the most visible thing in the app pointing at another machine while
        // every tile looks fine.
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

        // gallery, wallpaper, per-monitor, scene wallpaper. The scene's own
        // per-monitor map is left empty, so four fields are populated and four
        // must change — counting the five would mean the test is asserting the
        // number it was written from rather than the behaviour.
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
        // Windows paths are case-insensitive and the file is written by
        // whichever machine happened to have the folder spelled differently.
        let mut cfg = Config::default();
        cfg.gallery = vec![entry(WallpaperKind::Video, r"c:\clips\A.MP4")];
        let mut landed = BTreeMap::new();
        landed.insert(r"C:\Clips\a.mp4".to_string(), r"X:\import-g1.mp4".into());
        assert_eq!(rewrite_paths(&mut cfg, &landed), 1);
        assert_eq!(cfg.gallery[0].source, r"X:\import-g1.mp4");
    }

    #[test]
    fn a_source_that_did_not_travel_is_left_alone() {
        // Better a visible broken path than a silent one pointing at nothing.
        let mut cfg = Config::default();
        cfg.gallery = vec![entry(WallpaperKind::Video, r"C:\gone\b.mp4")];
        let mut landed = BTreeMap::new();
        landed.insert(r"C:\a.mp4".to_string(), r"X:\import-g1.mp4".into());
        assert_eq!(rewrite_paths(&mut cfg, &landed), 0);
        assert_eq!(cfg.gallery[0].source, r"C:\gone\b.mp4");
    }

    #[test]
    fn a_traversal_member_name_is_refused() {
        // The whole reason local names are minted from our own index. If these
        // were ever used as destinations, this is the payload.
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
        // The other direction, so the guard is not simply refusing everything.
        // The extensionless case is the one that matters: `extension_of` returns
        // nothing for a file that has no extension, so the exporter really does
        // mint `media/0007` and refusing it here would drop a file that exported
        // cleanly.
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
        // An absolute path in disguise, and a member name we never mint.
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
        // Even a hostile id, which a migrated config can carry.
        let name = local_name("../../evil", ".mp4", &|_| false);
        assert!(!name.contains('/'), "got {name}");
        assert!(!name.contains('\\'), "got {name}");
        assert!(!name.contains(".."), "got {name}");
    }

    #[test]
    fn an_oversized_member_is_refused_before_it_is_read() {
        assert!(check_member_size(1024, 0).is_ok());
        assert!(check_member_size(MAX_MEDIA_BYTES + 1, 0).is_err());
        // And the running total is checked, since many legal files can add up.
        assert!(check_member_size(MAX_MEDIA_BYTES, MAX_BUNDLE_BYTES).is_err());
    }
}