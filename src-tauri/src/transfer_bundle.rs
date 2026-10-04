// Writing and reading the bundle itself: a zip around the JSON envelope.
//
// The decisions are in `transfer_archive.rs`; this is the part that touches the
// disk, and it exists separately so the interesting half stays testable without
// a filesystem. Three rules hold throughout:
//
// * **Nothing a zip says becomes a path.** Every member name read here is
//   checked by `is_media_member` before it is compared against, and every
//   destination is built from `local_name`. A zip is attacker-authored data —
//   `../../Windows/System32` is a legal member name and the crate will hand it
//   back without complaint.
// * **Unpack to a temp file, then move into place.** A media file that fails
//   halfway leaves a truncated file that looks like a valid one; the wallpaper
//   loads it, shows a black frame, and the user blames the import.
// * **A config import replaces, so the old vault's files are not deleted.** They
//   were not ours to delete and the user may have exported them a moment ago.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};


use super::transfer_archive::{
    self, BundlePlan, PlannedFile, CONFIG_ENTRY, MAX_MEDIA_BYTES,
};

/// Write a bundled export: the envelope plus every planned file.
///
/// The JSON goes in first so a reader that finds a truncated archive still gets
/// a parse error rather than a file with no metadata in it.
pub fn write_bundle(
    path: &Path,
    json: &str,
    files: &[PlannedFile],
    missing: &[String],
) -> Result<(), String> {
    let file = std::fs::File::create(path).map_err(crate::error::err_str)?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    zip.start_file(CONFIG_ENTRY, opts)
        .map_err(crate::error::err_str)?;
    zip.write_all(json.as_bytes()).map_err(crate::error::err_str)?;

    for planned in files {
        // Re-checked at write time, not only at plan time: the plan may have
        // been made before the file was deleted, and a member promised but not
        // written is an import that fails a day later on someone else's machine.
        match std::fs::metadata(&planned.source) {
            Ok(m) if m.is_file() && m.len() <= MAX_MEDIA_BYTES => {}
            Ok(_) => {
                return Err(format!(
                    "{} is too large to include in a backup",
                    planned.source.display()
                ))
            }
            Err(e) => return Err(format!("could not read {}: {e}", planned.source.display())),
        }
        zip.start_file(planned.member.as_str(), opts)
            .map_err(crate::error::err_str)?;
        let bytes = std::fs::read(&planned.source).map_err(crate::error::err_str)?;
        zip.write_all(&bytes).map_err(crate::error::err_str)?;
    }

    if !missing.is_empty() {
        // Recorded rather than dropped. An export that silently omits four
        // files reads as a complete backup, and the omission is discovered on
        // the other machine.
        zip.start_file("missing.txt", opts)
            .map_err(crate::error::err_str)?;
        for path in missing {
            writeln!(zip, "{path}").map_err(crate::error::err_str)?;
        }
    }

    zip.finish().map_err(crate::error::err_str)?;
    Ok(())
}

/// Read the envelope out of a bundle without unpacking anything.
///
/// What a preview needs: what kind of file this is and what it would do. It
/// must not write to disk, so a user who is only looking at a summary does not
/// leave a gigabyte of media behind.
pub fn read_envelope(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(crate::error::err_str)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("could not open the bundle: {e}"))?;
    let mut json = String::new();
    archive
        .by_name(CONFIG_ENTRY)
        .map_err(|_| "the bundle has no configuration in it".to_string())?
        .read_to_string(&mut json)
        .map_err(crate::error::err_str)?;
    Ok(json)
}

/// How many media files a bundle carries, without unpacking.
pub fn count_media(path: &Path) -> Result<usize, String> {
    let file = std::fs::File::open(path).map_err(crate::error::err_str)?;
    let archive = zip::ZipArchive::new(file).map_err(|e| format!("could not open the bundle: {e}"))?;
    Ok(archive
        .file_names()
        .filter(|n| transfer_archive::is_media_member(n))
        .count())
}

/// What an unpack put on disk, and the map that reconnects the config to it.
#[derive(Debug, Default)]
pub struct Unpacked {
    /// Exporting-machine path -> path on this machine.
    pub landed: BTreeMap<String, String>,
    /// Members named in the archive but not in the plan, which is a malformed
    /// bundle rather than a missing file.
    pub rejected: usize,
    /// Bytes written, for the log line.
    pub bytes: u64,
}

