//! Persistence model for LumenDeck settings, mirrored by src/shared/types.ts.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const CONFIG_VERSION: u32 = 2;

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
    // v2: lighting-only profiles were replaced by whole-look configs, and
    // every profile someone had saved became one. See
    // `lighting_profiles_become_configs`.
    if from < 2 {
        lighting_profiles_become_configs(raw);
        rename_hotkey_key(raw, "nextScene", "nextProfile");
    }
    let _ = from;
    raw["version"] = serde_json::json!(CONFIG_VERSION);
    Ok(())
}

/// Carry a stored hotkey binding across a rename.
///
/// Written as a raw move rather than a serde alias because the pair has to
/// move in the file too: the old key is removed, so the next write does not
/// leave two spellings of one binding behind. A key that is absent is not an
/// error — an unbound action has nothing to carry.
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
    // Refuses to clobber: if the new name is already bound, the old one is
    // dropped instead, because two bindings for one action is worse than one.
    hotkeys.entry(to.to_string()).or_insert(value);
}

/// Milliseconds since the Unix epoch, for `created_ms`.
///
/// A named time source because two call sites writing the same four lines of
/// `SystemTime` boilerplate is how one of them ends up truncating to seconds.
pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// v1 -> v2: every saved lighting profile becomes a whole-look config.
///
/// A profile captured only mode, colour and speed; a config captures a whole
/// look. Each profile is therefore converted rather than dropped — it becomes
/// the wallpaper and the stickers currently on screen plus its own lighting,
/// which is what it meant in practice: a profile changed the lights and left
/// the desktop alone.
///
/// Converting rather than discarding is the whole reason this exists. A user
/// with eight saved profiles and no configs would otherwise come back from the
/// upgrade to an empty Settings page with no way to find out why.
fn lighting_profiles_become_configs(raw: &mut serde_json::Value) {
    let profiles = match raw.get("rgb").and_then(|rgb| rgb.get("profiles")) {
        Some(serde_json::Value::Array(list)) if !list.is_empty() => list.clone(),
        _ => return,
    };
    let base_rgb = raw.get("rgb").cloned().unwrap_or_else(|| serde_json::json!({}));
    let created_ms = now_ms();
    // Migrated profiles land after the configs the user already has: they are
    // the older thing, and the array order is the order the UI lists them in.
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
        // Ids are how "apply this config" finds its target, so a migrated id
        // that collided with a saved one would make two entries on the list
        // land on the same config. Deterministic ids keep the migration
        // testable; the suffix loop is what keeps them from overlapping.
        let mut id = format!("scene-from-profile-{i}");
        let mut bump = 1;
        while taken_ids.contains(&id) {
            id = format!("scene-from-profile-{i}-{bump}");
            bump += 1;
        }
        taken_ids.insert(id.clone());
        let mut rgb = base_rgb.clone();
        if let Some(obj) = rgb.as_object_mut() {
            // Only the three knobs a profile ever captured. Everything else in
            // the RGB config stays as this machine has it.
            for key in ["mode", "staticColor", "animationSpeed"] {
                if let Some(v) = profile.get(key) {
                    obj.insert(key.to_string(), v.clone());
                }
            }
            // The list being migrated must not survive inside every copy of the
            // RGB config, or recalling a config would resurrect it.
            obj.remove("profiles");
        }
        let mut scene = serde_json::Map::new();
        scene.insert("id".into(), serde_json::json!(id));
        scene.insert("name".into(), serde_json::json!(name));
        // Inserted only when present, so a missing section falls back to the
        // serde default instead of failing on an explicit null.
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
    /// Remember the user's pre-sync lock screen on first enable so it can be
    /// restored when the toggle goes off again. Without this the toggle is
    /// one-way: nothing ever puts the user's own image back.
    pub lock_screen_armed: bool,
    /// First-run onboarding wizard has been completed. False on fresh
    /// installs; the dashboard shows a guided setup until it's done.
    pub onboarded: bool,
    /// The profile the machine is currently running, or null when it is on
    /// something no profile describes.
    ///
    /// Stored rather than re-derived by matching the config against every
    /// profile, because two profiles can describe the same state and only the
    /// id says which one the user picked. The match is still the fallback: a
    /// config written before this field existed has no id, and its profiles
    /// should still light up. While it is set, every config write re-captures
    /// that profile (see `config_store::sync_active_profile`).
    pub active_profile_id: Option<String>,
    /// Dashboard accent auto-shade: how strongly the UI lifts/darkens a
    /// source color until it is legible on the theme surface. 0.0 = off
    /// (raw colors, may be hard to read), 1.0 = full adjustment to clear
    /// the contrast floor. Hardware colors are unaffected either way.
    pub accent_auto_shade: f64,
    /// AMOLED mode: true-black surfaces in dark theme (pixels fully off on
    /// OLED panels). Ignored in light theme.
    pub amoled: bool,
    /// Show the `#RRGGBB` readout beside colour swatches.
    ///
    /// The default here is `true`, and that is load-bearing rather than
    /// incidental: this value is what serde substitutes for a stored config
    /// written before the field existed, so it means "what an existing user
    /// keeps seeing". Changing it would silently change the UI for everyone who
    /// upgrades.
    ///
    /// New installs get the opposite, from `config_store::first_run_defaults` —
    /// a machine with no history has no reason to be shown something the
    /// product no longer considers the default. The split lives there because
    /// that is the only place that can tell a first run from an upgrade.
    ///
    /// Either way the swatch still shows the colour and the picker's own hex
    /// field is unaffected; only the readout label goes.
    pub show_color_hex: bool,
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
    /// How often a running dashboard looks for a new release, in minutes.
    ///
    /// Zero means no automatic checking at all: the dashboard then waits for the
    /// user to press Check for updates, and stops checking on a timer *and* on
    /// the window returning. Leaving the visibility trigger running would have
    /// made "manual" a lie, since alt-tabbing back checks more often than any
    /// interval here.
    ///
    /// It does not govern the manual Check for updates button, which is a
    /// question and not a poll.
    ///
    /// Hours by default, which is what a signed latest.json deserves: a few
    /// kilobytes, but still a round trip on someone's connection. A user who
    /// wants release-day notifications sooner can lower it; the dashboard
    /// clamps the value to something a server would thank us for.
    ///
    /// Safe for zero to mean "off" because this is `serde(default)`: a config
    /// written before the field existed becomes the default hour, never a zero.
    #[serde(default = "default_update_check_minutes")]
    pub update_check_minutes: u32,
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
    /// Apply the next saved profile. Renamed from `next_scene`; the migration
    /// carries an existing binding across rather than leaving a user who had
    /// set one with nothing bound after the upgrade.
    pub next_profile: HotkeyBinding,
    /// Advance the active playlist / gallery to the next entry.
    pub next_wallpaper: HotkeyBinding,
}

