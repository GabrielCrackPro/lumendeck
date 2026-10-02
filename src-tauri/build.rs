use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    // Tauri's default Windows manifest already declares Common Controls v6, so
    // the app binary was never the problem. Suppressing it anyway, because two
    // manifests mean two type-24 id-1 resources and the linker rejects that as
    // a duplicate (CVT1100). Ours carries the same dependency plus the DPI
    // awareness settings this app needs.
    let attrs = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    tauri_build::try_build(attrs)
        .expect("failed to run tauri-build");

    stamp_build_identity();

    // Windows only: this shells out to the SDK's resource compiler.
    #[cfg(windows)]
    embed_manifest();
}

/// Embed the Common Controls v6 manifest into every binary this package
/// produces — the app, and just as importantly the `cargo test` harness.
///
/// `tauri-winres` already embeds a manifest for the app binary, which is why
/// the app always ran. The test binary is built by cargo-test through a
/// different path and got none, and that is where this bit: the notification
/// plugin pulls in `TaskDialogIndirect` via `tauri-winrt-notification`, and
/// Windows ships that symbol only in comctl32 v6, which is reachable solely
/// through a declared manifest dependency. System32 holds v5 (5.82), which has
/// no such export, so the loader failed the process at start with
/// STATUS_ENTRYPOINT_NOT_FOUND.
///
/// The manifest below therefore replaces Tauri's (see `main`), and is applied to
/// every target so the app and the test harness cannot disagree.
///
/// Why rc.exe and not the usual embed-resource crate: `embed-resource` inlines
/// XML as string literals into a .rc script, and RC.EXE then rejects it as a
/// manifest. The `.rc` indirection below is what the Windows toolchain
/// actually expects — a resource *file* reference, type 24 (RT_MANIFEST),
/// id 1.
///
/// Failure here is fatal on purpose. A missing manifest is the difference
/// between an app that starts and one that dies before `main`, and the second
/// is silent and baffling at runtime. Failing loudly at build time is kinder.
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

    // rc.exe resolves a quoted resource path relative to the .rc file's own
    // directory, so both files are staged into OUT_DIR together.
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

    // RT_MANIFEST (24), resource id 1. That pairing is what the Windows loader
    // looks for when deciding which manifest applies to the process.
    let rc_body = "1 24 \"lumendeck.manifest\"\r\n";
    if let Err(e) = std::fs::write(&rc, rc_body) {
        panic!("writing {}: {e}", rc.display());
    }

    let rc_exe = sdk_tool("rc.exe")
        .unwrap_or_else(|| panic!("no rc.exe found; set RC to its path"));

    let status = Command::new(&rc_exe)
        // `-` switches, not `/`: Git Bash rewrites a leading slash into a path.
        .arg("-fo")
        .arg(&res)
        .arg(&rc)
        .status()
        .unwrap_or_else(|e| panic!("running {}: {e}", rc_exe.display()));
    if !status.success() {
        panic!("{} exited with {status}", rc_exe.display());
    }

    // Hand the compiled resource to the linker. It must come after the object
    // files or the loader will not find the manifest resource.
    println!("cargo:rustc-link-arg={}", res.display());
}

/// Find a tool in the highest-versioned Windows SDK on this machine.
///
/// Lexical sorting is wrong here — "10.0.9" sorts above "10.0.26100" — so the
/// version is compared numerically. `RC` in the environment overrides the
/// search, for a machine whose SDK lives somewhere unusual.
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

/// Bake the source revision into the binary, so it can report which build it is.
///
/// The version alone cannot answer that. Every working build between two releases
/// carries the same version number, so a bug report saying "0.2.7" is ambiguous:
/// it does not distinguish a shipped installer from a build of a branch that
/// happens to sit at 0.2.7.
///
/// The dirty flag matters as much as the SHA here, because this repository's
/// development pattern is a long-running uncommitted working tree. A bare SHA
/// reports the same commit for every local build regardless of what has changed on
/// top of it, which is precisely the ambiguity being removed.
///
/// Failure is non-fatal. A build from an exported tarball has no git directory, and
/// refusing to compile there would be worse than reporting "unknown".
fn stamp_build_identity() {
    declare_rerun_paths();

    let sha = git(&["rev-parse", "--short", "HEAD"]);
    let dirty = !git(&["status", "--porcelain"]).unwrap_or_default().is_empty();

    // A dirty tree is the interesting case, so it has to be distinguishable at a
    // glance rather than inferred from the surrounding commit message.
    let identity = match (sha, dirty) {
        (Some(sha), true) => Some(format!("{sha}-dirty")),
        (Some(sha), false) => Some(sha),
        (None, _) => None,
    };

    println!(
        "cargo:rustc-env=LUMENDECK_BUILD_ID={}",
        identity.as_deref().unwrap_or("unknown")
    );
    // Also separate, so the UI can say it in words rather than only in a suffix.
    println!("cargo:rustc-env=LUMENDECK_BUILD_DIRTY={dirty}");
}

/// Tell cargo when to run this script again.
///
/// The default is "whenever any file in the package changes", but a single
/// `rerun-if-changed` anywhere in a build script replaces that default with an
/// explicit list — and `embed_manifest` already emits one for the manifest. So
/// without this, the identity is frozen at the first build: commit something, or
/// switch branches, and the badge keeps naming a build that no longer exists.
/// That is worse than having no badge, because it is confidently wrong.
///
/// The git metadata is watched directly because a commit does not have to change
/// a file to move HEAD, and `.git/HEAD` alone only catches a branch switch, not a
/// commit on the current branch — hence the ref file as well. In a worktree or a
/// repo with packed refs these paths may not exist, which is harmless: cargo
/// simply never sees them change, and a missing `.git` means the values above are
/// "unknown" regardless.
fn declare_rerun_paths() {
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=../.git/HEAD");
    if let Some(reference) = git(&["symbolic-ref", "HEAD"]) {
        println!("cargo:rerun-if-changed=../.git/{reference}");
    }
}

/// Run a git command in the workspace, returning trimmed stdout.
///
/// Never panics and never inherits stderr: a missing git on a build agent is
/// normal, not a reason to fail the build.
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
