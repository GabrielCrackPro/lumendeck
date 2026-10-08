
use std::io::Read;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

const OPENRGB_VERSION: &str = "1.0";

const OPENRGB_ASSET: &str = "OpenRGB_1.0_Windows_64_81bbe18.zip";

const OPENRGB_SHA256: &str =
    "182a52a3c97c4c4ae52c80286b4260c9666c51c3447dbc416ee8945f66192e90";

pub fn releases_page() -> String {
    "https://github.com/CalcProgrammer1/OpenRGB/releases".to_string()
}

pub fn asset_url() -> String {
    format!(
        "https://github.com/CalcProgrammer1/OpenRGB/releases/download/release_{OPENRGB_VERSION}/{OPENRGB_ASSET}"
    )
}

pub fn version() -> &'static str {
    OPENRGB_VERSION
}

pub fn expected_sha256() -> &'static str {
    OPENRGB_SHA256
}

pub fn install_dir(app_data: &Path) -> PathBuf {
    app_data.join("openrgb")
}

pub fn installed_exe(app_data: &Path) -> Option<PathBuf> {
    let dir = install_dir(app_data);
    let mut found: Vec<(PathBuf, u64)> = Vec::new();
    collect_exes(&dir, &dir, &mut found, 0);
    find_exe(&dir, found)
}

const MAX_SCAN_DEPTH: usize = 4;

fn collect_exes(root: &Path, dir: &Path, out: &mut Vec<(PathBuf, u64)>, depth: usize) {
    if depth > MAX_SCAN_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_symlink() {
            continue;
        }
        if meta.is_dir() {
            collect_exes(root, &path, out, depth + 1);
            continue;
        }
        if !meta.is_file() {
            continue;
        }
        let Ok(rel) = path.strip_prefix(root) else { continue };
        out.push((rel.to_path_buf(), meta.len()));
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn checksum_matches(bytes: &[u8], expected: &str) -> bool {
    sha256_hex(bytes).eq_ignore_ascii_case(expected)
}

pub fn find_exe(root: &Path, names: impl IntoIterator<Item = (PathBuf, u64)>) -> Option<PathBuf> {
    names
        .into_iter()
        .filter(|(_, size)| *size > 0)
        .filter(|(path, _)| {
            path.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.eq_ignore_ascii_case("OpenRGB.exe"))
                .unwrap_or(false)
        })
        .min_by_key(|(path, _)| path.components().count())
        .map(|(path, _)| root.join(path))
}

pub fn extract(bytes: &[u8], dest: &Path) -> Result<PathBuf, String> {
    let reader = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(crate::error::err_str)?;

    let mut entries: Vec<(PathBuf, u64)> = Vec::new();
    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(crate::error::err_str)?;
        let name = file.mangled_name();
        if !is_within(dest, &name) {
            return Err(format!("archive entry escapes the install folder: {}", name.display()));
        }
        entries.push((name, file.size()));
    }

    std::fs::create_dir_all(dest).map_err(crate::error::err_str)?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(crate::error::err_str)?;
        let name = file.mangled_name();
        let out = dest.join(&name);
        if file.is_dir() {
            std::fs::create_dir_all(&out).map_err(crate::error::err_str)?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(crate::error::err_str)?;
        }
        let mut bytes_out = Vec::with_capacity(file.size() as usize);
        file.read_to_end(&mut bytes_out).map_err(crate::error::err_str)?;
        std::fs::write(&out, bytes_out).map_err(crate::error::err_str)?;
    }

    find_exe(dest, entries).ok_or_else(|| "the archive did not contain OpenRGB.exe".to_string())
}

fn is_within(base: &Path, name: &Path) -> bool {
    if name.as_os_str().is_empty() {
        return false;
    }
    if !name
        .components()
        .all(|c| matches!(c, std::path::Component::Normal(_)))
    {
        return false;
    }
    base.join(name).starts_with(base)
}

