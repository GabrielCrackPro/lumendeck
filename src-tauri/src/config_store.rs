//! Config store: load/save `%APPDATA%/LumenDeck/config.json` with a watch
//! channel so the engine loop and windows can react to changes.

use crate::config::Config;
use crate::events;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock, RwLock};
use tokio::sync::watch;

static CONFIG: OnceLock<RwLock<Config>> = OnceLock::new();
static WATCH_TX: OnceLock<Mutex<watch::Sender<Config>>> = OnceLock::new();
/// Last-seen file mtime (ms since epoch) for external-edit detection.
static LAST_MTIME_MS: AtomicU64 = AtomicU64::new(0);

pub fn config_path() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("LumenDeck").join("config.json")
}

pub fn init() -> Config {
    let cfg = load();
    let _ = CONFIG.set(RwLock::new(cfg.clone()));
    let (tx, _) = watch::channel(cfg.clone());
    let _ = WATCH_TX.set(Mutex::new(tx));
    mark_persisted();
    cfg
}

fn mtime_ms(path: &PathBuf) -> Option<u64> {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

/// Record the current file mtime so our own writes don't trigger reloads.
fn mark_persisted() {
    if let Some(t) = mtime_ms(&config_path()) {
        LAST_MTIME_MS.store(t, Ordering::Relaxed);
    }
}

/// Outcome of a change check against the config file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigReload {
    /// File mtime unchanged since the last sync.
    Unchanged,
    /// Fresh config was loaded into memory.
    Reloaded,
    /// File changed but could not be parsed (likely mid-write). The mtime is
    /// deliberately left unconsumed so a later attempt can succeed.
    Pending(u64),
}

/// Reload the config from disk if the file changed externally (manual edit or
/// another tool). Applies window side effects and broadcasts the change.
pub fn reload_if_changed() -> ConfigReload {
    let path = config_path();
    let Some(t) = mtime_ms(&path) else {
        return ConfigReload::Unchanged;
    };
    if t == LAST_MTIME_MS.load(Ordering::Relaxed) {
        return ConfigReload::Unchanged;
    }

    match fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<Config>(&s).ok())
    {
        Some(cfg) => {
            mark_persisted();
            if let Some(cell) = CONFIG.get() {
                if let Ok(mut slot) = cell.write() {
                    *slot = cfg.clone();
                }
            }
            if let Some(tx) = WATCH_TX.get() {
                if let Ok(tx) = tx.lock() {
                    let _ = tx.send(cfg.clone());
                }
            }
            if let Some(app) = crate::app_handle() {
                events::emit_all(&app, events::CONFIG_CHANGED, &cfg);
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                events::emit_all(&app, events::CONFIG_RELOADED, &now_ms);
                crate::ipc::apply_side_effects(&app, &cfg);
            }
            log::info!("config reloaded from disk");
            ConfigReload::Reloaded
        }
        None => {
            log::debug!("config file changed but not parseable yet (mid-write?)");
            ConfigReload::Pending(t)
        }
    }
}

pub fn get() -> Config {
    CONFIG
        .get()
        .expect("config not initialized")
        .read()
        .expect("config poisoned")
        .clone()
}

pub fn watch() -> watch::Receiver<Config> {
    WATCH_TX
        .get()
        .expect("config not initialized")
        .lock()
        .expect("watch mutex poisoned")
        .subscribe()
}

/// Replace the whole config, persist it, and notify listeners.
pub fn set(new_cfg: Config) -> Result<(), String> {
    {
        let cell = CONFIG.get().ok_or("config not initialized")?;
        *cell.write().map_err(|_| "config poisoned")? = new_cfg.clone();
    }
    persist(&new_cfg)?;
    if let Some(tx) = WATCH_TX.get() {
        let _ = tx.lock().map_err(|_| "watch mutex poisoned")?.send(new_cfg.clone());
    }
    if let Some(app) = crate::app_handle() {
        events::emit_all(&app, events::CONFIG_CHANGED, &new_cfg);
        // Keep quick-controls (mode/profile checkmarks) in sync with dashboard edits.
        crate::tray::refresh(&app);
    }
    Ok(())
}

/// Mutate the config through a closure and save.
pub fn update(f: impl FnOnce(&mut Config)) -> Result<Config, String> {
    let mut cfg = get();
    f(&mut cfg);
    set(cfg.clone())?;
    Ok(cfg)
}

fn load() -> Config {
    let path = config_path();
    match fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<Config>(&text) {
            Ok(cfg) => cfg,
            Err(e) => {
                log::warn!("config parse failed ({e}); using defaults");
                Config::default()
            }
        },
        Err(_) => Config::default(),
    }
}

fn persist(cfg: &Config) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    // Write-then-rename for atomicity.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    mark_persisted();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_roundtrip_json() {
        let cfg = Config::default();
        let json = serde_json::to_string(&cfg).unwrap();
        let back: Config = serde_json::from_str(&json).unwrap();
        assert_eq!(cfg, back);
    }

    #[test]
    fn config_camel_case_keys() {
        let json = serde_json::to_string(&Config::default()).unwrap();
        assert!(json.contains("\"wallpaperEnabled\""), "keys must be camelCase: {json}");
        assert!(json.contains("\"staticColor\""));
        assert!(json.contains("\"taskbarAbove\"") || !json.contains("\"taskbar_above\""));
    }

    #[test]
    fn defaults_parse_from_empty_object() {
        let back: Config = serde_json::from_str("{}").unwrap();
        assert_eq!(back, Config::default());
    }
}
