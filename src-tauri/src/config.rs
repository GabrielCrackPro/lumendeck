//! Persistence model for LumenDeck settings, mirrored by src/shared/types.ts.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    /// Which palette to paint. Defaults to following the OS: an app that
    /// fights the system theme on a light machine reads as broken, whatever
    /// its own default once was. Only new configs are affected — anyone who
    /// has already chosen keeps what they chose.
    pub theme: ThemeMode,
    /// UI language: "auto" follows the Windows display language, anything
    /// else is a locale tag this build may or may not ship. Defaults to
    /// "auto" so a Spanish Windows gets a Spanish app without anyone
    /// visiting Settings — the one thing nobody should have to configure.
    pub language: String,
    /// User-chosen names for displays, keyed by the Windows device name
    /// ("\.\DISPLAY1").
    ///
    /// The raw key is what identifies a display to Windows, but it is not a
    /// name a person would use — the panel currently shows ".DISPLAY1" or
    /// nothing at all. The alias is local to LumenDeck, and an absent or
    /// blank entry means "fall back to the device name".
    #[serde(default)]
    pub screen_names: HashMap<String, String>,
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
    /// Dashboard accent auto-shade: how strongly the UI lifts/darkens a
    /// source color until it is legible on the theme surface. 0.0 = off
    /// (raw colors, may be hard to read), 1.0 = full adjustment to clear
    /// the contrast floor. Hardware colors are unaffected either way.
    pub accent_auto_shade: f64,
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
    /// Master switch for system-wide key bindings. False releases every
    /// binding the OS is holding, which is the emergency off-ramp when a
    /// combo misbehaves. Defaults to true: a fresh install binds nothing
    /// anyway (every action ships unbound), so this costs no privacy on
    /// first run, and starting false would silently break the bindings of
    /// anyone who had already configured some.
    pub hotkeys_enabled: bool,
    /// System-wide key bindings, applied by `crate::hotkeys` from the tray
    /// process so they keep working while the dashboard is hidden.
    pub hotkeys: HotkeyConfig,
    /// Blink the keyboard backlight when a binding fires, so a combo can be
    /// confirmed with your eyes on the wallpaper rather than the tray. 0 =
    /// disabled; otherwise the total blink duration in milliseconds
    /// (150..1000). Ignored while `hotkeys_enabled` is false — nothing can
    /// fire to trigger it.
    #[serde(default = "default_hotkey_blink_ms")]
    pub hotkey_blink_ms: u64,
    /// Colour of that blink. White by default because it reads against any
    /// wallpaper accent; a hue can vanish into a room lit that colour.
    #[serde(default = "default_hotkey_blink_color")]
    pub hotkey_blink_color: [u8; 3],
}

/// One configurable system-wide shortcut.
///
/// `accelerator` uses the Tauri/`global-hotkey` grammar, e.g.
/// `"Ctrl+Alt+M"`. An empty string means "not bound" — bindings default to
/// unbound on purpose: registering OS-wide key grabs the user never asked for
/// is the fastest way to make an ambient app feel hostile. The dashboard shows
/// a suggested combo per action and the user opts in.
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

/// Every action a hotkey can trigger, each with its own (possibly empty)
/// binding. Adding a field here is additive: older config files deserialize
/// with the field defaulted, and the action shows up unbound in the UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HotkeyConfig {
    /// Show the dashboard if hidden, hide it if visible.
    pub toggle_dashboard: HotkeyBinding,
    pub play_pause: HotkeyBinding,
    pub next_track: HotkeyBinding,
    pub prev_track: HotkeyBinding,
    /// Mute/unmute the system output device.
    pub toggle_mute: HotkeyBinding,
    /// System volume up/down by 5%.
    pub volume_up: HotkeyBinding,
    pub volume_down: HotkeyBinding,
    /// Pause/resume the live wallpaper.
    pub toggle_wallpaper: HotkeyBinding,
    /// Step to the next lighting mode (same order as the tray menu).
    pub cycle_lighting_mode: HotkeyBinding,
    /// Cycle saved RGB profiles.
    pub next_profile: HotkeyBinding,
    /// Apply the next saved scene profile.
    pub next_scene: HotkeyBinding,
    /// Advance the active playlist / gallery to the next entry.
    pub next_wallpaper: HotkeyBinding,
}

