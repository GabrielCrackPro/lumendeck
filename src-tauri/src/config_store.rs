
use crate::config::Config;
use crate::events;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock, RwLock};
use tokio::sync::watch;

static CONFIG: OnceLock<RwLock<Config>> = OnceLock::new();
static WATCH_TX: OnceLock<Mutex<watch::Sender<Config>>> = OnceLock::new();
static LAST_MTIME_MS: AtomicU64 = AtomicU64::new(0);

pub fn config_path() -> PathBuf {
    data_dir().join("config.json")
}

pub fn data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("LumenDeck")
}

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

fn mark_persisted() {
    if let Some(t) = mtime_ms(&config_path()) {
        LAST_MTIME_MS.store(t, Ordering::Relaxed);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigReload {
    Unchanged,
    Reloaded,
    Pending(u64),
}

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

pub fn set(new_cfg: Config) -> Result<(), String> {
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
        crate::tray::refresh(&app);
    }
    Ok(())
}

pub fn update(f: impl FnOnce(&mut Config)) -> Result<Config, String> {
    static UPDATE_LOCK: Mutex<()> = Mutex::new(());
    let _guard = UPDATE_LOCK.lock().map_err(|_| "update lock poisoned")?;
    let mut cfg = get();
    f(&mut cfg);
    set(cfg.clone())?;
    Ok(get())
}

fn sync_active_profile(cfg: &mut Config) {
    let Some(id) = cfg.general.active_profile_id.clone() else {
        return;
    };
    let Some(idx) = cfg.scenes.iter().position(|s| s.id == id) else {
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
                Config::default()
            }
        },
        Err(_) => first_run_defaults(),
    }
}

fn first_run_defaults() -> Config {
    let mut cfg = Config::default();
    cfg.general.show_color_hex = false;
    cfg.general.show_developer_tools = false;
    cfg
}

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
        let mut cfg = Config::default();
        cfg.scenes.retain(|s| s.id != "s1");
        cfg.general.active_profile_id = Some("s1".into());

        sync_active_profile(&mut cfg);

        assert!(cfg.general.active_profile_id.is_none());
    }

    #[test]
    fn a_sticker_moved_by_hand_ends_up_in_the_profile() {
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
        let mut cfg = Config::default();
        cfg.rgb.device_names.insert(7, "Desk strip".to_string());
        cfg.general
            .screen_names
            .insert(r"\.\DISPLAY2".to_string(), "Desk".to_string());

        let json = serde_json::to_string_pretty(&cfg).unwrap();
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
        let json = serde_json::json!({
            "version": crate::config::CONFIG_VERSION,
            "general": {"autostart": true}
        });
        let cfg = parse_and_migrate(&json.to_string()).unwrap();
        assert!(cfg.general.minimize_to_tray);
    }

    #[test]
    fn login_start_stays_quiet_for_older_configs() {
        let json = serde_json::json!({
            "version": crate::config::CONFIG_VERSION,
            "general": {"autostart": true}
        });
        let cfg = parse_and_migrate(&json.to_string()).unwrap();
        assert!(cfg.general.autostart);
        assert!(!cfg.general.show_dashboard_on_login);
    }

    #[test]
    fn update_check_interval_defaults_to_an_hour_for_older_configs() {
        let json = serde_json::json!({
            "version": crate::config::CONFIG_VERSION,
            "general": {"autostart": true}
        });
        let cfg = parse_and_migrate(&json.to_string()).unwrap();
        assert_eq!(cfg.general.update_check_minutes, 60);
        assert_eq!(
            crate::config::Config::default().general.update_check_minutes,
            60,
            "first_run_defaults tests only that the two agree; this is the value"
        );
        assert!(
            cfg.general.update_check_minutes == 0
                || (cfg.general.update_check_minutes >= 15
                    && cfg.general.update_check_minutes <= 1440)
        );
    }

    #[test]
    fn color_hex_readout_stays_on_for_older_configs() {
        let json = serde_json::json!({
            "version": crate::config::CONFIG_VERSION,
            "general": {"autostart": true}
        });
        let cfg = parse_and_migrate(&json.to_string()).unwrap();
        assert!(cfg.general.show_color_hex);
    }

    #[test]
    fn developer_tools_stay_available_for_older_configs() {
        let json = serde_json::json!({
            "version": crate::config::CONFIG_VERSION,
            "general": {"autostart": true}
        });
        let cfg = parse_and_migrate(&json.to_string()).unwrap();
        assert!(cfg.general.show_developer_tools);
    }

    #[test]
    fn first_run_hides_the_hex_readout() {
        assert!(!first_run_defaults().general.show_color_hex);
    }

    #[test]
    fn first_run_hides_developer_details() {
        assert!(!first_run_defaults().general.show_developer_tools);
    }

    #[test]
    fn first_run_hides_only_the_optional_hex_and_developer_details() {
        let mut expected = Config::default();
        expected.general.show_color_hex = false;
        expected.general.show_developer_tools = false;
        let first = first_run_defaults();
        assert_eq!(
            serde_json::to_value(&first).unwrap(),
            serde_json::to_value(&expected).unwrap()
        );
    }

    #[test]
    fn importing_measures_by_default_for_existing_configs_too() {
        let json = serde_json::json!({
            "version": crate::config::CONFIG_VERSION,
            "wallpaper": {"kind": "shader", "source": "aurora"}
        });
        let cfg = parse_and_migrate(&json.to_string()).unwrap();
        assert!(cfg.wallpaper.index_after_import);
    }

    #[test]
    fn an_explicit_opt_out_of_auto_indexing_survives() {
        let json = serde_json::json!({
            "version": crate::config::CONFIG_VERSION,
            "wallpaper": {"kind": "shader", "source": "aurora", "indexAfterImport": false}
        });
        let cfg = parse_and_migrate(&json.to_string()).unwrap();
        assert!(!cfg.wallpaper.index_after_import);
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
