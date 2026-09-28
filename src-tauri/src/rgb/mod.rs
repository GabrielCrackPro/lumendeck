//! RGB engine: palette math, zone mapping, and the sample drain loop.
//! The OpenRGB connection itself lives in `openrgb_client`.

pub mod audio;
pub mod openrgb_client;
pub mod palette;

use crate::config::{RgbConfig, RgbMode};
use openrgb::data::Color;
use openrgb_client::RgbClientHandle;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

/// One sample of a zone or the full-screen dominant color.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ZoneSample {
    pub id: String,
    pub rgb: [u8; 3],
    /// Relative brightness 0..1, used by pulse mode.
    pub luma: f64,
    /// Monitor device string the sample came from (multi-monitor: each
    /// wallpaper webview samples its own display). Empty = unknown.
    #[serde(default)]
    pub monitor: String,
    /// True when sampled on the primary display — ambient/pulse follow this
    /// one so the lighting reflects the "main" wallpaper, not whichever
    /// webview pushed last.
    #[serde(default)]
    pub primary: bool,
    /// Arrival timestamp (ms) stamped by the IPC boundary; used to expire
    /// samples from displays that stopped pushing.
    #[serde(default, skip_deserializing, skip_serializing)]
    pub received_ms: u64,
}

/// Shared inbox for zone samples coming from the wallpaper webview.
pub type SampleTx = mpsc::Sender<ZoneSample>;

/// Per-device color actually pushed to OpenRGB, for UI previews.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceColor {
    pub id: u32,
    /// Representative color (LED 0 or the device flat color).
    pub rgb: [u8; 3],
    /// Per-LED colors (animation preview). Empty for flat/reactive modes.
    /// Capped so the RGB_FRAME event stays small even for huge strips.
    pub led_colors: Vec<[u8; 3]>,
}

/// Maximum per-LED colors forwarded to the UI in one rgb-frame event.
const MAX_LED_PREVIEW: usize = 96;

/// When true, the engine pushes black (off) to all devices instead of normal
/// output. Toggled by the idle timer on inactivity.
static SLEEPING: AtomicBool = AtomicBool::new(false);

/// (ms, color) of the last wallpaper-color broadcast: at most 1/sec and only
/// on meaningful shifts, so UI glow + OS accent don't chase every frame.
static LAST_UI_COLOR: std::sync::Mutex<Option<(u64, [u8; 3])>> = std::sync::Mutex::new(None);

/// Device ids whose exclusion state changed since the last engine tick, so a
/// farewell sweep can play on the hardware as it's switched off/on.


/// Current LED count for a device (0 when unknown).
fn status_len(client: &RgbClientHandle, device_id: u32) -> usize {
    client
        .status()
        .devices
        .iter()
        .find(|d| d.id == device_id)
        .map(|d| d.leds as usize)
        .unwrap_or(0)
}

/// Set the idle-sleep state. When `true`, the engine immediately starts
/// pushing black to all devices; when `false`, normal output resumes.
pub fn set_sleeping(v: bool) {
    SLEEPING.store(v, Ordering::Relaxed);
    log::info!("rgb engine sleep: {v}");
}

/// Wake the RGB engine if it is currently sleeping. Called from input hooks
/// for instant wake on user activity (no log spam when already awake).
pub fn wake_if_sleeping() {
    if SLEEPING.swap(false, Ordering::Relaxed) {
        log::info!("rgb engine wake (input activity)");
    }
}

/// Trim a LED frame to the preview cap while keeping the first and last
/// samples so gradient animations still read correctly at the ends.
fn cap_leds(leds: &[[u8; 3]]) -> Vec<[u8; 3]> {
    if leds.len() <= MAX_LED_PREVIEW {
        return leds.to_vec();
    }
    let mut out = Vec::with_capacity(MAX_LED_PREVIEW);
    for i in 0..MAX_LED_PREVIEW {
        // Sample evenly across the strip (don't just truncate the tail).
        let idx = (i as f64 / (MAX_LED_PREVIEW.saturating_sub(1)) as f64
            * (leds.len().saturating_sub(1)) as f64)
            .round() as usize;
        out.push(leds[idx.min(leds.len() - 1)]);
    }
    out
}

pub struct EngineState {
    pub client: RgbClientHandle,
    pub tx: SampleTx,
}

impl EngineState {
    /// Spawns the engine loop; call once at startup, then hand to `.manage()`.
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel::<ZoneSample>(64);
        let client = RgbClientHandle::new();
        let last_sent_ms = Arc::new(AtomicU64::new(0));
        tauri::async_runtime::spawn(engine_loop(rx, client.clone(), last_sent_ms));
        Self { client, tx }
    }
}