impl HotkeyConfig {
    /// `(action id, binding)` pairs, in a stable order. The ids match the
    /// frontend's `HotkeyAction` union and the tray's dispatch table.
    pub fn entries(&self) -> [(&'static str, &HotkeyBinding); 12] {
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
            ("nextScene", &self.next_scene),
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
            accent_auto_shade: 1.0,
            amoled: false,
            // Tray, not taskbar: a taskbar button for a window that only
            // shows a wallpaper would be the app's most visible feature.
            minimize_to_tray: true,
            show_dashboard_on_login: false,
            startup_hint_shown: false,
            changelog_seen_version: String::new(),
            // Unbound by default; see HotkeyBinding.
            hotkeys: HotkeyConfig::default(),
            hotkeys_enabled: true,
            hotkey_blink_ms: default_hotkey_blink_ms(),
            hotkey_blink_color: default_hotkey_blink_color(),
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
    /// (e.g. "\.\DISPLAY1"). A display with no entry uses the global
    /// wallpaper config. Only kind+source are overridden there; per-entry
    /// playback options (see EntryOptions) are layered on afterwards.
    pub per_monitor: std::collections::BTreeMap<String, PerMonitorWallpaper>,
    /// Whether importing a wallpaper also puts it on the displays.
    ///
    /// On by default, because for a single file that is almost always what you
    /// meant. It is wrong for a folder: importing sixty files then leaves the
    /// sixtieth one on your desktop, which is never the intent.
    pub apply_after_import: bool,
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
    /// User-chosen names for devices, keyed by OpenRGB device id.
    ///
    /// OpenRGB reports whatever the driver called the device, which is often a
    /// model string repeated across a desk ("LEDStrip1", "LEDStrip2") and
    /// never localised. The alias is local to LumenDeck — OpenRGB owns the
    /// real name — and an absent or blank entry means "use the driver's".
    #[serde(default)]
    pub device_names: HashMap<u32, String>,
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
    /// Flash all devices white-ish for a beat when the OS media session's
    /// track changes (SMTC). 0 = disabled; otherwise the flash duration in
    /// milliseconds (150..1000).
    #[serde(default)]
    pub track_flash_ms: u64,
}

/// Blink length for a fresh install. Not zero: confirming that a hotkey fired
/// is the whole point, and nothing else on screen is visible while the
/// dashboard is closed.
fn default_hotkey_blink_ms() -> u64 {
    450
}

/// Blink colour for a fresh install. Also the fallback for a config saved
/// before the blink colour was user-settable.
fn default_hotkey_blink_color() -> [u8; 3] {
    [255, 255, 255]
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
            profiles: Vec::new(),
            night_start: String::new(),
            night_end: String::new(),
            night_brightness: 0.3,
            track_flash_ms: 0,
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
    /// Per-entry playback overrides. `None` on every field means "inherit the
    /// global setting", which is what keeps a vault saved before this field
    /// existed rendering exactly as it always did.
    #[serde(default)]
    pub opts: Option<EntryOptions>,
    /// Starred by hand. Not a collection: a collection is a named membership
    /// list you set up deliberately, this is the one-click "I like this one".
    #[serde(default)]
    pub favorite: bool,
    /// When this entry was last put on a display, for the "recently used" sort.
    /// `None` has never been applied, which is different from applied at epoch.
    #[serde(default)]
    pub last_applied_ms: Option<u64>,
}

/// Playback overrides for one vault entry.
///
/// Every field is an `Option` because "inherit" and "set to the same value as
/// the global" are different things: inheriting is what lets the global setting
/// keep applying to the other four hundred clips when you change it.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EntryOptions {
    /// "cover" | "contain" | "fill" | "auto".
    pub fit: Option<String>,
    /// Playback rate; the runtime clamps to 0.1..8.
    pub speed: Option<f32>,
    /// Audio volume for this entry only. A clip with a soundtrack can be muted
    /// without muting the app.
    pub volume: Option<f64>,
    pub brightness: Option<f32>,
    pub saturation: Option<f32>,
    pub hue: Option<f32>,
}

impl EntryOptions {
    /// True when nothing is set, so the caller can drop the whole object
    /// instead of persisting an empty bag of nulls.
    pub fn is_empty(&self) -> bool {
        self.fit.is_none()
            && self.speed.is_none()
            && self.volume.is_none()
            && self.brightness.is_none()
            && self.saturation.is_none()
            && self.hue.is_none()
    }

