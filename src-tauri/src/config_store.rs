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
    data_dir().join("config.json")
}

/// The folder holding the config, the log and the thumbnails.
///
/// Named once because "the app's data folder" is written in four places that
/// have to agree — the log target, the log reveal, and the paths a user is told
/// to attach — and a folder name that drifts between them is a bug report that
/// arrives with the wrong file.
pub fn data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("LumenDeck")
}

/// The current log file. Fixed name, fixed place: this is the path support asks
/// for, so it must not move.
pub fn log_path() -> PathBuf {
    data_dir().join("lumendeck.log")
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
        .and_then(|s| parse_and_migrate(&s).ok())
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
                // The tray menu and tooltip are a mirror of the config, and
                // this path bypasses `set` (which refreshes them), so an edit
                // made outside the app would otherwise leave the notification
                // area describing a state that no longer exists.
                crate::tray::refresh(&app);
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

/// [get], but `None` instead of a panic when the store was never initialized.
///
/// For callers that run before or outside `setup` — a tray rebuild in a unit
/// test, a language lookup during early boot — where "no config yet" is a
/// state to handle rather than a bug.
pub fn try_get() -> Option<Config> {
    CONFIG
        .get()?
        .read()
        .ok()
        .map(|cfg| cfg.clone())
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
    // The profile sync lives here rather than in `update`, because `set` is the
    // floor every write passes through -- `update` is one caller, but the
    // dashboard's full-config save (`set_config`) calls `set` directly. Syncing
    // in `update` alone left every settings toggle looking like no change had
    // been made to the running profile, which is the whole feature.
    let mut new_cfg = new_cfg;
    sync_active_profile(&mut new_cfg);
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
///
/// Serialised by its own mutex rather than by the config `RwLock`. The obvious
/// implementation — read, mutate, write — releases the read lock before taking
/// the write lock, so two concurrent updates both start from the same base and
/// the second silently discards the first. That is not hypothetical: the
/// collection commands are the caller, and a bulk "file these twenty wallpapers
/// into a collection" is exactly the shape that loses entries.
///
/// A separate lock is used rather than holding the write lock across the whole
/// operation because `set` publishes the change, and publishing emits events
/// that read the config — re-entering the `RwLock` under a write guard would
/// deadlock. This lock is held only across read-modify-write, and nothing under
/// it re-enters `update`.
pub fn update(f: impl FnOnce(&mut Config)) -> Result<Config, String> {
    static UPDATE_LOCK: Mutex<()> = Mutex::new(());
    let _guard = UPDATE_LOCK.lock().map_err(|_| "update lock poisoned")?;
    let mut cfg = get();
    f(&mut cfg);
    set(cfg.clone())?;
    // Read back rather than returning the local copy: `set` syncs the running
    // profile, so the value handed to callers has to include that, or a caller
    // that broadcasts this config would broadcast a stale one.
    Ok(get())
}

/// Keep the profile that is applied in step with the machine.
///
/// A profile is a snapshot, so without this the two drift apart the moment
/// anything changes: the desktop is one look and the profile still claims
/// another, and the header keeps showing a name for a state that no longer
/// exists. Called from `set`, which every write passes through — `update` is
/// only one of its callers, and putting it there missed the dashboard's
/// full-config save entirely.
///
/// Deliberately does not touch the name or the logo. Those are the user's
/// labels for a profile, not part of what it captures, and re-syncing them
/// would make this a rename nobody asked for.
fn sync_active_profile(cfg: &mut Config) {
    let Some(id) = cfg.general.active_profile_id.clone() else {
        return;
    };
    let Some(idx) = cfg.scenes.iter().position(|s| s.id == id) else {
        // The profile was deleted, so nothing is being applied any more.
        cfg.general.active_profile_id = None;
        return;
    };
    cfg.scenes[idx].wallpaper = cfg.wallpaper.clone();
    cfg.scenes[idx].rgb = cfg.rgb.clone();
    cfg.scenes[idx].stickers = cfg.stickers.clone();
}

fn load() -> Config {
    let path = config_path();
    match fs::read_to_string(&path) {
        Ok(text) => match parse_and_migrate(&text) {
            Ok(cfg) => cfg,
            Err(e) => {
                log::warn!("config rejected ({e}); using defaults");
                // A file we cannot parse is not a fresh install: this machine
                // already had a config, so it gets the deserialization
                // defaults rather than the first-run ones. Flipping a
                // long-standing user's display preferences because their file
                // was briefly unreadable would be indefensible.
                Config::default()
            }
        },
        // No file at all: the one genuinely new machine.
        Err(_) => first_run_defaults(),
    }
}

/// Defaults for a machine that has never run LumenDeck.
///
/// Deliberately *not* `Config::default()`. The two differ, and the difference is
/// the whole point of the function: `Config::default()` doubles as the value
/// serde substitutes for a field a stored config predates, so it has to keep the
/// old behaviour for existing users. A brand-new install has no such history
/// and starts from the current product decision instead.
///
/// The only field that differs today is `show_color_hex`, because it is the only
/// preference whose "current" answer is deliberately not the "old" one. Adding a
/// second such field means adding it here too, and nothing else.
fn first_run_defaults() -> Config {
    let mut cfg = Config::default();
    cfg.general.show_color_hex = false;
    cfg
}

/// Parse config JSON through the migration pipeline so files written by
/// older (or, defensively, newer) app versions never silently reset the
/// user's setup.
fn parse_and_migrate(text: &str) -> Result<Config, String> {
    let mut raw: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("invalid JSON: {e}"))?;
    crate::config::migrate(&mut raw, None)?;
    serde_json::from_value(raw).map_err(|e| format!("schema mismatch: {e}"))
}

fn persist(cfg: &Config) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(crate::error::err_str)?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(crate::error::err_str)?;
    // Write-then-rename for atomicity.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(crate::error::err_str)?;
    fs::rename(&tmp, &path).map_err(crate::error::err_str)?;
    mark_persisted();
    Ok(())
}

