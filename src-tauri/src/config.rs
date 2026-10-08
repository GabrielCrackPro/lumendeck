
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const CONFIG_VERSION: u32 = 2;

pub fn migrate(raw: &mut serde_json::Value, from: Option<u32>) -> Result<(), String> {
    let from = from.unwrap_or(if raw.get("version").is_some() {
        raw["version"].as_u64().ok_or("config version not a number")? as u32
    } else {
        CONFIG_VERSION
    });
    if from > CONFIG_VERSION {
        return Err(format!(
            "config was written by a newer app (schema v{from} > v{CONFIG_VERSION})"
        ));
    }
    if from < 2 {
        lighting_profiles_become_configs(raw);
        rename_hotkey_key(raw, "nextScene", "nextProfile");
    }
    let _ = from;
    raw["version"] = serde_json::json!(CONFIG_VERSION);
    Ok(())
}

fn rename_hotkey_key(raw: &mut serde_json::Value, from: &str, to: &str) {
    let Some(hotkeys) = raw
        .get_mut("general")
        .and_then(|g| g.get_mut("hotkeys"))
        .and_then(|h| h.as_object_mut())
    else {
        return;
    };
    let Some(value) = hotkeys.remove(from) else {
        return;
    };
    hotkeys.entry(to.to_string()).or_insert(value);
}

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn lighting_profiles_become_configs(raw: &mut serde_json::Value) {
    let profiles = match raw.get("rgb").and_then(|rgb| rgb.get("profiles")) {
        Some(serde_json::Value::Array(list)) if !list.is_empty() => list.clone(),
        _ => return,
    };
    let base_rgb = raw.get("rgb").cloned().unwrap_or_else(|| serde_json::json!({}));
    let created_ms = now_ms();
    let mut scenes: Vec<serde_json::Value> = match raw.get("scenes") {
        Some(serde_json::Value::Array(existing)) => existing.clone(),
        _ => Vec::new(),
    };
    let mut taken_ids: std::collections::HashSet<String> = scenes
        .iter()
        .filter_map(|s| s.get("id").and_then(|id| id.as_str()).map(String::from))
        .collect();

    for (i, profile) in profiles.iter().enumerate() {
        let name = profile
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("Config")
            .to_string();
        let mut id = format!("scene-from-profile-{i}");
        let mut bump = 1;
        while taken_ids.contains(&id) {
            id = format!("scene-from-profile-{i}-{bump}");
            bump += 1;
        }
        taken_ids.insert(id.clone());
        let mut rgb = base_rgb.clone();
        if let Some(obj) = rgb.as_object_mut() {
            for key in ["mode", "staticColor", "animationSpeed"] {
                if let Some(v) = profile.get(key) {
                    obj.insert(key.to_string(), v.clone());
                }
            }
            obj.remove("profiles");
        }
        let mut scene = serde_json::Map::new();
        scene.insert("id".into(), serde_json::json!(id));
        scene.insert("name".into(), serde_json::json!(name));
        if let Some(wallpaper) = raw.get("wallpaper") {
            scene.insert("wallpaper".into(), wallpaper.clone());
        }
        scene.insert("rgb".into(), rgb);
        if let Some(stickers) = raw.get("stickers") {
            scene.insert("stickers".into(), stickers.clone());
        }
        scene.insert("createdMs".into(), serde_json::json!(created_ms));
        scenes.push(serde_json::Value::Object(scene));
    }

    raw["scenes"] = serde_json::json!(scenes);
    if let Some(rgb) = raw.get_mut("rgb").and_then(|r| r.as_object_mut()) {
        rgb.remove("profiles");
    }
    log::info!("migrated {} lighting profile(s) to configs", profiles.len());
}