/// Brightness cap (0..1) when the local time is inside the configured night
/// window, else None. Handles windows that wrap midnight (e.g. 22:00-07:00).
pub fn night_cap(cfg: &RgbConfig) -> Option<f64> {
    let (start, end) = (cfg.night_start.trim(), cfg.night_end.trim());
    if start.is_empty() || end.is_empty() {
        return None;
    }
    let parse = |s: &str| -> Option<u32> {
        let (h, m) = s.split_once(':')?;
        let h: u32 = h.trim().parse().ok()?;
        let m: u32 = m.trim().parse().ok()?;
        if h > 23 || m > 59 { None } else { Some(h * 60 + m) }
    };
    let (s, e, now) = (parse(start)?, parse(end)?, crate::win32::local_time_minutes()?);
    let inside = if s <= e { now >= s && now < e } else { now >= s || now < e };
    inside.then(|| cfg.night_brightness.clamp(0.0, 1.0))
}

/// Compute the target color for one device from config + latest samples.
/// Reactive modes only — animation modes own the frame generator instead.
pub fn target_color_for_device(device_id: u32, cfg: &RgbConfig, samples: &[ZoneSample]) -> Option<[u8; 3]> {
    if !cfg.enabled || cfg.excluded_devices.contains(&device_id) {
        return None;
    }
    if cfg.mode.is_animation() {
        return None;
    }
    let mixed = |c: [u8; 3]| {
        palette::apply_mixer(c, cfg.mixer.brightness, cfg.mixer.saturation, cfg.mixer.gamma)
    };
    // The full-frame sample of the PRIMARY monitor. Multi-monitor setups have
    // one "all" sample per display; ambient/pulse follow the primary's
    // wallpaper color and only fall back to another display (or the zone
    // average) when no primary sample exists. Zone samples overlap the same
    // pixels, so averaging them into ambient/pulse would double-count regions.
    let full = ||
        samples
            .iter()
            .find(|s| s.id == "all" && s.primary)
            .or_else(|| samples.iter().find(|s| s.id == "all"));
    match cfg.mode {
        RgbMode::Static => Some(mixed(cfg.static_color)),
        RgbMode::Ambient => full()
            .map(|s| s.rgb)
            .or_else(|| palette::dominant_over_samples(samples))
            // A mild saturation boost keeps wallpaper-derived colors from
            // reading muddy on wide-spectrum RGB hardware.
            .map(|c| palette::saturate(c, 1.25))
            .map(mixed),
        RgbMode::Pulse => {
            let dom = full()
                .map(|s| s.rgb)
                .or_else(|| palette::dominant_over_samples(samples))?;
            let luma = full()
                .map(|s| s.luma)
                .unwrap_or_else(|| {
                    samples.iter().map(|s| s.luma).sum::<f64>() / samples.len().max(1) as f64
                });
            // Perceptual curve: floor at 35% so the device never fully dies,
            // lift midtones (pow < 1) so scene changes read as bold swells.
            let factor = 0.35 + 0.65 * luma.clamp(0.0, 1.0).powf(0.8);
            Some(mixed(palette::scale_luma(dom, factor)))
        }
        RgbMode::Zone => {
            let zone = cfg
                .zones
                .iter()
                .find(|z| z.device_ids.contains(&device_id))?;
            // Every monitor with this zone contributes its own sample; the
            // average across displays is stable, while latest-wins would
            // flicker between monitors at their different push rates.
            let matching: Vec<&ZoneSample> = samples
                .iter()
                .filter(|s| s.id == zone.id)
                .collect();
            if matching.is_empty() {
                return None;
            }
            let n = matching.len() as f64;
            let avg = [
                (matching.iter().map(|s| s.rgb[0] as f64).sum::<f64>() / n) as u8,
                (matching.iter().map(|s| s.rgb[1] as f64).sum::<f64>() / n) as u8,
                (matching.iter().map(|s| s.rgb[2] as f64).sum::<f64>() / n) as u8,
            ];
            Some(mixed(avg))
        }
        RgbMode::Wave | RgbMode::Cycle | RgbMode::Breathe | RgbMode::AudioReactive => None,
    }
}

/// Generate one animated frame for a device's LED strip. Returns a
/// representative color (LED 0 / the current phase) for the UI plus the full
/// per-LED frame, with the mixer's saturation/brightness baked in. Reactive
/// modes return `None` — they are driven by wallpaper samples instead.
/// Hue (0..1) -> RGB, for sweep colors in animation modes.
fn hsl_to_rgb(h: f32) -> [u8; 3] {
    let c = |n: f32| {
        let k = (n + h * 6.0) % 6.0;
        (255.0 * (1.0 - (k - 3.0).abs()).clamp(0.0, 1.0).min(0.92)) as u8
    };
    [c(5.0), c(3.0), c(1.0)]
}

