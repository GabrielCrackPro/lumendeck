
use crate::config::{PlaylistRule, WallpaperKind, WallpaperPlaylist};
use std::time::Duration;
use tokio::sync::mpsc;

static NUDGE_TX: std::sync::OnceLock<mpsc::UnboundedSender<()>> = std::sync::OnceLock::new();

pub fn nudge() {
    if let Some(tx) = NUDGE_TX.get() {
        let _ = tx.send(());
    }
}

pub fn spawn() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let _ = NUDGE_TX.set(tx);
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(30)) => {},
                _ = rx.recv() => {},
            }
            tick().await;
        }
    });
}

fn now_minutes() -> Option<u32> {
    crate::win32::local_time_minutes()
}

fn pool_for(source: &str, cfg: &crate::config::Config) -> Vec<String> {
    match source.strip_prefix("collection:") {
        Some(col_id) => cfg
            .collections
            .iter()
            .find(|c| c.id == col_id)
            .map(|c| {
                c.entry_ids
                    .iter()
                    .filter(|id| cfg.gallery.iter().any(|g| g.id == **id))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default(),
        None => cfg.gallery.iter().map(|g| g.id.clone()).collect(),
    }
}

fn active_rule_source(pl: &WallpaperPlaylist) -> &str {
    let now = now_minutes().unwrap_or(0);
    let mut best: Option<(&PlaylistRule, u32)> = None;
    for r in &pl.rules {
        if let Some(mins) = r.start_minutes() {
            if mins <= now && best.map(|(_, bm)| mins > bm).unwrap_or(true) {
                best = Some((r, mins));
            }
        }
    }
    best.map(|(r, _)| r.source.as_str()).unwrap_or("all")
}

fn pick_entry(pool: &[String], slot: u64) -> Option<String> {
    if pool.is_empty() {
        return None;
    }
    let idx = (slot as usize).wrapping_mul(2654435761) % pool.len();
    pool.get(idx).cloned()
}

async fn tick() {
    let cfg = crate::config_store::get();
    if !cfg.general.wallpaper_enabled {
        return;
    }
    let Some(pl) = cfg.playlists.iter().find(|p| p.enabled) else {
        return;
    };

    let interval = pl.shuffle_min.max(1) as u64;
    let minutes = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() / 60)
        .unwrap_or(0);
    let slot = minutes / interval;

    let source = active_rule_source(pl);
    let pool = pool_for(source, &cfg);
    let want = match pick_entry(&pool, slot ^ (source.len() as u64)) {
        Some(id) => id,
        None => return,
    };
    let entry = match cfg.gallery.iter().find(|g| g.id == want) {
        Some(e) => e.clone(),
        None => return,
    };

    let live = &cfg.wallpaper;
    let already = live.kind == entry.kind && live.source == entry.source;
    if already {
        return;
    }

    let marker = format!("{}:{}", slot, entry.id);
    if LAST_APPLIED.lock().map(|m| m.as_str() == marker).unwrap_or(false) {
        return;
    }

    let app = match crate::app_handle() {
        Some(a) => a,
        None => return,
    };
    let _ = crate::config_store::update(|c| {
        c.wallpaper.kind = entry.kind;
        c.wallpaper.source = entry.source.clone();
    });
    if crate::config_store::get().general.wallpaper_enabled {
        let _ = crate::wallpaper::ensure(&app);
        crate::wallpaper_bg::apply_bg(&crate::config_store::get().wallpaper);
    }
    if let Ok(mut m) = LAST_APPLIED.lock() {
        *m = marker;
    }
    log::info!(
        "playlist \"{}\": applied \"{}\" ({:?})",
        pl.name,
        entry.name,
        entry.kind
    );
}

static LAST_APPLIED: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

pub fn next_entry_index(
    gallery: &[crate::config::GalleryEntry],
    live: &crate::config::WallpaperConfig,
) -> Option<usize> {
    if gallery.is_empty() {
        return None;
    }
    let current = gallery
        .iter()
        .position(|g| g.kind == live.kind && g.source == live.source);
    Some(match current {
        Some(i) => (i + 1) % gallery.len(),
        None => 0,
    })
}

fn seed_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

pub fn shuffled_entry_index(
    gallery: &[crate::config::GalleryEntry],
    live: &crate::config::WallpaperConfig,
    seed: u64,
) -> Option<usize> {
    if gallery.is_empty() {
        return None;
    }
    if gallery.len() == 1 {
        return Some(0);
    }
    let current = gallery
        .iter()
        .position(|g| g.kind == live.kind && g.source == live.source);
    let mut z = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    let pick = (z % gallery.len() as u64) as usize;
    match current {
        Some(i) => Some((i + 1 + pick % (gallery.len() - 1)) % gallery.len()),
        None => Some(pick),
    }
}

pub fn advance() -> Option<crate::config::GalleryEntry> {
    let cfg = crate::config_store::get();
    let idx = if cfg.gallery_shuffle {
        shuffled_entry_index(&cfg.gallery, &cfg.wallpaper, seed_now())?
    } else {
        next_entry_index(&cfg.gallery, &cfg.wallpaper)?
    };
    let next = cfg.gallery[idx].clone();
    let app = crate::app_handle()?;

    crate::config_store::update(|c| {
        c.wallpaper.kind = next.kind;
        c.wallpaper.source = next.source.clone();
        c.wallpaper.per_monitor.clear();
    })
    .ok()?;

    if crate::config_store::get().general.wallpaper_enabled {
        let _ = crate::wallpaper::ensure(&app);
        crate::wallpaper_bg::apply_bg(&crate::config_store::get().wallpaper);
    }
    log::info!("playlist: advanced to \"{}\" ({:?})", next.name, next.kind);
    Some(next)
}

#[allow(dead_code)]
fn _kind_used(k: WallpaperKind) -> WallpaperKind {
    k
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{GalleryEntry, WallpaperKind};
    fn entry(id: &str) -> GalleryEntry {
        GalleryEntry {
            id: id.into(),
            name: id.into(),
            kind: WallpaperKind::Video,
            source: format!("C:/{id}.mp4"),
            added_ms: 0,
            thumb: None,
            opts: None,
            favorite: false,
            last_applied_ms: None,
        }
    }

    fn live(source: &str) -> crate::config::WallpaperConfig {
        let mut w = crate::config::WallpaperConfig::default();
        w.kind = WallpaperKind::Video;
        w.source = source.into();
        w
    }

    #[test]
    fn advance_walks_the_vault_in_order_and_wraps() {
        let g = vec![entry("a"), entry("b"), entry("c")];
        assert_eq!(next_entry_index(&g, &live("C:/a.mp4")), Some(1));
        assert_eq!(next_entry_index(&g, &live("C:/b.mp4")), Some(2));
        assert_eq!(next_entry_index(&g, &live("C:/c.mp4")), Some(0));
    }

    #[test]
    fn advance_from_a_wallpaper_outside_the_vault_starts_at_the_top() {
        let g = vec![entry("a"), entry("b")];
        assert_eq!(next_entry_index(&g, &live("C:/elsewhere.mp4")), Some(0));
    }

    #[test]
    fn an_empty_vault_has_nothing_to_advance_to() {
        assert_eq!(next_entry_index(&[], &live("C:/a.mp4")), None);
    }

    #[test]
    fn a_kind_mismatch_is_not_a_match() {
        let mut other = entry("a");
        other.kind = WallpaperKind::Image;
        let g = vec![other, entry("b")];
        let mut w = live("C:/a.mp4");
        w.kind = WallpaperKind::Video;
        assert_eq!(next_entry_index(&g, &w), Some(0));
    }
}

#[cfg(test)]
mod shuffle_tests {
    use super::shuffled_entry_index;
    use crate::config::{GalleryEntry, WallpaperConfig, WallpaperKind};

    fn entry(id: &str) -> GalleryEntry {
        GalleryEntry {
            id: id.into(),
            name: id.into(),
            kind: WallpaperKind::Image,
            source: format!("media.localhost/{id}.jpg"),
            added_ms: 0,
            thumb: None,
            opts: None,
            favorite: false,
            last_applied_ms: None,
        }
    }

    fn live(gallery: &[GalleryEntry], idx: usize) -> WallpaperConfig {
        WallpaperConfig {
            kind: gallery[idx].kind,
            source: gallery[idx].source.clone(),
            ..Default::default()
        }
    }

    fn vault(n: usize) -> Vec<GalleryEntry> {
        (0..n).map(|i| entry(&format!("w{i}"))).collect()
    }

    #[test]
    fn never_returns_the_wallpaper_already_on_screen() {
        let gallery = vault(6);
        for start in 0..gallery.len() {
            for seed in 0..64u64 {
                let got = shuffled_entry_index(&gallery, &live(&gallery, start), seed);
                assert_ne!(got, Some(start), "seed {seed} from {start}");
                assert!(got.unwrap() < gallery.len());
            }
        }
    }

    #[test]
    fn alternates_when_the_vault_holds_two() {
        let gallery = vault(2);
        for seed in 0..32u64 {
            assert_eq!(shuffled_entry_index(&gallery, &live(&gallery, 0), seed), Some(1));
            assert_eq!(shuffled_entry_index(&gallery, &live(&gallery, 1), seed), Some(0));
        }
    }

    #[test]
    fn a_single_entry_vault_repeats_itself() {
        let gallery = vault(1);
        assert_eq!(shuffled_entry_index(&gallery, &live(&gallery, 0), 7), Some(0));
    }

    #[test]
    fn an_empty_vault_has_nothing_to_shuffle() {
        assert_eq!(shuffled_entry_index(&[], &WallpaperConfig::default(), 3), None);
    }

    #[test]
    fn a_wallpaper_from_outside_the_vault_can_pick_anything() {
        let gallery = vault(5);
        let outsider = WallpaperConfig::default();
        let got = shuffled_entry_index(&gallery, &outsider, 42);
        assert!(got.is_some() && got.unwrap() < gallery.len());
    }

    #[test]
    fn a_seed_moves_the_pick_rather_than_always_walking_on() {
        let gallery = vault(5);
        let current = live(&gallery, 0);
        let reached: std::collections::BTreeSet<usize> = (0..200u64)
            .map(|seed| shuffled_entry_index(&gallery, &current, seed).unwrap())
            .collect();
        assert!(reached.len() > 1, "shuffle never varied");
        assert!(reached.len() <= gallery.len() - 1);
    }
}