#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GeneralConfig {
    pub autostart: bool,
    pub theme: ThemeMode,
    pub language: String,
    #[serde(default)]
    pub screen_names: HashMap<String, String>,
    pub pause_on_battery_saver: bool,
    pub pause_on_fullscreen: bool,
    pub wallpaper_enabled: bool,
    pub accent_live: bool,
    pub software_video_decode: bool,
    pub accent_sync_enabled: bool,
    pub accent_sync_armed: bool,
    pub lock_screen_follows_wallpaper: bool,
    pub lock_screen_armed: bool,
    pub onboarded: bool,
    pub active_profile_id: Option<String>,
    pub accent_auto_shade: f64,
    pub amoled: bool,
    pub show_color_hex: bool,
    pub show_developer_tools: bool,
    pub minimize_to_tray: bool,
    pub show_dashboard_on_login: bool,
    pub startup_hint_shown: bool,
    pub changelog_seen_version: String,
    pub hotkeys_enabled: bool,
    pub hotkeys: HotkeyConfig,
    #[serde(default = "default_hotkey_blink_ms")]
    pub hotkey_blink_ms: u64,
    #[serde(default = "default_hotkey_blink_color")]
    pub hotkey_blink_color: [u8; 3],
    #[serde(default = "default_update_check_minutes")]
    pub update_check_minutes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HotkeyBinding {
    pub accelerator: String,
}