/// The color an on/off or device-exclusion sweep plays in: static-family
/// modes use the chosen color, reactive modes the latest wallpaper sample,
/// and animation modes a mid-rainbow hue.
fn sweep_base(cfg: &RgbConfig, latest: &[ZoneSample]) -> [u8; 3] {
    match cfg.mode {
        RgbMode::Static | RgbMode::Breathe | RgbMode::AudioReactive => cfg.static_color,
        RgbMode::Cycle | RgbMode::Wave => hsl_to_rgb(0.55),
        _ => latest.last().map(|s| s.rgb).unwrap_or([56, 189, 248]),
    }
}

/// Build one device's sweep: a brightness wave across `led_count` LEDs in
/// `base`, with `direction` mapping strip position (0..1) to brightness so
/// callers express on/off/exclude as a one-line closure.
fn sweep_colors(
    base: [u8; 3],
    led_count: usize,
    direction: impl Fn(f32) -> f32,
) -> Vec<Color> {
    (0..led_count)
        .map(|i| {
            let f = i as f32 / (led_count as f32 - 1.0).max(1.0);
            // Triangle window: 0 at the edges, 1 in the middle, so the wave
            // reads as traveling rather than fading.
            let w = ((f * 2.0 - 1.0).abs() * 3.0 - 1.0).clamp(0.0, 1.0);
            let v = direction(w);
            Color {
                r: (base[0] as f32 * v) as u8,
                g: (base[1] as f32 * v) as u8,
                b: (base[2] as f32 * v) as u8,
            }
        })
        .collect()
}

pub fn animation_frame(
    cfg: &RgbConfig,
    led_count: usize,
    t: f64,
    accent: Option<[u8; 3]>,
) -> Option<([u8; 3], Vec<[u8; 3]>)> {
    if led_count == 0 || !cfg.mode.is_animation() {
        return None;
    }
    let speed = cfg.animation_speed.max(0.05);
    // Mixer saturation/brightness behave like "intensity" for the generated
    // hues. Gamma is ignored here; animating a gamma pipeline per frame at
    // 60 fps isn't worth the cost and would muddy the motion.
    let sat = cfg.mixer.saturation.clamp(0.0, 1.0);
    let val = cfg.mixer.brightness.clamp(0.0, 1.0);

    match cfg.mode {
        RgbMode::Cycle => {
            // Spectrum stretched across the strip per `cycle_spread`, the
            // rainbow sliding along the device; every LED shows a different
            // hue. Spread > 360 wraps the wheel; < 360 shows a partial arc.
            let spread = cfg.cycle_spread.clamp(30.0, 720.0);
            let frame = (0..led_count)
                .map(|i| {
                    let p = i as f64 / led_count.max(1) as f64;
                    palette::hsv_to_rgb(
                        (t * 45.0 * speed + p * spread).rem_euclid(360.0),
                        sat,
                        val,
                    )
                })
                .collect::<Vec<_>>();
            Some((frame[0], frame))
        }
        RgbMode::Wave => {
            // Two hue gradients marching along the strip (direction from
            // config), each LED dimmed by a travelling comet pulse.
            let repeats = 2.0;
            let dir = if cfg.wave_direction < 0 { -1.0 } else { 1.0 };
            let frame = (0..led_count)
                .map(|i| {
                    let p = i as f64 / led_count.max(1) as f64;
                    let comet = 0.65
                        + 0.35 * ((p - dir * t * speed / 3.0) * std::f64::consts::TAU * repeats).sin();
                    palette::hsv_to_rgb(
                        (360.0 * (p * repeats - dir * t * speed / 3.0)).rem_euclid(360.0),
                        sat,
                        (val * comet).clamp(0.0, 1.0),
                    )
                })
                .collect::<Vec<_>>();
            Some((frame[0], frame))
        }
        RgbMode::Breathe => {
            // Organic breath cycle: quick 40% inhale, slow 60% exhale, with
            // smoothstep easing — no mechanical sine. Floor at 15%.
            let (h, s, v) = palette::rgb_to_hsv(cfg.static_color);
            let period = 4.5 / speed.max(0.05);
            let p = (t % period) / period; // 0..1 within one breath
            let ease = |x: f64| x * x * (3.0 - 2.0 * x);
            let wave = if p < 0.4 {
                ease(p / 0.4)
            } else {
                1.0 - ease((p - 0.4) / 0.6)
            };
            let v = (v * val * (0.15 + 0.85 * wave)).clamp(0.0, 1.0);
            let s = (s * sat).clamp(0.0, 1.0);
            let color = palette::hsv_to_rgb(h, s, v);
            Some((color, vec![color; led_count]))
        }
        RgbMode::AudioReactive => {
            audio::ensure_started();
            audio::set_sensitivity(cfg.audio_sensitivity as f32);

            let vol = audio::volume();
            let is_beat = audio::beat();
            // The accent is the color the rest of the interface already
            // associates with "right now" — the wallpaper's dominant tone —
            // so the audio visualization matches the screen instead of a
            // color the user picked for a different mode. Fall back to the
            // static color only when no wallpaper sample has arrived yet.
            let base = accent.unwrap_or(cfg.static_color);
            let (h, s, _) = palette::rgb_to_hsv(base);
            let smooth = cfg.audio_smoothing;

            let beat_boost = if is_beat { 1.0 } else { 0.0 };
            // Floor the volume at 0.3 so the base color is always visible;
            // audio only modulates brightness on top of that.
            let base_v = vol.max(0.3) as f64 * val;
            let v = ((base_v + beat_boost * 0.6) * (1.0 - smooth * 0.5)).clamp(0.0, 1.0);
            let s = (s * sat).clamp(0.0, 1.0);

            let rep = palette::hsv_to_rgb(h, s, v);
            let frame = (0..led_count)
                .map(|i| {
                    let p = i as f64 / led_count.max(1) as f64;
                    // Spectral tilt: hue drifts up to +40deg along the strip
                    // scaled by loudness, like a bass-to-treble gradient.
                    let hue = h + 40.0 * p * vol as f64;
                    let wave = if is_beat {
                        // Beat: a ring expanding from the strip center.
                        let edge = (p - 0.5).abs() * 2.0;
                        (1.0 - edge * 0.4).max(0.0)
                    } else {
                        0.7 + 0.3 * (p * std::f64::consts::TAU - t * 4.0).sin()
                    };
                    let lv = (v * wave).clamp(0.0, 1.0);
                    palette::hsv_to_rgb(hue, s, lv)
                })
                .collect();
            Some((rep, frame))
        }
        RgbMode::Ambient | RgbMode::Zone | RgbMode::Pulse | RgbMode::Static => None,
    }
}