    /// Overlay these overrides onto the global wallpaper config.
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
mod device_name_tests {
    use super::*;

    #[test]
    fn a_config_without_device_names_still_loads() {
        // Renaming shipped after the first release, so every config already on
        // disk predates the field. Serde's `default` is what keeps those from
        // failing to parse, and it is the one thing here that must not regress.
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
        // JSON object keys are strings, so serde writes the id as "4".
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
        // The key is the Windows device name, backslashes and all: JSON has no
        // escaping problem here, but getting the key wrong would silently
        // orphan every alias the user has set.
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

    // ---------- Hotkeys ----------

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
            "nextScene",
            "nextWallpaper",
        ] {
            assert!(ids.contains(&expected), "entries() is missing {expected}");
        }
    }

    #[test]
    fn hotkeys_survive_an_old_config_without_the_section() {
        // A config written before hotkeys existed must still load, with the
        // whole section defaulted rather than the file being rejected. The
        // master switch has to default to on here, or upgrading would
        // silently kill bindings the user had already set up.
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
        // A config written before the blink existed has neither the duration
        // nor the colour. Both must default rather than fail the parse: the
        // duration to on (the blink is the useful default) and the colour to
        // white, which reads against any wallpaper accent.
        let old = serde_json::json!({ "version": 1, "general": { "theme": "dark" } });
        let cfg: Config = serde_json::from_value(old).expect("pre-blink config must parse");
        assert_eq!(cfg.general.hotkey_blink_ms, default_hotkey_blink_ms());
        assert_eq!(cfg.general.hotkey_blink_color, [255, 255, 255]);
    }

    #[test]
    fn a_new_config_follows_the_system_theme() {
        // Light machines should not get a dark app they never asked for. The
        // frontend resolves "system" against prefers-color-scheme, so the
        // default has to be System rather than a hard palette.
        assert_eq!(GeneralConfig::default().theme, ThemeMode::System);
        assert_eq!(Config::default().general.theme, ThemeMode::System);
    }

    #[test]
    fn an_explicit_theme_from_an_older_config_is_still_honoured() {
        // Flipping the default must not reach forward and overwrite someone
        // who already picked a palette: their config.json still says what it
        // always said, and it has to win.
        let old = serde_json::json!({ "version": 1, "general": { "theme": "dark" } });
        let cfg: Config = serde_json::from_value(old).expect("pre-system config must parse");
        assert_eq!(cfg.general.theme, ThemeMode::Dark);
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

/// Per-entry playback overrides, and the promise they make to an existing vault.
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

    /// A config file written before this field existed has no `opts` key at all.
    /// If that failed to parse, every existing user would open the app to a
    /// reset vault.
    #[test]
    fn an_entry_without_the_field_still_parses() {
        let json = r#"{"id":"g1","name":"clip","kind":"video","source":"C:/clip.mp4","addedMs":0}"#;
        let e: GalleryEntry = serde_json::from_str(json).unwrap();
        assert!(e.opts.is_none());
    }

    /// And one that has it round-trips, so a per-entry speed survives a restart
    /// rather than quietly reverting to the global value.
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

    /// "Inherit" and "set to the same value as the global" are different things.
    /// An empty bag must leave the config completely alone, or changing the
    /// global speed would stop affecting a wallpaper the user had touched.
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
        // Muted is a real value here, not "unset": an entry with a soundtrack
        // has to be silenceable without muting the app.
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