impl HotkeyConfig {
    /// `(action id, binding)` pairs, in a stable order. The ids match the
    /// frontend's `HotkeyAction` union and the tray's dispatch table.
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
            lock_screen_armed: false,
            onboarded: false,
            active_profile_id: None,
            accent_auto_shade: 1.0,
            amoled: false,
            // The fallback for configs predating the field, so existing users
            // keep the readout they have always had. First runs override this.
            show_color_hex: true,
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
            update_check_minutes: default_update_check_minutes(),
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
    /// Whether an import measures what it brought in (resolution, length).
    ///
    /// The vault index is what makes "sort by 4K" and "only the long ones"
    /// answerable, and until it is built a freshly imported file has no
    /// measurements at all. On by default for every existing config too, not
    /// just new ones: there is no history to preserve, the work is bounded to
    /// what was just added, and an upgrade is not a moment to start doing less.
    ///
    /// Off is for the person who imports a few hundred files and would rather
    /// not pay for measuring them — the toolbar's "Index vault" button stays
    /// there either way.
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

/// How often a running dashboard checks for a release. See the field's doc.
fn default_update_check_minutes() -> u32 {
    60
}

/// Blink colour for a fresh install. Also the fallback for a config saved
/// before the blink colour was user-settable.
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
    /// Whole-RGB config (mode/mixer/zones/accents and the rest).
    pub rgb: RgbConfig,
    /// Sticker placements, so a recall restores the whole arrangement.
    ///
    /// This reverses an earlier decision to leave stickers alone as
    /// "positional, not mood". A desk with three different sticker layouts and
    /// three different wallpapers is one setup saved three times, which is the
    /// thing a config is for. `#[serde(default)]` matters more here than on the
    /// other fields: a scene stored before this existed deserialises to an
    /// empty list, and recall then clears the desktop rather than failing.
    ///
    /// That is the sharp edge of restoring stickers and it is why the
    /// confirmation is the user's to give, not ours to assume either way.
    ///
    /// No `#[serde(default)]` here on purpose: the struct already carries one,
    /// and mutation proved a field-level copy changes nothing — the test still
    /// passed with it removed. Two attributes reading as load-bearing when only
    /// the outer one is is how the next person deletes the one that matters.
    pub stickers: Vec<StickerDef>,
    /// Absolute path to the avatar image, when the user chose one.
    ///
    /// A copy in the app's own media directory rather than the path they
    /// picked: a config is the one thing here that is meant to still work in a
    /// year, and the file behind "Next to my Downloads" is the first thing that
    /// gets tidied away. `None` is the ordinary case and means "draw the
    /// initial", which is also what every config written before this field
    /// existed reads as.
    pub logo: Option<String>,
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
            stickers: Vec::new(),
            logo: None,
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
    /// Walk the vault in random order instead of display order.
    ///
    /// False is what every existing config resolves to, so upgrading does not
    /// change how the next-wallpaper key behaves for anyone already using it.
    pub gallery_shuffle: bool,
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