#[cfg(test)]
mod profile_sync_tests {
    use super::sync_active_profile;
    use crate::config::{Config, RgbMode, SceneProfile, StickerDef};

    fn scene(id: &str) -> SceneProfile {
        SceneProfile {
            id: id.into(),
            name: "Night".into(),
            ..Default::default()
        }
    }

    #[test]
    fn a_change_is_captured_into_the_profile_that_is_running() {
        let mut cfg = Config::default();
        cfg.scenes.push(scene("s1"));
        cfg.general.active_profile_id = Some("s1".into());
        cfg.rgb.mode = RgbMode::Wave;

        sync_active_profile(&mut cfg);

        assert_eq!(
            cfg.scenes[0].rgb.mode,
            RgbMode::Wave,
            "the profile must not keep describing a look that is no longer on screen"
        );
    }

    #[test]
    fn nothing_is_touched_when_no_profile_is_applied() {
        let mut cfg = Config::default();
        cfg.scenes.push(scene("s1"));
        cfg.general.active_profile_id = None;
        cfg.rgb.mode = RgbMode::Wave;

        sync_active_profile(&mut cfg);

        assert_eq!(cfg.scenes[0].rgb.mode, RgbMode::Ambient);
    }

    #[test]
    fn deleting_the_running_profile_clears_the_pointer() {
        // Otherwise every later write looks for a profile that is gone, and
        // the header would go on naming a deleted one.
        let mut cfg = Config::default();
        cfg.scenes.retain(|s| s.id != "s1");
        cfg.general.active_profile_id = Some("s1".into());

        sync_active_profile(&mut cfg);

        assert!(cfg.general.active_profile_id.is_none());
    }

    #[test]
    fn a_sticker_moved_by_hand_ends_up_in_the_profile() {
        // Stickers are the field most likely to be forgotten, because they move
        // on their own rather than through a setting.
        let mut cfg = Config::default();
        let mut running = scene("s1");
        running.stickers.push(StickerDef {
            id: "st1".into(),
            x: 10,
            y: 20,
            ..Default::default()
        });
        cfg.scenes.push(running);
        cfg.general.active_profile_id = Some("s1".into());
        cfg.stickers.push(StickerDef {
            id: "st1".into(),
            x: 999,
            y: 20,
            ..Default::default()
        });

        sync_active_profile(&mut cfg);

        assert_eq!(cfg.scenes[0].stickers.len(), 1);
        assert_eq!(cfg.scenes[0].stickers[0].x, 999);
    }
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

    #[test]
    fn custom_names_survive_the_write_read_cycle() {
        // persist() is a pretty-print of the whole Config followed by a file
        // write, and load() is the inverse parse. A full round trip is that
        // path minus the filesystem itself, so if a rename is going to be lost
        // on the way to disk, it is lost here.
        let mut cfg = Config::default();
        cfg.rgb.device_names.insert(7, "Desk strip".to_string());
        cfg.general
            .screen_names
            .insert(r"\.\DISPLAY2".to_string(), "Desk".to_string());

        let json = serde_json::to_string_pretty(&cfg).unwrap();
        // Assert on the parsed value, never on substrings: persist() writes
        // pretty JSON, so matching a literal block would only prove the indent
        // is two spaces. What matters is the key *shape* — a device id must
        // stay "7" rather than become "7.0", and a backslashed display name
        // must not lose an escape — or every alias silently stops matching and
        // the rename looks like it was forgotten.
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["rgb"]["deviceNames"]["7"], "Desk strip", "{v:#}");
        assert_eq!(
            v["general"]["screenNames"][r"\.\DISPLAY2"],
            "Desk",
            "{v:#}"
        );