/// Per-device eased color cache.
#[derive(Default)]
pub struct SmoothedColors {
    map: std::collections::HashMap<u32, [f64; 3]>,
}

impl SmoothedColors {
    pub fn step(&mut self, device: u32, target: [u8; 3], smoothing: f64) -> [u8; 3] {
        // smoothing 0 => snap most of the way to target, 0.95 => very slow.
        let k = (1.0 - smoothing.clamp(0.0, 0.95)) * 0.8;
        let e = self
            .map
            .entry(device)
            .or_insert([target[0] as f64, target[1] as f64, target[2] as f64]);
        for i in 0..3 {
            e[i] += (target[i] as f64 - e[i]) * k;
        }
        [
            e[0].round().clamp(0.0, 255.0) as u8,
            e[1].round().clamp(0.0, 255.0) as u8,
            e[2].round().clamp(0.0, 255.0) as u8,
        ]
    }
}

/// Main loop: drain samples, compute per-device colors, push to OpenRGB.
/// Reactive modes ease toward wallpaper-derived targets; animation modes
/// generate per-LED frames on their own cadence (independent of samples).
async fn engine_loop(
    mut rx: mpsc::Receiver<ZoneSample>,
    client: RgbClientHandle,
    last_sent_ms: Arc<AtomicU64>,
) {
    let mut smoothed = SmoothedColors::default();
    // Latest sample per (id, monitor): one wallpaper webview pushes per
    // display, and each keeps its own "all" + zone slots alive.
    let mut latest: Vec<ZoneSample> = Vec::new();
    // Wallpapers only push while playing: when a display stops sending (media
    // removed, webview crashed), expire its samples instead of freezing the
    // lights on the last frame forever.
    const SAMPLE_TTL_MS: u64 = 3_000;
    let mut cfg_rx = crate::config_store::watch();
    let mut ticker = tokio::time::interval(std::time::Duration::from_millis(25));
    let phase_start = std::time::Instant::now();
    let mut last_excluded: Vec<u32> = Vec::new();
    let mut last_enabled: Option<bool> = None;
    // Track-flash: when the SMTC track changes, override every device with a
    // bright white-ish pulse for track_flash_ms. Instant::now() would panic
    // before the epoch fix, but this loop only starts after boot time exists.
    let mut flash_until: Option<std::time::Instant> = None;
    // Ensure audio capture + SMTC poller threads are spawned (idempotent).
    audio::ensure_started();
    crate::media_session::ensure_started();

    loop {
        tokio::select! {
            item = rx.recv() => {
                match item {
                    Some(s) => {
                        latest.retain(|e| !(e.id == s.id && e.monitor == s.monitor));
                        latest.push(s);
                    }
                    None => break, // channel closed: shutting down
                }
            }
            _ = ticker.tick() => {}
        }

        let mut cfg: RgbConfig = cfg_rx.borrow_and_update().rgb.clone();
        // Night dimming: cap brightness inside the scheduled window. Applied
        // here so every mode (reactive + animation) is affected uniformly.
        if let Some(cap) = night_cap(&cfg) {
            cfg.mixer.brightness = cfg.mixer.brightness.min(cap);
        }

        // Track flash: arm on a fresh SMTC track change, disarm when expired.
        if crate::media_session::take_track_change() && cfg.track_flash_ms > 0 {
            flash_until = Some(std::time::Instant::now() + std::time::Duration::from_millis(cfg.track_flash_ms.clamp(150, 1000)));
        }
        if flash_until.is_some_and(|until| std::time::Instant::now() >= until) {
            flash_until = None;
        }

        // Expire samples from displays that stopped pushing (3s of silence).
        if !latest.is_empty() {
            let cutoff = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0)
                .saturating_sub(SAMPLE_TTL_MS);
            latest.retain(|s| s.received_ms >= cutoff);
        }

        // Sync audio source from config.
        audio::set_source(&cfg.audio_source);

        // On/off transitions get a quick hardware sweep so the toggle feels
        // physical: diff the excluded set against the previous tick.
        let transitions: Vec<(u32, bool)> = {
            let mut out: Vec<(u32, bool)> = cfg
                .excluded_devices
                .iter()
                .filter(|id| !last_excluded.contains(id))
                .copied()
                .map(|id| (id, true))
                .collect();
            out.extend(
                last_excluded
                    .iter()
                    .filter(|id| !cfg.excluded_devices.contains(id))
                    .copied()
                    .map(|id| (id, false)),
            );
            out
        };
        last_excluded = cfg.excluded_devices.clone();

        // Global RGB sync toggle: play the sweep across ALL devices in
        // sequence — off drains in mode color, on rises in mode color.
        let global_flip = match last_enabled {
            Some(prev) if prev != cfg.enabled => Some(cfg.enabled),
            None => None,
            _ => None,
        };
        last_enabled = Some(cfg.enabled);
        if let Some(turning_on) = global_flip {
            for dev in &client.status().devices {
                let n = dev.leds as usize;
                if n == 0 {
                    continue;
                }
                let sweep = sweep_colors(sweep_base(&cfg, &latest), n, |f| {
                    if turning_on { f } else { 1.0 - f }
                });
                client.push_device_colors(dev.id, sweep).await;
                // The sequencing is the show: each device lights as the
                // previous one finishes its wave.
                tokio::time::sleep(std::time::Duration::from_millis(70)).await;
            }
        }

        if !transitions.is_empty() {
            for (dev_id, excluded) in transitions {
                let n = status_len(&client, dev_id);
                if n == 0 {
                    continue;
                }
                // Off: the wave drains left-to-right; on: it rises.
                let sweep = sweep_colors(sweep_base(&cfg, &latest), n, |f| {
                    if excluded { 1.0 - f } else { f }
                });
                client.push_device_colors(dev_id, sweep).await;
                tokio::time::sleep(std::time::Duration::from_millis(40)).await;
            }
        }
        if !cfg.enabled {
            continue;
        }

        let sleeping = SLEEPING.load(Ordering::Relaxed);

        // Animations are self-generated and don't need wallpaper samples; the
        // reactive modes do (and otherwise shouldn't burn pushes with stale data).
        if !sleeping && !cfg.mode.is_animation() && latest.is_empty() {
            continue;
        }

        // Throttle device updates. Animations want fluid motion, so cap their
        // interval well below the default reactive 100ms.
        let min_interval = if cfg.mode.is_animation() {
            cfg.min_update_ms.min(33)
        } else {
            cfg.min_update_ms
        };
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let last = last_sent_ms.load(Ordering::Relaxed);
        if now_ms.saturating_sub(last) < min_interval {
            continue;
        }
        last_sent_ms.store(now_ms, Ordering::Relaxed);

        let t = phase_start.elapsed().as_secs_f64();
        let status = client.status();
        let is_anim = cfg.mode.is_animation();
        let mut frame: Vec<DeviceColor> = Vec::new();
        for dev in &status.devices {
            let n = dev.leds as usize;
            if n == 0 {
                continue;
            }
            // Excluded devices: actively push black so the toggle visibly
            // turns the hardware off (it would otherwise keep its last color).
            if cfg.excluded_devices.contains(&dev.id) {
                if !sleeping {
                    let black: Vec<Color> = vec![Color { r: 0, g: 0, b: 0 }; n];
                    client.push_device_colors(dev.id, black).await;
                }
                frame.push(DeviceColor {
                    id: dev.id,
                    rgb: [0, 0, 0],
                    led_colors: Vec::new(),
                });
                continue;
            }
            let (rep, per_led) = if sleeping {
                // Idle sleep: push black to turn off all LEDs.
                let black = [0u8; 3];
                (black, vec![black; n])
            } else if flash_until.is_some() {
                // Track change: one bright pulse, same tint for every LED.
                // Mirrors the mixer so brightness/saturation prefs apply.
                let flash = palette::apply_mixer([235, 235, 235], cfg.mixer.brightness, cfg.mixer.saturation, cfg.mixer.gamma);
                (flash, vec![flash; n])
            } else if is_anim {
                // Accent for the frame: the primary display's live wallpaper
                // color, so audio-reactive rides the screen's mood instead of
                // the user-picked static color. Computed directly —
                // target_color_for_device() returns None for animation modes,
                // which is exactly the mode we're in here.
                let accent = latest
                    .iter()
                    .find(|s| s.id == "all" && s.primary)
                    .or_else(|| latest.iter().find(|s| s.id == "all"))
                    .map(|s| s.rgb)
                    .or_else(|| palette::dominant_over_samples(&latest));
                match animation_frame(&cfg, n, t, accent) {
                    Some(f) => f,
                    None => continue,
                }
            } else {
                let Some(target) = target_color_for_device(dev.id, &cfg, &latest) else {
                    continue;
                };
                let color = smoothed.step(dev.id, target, cfg.mixer.smoothing);
                (color, vec![color; n])
            };
            let colors: Vec<Color> = per_led
                .iter()
                .map(|c| Color {
                    r: c[0],
                    g: c[1],
                    b: c[2],
                })
                .collect();
            client.push_device_colors(dev.id, colors).await;
            frame.push(DeviceColor {
                id: dev.id,
                rgb: rep,
                // Only animations carry per-LED state; reactive flat frames
                // would spend event bytes on 96 copies of the same color.
                led_colors: if is_anim { cap_leds(&per_led) } else { Vec::new() },
            });
        }
        if !frame.is_empty() {
            if let Some(app) = crate::app_handle() {
                crate::events::emit_all(&app, crate::events::RGB_FRAME, &frame);
            }
            // Wallpaper's current dominant color, broadcast for the dashboard
            // glow and the Windows theming hub. Rate-limited: the UI glow and
            // OS accent shouldn't chase every video frame.
            if let Some(c) = frame.first() {
                if c.rgb != [0, 0, 0] {
                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    let mut push = false;
                    {
                        let mut last = LAST_UI_COLOR
                            .lock()
                            .expect("ui color mutex poisoned");
                        match *last {
                            Some((ts, prev)) => {
                                let delta = c
                                    .rgb
                                    .iter()
                                    .zip(prev.iter())
                                    .map(|(a, b)| a.abs_diff(*b))
                                    .max()
                                    .unwrap_or(0);
                                if now_ms - ts >= 1000 && delta >= 12 {
                                    *last = Some((now_ms, c.rgb));
                                    push = true;
                                }
                            }
                            None => {
                                *last = Some((now_ms, c.rgb));
                                push = true;
                            }
                        }
                    }
                    if push {
                        if let Some(app) = crate::app_handle() {
                            crate::events::emit_all(
                                &app,
                                crate::events::WALLPAPER_COLOR,
                                &c.rgb,
                            );
                        }
                        // Windows theming hub: drive the OS accent from the
                        // wallpaper's dominant color when enabled.
                        crate::sys_theme::feed_wallpaper_color(c.rgb);
                    }
                }
            }
        }
        // Emit audio level for UI visualization when in audio reactive mode.
        if cfg.mode == RgbMode::AudioReactive {
            if let Some(app) = crate::app_handle() {
                #[derive(Clone, serde::Serialize)]
                struct AudioLevelPayload {
                    volume: f32,
                    beat: bool,
                    device_name: String,
                }
                let payload = AudioLevelPayload {
                    volume: audio::volume(),
                    beat: audio::beat(),
                    device_name: audio::device_name(),
                };
                crate::events::emit_all(&app, crate::events::AUDIO_LEVEL, &payload);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{RgbConfig, RgbMode};

    fn sample(id: &str, rgb: [u8; 3], luma: f64) -> ZoneSample {
        ZoneSample {
            id: id.to_string(),
            rgb,
            luma,
            monitor: String::new(),
            primary: false,
            received_ms: 0,
        }
    }

    fn sample_on(id: &str, rgb: [u8; 3], luma: f64, monitor: &str, primary: bool) -> ZoneSample {
        ZoneSample {
            monitor: monitor.to_string(),
            primary,
            ..sample(id, rgb, luma)
        }
    }

    #[test]
    fn static_mode_ignores_samples() {
        let cfg = RgbConfig {
            mode: RgbMode::Static,
            ..Default::default()
        };
        let out = target_color_for_device(0, &cfg, &[]);
        assert_eq!(out, Some(cfg.static_color));
    }

    #[test]
    fn ambient_without_samples_is_none() {
        let cfg = RgbConfig {
            mode: RgbMode::Ambient,
            ..Default::default()
        };
        assert_eq!(target_color_for_device(0, &cfg, &[]), None);
    }

    #[test]
    fn ambient_uses_full_sample_only() {
        let cfg = RgbConfig {
            mode: RgbMode::Ambient,
            ..Default::default()
        };
        // Zone samples overlap the "all" pixels; averaging them in would
        // double-count regions. Ambient must follow the full-frame sample.
        let samples = vec![
            sample("all", [100, 100, 100], 0.5),
            sample("z1", [255, 0, 0], 0.4),
            sample("z2", [0, 255, 0], 0.4),
        ];
        let out = target_color_for_device(0, &cfg, &samples).unwrap();
        assert_eq!(out, [100, 100, 100]);
    }

    #[test]
    fn ambient_falls_back_without_full_sample() {
        let cfg = RgbConfig {
            mode: RgbMode::Ambient,
            ..Default::default()
        };
        let samples = vec![
            sample("z1", [255, 0, 0], 0.4),
            sample("z2", [0, 255, 0], 0.4),
        ];
        let out = target_color_for_device(0, &cfg, &samples).unwrap();
        // Ambient now applies a 1.25x saturation boost to the sample average.
        assert_eq!(out, [130, 130, 0]);
    }

    #[test]
    fn ambient_prefers_primary_monitor() {
        let cfg = RgbConfig {
            mode: RgbMode::Ambient,
            ..Default::default()
        };
        // Secondary monitor pushes last, but ambient must follow the primary.
        let samples = vec![
            sample_on("all", [200, 40, 40], 0.5, "\\\\.\\DISPLAY1", true),
            sample_on("all", [40, 40, 200], 0.5, "\\\\.\\DISPLAY6", false),
        ];
        let out = target_color_for_device(0, &cfg, &samples).unwrap();
        assert_eq!(out, [231, 31, 31], "primary wins + 1.25x saturation");
    }

    #[test]
    fn ambient_falls_back_to_any_monitor_when_no_primary() {
        let cfg = RgbConfig {
            mode: RgbMode::Ambient,
            ..Default::default()
        };
        let samples = vec![sample_on("all", [40, 200, 40], 0.5, "\\\\.\\DISPLAY6", false)];
        let out = target_color_for_device(0, &cfg, &samples).unwrap();
        assert_eq!(out, [11, 211, 11], "fallback sample + saturation boost");
    }

    #[test]
    fn zone_mode_averages_across_monitors() {
        let cfg = RgbConfig {
            mode: RgbMode::Zone,
            zones: vec![crate::config::ZoneDef {
                id: "z".into(),
                name: "Left".into(),
                x: 0.0,
                y: 0.0,
                w: 0.5,
                h: 1.0,
                device_ids: vec![7],
            }],
            ..Default::default()
        };
        let samples = vec![
            sample_on("z", [100, 0, 0], 0.5, "\\\\.\\DISPLAY1", true),
            sample_on("z", [0, 100, 0], 0.5, "\\\\.\\DISPLAY6", false),
        ];
        let out = target_color_for_device(7, &cfg, &samples).unwrap();
        assert_eq!(out, [50, 50, 0], "zone must be the cross-monitor average");
    }

    #[test]
    fn pulse_uses_full_sample_luma() {
        let cfg = RgbConfig {
            mode: RgbMode::Pulse,
            ..Default::default()
        };
        // A dark low-luma zone must not drag the whole device dimmer when
        // the full frame is bright.
        let samples = vec![
            sample("all", [200, 200, 200], 0.78),
            sample("z1", [10, 10, 10], 0.01),
        ];
        let out = target_color_for_device(0, &cfg, &samples).unwrap();
        assert!(out[0] > 100, "bright full frame should stay bright: {out:?}");
    }

    #[test]
    fn reactive_modes_return_none_for_animation_devices() {
        for mode in [RgbMode::Wave, RgbMode::Cycle, RgbMode::Breathe] {
            let cfg = RgbConfig {
                mode,
                ..Default::default()
            };
            assert_eq!(target_color_for_device(0, &cfg, &[]), None);
        }
    }

    #[test]
    fn cycle_rotates_hue_over_time() {
        let cfg = RgbConfig {
            mode: RgbMode::Cycle,
            mixer: crate::config::RgbMixer {
                saturation: 1.0,
                brightness: 1.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let (_, fa) = animation_frame(&cfg, 12, 0.0, None).unwrap();
        let (_, fb) = animation_frame(&cfg, 12, 1.0, None).unwrap();
        // Cycle now spreads the spectrum across the strip, sliding with time.
        assert_ne!(fa[0], fa[11], "rainbow must span the strip");
        assert_ne!(fa[0], fb[0], "cycle should march in time");
    }

    #[test]
    fn wave_varies_across_leds_and_marches() {
        let cfg = RgbConfig {
            mode: RgbMode::Wave,
            mixer: crate::config::RgbMixer {
                saturation: 1.0,
                brightness: 1.0,
                ..Default::default()
            },
            animation_speed: 1.0,
            ..Default::default()
        };
        let (_, a) = animation_frame(&cfg, 12, 0.0, None).unwrap();
        let (_, b) = animation_frame(&cfg, 12, 0.5, None).unwrap();
        assert_eq!(a.len(), 12);
        assert_ne!(a[0], a[11], "gradient must span the strip");
        assert_ne!(a[0], b[0], "wave should march forward in time");
    }

    #[test]
    fn breathe_pulses_static_color() {
        let cfg = RgbConfig {
            mode: RgbMode::Breathe,
            static_color: [255, 0, 0],
            mixer: crate::config::RgbMixer {
                saturation: 1.0,
                brightness: 1.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let (dim, fd) = animation_frame(&cfg, 8, 0.0, None).unwrap();
        let (bright, fb) = animation_frame(&cfg, 8, 1.0, None).unwrap();
        assert!(fd.iter().all(|c| *c == dim));
        assert!(fb.iter().all(|c| *c == bright));
        assert!(bright[0] > dim[0], "should get brighter over the breath");
        assert_eq!(dim[1], 0);
        assert_eq!(dim[2], 0);
    }

    #[test]
    fn cap_leds_samples_evenly() {
        let big: Vec<[u8; 3]> = (0..500).map(|i| [i as u8, 0, 0]).collect();
        let out = cap_leds(&big);
        assert_eq!(out.len(), super::MAX_LED_PREVIEW);
        assert_eq!(out[0], big[0]);
        assert_eq!(out[out.len() - 1], big[499]);
        // Interior samples spread across the whole strip, not just the head.
        assert_ne!(out[50], out[0], "mid-strip LED must be sampled");
        assert_ne!(out[50], out[95], "gradient should not collapse");
    }

    #[test]
    fn zone_mode_needs_zone_mapping() {
        let cfg = RgbConfig {
            mode: RgbMode::Zone,
            ..Default::default()
        };
        let samples = vec![sample("z", [10, 20, 30], 0.5)];
        assert_eq!(target_color_for_device(0, &cfg, &samples), None);
    }

    #[test]
    fn zone_mode_uses_mapped_zone() {
        let cfg = RgbConfig {
            mode: RgbMode::Zone,
            zones: vec![crate::config::ZoneDef {
                id: "z".into(),
                name: "Left".into(),
                x: 0.0,
                y: 0.0,
                w: 0.5,
                h: 1.0,
                device_ids: vec![7],
            }],
            ..Default::default()
        };
        let samples = vec![sample("z", [10, 20, 30], 0.5)];
        assert_eq!(target_color_for_device(7, &cfg, &samples), Some([10, 20, 30]));
        assert_eq!(target_color_for_device(8, &cfg, &samples), None);
    }

    #[test]
    fn excluded_device_gets_nothing() {
        let cfg = RgbConfig {
            excluded_devices: vec![3],
            ..Default::default()
        };
        assert_eq!(target_color_for_device(3, &cfg, &[]), None);
    }

    #[test]
    fn smoothing_snaps_at_zero() {
        let mut s = SmoothedColors::default();
        let a = s.step(1, [0, 0, 0], 0.0);
        let b = s.step(1, [255, 255, 255], 0.0);
        assert_eq!(a, [0, 0, 0]);
        assert!(b[0] > 200, "smoothing 0 should move most of the way: {b:?}");
    }

    fn night_cfg(start: &str, end: &str, cap: f64) -> RgbConfig {
        RgbConfig {
            night_start: start.into(),
            night_end: end.into(),
            night_brightness: cap,
            ..Default::default()
        }
    }

    #[test]
    fn night_cap_disabled_when_unset() {
        assert_eq!(night_cap(&night_cfg("", "07:00", 0.3)), None);
        assert_eq!(night_cap(&night_cfg("22:00", "", 0.3)), None);
    }

    #[test]
    fn night_cap_invalid_times_disabled() {
        assert_eq!(night_cap(&night_cfg("25:00", "07:00", 0.3)), None);
        assert_eq!(night_cap(&night_cfg("22:00", "7am", 0.3)), None);
    }

    #[test]
    fn night_cap_clamped() {
        // Cap out of range is clamped into 0..1 whatever the window says.
        let c = night_cap(&night_cfg("00:00", "23:59", 4.0));
        assert!(matches!(c, Some(v) if (v - 1.0).abs() < f64::EPSILON));
    }
}