    /// A config stored before scenes carried stickers must still load.
    ///
    /// This is the migration that matters: `SceneProfile` carries a
    /// struct-level `#[serde(default)]`, so an old scene deserialises to an
    /// empty sticker list rather than failing the whole config read. Without it
    /// every existing user's app would fail to start on upgrade, which is the
    /// failure mode a `default` attribute exists to prevent and the one worth a
    /// test rather than a comment.
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
        // The one test that matters for the v1 -> v2 migration: a user who
        // saved profiles must come back to configs, not to an empty page.
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

        // The three knobs the profile captured come from the profile...
        assert_eq!(cfg.scenes[0].rgb.mode, RgbMode::Ambient);
        assert_eq!(cfg.scenes[0].rgb.static_color, [0, 0, 255]);
        assert_eq!(cfg.scenes[0].rgb.animation_speed, 0.5);
        assert_eq!(cfg.scenes[1].rgb.mode, RgbMode::Wave);
        // ...and everything else the profile never knew about stays as the
        // machine had it.
        assert!(!cfg.scenes[0].rgb.enabled, "unrelated RGB settings must survive");
        // The desktop a profile was used against is the one it now carries.
        assert_eq!(cfg.scenes[0].wallpaper.kind, WallpaperKind::Video);
        assert_eq!(cfg.scenes[0].wallpaper.source, "media://a.mp4");
        assert_eq!(cfg.scenes[0].stickers.len(), 1);

        // The list must not survive inside the migrated copies, or recalling a
        // config would bring the retired profiles back.
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
        // Two configs answering to one id is the failure that makes "apply this
        // config" land on the wrong one, so the migration has to move out of
        // the way of ids it could collide with.
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
    fn a_chosen_update_interval_is_kept_through_a_roundtrip() {
        let mut cfg = Config::default();
        cfg.general.update_check_minutes = 30;
        let json = serde_json::to_string(&cfg).unwrap();
        let back: Config = serde_json::from_str(&json).unwrap();
        assert_eq!(back.general.update_check_minutes, 30);
    }

    #[test]
    fn the_update_interval_is_stored_under_the_name_the_dashboard_sends() {
        // `GeneralConfig` is `rename_all = "camelCase"`, so the JSON key is
        // `updateCheckMinutes` -- which is what `GeneralTab`'s dropdown writes and
        // what the hand-maintained TypeScript interface calls the field. Nothing
        // in the compiler connects those three: a rename on either side would
        // leave the control saving a key the backend drops, and the interval
        // would silently stay at the default forever.
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