        let back: Config = serde_json::from_str(&json).unwrap();
        assert_eq!(back.rgb.device_names.get(&7).map(String::as_str), Some("Desk strip"));
        assert_eq!(
            back.general.screen_names.get(r"\.\DISPLAY2").map(String::as_str),
            Some("Desk")
        );
    }

    #[test]
    fn migration_sets_current_version() {
        // A versionless legacy file migrates to the current schema version.
        let mut raw: serde_json::Value = serde_json::from_str("{}").unwrap();
        crate::config::migrate(&mut raw, None).unwrap();
        assert_eq!(raw["version"], serde_json::json!(crate::config::CONFIG_VERSION));
    }

    #[test]
    fn migration_rejects_newer_schema() {
        let mut raw: serde_json::Value =
            serde_json::json!({"version": crate::config::CONFIG_VERSION + 1});
        assert!(crate::config::migrate(&mut raw, None).is_err());
    }

    #[test]
    fn minimize_to_tray_defaults_on_for_older_configs() {
        // A config written before the field existed must not silently park
        // the dashboard on the taskbar: the default hides it to the tray,
        // matching the close button's long-standing behavior.
        let json = serde_json::json!({
            "version": crate::config::CONFIG_VERSION,
            "general": {"autostart": true}
        });
        let cfg = parse_and_migrate(&json.to_string()).unwrap();
        assert!(cfg.general.minimize_to_tray);
    }

    #[test]
    fn login_start_stays_quiet_for_older_configs() {
        // A config written before the opt-in existed must keep booting into
        // the tray rather than popping the dashboard over a fresh desktop.
        let json = serde_json::json!({
            "version": crate::config::CONFIG_VERSION,
            "general": {"autostart": true}
        });
        let cfg = parse_and_migrate(&json.to_string()).unwrap();
        assert!(cfg.general.autostart);
        assert!(!cfg.general.show_dashboard_on_login);
    }

    #[test]
    fn color_hex_readout_stays_on_for_older_configs() {
        // The hex readout existed before this setting did. An older config must
        // keep seeing it, or upgrading the app quietly removes something the
        // user was reading — and there is no signal that anything changed.
        let json = serde_json::json!({
            "version": crate::config::CONFIG_VERSION,
            "general": {"autostart": true}
        });
        let cfg = parse_and_migrate(&json.to_string()).unwrap();
        assert!(cfg.general.show_color_hex);
    }

    #[test]
    fn first_run_hides_the_hex_readout() {
        // A machine with no config has no history to preserve, so it starts from
        // the current product decision rather than the one this setting replaced.
        assert!(!first_run_defaults().general.show_color_hex);
    }

    #[test]
    fn first_run_differs_from_the_upgrade_default_only_in_the_hex() {
        // The split has to stay narrow. If a future field also wants a different
        // first-run value, it gets its own line in `first_run_defaults` — and a
        // test that fails here is the thing that catches a second divergence
        // being introduced by accident.
        let mut expected = Config::default();
        expected.general.show_color_hex = false;
        let first = first_run_defaults();
        // Compare by round-tripping both, so a new field added to either side
        // shows up as a difference rather than silently defaulting.
        assert_eq!(
            serde_json::to_value(&first).unwrap(),
            serde_json::to_value(&expected).unwrap()
        );
    }

    #[test]
    fn color_hex_readout_respects_an_explicit_opt_out() {
        let json = serde_json::json!({
            "version": crate::config::CONFIG_VERSION,
            "general": {"autostart": true, "showColorHex": false}
        });
        let cfg = parse_and_migrate(&json.to_string()).unwrap();
        assert!(!cfg.general.show_color_hex);
    }

    #[test]
    fn parse_and_migrate_preserves_user_fields() {
        let json = serde_json::json!({
            "version": crate::config::CONFIG_VERSION,
            "general": {"autostart": true, "amoled": true}
        });
        let cfg = parse_and_migrate(&json.to_string()).unwrap();
        assert!(cfg.general.autostart);
        assert!(cfg.general.amoled);
        assert_eq!(cfg.version, crate::config::CONFIG_VERSION);
    }
}
