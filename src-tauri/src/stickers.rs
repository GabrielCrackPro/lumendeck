
use crate::config::StickerDef;
use crate::events;

pub fn replace_all(stickers: Vec<StickerDef>) -> Result<(), String> {
    crate::config_store::update(|c| c.stickers = stickers)?;
    Ok(())
}

pub fn broadcast(app: &tauri::AppHandle) {
    let cfg = crate::config_store::get();
    events::emit_all(app, events::CONFIG_CHANGED, &cfg);
}

pub fn render_list() -> Vec<StickerDef> {
    let cfg = crate::config_store::get();
    let in_wallpaper: Vec<StickerDef> = cfg
        .stickers
        .iter()
        .filter(|s| !s.on_top)
        .cloned()
        .collect();
    if !cfg.sticker.remove_background {
        return in_wallpaper;
    }
    in_wallpaper
        .iter()
        .map(|s| {
            if s.url.contains(".nobg") {
                return s.clone();
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
