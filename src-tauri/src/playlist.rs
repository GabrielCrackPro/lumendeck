//! Playlist scheduler: rotates the active wallpaper from a playlist's source
//! (whole vault or a collection) on a shuffle interval, with optional
//! time-of-day rules that swap the source pool at fixed local times.
//!
//! One background task polls every 30s (plus a `nudge()` channel for instant
//! reaction to edits). When the desired entry differs from the live wallpaper,
//! it applies through the same path the gallery uses (`gallery_apply`
//! semantics), so RGB ambient sampling, the static fallback frame, and all
//! broadcasts stay consistent.

use crate::config::{PlaylistRule, WallpaperKind, WallpaperPlaylist};
use std::time::Duration;
use tokio::sync::mpsc;

static NUDGE_TX: std::sync::OnceLock<mpsc::UnboundedSender<()>> = std::sync::OnceLock::new();

/// Ask the scheduler to re-evaluate immediately (config changed, playlist
/// enabled/disabled, etc.).
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

/// Local time-of-day in minutes; None when the clock is unavailable.
fn now_minutes() -> Option<u32> {
    // No chrono dependency: derive from SystemTime + the local timezone via
    // win32's GetLocalTime-equivalent. Simpler: use `std::time` plus libc's
    // localtime through the `windows` crate is heavy — read TZ offset once.
    // Keep it dependency-free with GetLocalTime via the existing win32 layer.
    crate::win32::local_time_minutes()
}

/// The pool of gallery entries a source string selects.
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

/// Pick the source string active right now for a playlist (time-of-day rules;
/// the last rule whose start <= now wins).
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

/// Deterministic-but-varying pick: hash of (day, current slot) over the pool,
/// so every interval lands on a different entry without persisting state.
fn pick_entry(pool: &[String], slot: u64) -> Option<String> {
    if pool.is_empty() {
        return None;
    }
    let idx = (slot as usize).wrapping_mul(2654435761) % pool.len();
    pool.get(idx).cloned()
}

async fn tick() {
    let cfg = crate::config_store::get();
    // Wallpapers disabled: never rotate. Otherwise re-enabling the wallpaper
    // surfaces a random playlist entry instead of what the user last chose.
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

    // Re-apply when either the slot rolled over or the pool changed (entries
    // added/removed). We detect "rolled over" by hashing slot+pool.
    let source = active_rule_source(pl);
    let pool = pool_for(source, &cfg);
    let want = match pick_entry(&pool, slot ^ (source.len() as u64)) {
        Some(id) => id,
        None => return, // empty pool; leave the current wallpaper alone
    };
    let entry = match cfg.gallery.iter().find(|g| g.id == want) {
        Some(e) => e.clone(),
        None => return,
    };

    // Already playing this entry? (per-monitor overrides keep their own state)
    let live = &cfg.wallpaper;
    let already = live.kind == entry.kind && live.source == entry.source;
    if already {
        return;
    }

    // Track which slot we last applied so clock drift doesn't re-apply
    // mid-slot (compare against a persisted marker).
    let marker = format!("{}:{}", slot, entry.id);
    if LAST_APPLIED.lock().map(|m| m.as_str() == marker).unwrap_or(false) {
        return;
    }

    let app = match crate::app_handle() {
        Some(a) => a,
        None => return,
    };
    // Same semantics as ipc::gallery_apply minus the id lookup.
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

/// Which vault entry `advance` should apply next, given the live wallpaper.
///
/// Pure so the ordering rule is testable: it walks the vault in display order
/// from whichever entry matches what is on screen, wrapping at the end. A
/// wallpaper that is not a vault entry (a file the user picked directly, or a
/// shader) has no position, so the walk restarts from the top.
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

/// Apply the next vault entry after the one on screen, wrapping at the end.
/// Backs the "next wallpaper" hotkey so the vault can be stepped without
/// opening the dashboard.
///
/// Per-display overrides are cleared: the point of a "next wallpaper" key is
/// that something changes on the screens you are looking at, and leaving
/// stale overrides in place can make the press look like a no-op.
pub fn advance() -> Option<crate::config::GalleryEntry> {
    let cfg = crate::config_store::get();
    let idx = next_entry_index(&cfg.gallery, &cfg.wallpaper)?;
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

// Silence unused-variant warnings on WallpaperKind when playlists only use a
// subset in a given build.
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
        // Same path, different kind: the vault entry is a different wallpaper.
        let mut other = entry("a");
        other.kind = WallpaperKind::Image;
        let g = vec![other, entry("b")];
        let mut w = live("C:/a.mp4");
        w.kind = WallpaperKind::Video;
        assert_eq!(next_entry_index(&g, &w), Some(0));
    }
}
