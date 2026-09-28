//! Persistence model for LumenDeck settings, mirrored by src/shared/types.ts.

use serde::{Deserialize, Serialize};

pub const CONFIG_VERSION: u32 = 1;

/// Migrate a config written by an older app version to the current schema.
/// Serde's `default` fields already absorb additive changes; this hook is for
/// *breaking* changes (renamed keys, moved data, semantic shifts). Bump
/// `CONFIG_VERSION` and add a match arm per old version. `from` is the
/// version read from the file — `None` means the file predates versioning.
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
    // Example for a future break:
    //   if from < 2 { rename_key(raw, "oldName", "newName"); }
    let _ = from;
    raw["version"] = serde_json::json!(CONFIG_VERSION);
    Ok(())
}

// ---------- General ----------

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
    pub pause_on_battery_saver: bool,
    pub pause_on_fullscreen: bool,
    pub wallpaper_enabled: bool,
    /// UI accent follows live device colors (true) or frozen to the static color (false).
    pub accent_live: bool,
    /// Decode wallpaper video in software (for machines whose hardware
    /// decoder misbehaves). Costs CPU and destabilizes 4K pipelines — the
    /// hardware path is the default. Read once at startup.
    pub software_video_decode: bool,
    /// Sync the Windows accent color to the wallpaper's dominant color.
    pub accent_sync_enabled: bool,
    /// Remember the user's pre-sync accent on first enable so it can be
    /// restored when the toggle goes off again.
    pub accent_sync_armed: bool,
    /// Apply wallpaper changes to the Windows lock screen too (off by
    /// default: some users prefer keeping a personal lock image).
    pub lock_screen_follows_wallpaper: bool,
    /// First-run onboarding wizard has been completed. False on fresh
    /// installs; the dashboard shows a guided setup until it's done.
    pub onboarded: bool,
    /// AMOLED mode: true-black surfaces in dark theme (pixels fully off on
    /// OLED panels). Ignored in light theme.
    pub amoled: bool,
    /// The titlebar minimize button hides the dashboard into the notification
    /// area instead of parking it on the taskbar. Wallpapers and lighting
    /// keep running either way; the tray icon brings the window back.
    pub minimize_to_tray: bool,
    /// A launch-at-login start shows the dashboard instead of coming up in
    /// the tray. Off by default: the wallpaper and lights are the point of
    /// an autostart, and a window popping up over a freshly booted desktop
    /// is not. Ignored when `autostart` is off — a manual start always
    /// shows the window.
    pub show_dashboard_on_login: bool,
    /// Internal: the one-time "running in the background" tray balloon has
    /// been shown, so a quiet login start is explained exactly once.
    pub startup_hint_shown: bool,
    /// Internal: the last version whose release notes were opened in the
    /// dashboard. Empty = never read. Drives the "what's new" marker.
    pub changelog_seen_version: String,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            autostart: false,
            theme: ThemeMode::Dark,
            // Off by default: a laptop user's first run should show a live
            // wallpaper, not a frozen frame just because the charger is
            // unplugged. Opt in from the General tab.
            pause_on_battery_saver: false,
            pause_on_fullscreen: true,
            wallpaper_enabled: true,
            accent_live: false,
            software_video_decode: false,
            accent_sync_enabled: false,
            accent_sync_armed: false,
            lock_screen_follows_wallpaper: false,
            onboarded: false,
            amoled: false,
            // Tray, not taskbar: a taskbar button for a window that only
            // shows a wallpaper would be the app's most visible feature.
            minimize_to_tray: true,
            show_dashboard_on_login: false,
            startup_hint_shown: false,
            changelog_seen_version: String::new(),
        }
    }
}