/// Unpack every media member into `media_dir`, returning the path mapping.
///
/// Written before the config is replaced, because a config pointing at files
/// that were never written is worse than a failed import: the vault looks whole
/// and every tile is broken.
pub fn unpack_media(
    bundle: &Path,
    media_dir: &Path,
    plan: &BundlePlan,
    id_for: &dyn Fn(&str) -> String,
) -> Result<Unpacked, String> {
    std::fs::create_dir_all(media_dir).map_err(crate::error::err_str)?;
    let file = std::fs::File::open(bundle).map_err(crate::error::err_str)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("could not open the bundle: {e}"))?;
    let mut out = Unpacked::default();

    let planned_by_member: BTreeMap<&str, &PlannedFile> = plan
        .files
        .iter()
        .map(|p| (p.member.as_str(), p))
        .collect();

    let names: Vec<String> = archive.file_names().map(|n| n.to_string()).collect();
    for name in names {
        if name == CONFIG_ENTRY || name == "missing.txt" {
            continue;
        }
        if !transfer_archive::is_media_member(&name) {
            // A member we did not write. Counted and skipped; never used as a
            // path, which is the entire point of the check.
            out.rejected += 1;
            continue;
        }
        let Some(planned) = planned_by_member.get(name.as_str()) else {
            // Ours by shape but not in the plan: the config will not reference
            // it, so writing it would put a file on disk with no owner.
            out.rejected += 1;
            continue;
        };
        let mut entry = archive
            .by_name(&name)
            .map_err(crate::error::err_str)?;
        let size = entry.size();
        transfer_archive::check_member_size(size, out.bytes)?;

        let ext = Path::new(&name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default();
        let id = id_for(&planned.source.to_string_lossy());
        let target: PathBuf = media_dir.join(transfer_archive::local_name(&id, ext, &|n| {
            media_dir.join(n).exists()
        }));

        // Temp then move, so a failure cannot leave a truncated file wearing
        // the name of a real one.
        let tmp = target.with_extension("part");
        let mut buf = Vec::with_capacity(size as usize);
        entry.read_to_end(&mut buf).map_err(crate::error::err_str)?;
        std::fs::write(&tmp, &buf).map_err(crate::error::err_str)?;
        std::fs::rename(&tmp, &target).map_err(crate::error::err_str)?;

        out.landed.insert(
            planned.source.to_string_lossy().to_string(),
            target.to_string_lossy().to_string(),
        );
        out.bytes += buf.len() as u64;
    }
    Ok(out)
}

/// Unpack a bundle the way an import does, given the config it carries.
///
/// Exists so the command and the tests share one path. The step that matters —
/// numbering the references *without* asking whether they exist here — is the
/// one that silently emptied the plan when it was done wrong, and it was only
/// ever exercised through the command's own copy of the logic, which no test
/// reached.
pub fn restore_bundle(
    bundle: &Path,
    media_dir: &Path,
    incoming: &crate::config::Config,
    id_for: &dyn Fn(&str) -> String,
) -> Result<Unpacked, String> {
    let plan = crate::transfer_archive::plan_for_import(incoming);
    let unpacked = unpack_media(bundle, media_dir, &plan, id_for)?;
    Ok(unpacked)
}

