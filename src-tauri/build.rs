use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    let attrs = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    tauri_build::try_build(attrs)
        .expect("failed to run tauri-build");

    stamp_build_identity();

    #[cfg(windows)]
    embed_manifest();
}

#[cfg(windows)]
fn embed_manifest() {
    let manifest = Path::new("windows/lumendeck.manifest");
    assert!(
        manifest.exists(),
        "missing {} — the notification plugin cannot start without it",
        manifest.display()
    );
    println!("cargo:rerun-if-changed=windows/lumendeck.manifest");

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));

    let staged_manifest = out_dir.join("lumendeck.manifest");
    let rc = out_dir.join("lumendeck.rc");
    let res = out_dir.join("lumendeck_manifest.res");

    let copy = || -> Result<(), String> {
        std::fs::copy(manifest, &staged_manifest)
            .map(|_| ())
            .map_err(|e| format!("copying manifest to OUT_DIR: {e}"))
    };
    if let Err(e) = copy() {
        panic!("{e}");
    }

    let rc_body = "1 24 \"lumendeck.manifest\"\r\n";
    if let Err(e) = std::fs::write(&rc, rc_body) {
        panic!("writing {}: {e}", rc.display());
    }

    let rc_exe = sdk_tool("rc.exe")
        .unwrap_or_else(|| panic!("no rc.exe found; set RC to its path"));

    let status = Command::new(&rc_exe)
        .arg("-fo")
        .arg(&res)
        .arg(&rc)
        .status()
        .unwrap_or_else(|e| panic!("running {}: {e}", rc_exe.display()));
    if !status.success() {
        panic!("{} exited with {status}", rc_exe.display());
    }

    println!("cargo:rustc-link-arg={}", res.display());
}

#[cfg(windows)]
fn sdk_tool(tool: &str) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("RC") {
        let p = PathBuf::from(p);
        if p.exists() {
            return Some(p);
        }
    }
    let roots = [
        r"C:\Program Files (x86)\Windows Kits\10\bin",
        r"C:\Program Files\Windows Kits\10\bin",
    ];
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        let mut best: Option<(Vec<u32>, PathBuf)> = None;
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let Some(version) = name.strip_prefix("10.") else {
                continue;
            };
            let parts: Vec<u32> = version.split('.').map(|p| p.parse().unwrap_or(0)).collect();
            let cand = e.path().join("x64").join(tool);
            if !cand.exists() {
                continue;
            }
            if best.as_ref().is_none_or(|(b, _)| parts > *b) {
                best = Some((parts, cand));
            }
        }
        if let Some((_, path)) = best {
            return Some(path);
        }
    }
    None
}

fn stamp_build_identity() {
    declare_rerun_paths();

    let sha = git(&["rev-parse", "--short", "HEAD"]);
    let dirty = !git(&["status", "--porcelain"]).unwrap_or_default().is_empty();

    let identity = match (sha, dirty) {
        (Some(sha), true) => Some(format!("{sha}-dirty")),
        (Some(sha), false) => Some(sha),
        (None, _) => None,
    };

    println!(
        "cargo:rustc-env=LUMENDECK_BUILD_ID={}",
        identity.as_deref().unwrap_or("unknown")
    );
    println!("cargo:rustc-env=LUMENDECK_BUILD_DIRTY={dirty}");
}

fn declare_rerun_paths() {
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=../.git/HEAD");
    if let Some(reference) = git(&["symbolic-ref", "HEAD"]) {
        println!("cargo:rerun-if-changed=../.git/{reference}");
    }
}

fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8(out.stdout).ok()?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}