// ---------- Wallpaper ----------

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
    /// media:// URL or absolute path for video/image, URL for web, preset id for shader.
    pub source: String,
    pub volume: f64,
    pub slideshow: SlideshowConfig,
    /// How video fills each monitor: "cover" (fill, crop), "contain"
    /// (letterbox, aspect-correct), "fill" (stretch), or "auto" (cover when
    /// the video aspect is within 10% of the display, else contain).
    pub video_fit: String,
    /// Video playback rate (1.0 = normal). Clamped in the runtime to 0.1..8.
    pub video_speed: f32,
    /// Video color grading: multiplier on brightness (1 = unchanged).
    pub video_brightness: f32,
    /// Video color grading: saturation multiplier (1 = unchanged, 0 = gray).
    pub video_saturation: f32,
    /// Video color grading: hue rotation in degrees (-180..180).
    pub video_hue: f32,
    /// Per-display wallpaper overrides, keyed by monitor device string
    /// (e.g. "\\.\DISPLAY1"). A display with no entry uses the global
    /// wallpaper config. Only kind+source are overridden; playback options
    /// (fit, speed, grading, volume) stay global.
    pub per_monitor: std::collections::BTreeMap<String, PerMonitorWallpaper>,
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
        }
    }
}

// ---------- RGB ----------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RgbMode {
    Ambient,
    Zone,
    Pulse,
    Static,
    /// Rainbow gradient marching along the LED strip (per-LED).
    Wave,
    /// Enture device cycles through hues over time (per-LED, uniform).
    Cycle,
    /// Smooth brightness breathing on the static color.
    Breathe,
    /// LEDs pulse in sync with system audio.
    #[serde(rename = "audioReactive")]
    AudioReactive,
}

impl RgbMode {
    /// Pure animation modes generate their own frames and don't wait for
    /// wallpaper samples. They also want a faster push cadence than the
    /// reactive modes so motion looks fluid.
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
    /// 0 = grayscale, 1 = normal, >1 boosted.
    pub saturation: f64,
    pub gamma: f64,
    /// 0 = snap, 1 = very slow easing.
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
    /// Normalized rect within the wallpaper (0..1).
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
    /// Animation playback speed multiplier (0.1..5, 1 = normal).
    pub animation_speed: f64,
    /// Seconds of inactivity before lights turn off (0 = disabled, min 30).
    pub idle_timeout_sec: u64,
    /// How often (seconds) to check for idle state (1..60).
    pub idle_check_interval_sec: u64,
    /// Device driving the dashboard accent color (None = auto, Some(-1) = static).
    pub accent_device: Option<u32>,
    /// Audio-reactive sensitivity (0.1..3, 1 = normal).
    pub audio_sensitivity: f64,
    /// Audio-reactive smoothing (0 = snap, 1 = very slow).
    pub audio_smoothing: f64,
    /// Audio capture source: "system" (WASAPI loopback) or "microphone" (WASAPI capture).
    pub audio_source: String,
    /// Wave mode travel direction: 1 = forward, -1 = reverse.
    pub wave_direction: i32,
    /// Cycle mode rainbow spread across the strip in degrees (30..720).
    pub cycle_spread: f64,
    /// Named lighting profiles: snapshot of mode/color/speed for quick switching.
    pub profiles: Vec<RgbProfile>,
    /// Night dimming: between `night_start` and `night_end` (local "hh:mm",
    /// may wrap midnight), device brightness is capped at `night_brightness`
    /// (0..1). Empty strings = disabled.
    pub night_start: String,
    pub night_end: String,
    /// Brightness cap during the night window (0..1).
    pub night_brightness: f64,
}

/// A named lighting profile bundling the most-tweaked RGB knobs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RgbProfile {
    pub name: String,
    pub mode: RgbMode,
    pub static_color: [u8; 3],
    pub animation_speed: f64,
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
            animation_speed: 1.0,
            idle_timeout_sec: 30,
            idle_check_interval_sec: 5,
            accent_device: None,
            audio_sensitivity: 1.0,
            audio_smoothing: 0.3,
            audio_source: "system".into(),
            wave_direction: 1,
            cycle_spread: 360.0,
            profiles: Vec::new(),
            night_start: String::new(),
            night_end: String::new(),
            night_brightness: 0.3,
        }
    }
}

// ---------- Stickers ----------

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
    /// Virtual-screen coordinates (px).
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub rotation: f64,
    pub opacity: f64,
    pub muted: bool,
    pub visible: bool,
    /// Render in a topmost OS window above all applications instead of the
    /// wallpaper layer (which sits behind desktop icons).
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
            w: crate::constants_sticker::DEFAULT_W,
            h: crate::constants_sticker::DEFAULT_H,
            rotation: 0.0,
            opacity: 1.0,
            muted: false,
            visible: true,
            on_top: false,
        }
    }
}

