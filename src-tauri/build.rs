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