pub async fn download_and_install(app_data: &Path) -> Result<PathBuf, String> {
    let url = asset_url();
    let resp = reqwest::get(&url).await.map_err(|e| format!("could not reach GitHub: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("download was interrupted: {e}"))?;

    if !checksum_matches(&bytes, expected_sha256()) {
        return Err("the download does not match the expected checksum".into());
    }

    extract(&bytes, &install_dir(app_data))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pinned_asset_and_its_digest_agree() {
        assert!(
            OPENRGB_ASSET.starts_with(&format!("OpenRGB_{OPENRGB_VERSION}_Windows_64")),
            "asset name does not match the pinned version"
        );
        assert_eq!(expected_sha256().len(), 64);
        assert!(expected_sha256().chars().all(|c| c.is_ascii_hexdigit()));
        assert!(asset_url().ends_with(OPENRGB_ASSET));
        assert!(asset_url().contains(&format!("release_{OPENRGB_VERSION}")));
    }

    #[test]
    fn checksum_is_computed_and_compared() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert!(checksum_matches(b"", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
        assert!(checksum_matches(b"abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
        assert!(!checksum_matches(b"abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ae"));
    }

    #[test]
    fn checksum_comparison_ignores_case_because_github_publishes_lowercase() {
        let lower = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assert!(checksum_matches(b"abc", &lower.to_ascii_uppercase()));
    }

    #[test]
    fn the_executable_is_found_wherever_the_archive_put_it() {
        let root = Path::new("C:/x");
        assert_eq!(
            find_exe(
                root,
                vec![
                    (PathBuf::from("OpenRGB/OpenRGB.ini"), 10),
                    (PathBuf::from("OpenRGB/OpenRGB.exe"), 900),
                ]
            ),
            Some(PathBuf::from("C:/x/OpenRGB/OpenRGB.exe"))
        );
        assert_eq!(
            find_exe(root, vec![(PathBuf::from("OpenRGB.exe"), 900)]),
            Some(PathBuf::from("C:/x/OpenRGB.exe"))
        );
    }

    #[test]
    fn a_zero_length_entry_is_not_mistaken_for_the_binary() {
        assert_eq!(
            find_exe(Path::new("C:/x"), vec![(PathBuf::from("OpenRGB.exe"), 0)]),
            None
        );
    }

    #[test]
    fn the_shallowest_copy_wins() {
        let root = Path::new("C:/x");
        assert_eq!(
            find_exe(
                root,
                vec![
                    (PathBuf::from("docs/OpenRGB.exe"), 10),
                    (PathBuf::from("OpenRGB.exe"), 10),
                ]
            ),
            Some(PathBuf::from("C:/x/OpenRGB.exe"))
        );
    }

    #[test]
    fn the_executable_name_is_matched_case_insensitively() {
        assert!(find_exe(Path::new("C:/x"), vec![(PathBuf::from("openrgb.EXE"), 10)]).is_some());
    }

    #[test]
    fn no_executable_is_an_error_not_a_guess() {
        assert_eq!(find_exe(Path::new("C:/x"), vec![(PathBuf::from("readme.txt"), 10)]), None);
    }

    #[test]
    fn an_archive_entry_cannot_write_outside_the_install_folder() {
        let base = Path::new("C:/x");
        assert!(!is_within(base, Path::new("../evil.exe")));
        assert!(!is_within(base, Path::new("a/../../evil.exe")));
        assert!(!is_within(base, Path::new("..")));
        assert!(is_within(base, Path::new("OpenRGB/OpenRGB.exe")));
        assert!(is_within(base, Path::new("OpenRGB.exe")));
    }

    #[test]
    fn a_backslash_traversal_is_rejected_too() {
        let base = Path::new("C:/x");
        assert!(!is_within(base, Path::new(r"..\evil.exe")));
        assert!(!is_within(base, Path::new(r"OpenRGB\..\..\evil.exe")));
        assert!(is_within(base, Path::new(r"OpenRGB\OpenRGB.exe")));
    }

    #[test]
    fn an_absolute_or_drive_qualified_entry_is_rejected() {
        let base = Path::new("C:/x");
        assert!(!is_within(base, Path::new(r"C:\Windows\System32\evil.exe")));
        assert!(!is_within(base, Path::new(r"\evil.exe")));
        assert!(!is_within(base, Path::new("")));
    }

    #[test]
    fn an_unpacked_install_is_found_wherever_the_binary_landed() {
        let root = std::env::temp_dir().join(format!(
            "lumendeck-openrgb-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let app = root.join("data");
        let _ = std::fs::remove_dir_all(&root);
        let nested = install_dir(&app).join("OpenRGB");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("OpenRGB.exe"), b"MZ").unwrap();
        std::fs::write(nested.join("OpenRGB.ini"), b"[x]").unwrap();

        assert_eq!(
            installed_exe(&app),
            Some(nested.join("OpenRGB.exe")),
            "a working install must not be reported as missing"
        );

        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&install_dir(&app)).unwrap();
        std::fs::write(install_dir(&app).join("OpenRGB.exe"), b"MZ").unwrap();
        assert_eq!(
            installed_exe(&app),
            Some(install_dir(&app).join("OpenRGB.exe"))
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_missing_or_empty_install_reports_nothing() {
        let root = std::env::temp_dir().join(format!(
            "lumendeck-openrgb-empty-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let app = root.join("data");
        assert_eq!(installed_exe(&app), None, "no install folder is not an install");

        std::fs::create_dir_all(&install_dir(&app)).unwrap();
        std::fs::write(install_dir(&app).join("OpenRGB.exe"), b"").unwrap();
        assert_eq!(installed_exe(&app), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn installs_into_its_own_folder_rather_than_beside_the_config() {
        let dir = install_dir(Path::new("C:/data/LumenDeck"));
        assert!(dir.ends_with("openrgb"));
        assert!(dir.starts_with("C:/data/LumenDeck"));
    }
}