// ---------- Sticker snapping ----------

/// Snap behavior for the on-wallpaper sticker editor. Guides = alignment
/// against other stickers and monitor edges/centers; grid = quantum snap.
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

// ---------- Sticker behavior ----------

/// Sticker behavior settings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct StickerConfig {
    /// Remove flat background at placement time (transparent PNG/APNG).
    pub remove_background: bool,
    /// Mirror every wallpaper-layer sticker onto all monitors instead of
    /// showing it only at its placed virtual-screen position.
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

// ---------- Gallery ----------

/// One saved wallpaper in the gallery. Videos/images persist by absolute path;
/// web/shader presets are also allowed so everything appears in one grid.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GalleryEntry {
    pub id: String,
    pub name: String,
    pub kind: WallpaperKind,
    /// Absolute path (video/image), URL (web), or preset id (shader).
    pub source: String,
    /// Milliseconds since epoch (added time; drives ordering).
    pub added_ms: u64,
    /// Small JPEG data-URL preview captured client-side (optional).
    pub thumb: Option<String>,
}

/// A named group of vault entries. Entries keep their global vault ids;
/// collections are just membership lists, so an entry can live in several.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct WallpaperCollection {
    pub id: String,
    pub name: String,
    /// Gallery entry ids, in display order.
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

/// A playlist: rotation source over a collection (or the whole vault) that
/// switches the active wallpaper on a schedule.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct WallpaperPlaylist {
    pub id: String,
    pub name: String,
    /// `collection:<id>` or `all` for the whole vault.
    pub source: String,
    /// Ordered time-of-day rules; first rule whose start <= now wins.
    /// Empty = interval/shuffle mode only.
    pub rules: Vec<PlaylistRule>,
    /// Shuffle to a different entry every N minutes (0 = off).
    pub shuffle_min: u32,
    /// Crossfade seconds between playlist transitions (0 = instant cut).
    pub crossfade_sec: f64,
    /// True when the playlist is the active rotation.
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

/// One time-of-day rule: from `hh:mm` the playlist applies its own shuffle
/// within the given filter (a collection id, or `all`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PlaylistRule {
    /// Start time "hh:mm" (local, 24h). The last rule before midnight wins
    /// until the next day's first rule.
    pub start: String,
    /// `collection:<id>` or `all`.
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
    /// Parse "hh:mm" into minutes-of-day; None when malformed.
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

// ---------- Scenes ----------

/// Full-look snapshot: everything that defines the machine's vibe right now.
/// Recall restores the entire snapshot in one command.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SceneProfile {
    pub id: String,
    pub name: String,
    /// Whole-wallpaper config (kind/source/videoFit/fx/per-monitor overrides).
    pub wallpaper: WallpaperConfig,
    /// Whole-RGB config (mode/mixer/zones/profiles list stays shared).
    pub rgb: RgbConfig,
    /// Snapshot timestamp (ms) for the UI.
    pub created_ms: u64,
}

impl Default for SceneProfile {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            wallpaper: WallpaperConfig::default(),
            rgb: RgbConfig::default(),
            created_ms: 0,
        }
    }
}

// ---------- Root ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub version: u32,
    pub general: GeneralConfig,
    pub wallpaper: WallpaperConfig,
    pub rgb: RgbConfig,
    pub stickers: Vec<StickerDef>,
    pub gallery: Vec<GalleryEntry>,
    pub collections: Vec<WallpaperCollection>,
    pub playlists: Vec<WallpaperPlaylist>,
    /// Scene profiles: full-look snapshots (wallpaper + RGB + per-monitor
    /// overrides) with instant recall — one click switches the entire vibe.
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
            collections: Vec::new(),
            playlists: Vec::new(),
            scenes: Vec::new(),
            sticker_snap: StickerSnap::default(),
            sticker: StickerConfig::default(),
        }
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
}