impl HotkeyBinding {
    pub fn bound(accelerator: &str) -> Self {
        Self {
            accelerator: accelerator.to_string(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.accelerator.trim().is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HotkeyConfig {
    pub toggle_dashboard: HotkeyBinding,
    pub play_pause: HotkeyBinding,
    pub next_track: HotkeyBinding,
    pub prev_track: HotkeyBinding,
    pub toggle_mute: HotkeyBinding,
    pub volume_up: HotkeyBinding,
    pub volume_down: HotkeyBinding,
    pub toggle_wallpaper: HotkeyBinding,
    pub cycle_lighting_mode: HotkeyBinding,
    pub next_profile: HotkeyBinding,
    pub next_wallpaper: HotkeyBinding,
}

impl HotkeyConfig {
    pub fn entries(&self) -> [(&'static str, &HotkeyBinding); 11] {
        [
            ("toggleDashboard", &self.toggle_dashboard),
            ("playPause", &self.play_pause),
            ("nextTrack", &self.next_track),
            ("prevTrack", &self.prev_track),
            ("toggleMute", &self.toggle_mute),
            ("volumeUp", &self.volume_up),
            ("volumeDown", &self.volume_down),
            ("toggleWallpaper", &self.toggle_wallpaper),
            ("cycleLightingMode", &self.cycle_lighting_mode),
            ("nextProfile", &self.next_profile),
            ("nextWallpaper", &self.next_wallpaper),
        ]
    }
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            autostart: false,
            theme: ThemeMode::System,
            language: "auto".to_string(),
            screen_names: HashMap::new(),
            pause_on_battery_saver: false,
            pause_on_fullscreen: true,
            wallpaper_enabled: true,
            accent_live: true,
            software_video_decode: false,
            accent_sync_enabled: false,
            accent_sync_armed: false,
            lock_screen_follows_wallpaper: false,
            lock_screen_armed: false,
            onboarded: false,
            active_profile_id: None,
            accent_auto_shade: 1.0,
            amoled: false,
            show_color_hex: true,
            show_developer_tools: true,
            minimize_to_tray: true,
            show_dashboard_on_login: false,
            startup_hint_shown: false,
            changelog_seen_version: String::new(),
            hotkeys: HotkeyConfig::default(),
            hotkeys_enabled: true,
            hotkey_blink_ms: default_hotkey_blink_ms(),
            hotkey_blink_color: default_hotkey_blink_color(),
            update_check_minutes: default_update_check_minutes(),
        }
    }
}


#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WallpaperKind {
    Video,
    Image,
    Slideshow,
    Web,
    Shader,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SlideshowConfig {
    pub folder: String,
    pub interval_sec: f64,
    pub crossfade_sec: f64,
}

impl Default for SlideshowConfig {
    fn default() -> Self {
        Self {
            folder: String::new(),
            interval_sec: 30.0,
            crossfade_sec: 1.5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct WallpaperConfig {
    pub kind: WallpaperKind,
    pub source: String,
    pub volume: f64,
    pub slideshow: SlideshowConfig,
    pub video_fit: String,
    pub video_speed: f32,
    pub video_brightness: f32,
    pub video_saturation: f32,
    pub video_hue: f32,
    pub per_monitor: std::collections::BTreeMap<String, PerMonitorWallpaper>,
    pub apply_after_import: bool,
    pub index_after_import: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PerMonitorWallpaper {
    pub kind: WallpaperKind,
    pub source: String,
}

impl Default for WallpaperConfig {
    fn default() -> Self {
        Self {
            kind: WallpaperKind::Shader,
            source: "aurora".into(),
            volume: 0.0,
            slideshow: SlideshowConfig::default(),
            video_fit: "auto".into(),
            video_speed: 1.0,
            video_brightness: 1.0,
            video_saturation: 1.0,
            video_hue: 0.0,
            per_monitor: std::collections::BTreeMap::new(),
            apply_after_import: true,
            index_after_import: true,
        }
    }
}


#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RgbMode {
    Ambient,
    Zone,
    Pulse,
    Static,
    Wave,
    Cycle,
    Breathe,
    #[serde(rename = "audioReactive")]
    AudioReactive,
}

impl RgbMode {
    pub fn is_animation(&self) -> bool {
        matches!(
            self,
            RgbMode::Wave | RgbMode::Cycle | RgbMode::Breathe | RgbMode::AudioReactive
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RgbMixer {
    pub brightness: f64,
    pub saturation: f64,
    pub gamma: f64,
    pub smoothing: f64,
}

impl Default for RgbMixer {
    fn default() -> Self {
        Self {
            brightness: 1.0,
            saturation: 1.0,
            gamma: 1.0,
            smoothing: 0.35,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ZoneDef {
    pub id: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub device_ids: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RgbConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub mode: RgbMode,
    pub static_color: [u8; 3],
    pub zones: Vec<ZoneDef>,
    pub mixer: RgbMixer,
    pub min_update_ms: u64,
    pub excluded_devices: Vec<u32>,
    #[serde(default)]
    pub device_names: HashMap<u32, String>,
    pub animation_speed: f64,
    pub idle_timeout_sec: u64,
    pub idle_check_interval_sec: u64,
    pub accent_device: Option<u32>,
    pub audio_sensitivity: f64,
    pub audio_smoothing: f64,
    pub audio_source: String,
    pub wave_direction: i32,
    pub cycle_spread: f64,
    pub night_start: String,
    pub night_end: String,
    pub night_brightness: f64,
    #[serde(default)]
    pub track_flash_ms: u64,
}

fn default_hotkey_blink_ms() -> u64 {
    450
}

fn default_update_check_minutes() -> u32 {
    60
}

fn default_hotkey_blink_color() -> [u8; 3] {
    crate::tokens::hotkey_blink()
}

impl Default for RgbConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            host: "127.0.0.1".into(),
            port: 6742,
            mode: RgbMode::Ambient,
            static_color: [80, 120, 255],
            zones: Vec::new(),
            mixer: RgbMixer::default(),
            min_update_ms: 100,
            excluded_devices: Vec::new(),
            device_names: HashMap::new(),
            animation_speed: 1.0,
            idle_timeout_sec: 30,
            idle_check_interval_sec: 5,
            accent_device: None,
            audio_sensitivity: 1.0,
            audio_smoothing: 0.3,
            audio_source: "system".into(),
            wave_direction: 1,
            cycle_spread: 360.0,
            night_start: String::new(),
            night_end: String::new(),
            night_brightness: 0.3,
            track_flash_ms: 0,
        }
    }
}


#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StickerFit {
    Contain,
    Cover,
    Fill,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct StickerDef {
    pub id: String,
    pub name: String,
    pub url: String,
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub rotation: f64,
    pub opacity: f64,
    pub muted: bool,
    pub visible: bool,
    #[serde(default)]
    pub on_top: bool,
}

impl Default for StickerDef {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            url: String::new(),
            x: 0,
            y: 0,
            w: crate::tokens::sticker_default_w(),
            h: crate::tokens::sticker_default_h(),
            rotation: 0.0,
            opacity: 1.0,
            muted: false,
            visible: true,
            on_top: false,
        }
    }
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct StickerSnap {
    pub grid: bool,
    pub guides: bool,
    pub grid_size: u32,
}

impl Default for StickerSnap {
    fn default() -> Self {
        Self {
            grid: true,
            guides: true,
            grid_size: 32,
        }
    }
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct StickerConfig {
    pub remove_background: bool,
    pub all_monitors: bool,
}

impl Default for StickerConfig {
    fn default() -> Self {
        Self {
            remove_background: true,
            all_monitors: true,
        }
    }
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GalleryEntry {
    pub id: String,
    pub name: String,
    pub kind: WallpaperKind,
    pub source: String,
    pub added_ms: u64,
    pub thumb: Option<String>,
    #[serde(default)]
    pub opts: Option<EntryOptions>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub last_applied_ms: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EntryOptions {
    pub fit: Option<String>,
    pub speed: Option<f32>,
    pub volume: Option<f64>,
    pub brightness: Option<f32>,
    pub saturation: Option<f32>,
    pub hue: Option<f32>,
}

impl EntryOptions {
    pub fn is_empty(&self) -> bool {
        self.fit.is_none()
            && self.speed.is_none()
            && self.volume.is_none()
            && self.brightness.is_none()
            && self.saturation.is_none()
            && self.hue.is_none()
    }

    pub fn apply_to(&self, cfg: &mut WallpaperConfig) {
        if let Some(v) = &self.fit {
            cfg.video_fit = v.clone();
        }
        if let Some(v) = self.speed {
            cfg.video_speed = v;
        }
        if let Some(v) = self.volume {
            cfg.volume = v;
        }
        if let Some(v) = self.brightness {
            cfg.video_brightness = v;
        }
        if let Some(v) = self.saturation {
            cfg.video_saturation = v;
        }
        if let Some(v) = self.hue {
            cfg.video_hue = v;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct WallpaperCollection {
    pub id: String,
    pub name: String,
    pub entry_ids: Vec<String>,
}

impl Default for WallpaperCollection {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            entry_ids: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct WallpaperPlaylist {
    pub id: String,
    pub name: String,
    pub source: String,
    pub rules: Vec<PlaylistRule>,
    pub shuffle_min: u32,
    pub crossfade_sec: f64,
    pub enabled: bool,
}

impl Default for WallpaperPlaylist {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            source: "all".into(),
            rules: Vec::new(),
            shuffle_min: 0,
            crossfade_sec: 1.5,
            enabled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PlaylistRule {
    pub start: String,
    pub source: String,
}

impl Default for PlaylistRule {
    fn default() -> Self {
        Self {
            start: "00:00".into(),
            source: "all".into(),
        }
    }
}

impl PlaylistRule {
    pub fn start_minutes(&self) -> Option<u32> {
        let (h, m) = self.start.split_once(':')?;
        let h: u32 = h.trim().parse().ok()?;
        let m: u32 = m.trim().parse().ok()?;
        if h > 23 || m > 59 {
            return None;
        }
        Some(h * 60 + m)
    }
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SceneProfile {
    pub id: String,
    pub name: String,
    pub wallpaper: WallpaperConfig,
    pub rgb: RgbConfig,
    pub stickers: Vec<StickerDef>,
    pub logo: Option<String>,
    pub created_ms: u64,
}

impl Default for SceneProfile {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            wallpaper: WallpaperConfig::default(),
            rgb: RgbConfig::default(),
            stickers: Vec::new(),
            logo: None,
            created_ms: 0,
        }
    }
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub version: u32,
    pub general: GeneralConfig,
    pub wallpaper: WallpaperConfig,
    pub rgb: RgbConfig,
    pub stickers: Vec<StickerDef>,
    pub gallery: Vec<GalleryEntry>,
    pub gallery_shuffle: bool,
    pub collections: Vec<WallpaperCollection>,
    pub playlists: Vec<WallpaperPlaylist>,
    pub scenes: Vec<SceneProfile>,
    pub sticker_snap: StickerSnap,
    pub sticker: StickerConfig,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            general: GeneralConfig::default(),
            wallpaper: WallpaperConfig::default(),
            rgb: RgbConfig::default(),
            stickers: Vec::new(),
            gallery: Vec::new(),
            gallery_shuffle: false,
            collections: Vec::new(),
            playlists: Vec::new(),
            scenes: Vec::new(),
            sticker_snap: StickerSnap::default(),
            sticker: StickerConfig::default(),
        }
    }
}

#[cfg(test)]
mod device_name_tests {
    use super::*;

    #[test]
    fn a_config_without_device_names_still_loads() {
        let raw = serde_json::json!({ "version": CONFIG_VERSION, "rgb": {} });
        let cfg: Config = serde_json::from_value(raw).expect("an older config parses");
        assert!(cfg.rgb.device_names.is_empty());
    }

    #[test]
    fn device_names_survive_a_round_trip() {
        let mut names = HashMap::new();
        names.insert(4u32, "Desk strip".to_string());
        let mut rgb = RgbConfig::default();
        rgb.device_names = names;

        let json = serde_json::to_value(&rgb).expect("serialises");
        assert_eq!(json["deviceNames"]["4"], "Desk strip");
        let back: RgbConfig = serde_json::from_value(json).expect("deserialises");
        assert_eq!(back.device_names.get(&4).map(String::as_str), Some("Desk strip"));
    }

    #[test]
    fn default_is_empty() {
        assert!(RgbConfig::default().device_names.is_empty());
    }

    #[test]
    fn a_config_without_screen_names_still_loads() {
        let raw = serde_json::json!({ "version": CONFIG_VERSION, "general": {} });
        let cfg: Config = serde_json::from_value(raw).expect("an older config parses");
        assert!(cfg.general.screen_names.is_empty());
    }

    #[test]
    fn screen_names_survive_a_round_trip() {
        let mut names = HashMap::new();
        names.insert(r"\.\DISPLAY2".to_string(), "Desk".to_string());
        let mut general = GeneralConfig::default();
        general.screen_names = names;

        let json = serde_json::to_value(&general).expect("serialises");
        assert_eq!(json["screenNames"][r"\.\DISPLAY2"], "Desk");
        let back: GeneralConfig = serde_json::from_value(json).expect("deserialises");
        assert_eq!(
            back.screen_names.get(r"\.\DISPLAY2").map(String::as_str),
            Some("Desk")
        );
    }
}

#[cfg(test)]
mod playlist_tests {
    use super::*;

    fn rule(start: &str) -> PlaylistRule {
        PlaylistRule {
            start: start.into(),
            source: "all".into(),
        }
    }

    #[test]
    fn rule_parses_valid_times() {
        assert_eq!(rule("08:30").start_minutes(), Some(510));
        assert_eq!(rule("00:00").start_minutes(), Some(0));
        assert_eq!(rule("23:59").start_minutes(), Some(1439));
    }

    #[test]
    fn rule_rejects_malformed_times() {
        assert_eq!(rule("24:00").start_minutes(), None);
        assert_eq!(rule("12:60").start_minutes(), None);
        assert_eq!(rule("abc").start_minutes(), None);
        assert_eq!(rule("8:").start_minutes(), None);
    }

    #[test]
    fn collections_and_playlists_default_empty() {
        let cfg = Config::default();
        assert!(cfg.collections.is_empty());
        assert!(cfg.playlists.is_empty());
    }

    #[test]
    fn an_old_scene_without_stickers_still_deserializes() {
        let old = r#"{
            "id": "scene-1",
            "name": "Evening",
            "createdMs": 1700000000000,
            "wallpaper": {},
            "rgb": {}
        }"#;
        let scene: SceneProfile = serde_json::from_str(old).expect("old scene must load");
        assert_eq!(scene.name, "Evening");
        assert!(
            scene.stickers.is_empty(),
            "an old scene recalls with an empty desk, not a failed load"
        );
    }

    #[test]
    fn a_scene_roundtrips_its_stickers() {
        let mut scene = SceneProfile {
            id: "scene-2".into(),
            name: "Desk".into(),
            created_ms: 1,
            ..Default::default()
        };
        scene.stickers.push(StickerDef {
            id: "s1".into(),
            name: "clock".into(),
            url: "media://s1.png".into(),
            x: 10,
            y: 20,
            w: 100,
            h: 100,
            ..Default::default()
        });
        let json = serde_json::to_string(&scene).expect("scene serialises");
        let back: SceneProfile = serde_json::from_str(&json).expect("scene deserialises");
        assert_eq!(back.stickers.len(), 1);
        assert_eq!(back.stickers[0].name, "clock");
    }

    #[test]
    fn saved_lighting_profiles_become_configs_on_load() {
        let old = serde_json::json!({
            "version": 1,
            "wallpaper": { "kind": "video", "source": "media://a.mp4" },
            "stickers": [{ "id": "s1", "name": "cat" }],
            "rgb": {
                "mode": "ambient",
                "staticColor": [80, 120, 255],
                "animationSpeed": 1.0,
                "enabled": false,
                "profiles": [
                    { "name": "Chill", "mode": "ambient", "staticColor": [0, 0, 255], "animationSpeed": 0.5 },
                    { "name": "Rage", "mode": "wave", "staticColor": [255, 0, 0], "animationSpeed": 3.0 }
                ]
            }
        });
        let mut raw = old;
        migrate(&mut raw, Some(1)).expect("a v1 config must migrate");

        let cfg: Config = serde_json::from_value(raw.clone()).expect("migrated config parses");
        assert_eq!(cfg.scenes.len(), 2, "each profile becomes one config");
        assert_eq!(cfg.scenes[0].name, "Chill");
        assert_eq!(cfg.scenes[1].name, "Rage");

        assert_eq!(cfg.scenes[0].rgb.mode, RgbMode::Ambient);
        assert_eq!(cfg.scenes[0].rgb.static_color, [0, 0, 255]);
        assert_eq!(cfg.scenes[0].rgb.animation_speed, 0.5);
        assert_eq!(cfg.scenes[1].rgb.mode, RgbMode::Wave);
        assert!(!cfg.scenes[0].rgb.enabled, "unrelated RGB settings must survive");
        assert_eq!(cfg.scenes[0].wallpaper.kind, WallpaperKind::Video);
        assert_eq!(cfg.scenes[0].wallpaper.source, "media://a.mp4");
        assert_eq!(cfg.scenes[0].stickers.len(), 1);

        assert!(raw["rgb"].get("profiles").is_none());
        assert!(raw["scenes"][0]["rgb"].get("profiles").is_none());
    }

    #[test]
    fn ids_of_migrated_configs_cannot_collide_with_saved_ones() {
        let old = serde_json::json!({
            "version": 1,
            "rgb": { "profiles": [
                { "name": "Chill", "mode": "ambient", "staticColor": [0, 0, 255], "animationSpeed": 1.0 }
            ]},
            "scenes": [{ "id": "scene-from-profile-0", "name": "Mine", "wallpaper": {}, "rgb": {} }]
        });
        let mut raw = old;
        migrate(&mut raw, Some(1)).expect("a v1 config must migrate");
        let ids: Vec<String> = raw["scenes"]
            .as_array()
            .expect("scenes stay an array")
            .iter()
            .map(|s| s["id"].as_str().expect("every config has an id").to_string())
            .collect();
        assert_eq!(ids.len(), 2);
        assert_ne!(
            ids[0], ids[1],
            "a migrated config must not reuse a stored id"
        );
    }

    #[test]
    fn a_config_without_saved_profiles_is_left_alone() {
        let old = serde_json::json!({
            "version": 1,
            "rgb": { "mode": "wave" },
            "scenes": [{ "id": "scene-1", "name": "Mine", "wallpaper": {}, "rgb": {} }]
        });
        let mut raw = old;
        migrate(&mut raw, Some(1)).expect("a v1 config must migrate");
        let cfg: Config = serde_json::from_value(raw).expect("config parses");
        assert_eq!(cfg.scenes.len(), 1, "nothing to convert means nothing added");
        assert_eq!(cfg.scenes[0].name, "Mine");
    }

    #[test]
    fn a_bound_next_scene_hotkey_survives_its_rename() {
        let old = serde_json::json!({
            "version": 1,
            "general": { "hotkeys": { "nextScene": { "accelerator": "Ctrl+Alt+S" } } }
        });
        let mut raw = old;
        migrate(&mut raw, Some(1)).expect("a v1 config must migrate");
        let cfg: Config = serde_json::from_value(raw.clone()).expect("config parses");
        assert_eq!(
            cfg.general.hotkeys.next_profile.accelerator,
            "Ctrl+Alt+S",
            "a user who bound the action keeps it after the rename"
        );
        assert!(
            !raw["general"]["hotkeys"].as_object().expect("hotkeys stay an object").contains_key("nextScene"),
            "the old key must not be written back out"
        );
    }

    #[test]
    fn playlist_serde_roundtrip() {
        let pl = WallpaperPlaylist {
            id: "pl-1".into(),
            name: "Day cycle".into(),
            source: "collection:abc".into(),
            rules: vec![rule("08:00")],
            shuffle_min: 30,
            crossfade_sec: 1.5,
            enabled: true,
        };
        let json = serde_json::to_string(&pl).unwrap();
        let back: WallpaperPlaylist = serde_json::from_str(&json).unwrap();
        assert_eq!(pl, back);
        assert!(json.contains("\"shuffleMin\":30"));
    }


    #[test]
    fn hotkeys_default_to_unbound() {
        let g = GeneralConfig::default();
        for (id, binding) in g.hotkeys.entries() {
            assert!(binding.is_empty(), "{id} must not grab a key on first run");
        }
    }

    #[test]
    fn hotkey_entries_cover_every_action_exactly_once() {
        let g = GeneralConfig::default();
        let mut ids: Vec<&str> = g.hotkeys.entries().iter().map(|(id, _)| *id).collect();
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), count, "duplicate action id in HotkeyConfig::entries");
        for expected in [
            "toggleDashboard",
            "playPause",
            "nextTrack",
            "prevTrack",
            "toggleMute",
            "volumeUp",
            "volumeDown",
            "toggleWallpaper",
            "cycleLightingMode",
            "nextProfile",
            "nextWallpaper",
        ] {
            assert!(ids.contains(&expected), "entries() is missing {expected}");
        }
    }

    #[test]
    fn hotkeys_survive_an_old_config_without_the_section() {
        let old = serde_json::json!({ "version": 1, "general": { "theme": "dark" } });
        let cfg: Config = serde_json::from_value(old).expect("pre-hotkey config must parse");
        assert!(cfg.general.hotkeys.entries().iter().all(|(_, b)| b.is_empty()));
        assert!(
            cfg.general.hotkeys_enabled,
            "upgrading must not silently disable existing hotkeys"
        );
    }

    #[test]
    fn blink_settings_survive_an_old_config_without_them() {
        let old = serde_json::json!({ "version": 1, "general": { "theme": "dark" } });
        let cfg: Config = serde_json::from_value(old).expect("pre-blink config must parse");
        assert_eq!(cfg.general.hotkey_blink_ms, default_hotkey_blink_ms());
        assert_eq!(cfg.general.hotkey_blink_color, [255, 255, 255]);
    }

    #[test]
    fn a_new_config_follows_the_system_theme() {
        assert_eq!(GeneralConfig::default().theme, ThemeMode::System);
        assert_eq!(Config::default().general.theme, ThemeMode::System);
    }

    #[test]
    fn an_explicit_theme_from_an_older_config_is_still_honoured() {
        let old = serde_json::json!({ "version": 1, "general": { "theme": "dark" } });
        let cfg: Config = serde_json::from_value(old).expect("pre-system config must parse");
        assert_eq!(cfg.general.theme, ThemeMode::Dark);
    }

    #[test]
    fn a_chosen_update_interval_is_kept_through_a_roundtrip() {
        let mut cfg = Config::default();
        cfg.general.update_check_minutes = 30;
        let json = serde_json::to_string(&cfg).unwrap();
        let back: Config = serde_json::from_str(&json).unwrap();
        assert_eq!(back.general.update_check_minutes, 30);
    }

    #[test]
    fn the_update_interval_is_stored_under_the_name_the_dashboard_sends() {
        let cfg = Config::default();
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(
            json.contains("\"updateCheckMinutes\""),
            "expected the camelCase key, got: {json}"
        );
        assert!(!json.contains("update_check_minutes"));
    }

    #[test]
    fn a_custom_blink_color_is_kept_through_a_roundtrip() {
        let mut cfg = Config::default();
        cfg.general.hotkey_blink_color = [0, 128, 255];
        cfg.general.hotkey_blink_ms = 700;
        let json = serde_json::to_string(&cfg).unwrap();
        let back: Config = serde_json::from_str(&json).unwrap();
        assert_eq!(back.general.hotkey_blink_color, [0, 128, 255]);
        assert_eq!(back.general.hotkey_blink_ms, 700);
    }

    #[test]
    fn hotkey_binding_roundtrips_and_ignores_blank_accelerators() {
        let mut hk = HotkeyConfig::default();
        hk.toggle_mute = HotkeyBinding::bound("Ctrl+Alt+M");
        hk.play_pause = HotkeyBinding::bound("   ");
        let json = serde_json::to_string(&hk).unwrap();
        assert!(json.contains("\"accelerator\":\"Ctrl+Alt+M\""));
        let back: HotkeyConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(hk, back);
        assert!(!back.toggle_mute.is_empty());
        assert!(back.play_pause.is_empty(), "whitespace is not a binding");
    }
}

#[cfg(test)]
mod entry_options_tests {
    use super::{EntryOptions, GalleryEntry, WallpaperConfig, WallpaperKind};

    fn entry() -> GalleryEntry {
        GalleryEntry {
            id: "g1".into(),
            name: "clip".into(),
            kind: WallpaperKind::Video,
            source: "C:/clip.mp4".into(),
            added_ms: 0,
            thumb: None,
            opts: None,
            favorite: false,
            last_applied_ms: None,
        }
    }

    #[test]
    fn an_entry_without_the_field_still_parses() {
        let json = r#"{"id":"g1","name":"clip","kind":"video","source":"C:/clip.mp4","addedMs":0}"#;
        let e: GalleryEntry = serde_json::from_str(json).unwrap();
        assert!(e.opts.is_none());
    }

    #[test]
    fn a_set_option_survives_the_round_trip() {
        let e = GalleryEntry {
            opts: Some(EntryOptions {
                speed: Some(0.5),
                fit: Some("contain".into()),
                ..Default::default()
            }),
            ..entry()
        };
        let json = serde_json::to_string(&e).unwrap();
        let back: GalleryEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(back.opts.as_ref().unwrap().speed, Some(0.5));
        assert_eq!(back.opts.as_ref().unwrap().fit.as_deref(), Some("contain"));
    }

    #[test]
    fn an_empty_bag_changes_nothing() {
        let mut w = WallpaperConfig::default();
        w.video_speed = 2.0;
        let before = w.clone();
        EntryOptions::default().apply_to(&mut w);
        assert_eq!(w, before);
        assert!(EntryOptions::default().is_empty());
    }

    #[test]
    fn only_the_set_fields_are_overlaid() {
        let mut w = WallpaperConfig::default();
        w.video_fit = "cover".into();
        w.video_speed = 1.0;
        w.volume = 0.5;
        let opts = EntryOptions {
            volume: Some(0.0),
            ..Default::default()
        };
        opts.apply_to(&mut w);
        assert_eq!(w.volume, 0.0);
        assert_eq!(w.video_fit, "cover", "an unset field must not be reset");
        assert_eq!(w.video_speed, 1.0);
    }

    #[test]
    fn a_bag_with_one_field_in_it_is_not_empty() {
        let opts = EntryOptions {
            hue: Some(0.0),
            ..Default::default()
        };
        assert!(!opts.is_empty());
    }
}
