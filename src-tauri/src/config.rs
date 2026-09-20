//! Persistence model for LumenDeck settings, mirrored by src/shared/types.ts.

use serde::{Deserialize, Serialize};

pub const CONFIG_VERSION: u32 = 1;

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
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            autostart: false,
            theme: ThemeMode::Dark,
            pause_on_battery_saver: true,
            pause_on_fullscreen: true,
            wallpaper_enabled: true,
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
}

impl Default for WallpaperConfig {
    fn default() -> Self {
        Self {
            kind: WallpaperKind::Shader,
            source: "aurora".into(),
            volume: 0.0,
            slideshow: SlideshowConfig::default(),
            video_fit: "auto".into(),
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
}

impl RgbMode {
    /// Pure animation modes generate their own frames and don't wait for
    /// wallpaper samples. They also want a faster push cadence than the
    /// reactive modes so motion looks fluid.
    pub fn is_animation(&self) -> bool {
        matches!(self, RgbMode::Wave | RgbMode::Cycle | RgbMode::Breathe)
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
            idle_timeout_sec: 0,
            idle_check_interval_sec: 10,
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
}

impl Default for StickerConfig {
    fn default() -> Self {
        Self {
            remove_background: true,
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
            sticker_snap: StickerSnap::default(),
            sticker: StickerConfig::default(),
        }
    }
}
