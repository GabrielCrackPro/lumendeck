//! RGB engine: palette math, zone mapping, and the sample drain loop.
//! The OpenRGB connection itself lives in `openrgb_client`.

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

/// Compute the target color for one device from config + latest samples.
/// Reactive modes only — animation modes own the frame generator instead.
pub fn target_color_for_device(
    device_id: u32,
    cfg: &RgbConfig,
    samples: &[(String, ZoneSample)],
) -> Option<[u8; 3]> {
    if !cfg.enabled || cfg.excluded_devices.contains(&device_id) {
        return None;
    }
    if cfg.mode.is_animation() {
        return None;
    }
    let mixed = |c: [u8; 3]| {
        palette::apply_mixer(c, cfg.mixer.brightness, cfg.mixer.saturation, cfg.mixer.gamma)
    };
    // The full-frame sample the wallpaper sends first. Zone samples overlap
    // the same pixels, so averaging them into ambient/pulse would double-count
    // regions. Fall back to the sample average only if it's missing.
    let full = || samples.iter().find(|(id, _)| id == "all").map(|(_, s)| s);
    match cfg.mode {
        RgbMode::Static => Some(mixed(cfg.static_color)),
        RgbMode::Ambient => full()
            .map(|s| s.rgb)
            .or_else(|| palette::dominant_over_samples(samples))
            .map(mixed),
        RgbMode::Pulse => {
            let dom = full()
                .map(|s| s.rgb)
                .or_else(|| palette::dominant_over_samples(samples))?;
            let luma = full()
                .map(|s| s.luma)
                .unwrap_or_else(|| {
                    samples.iter().map(|(_, s)| s.luma).sum::<f64>() / samples.len().max(1) as f64
                });
            Some(mixed(palette::scale_luma(dom, luma)))
        }
        RgbMode::Zone => {
            let zone = cfg
                .zones
                .iter()
                .find(|z| z.device_ids.contains(&device_id))?;
            let matching: Vec<&ZoneSample> = samples
                .iter()
                .filter(|(id, _)| *id == zone.id)
                .map(|(_, s)| s)
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
        RgbMode::Wave | RgbMode::Cycle | RgbMode::Breathe => None,
    }
}

/// Generate one animated frame for a device's LED strip. Returns a
/// representative color (LED 0 / the current phase) for the UI plus the full
/// per-LED frame, with the mixer's saturation/brightness baked in. Reactive
/// modes return `None` — they are driven by wallpaper samples instead.
pub fn animation_frame(cfg: &RgbConfig, led_count: usize, t: f64) -> Option<([u8; 3], Vec<[u8; 3]>)> {
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
            // Whole device sweeps through the spectrum; ~6s per lap at 1x.
            let color = palette::hsv_to_rgb((t * 60.0 * speed).rem_euclid(360.0), sat, val);
            Some((color, vec![color; led_count]))
        }
        RgbMode::Wave => {
            // Two hue gradients side by side, marching up the strip; a full
            // gap passes every ~3s at 1x.
            let repeats = 2.0;
            let frame = (0..led_count)
                .map(|i| {
                    let p = i as f64 / led_count as f64;
                    palette::hsv_to_rgb(
                        (360.0 * (p * repeats + t * speed / 3.0)).rem_euclid(360.0),
                        sat,
                        val,
                    )
                })
                .collect::<Vec<_>>();
            Some((frame[0], frame))
        }
        RgbMode::Breathe => {
            // Static color pulsing between 25% and full brightness, ~4s per
            // breath at 1x.
            let (h, s, v) = palette::rgb_to_hsv(cfg.static_color);
            let wave = 0.5 + 0.5 * ((t * speed * std::f64::consts::PI / 2.0).sin());
            let v = (v * val * (0.25 + 0.75 * wave)).clamp(0.0, 1.0);
            let s = (s * sat).clamp(0.0, 1.0);
            let color = palette::hsv_to_rgb(h, s, v);
            Some((color, vec![color; led_count]))
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
    let mut latest: Vec<(String, ZoneSample)> = Vec::new();
    let mut cfg_rx = crate::config_store::watch();
    let mut ticker = tokio::time::interval(std::time::Duration::from_millis(25));
    let phase_start = std::time::Instant::now();

    loop {
        tokio::select! {
            item = rx.recv() => {
                match item {
                    Some(s) => {
                        let id = s.id.clone();
                        latest.retain(|(eid, _)| *eid != id);
                        latest.push((id, s));
                    }
                    None => break, // channel closed: shutting down
                }
            }
            _ = ticker.tick() => {}
        }

        let cfg: RgbConfig = cfg_rx.borrow_and_update().rgb.clone();
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
            if n == 0 || cfg.excluded_devices.contains(&dev.id) {
                continue;
            }
            let (rep, per_led) = if sleeping {
                // Idle sleep: push black to turn off all LEDs.
                let black = [0u8; 3];
                (black, vec![black; n])
            } else if is_anim {
                match animation_frame(&cfg, n, t) {
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
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{RgbConfig, RgbMode};

    fn sample(id: &str, rgb: [u8; 3], luma: f64) -> (String, ZoneSample) {
        (
            id.to_string(),
            ZoneSample {
                id: id.to_string(),
                rgb,
                luma,
            },
        )
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
        assert_eq!(out, [128, 128, 0]);
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
        let (a, fa) = animation_frame(&cfg, 12, 0.0).unwrap();
        let (b, fb) = animation_frame(&cfg, 12, 1.0).unwrap();
        // Uniform across LEDs, but the whole device hue moves with time.
        assert!(fa.iter().all(|c| *c == a));
        assert!(fb.iter().all(|c| *c == b));
        assert_ne!(a, b, "cycle should sweep the hue");
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
        let (_, a) = animation_frame(&cfg, 12, 0.0).unwrap();
        let (_, b) = animation_frame(&cfg, 12, 0.5).unwrap();
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
        let (dim, fd) = animation_frame(&cfg, 8, 0.0).unwrap();
        let (bright, fb) = animation_frame(&cfg, 8, 1.0).unwrap();
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
}
