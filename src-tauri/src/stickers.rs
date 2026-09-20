//! Stickers: windowless overlays rendered *inside* the wallpaper webview.
//! This module only owns config management (add/update/remove) — the drawing
//! happens in `src/wallpaper/main.tsx`, and placement clicks arrive via the
//! global mouse hook (`mouse_hook.rs`). No per-sticker windows exist.

use crate::config::StickerDef;
use crate::events;

/// Replace the sticker list, persist, and broadcast.
pub fn replace_all(stickers: Vec<StickerDef>) -> Result<(), String> {
    crate::config_store::update(|c| c.stickers = stickers)?;
    Ok(())
}

/// Broadcast the current sticker list (after adds/updates/removes).
pub fn broadcast(app: &tauri::AppHandle) {
    let cfg = crate::config_store::get();
    events::emit_all(app, events::CONFIG_CHANGED, &cfg);
}

/// Sticker list for rendering: when background removal is enabled, stickers
/// whose `<stem>.nobg.png` artifact exists get their URL swapped to it. Pure
/// lookups — never processes anything here (that happens at placement or in
/// the startup pass), so this stays cheap enough to call per frame payload.
pub fn render_list() -> Vec<StickerDef> {
    let cfg = crate::config_store::get();
    if !cfg.sticker.remove_background {
        return cfg.stickers;
    }
    cfg.stickers
        .iter()
        .map(|s| {
            if s.url.contains(".nobg") {
                return s.clone(); // already the processed artifact
            }
            let orig = crate::media::decode_media_ref(&s.url);
            let out = crate::bgremove::out_path(&orig);
            if out.is_file() {
                let mut s2 = s.clone();
                s2.url = crate::media::media_url_for_file(&out.to_string_lossy());
                s2
            } else {
                s.clone()
            }
        })
        .collect()
}

/// Startup/back-compat pass: generate transparent variants for stickers
/// placed before background removal existed. Runs on a worker thread —
/// idempotent (mtime-checked) and best-effort.
pub fn spawn_bg_removal_pass() {
    std::thread::spawn(|| {
        let cfg = crate::config_store::get();
        if !cfg.sticker.remove_background {
            return;
        }
        for s in &cfg.stickers {
            if s.url.contains(".nobg") {
                continue;
            }
            let orig = crate::media::decode_media_ref(&s.url);
            if !orig.is_file() {
                continue;
            }
            match crate::bgremove::process_file(&orig) {
                Ok(p) => log::info!(
                    "bg removal pass: {} ({} frame(s), animated={})",
                    p.path.display(),
                    p.frames,
                    p.animated
                ),
                Err(e) => log::warn!("bg removal pass failed for {}: {e}", orig.display()),
            }
        }
    });
}