/// The files an archive says it did not carry, if it recorded any.
pub fn read_missing(bundle: &Path) -> Vec<String> {
    let Ok(file) = std::fs::File::open(bundle) else {
        return Vec::new();
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return Vec::new();
    };
    let Ok(mut entry) = archive.by_name("missing.txt") else {
        return Vec::new();
    };
    let mut text = String::new();
    if entry.read_to_string(&mut text).is_err() {
        return Vec::new();
    }
    text.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, GalleryEntry, WallpaperKind};
    use crate::transfer_archive::plan_bundle;

    /// A throwaway directory that cleans itself up, so a failing test does not
    /// leave media behind for the next one to trip over.
    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "lumendeck-bundle-test-{}-{name}",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&p);
            std::fs::create_dir_all(&p).unwrap();
            Self(p)
        }
        fn join(&self, n: &str) -> PathBuf {
            self.0.join(n)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn entry(kind: WallpaperKind, source: &str) -> GalleryEntry {
        GalleryEntry {
            id: "g1".into(),
            name: "clip".into(),
            kind,
            source: source.into(),
            added_ms: 0,
            thumb: None,
            opts: None,
            favorite: false,
            last_applied_ms: None,
        }
    }

    /// Build a bundle from real files on disk, returning the path and the plan.
    fn export_fixture(
        dir: &TempDir,
        cfg: &Config,
    ) -> (PathBuf, crate::transfer_archive::BundlePlan) {
        let plan = plan_bundle(cfg, &|p| Path::new(p).is_file());
        let zip = dir.join("export.zip");
        let json = crate::transfer::to_json(&crate::transfer::build_export(
            crate::transfer::TransferKind::Config,
            cfg,
            "0.2.33",
            &cfg.scenes,
        ));
        write_bundle(&zip, &json, &plan.files, &plan.missing).unwrap();
        (zip, plan)
    }

    #[test]
    fn a_bundled_media_file_survives_a_real_round_trip() {
        // The whole point of the format, end to end: bytes out, bytes back, and
        // the config pointing at the copy on this machine rather than at the
        // exporting machine's path.
        let dir = TempDir::new("roundtrip");
        let clip = dir.join("source.mp4");
        std::fs::write(&clip, b"pretend this is a video").unwrap();
        let source = clip.to_string_lossy().to_string();

        let mut cfg = Config::default();
        cfg.gallery = vec![entry(WallpaperKind::Video, &source)];
        cfg.wallpaper.kind = WallpaperKind::Video;
        cfg.wallpaper.source = source.clone();

        let (zip, plan) = export_fixture(&dir, &cfg);
        assert_eq!(plan.files.len(), 1);
        assert_eq!(count_media(&zip).unwrap(), 1);

        let out_dir = TempDir::new("roundtrip-out");
        let unpacked = unpack_media(&zip, &out_dir.0, &plan, &|src| {
            assert_eq!(src, source);
            "g1".to_string()
        })
        .unwrap();
        assert_eq!(unpacked.landed.len(), 1);
        assert_eq!(unpacked.rejected, 0);

        let mut incoming = cfg.clone();
        let n = transfer_archive::rewrite_paths(&mut incoming, &unpacked.landed);
        assert_eq!(n, 2, "the vault entry and the live wallpaper");
        assert_ne!(incoming.gallery[0].source, source, "must not keep the old path");
        assert!(
            Path::new(&incoming.gallery[0].source).is_file(),
            "must point at a real file"
        );
        assert_eq!(
            std::fs::read(&incoming.gallery[0].source).unwrap(),
            b"pretend this is a video",
            "the bytes must actually arrive"
        );
        assert_eq!(incoming.wallpaper.source, incoming.gallery[0].source);
    }

    #[test]
    fn a_bundle_with_no_media_is_still_a_valid_export() {
        // Shader-only and web-only configs are ordinary. The format must not
        // require a file to be exportable.
        let dir = TempDir::new("nomedia");
        let mut cfg = Config::default();
        cfg.wallpaper.kind = WallpaperKind::Shader;
        cfg.wallpaper.source = "aurora".into();
        cfg.gallery = vec![entry(WallpaperKind::Web, "https://x.test/a.mp4")];
        let (zip, plan) = export_fixture(&dir, &cfg);
        assert!(plan.files.is_empty());
        assert_eq!(count_media(&zip).unwrap(), 0);
        // And it still parses as an export, which is all an import needs.
        let envelope = read_envelope(&zip).unwrap();
        assert!(crate::transfer::parse_export(&envelope).is_ok());
    }

    #[test]
    fn a_traversal_member_in_a_hostile_bundle_never_reaches_the_disk() {
        // The attack this format has to survive: a zip is data a stranger can
        // author, and the crate hands back whatever name is in it.
        let dir = TempDir::new("hostile");
        let zip = dir.join("evil.zip");
        {
            let f = std::fs::File::create(&zip).unwrap();
            let mut w = zip::ZipWriter::new(f);
            let opts = zip::write::SimpleFileOptions::default();
            for name in [
                "media/../../../../evil-escape.mp4",
                "media/0000.mp4",
                "/absolute/evil.mp4",
            ] {
                w.start_file(name, opts).unwrap();
                w.write_all(b"payload").unwrap();
            }
            w.start_file(transfer_archive::CONFIG_ENTRY, opts)
                .unwrap();
            w.write_all(b"{}").unwrap();
            w.finish().unwrap();
        }

        let plan = crate::transfer_archive::BundlePlan {
            files: vec![crate::transfer_archive::PlannedFile {
                source: dir.join("ok.mp4"),
                member: "media/0000.mp4".into(),
            }],
            missing: Vec::new(),
        };
        let out = TempDir::new("hostile-out");
        let unpacked = unpack_media(&zip, &out.0, &plan, &|_| "g1".into()).unwrap();

        // Two of the three were refused, one was ours, nothing escaped.
        assert_eq!(unpacked.rejected, 2);
        assert_eq!(unpacked.landed.len(), 1);
        let landed = unpacked.landed.values().next().unwrap();
        assert!(
            Path::new(landed).starts_with(&out.0),
            "must land inside the media dir"
        );
        assert!(!out.0.join("evil-escape.mp4").exists());
        assert!(!dir.0.join("evil-escape.mp4").exists());
    }

    #[test]
    fn an_unplanned_member_is_refused_rather_than_written_orphaned() {
        // A member shaped like ours but not in the plan has no config entry
        // pointing at it, and a file nothing can reference is worse than none.
        let dir = TempDir::new("orphan");
        let zip = dir.join("extra.zip");
        {
            let f = std::fs::File::create(&zip).unwrap();
            let mut w = zip::ZipWriter::new(f);
            let opts = zip::write::SimpleFileOptions::default();
            w.start_file("media/0009.mp4", opts).unwrap();
            w.write_all(b"payload").unwrap();
            w.start_file(transfer_archive::CONFIG_ENTRY, opts)
                .unwrap();
            w.write_all(b"{}").unwrap();
            w.finish().unwrap();
        }
        let out = TempDir::new("orphan-out");
        let plan = crate::transfer_archive::BundlePlan::default();
        let unpacked = unpack_media(&zip, &out.0, &plan, &|_| "g1".into()).unwrap();
        assert_eq!(unpacked.rejected, 1);
        assert!(unpacked.landed.is_empty());
    }

    #[test]
    fn a_bundle_restored_on_a_machine_that_has_none_of_the_files_still_works() {
        // The real scenario, and the one every other test here missed: export on
        // one machine, import on another where none of the exporting machine's
        // paths resolve. If the import side asks whether those paths exist it
        // concludes they do not, the plan comes back empty, every member is
        // rejected as unplanned, and the vault is restored as a list of dead
        // paths — silently, with no error anywhere.
        let export_dir = TempDir::new("xfer-src");
        let clip = export_dir.join("clip.mp4");
        std::fs::write(&clip, b"the bytes").unwrap();

        // Pretend the config was authored on another computer, which is what the
        // exported file will say once read back.
        let foreign = PathBuf::from(r"Z:\somebody-elses-laptop\clips\clip.mp4");
        let mut exported = Config::default();
        exported.gallery = vec![entry(WallpaperKind::Video, &foreign.to_string_lossy())];
        exported.wallpaper.kind = WallpaperKind::Video;
        exported.wallpaper.source = foreign.to_string_lossy().to_string();

        // Export side. On the exporting machine its config references its own
        // real path; the member name is decided by that reference, and the
        // bytes come from that file. Simulated by taking the name from the
        // foreign-path plan and the bytes from the local file.
        let export_plan = transfer_archive::plan_for_import(&exported);
        assert_eq!(export_plan.files[0].member, "media/0000.mp4");
        let write_plan = crate::transfer_archive::BundlePlan {
            files: vec![crate::transfer_archive::PlannedFile {
                source: clip.clone(),
                member: export_plan.files[0].member.clone(),
            }],
            missing: Vec::new(),
        };
        let zip = export_dir.join("export.zip");
        let json = crate::transfer::to_json(&crate::transfer::build_export(
            crate::transfer::TransferKind::Config,
            &exported,
            "0.2.33",
            &exported.scenes,
        ));
        write_bundle(&zip, &json, &write_plan.files, &write_plan.missing).unwrap();
        assert_eq!(count_media(&zip).unwrap(), 1, "one member travelled");

        // Import side: reads the envelope back, so the config now carries the
        // foreign path, and unpacks on a machine where it does not exist.
        let envelope = read_envelope(&zip).unwrap();
        let incoming_cfg = crate::transfer::parse_export(&envelope)
            .unwrap()
            .config
            .unwrap();
        assert!(
            !Path::new(&incoming_cfg.gallery[0].source).is_file(),
            "the imported path must not be a real file here, or the test proves nothing"
        );

        // The command's own path, not a hand-assembled one. A test that rebuilt the
        // plan itself would keep passing while the command stayed broken, which
        // is precisely what happened the first time round.
        let out = TempDir::new("xfer-dst");
        let by_source: std::collections::HashMap<&str, &str> = incoming_cfg
            .gallery
            .iter()
            .map(|g| (g.source.as_str(), g.id.as_str()))
            .collect();
        let unpacked = restore_bundle(&zip, &out.0, &incoming_cfg, &|src| {
            by_source
                .get(src)
                .map(|id| (*id).to_string())
                .unwrap_or_else(|| "unknown".to_string())
        })
        .unwrap();

        assert_eq!(unpacked.rejected, 0, "nothing should be refused");
        assert_eq!(unpacked.landed.len(), 1, "the member must land");
        let mut restored = incoming_cfg.clone();
        assert_eq!(
            transfer_archive::rewrite_paths(&mut restored, &unpacked.landed),
            2
        );
        assert!(Path::new(&restored.gallery[0].source).is_file());
        assert_eq!(
            std::fs::read(&restored.gallery[0].source).unwrap(),
            b"the bytes"
        );
    }

    #[test]
    fn files_the_exporter_could_not_find_are_recorded_not_dropped() {
        // An export that silently omits four files reads as a complete backup,
        // and the omission is discovered on the other machine, one tile at a
        // time. The bundle says so itself.
        let dir = TempDir::new("missing");
        let mut cfg = Config::default();
        cfg.gallery = vec![entry(WallpaperKind::Video, r"C:\gone\a.mp4")];
        let (zip, plan) = export_fixture(&dir, &cfg);
        assert!(plan.files.is_empty());
        assert_eq!(plan.missing.len(), 1);
        assert_eq!(read_missing(&zip), vec![r"C:\gone\a.mp4".to_string()]);
    }

    #[test]
    fn two_entries_sharing_one_file_share_the_one_unpacked_copy() {
        // The exporter bundles once, and the importer writes once. Two tiles
        // for one clip is a legitimate vault state; two copies of the file is
        // not, since deleting one would orphan the other.
        let dir = TempDir::new("shared");
        let clip = dir.join("shared.mp4");
        std::fs::write(&clip, b"bytes").unwrap();
        let source = clip.to_string_lossy().to_string();

        let mut cfg = Config::default();
        let mut second = entry(WallpaperKind::Video, &source);
        second.id = "g2".into();
        cfg.gallery = vec![entry(WallpaperKind::Video, &source), second];

        let (zip, plan) = export_fixture(&dir, &cfg);
        assert_eq!(plan.files.len(), 1, "bundled once");
        assert_eq!(count_media(&zip).unwrap(), 1);

        let out = TempDir::new("shared-out");
        let by_source: std::collections::HashMap<&str, &str> = cfg
            .gallery
            .iter()
            .map(|g| (g.source.as_str(), g.id.as_str()))
            .collect();
        let unpacked = unpack_media(&zip, &out.0, &plan, &|src| {
            by_source
                .get(src)
                .map(|id| (*id).to_string())
                .unwrap_or_else(|| "unknown".to_string())
        })
        .unwrap();
        assert_eq!(unpacked.landed.len(), 1, "one file, one landing");

        // Both entries resolve to it, which is correct: it is the same clip.
        let mut incoming = cfg.clone();
        assert_eq!(
            transfer_archive::rewrite_paths(&mut incoming, &unpacked.landed),
            2
        );
        assert_eq!(incoming.gallery[0].source, incoming.gallery[1].source);
        assert!(Path::new(&incoming.gallery[0].source).is_file());
    }
}