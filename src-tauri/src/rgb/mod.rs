
pub mod audio;
pub mod openrgb_client;
pub mod palette;
pub mod silence;

use crate::config::{RgbConfig, RgbMode};
use openrgb::data::Color;
use openrgb_client::{DeviceInfo, RgbClientHandle};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ZoneSample {
    pub id: String,
    pub rgb: [u8; 3],
    pub luma: f64,
    #[serde(default)]
    pub monitor: String,
    #[serde(default)]
    pub primary: bool,
    #[serde(default, skip_deserializing, skip_serializing)]
    pub received_ms: u64,
}

pub type SampleTx = mpsc::Sender<ZoneSample>;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceColor {
    pub id: u32,
    pub rgb: [u8; 3],
    pub led_colors: Vec<[u8; 3]>,
}

const MAX_LED_PREVIEW: usize = 96;

static SLEEPING: AtomicBool = AtomicBool::new(false);

static HOTKEY_BLINK_PENDING: AtomicBool = AtomicBool::new(false);

static LAST_FRAMES: LastFrames = LastFrames::new();

const HOTKEY_BLINK_PULSES: u64 = 3;

pub fn request_hotkey_blink() {
    HOTKEY_BLINK_PENDING.store(true, Ordering::Relaxed);
}

fn take_hotkey_blink() -> bool {
    HOTKEY_BLINK_PENDING.swap(false, Ordering::Relaxed)
}

fn blink_is_on(elapsed_ms: u64, total_ms: u64) -> bool {
    let period = (total_ms / HOTKEY_BLINK_PULSES).max(1);
    (elapsed_ms % period) * 2 < period
}

fn is_keyboard(dev: &DeviceInfo) -> bool {
    dev.type_name.contains("Keyboard")
}

#[derive(Default)]
struct LastFrames {
    inner: std::sync::Mutex<Vec<(u32, Vec<[u8; 3]>)>>,
}

impl LastFrames {
    const fn new() -> Self {
        Self {
            inner: std::sync::Mutex::new(Vec::new()),
        }
    }

    fn record(&self, id: u32, frame: &[[u8; 3]]) {
        let Ok(mut m) = self.inner.lock() else { return };
        match m.iter_mut().find(|(k, _)| *k == id) {
            Some(slot) => slot.1 = frame.to_vec(),
            None => m.push((id, frame.to_vec())),
        }
    }

    fn get(&self, id: u32) -> Option<Vec<[u8; 3]>> {
        let m = self.inner.lock().ok()?;
        m.iter().find(|(k, _)| *k == id).map(|(_, v)| v.clone())
    }

    fn retain(&self, live: &[u32]) {
        if let Ok(mut m) = self.inner.lock() {
            m.retain(|(id, _)| live.contains(id));
        }
    }
}

fn restore_frame(saved: Option<&[[u8; 3]]>, leds: usize) -> Vec<[u8; 3]> {
    let mut out = vec![[0u8; 3]; leds];
    if let Some(saved) = saved {
        for (i, slot) in out.iter_mut().enumerate() {
            *slot = saved[i % saved.len().max(1)];
        }
    }
    out
}

static LAST_UI_COLOR: std::sync::Mutex<Option<(u64, [u8; 3])>> = std::sync::Mutex::new(None);



fn status_len(client: &RgbClientHandle, device_id: u32) -> usize {
    client
        .status()
        .devices
        .iter()
        .find(|d| d.id == device_id)
        .map(|d| d.leds as usize)
        .unwrap_or(0)
}

pub fn set_sleeping(v: bool) {
    if SLEEPING.swap(v, Ordering::Relaxed) != v {
        log::debug!("rgb engine sleep: {v}");
    }
}

pub fn wake_if_sleeping() {
    if SLEEPING.swap(false, Ordering::Relaxed) {
        log::debug!("rgb engine wake (input activity)");
    }
}

fn cap_leds(leds: &[[u8; 3]]) -> Vec<[u8; 3]> {
    if leds.len() <= MAX_LED_PREVIEW {
        return leds.to_vec();
    }
    let mut out = Vec::with_capacity(MAX_LED_PREVIEW);
    for i in 0..MAX_LED_PREVIEW {
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
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel::<ZoneSample>(64);
        let client = RgbClientHandle::new();
        let last_sent_ms = Arc::new(AtomicU64::new(0));
        tauri::async_runtime::spawn(engine_loop(rx, client.clone(), last_sent_ms));
        Self { client, tx }
    }
}

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
            let factor = 0.35 + 0.65 * luma.clamp(0.0, 1.0).powf(0.8);
            Some(mixed(palette::scale_luma(dom, factor)))
        }
        RgbMode::Zone => {
            let zone = cfg
                .zones
                .iter()
                .find(|z| z.device_ids.contains(&device_id))?;
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

fn hsl_to_rgb(h: f32) -> [u8; 3] {
    let c = |n: f32| {
        let k = (n + h * 6.0) % 6.0;
        (255.0 * (1.0 - (k - 3.0).abs()).clamp(0.0, 1.0).min(0.92)) as u8
    };
    [c(5.0), c(3.0), c(1.0)]
}

fn sweep_base(cfg: &RgbConfig, latest: &[ZoneSample]) -> [u8; 3] {
    match cfg.mode {
        RgbMode::Static | RgbMode::Breathe | RgbMode::AudioReactive => cfg.static_color,
        RgbMode::Cycle | RgbMode::Wave => hsl_to_rgb(0.55),
        _ => latest.last().map(|s| s.rgb).unwrap_or_else(crate::tokens::default_glow),
    }
}

fn sweep_colors(
    base: [u8; 3],
    led_count: usize,
    direction: impl Fn(f32) -> f32,
) -> Vec<Color> {
    (0..led_count)
        .map(|i| {
            let f = i as f32 / (led_count as f32 - 1.0).max(1.0);
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
    let sat = cfg.mixer.saturation.clamp(0.0, 1.0);
    let val = cfg.mixer.brightness.clamp(0.0, 1.0);

    match cfg.mode {
        RgbMode::Cycle => {
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
            let (h, s, v) = palette::rgb_to_hsv(cfg.static_color);
            let period = 4.5 / speed.max(0.05);
            let p = (t % period) / period;
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
            let base = accent.unwrap_or(cfg.static_color);
            let (h, s, _) = palette::rgb_to_hsv(base);
            let smooth = cfg.audio_smoothing;

            let beat_boost = if is_beat { 1.0 } else { 0.0 };
            let base_v = vol.max(0.3) as f64 * val;
            let v = ((base_v + beat_boost * 0.6) * (1.0 - smooth * 0.5)).clamp(0.0, 1.0);
            let s = (s * sat).clamp(0.0, 1.0);

            let rep = palette::hsv_to_rgb(h, s, v);
            let frame = (0..led_count)
                .map(|i| {
                    let p = i as f64 / led_count.max(1) as f64;
                    let hue = h + 40.0 * p * vol as f64;
                    let wave = if is_beat {
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

#[derive(Default)]
pub struct SmoothedColors {
    map: std::collections::HashMap<u32, [f64; 3]>,
}

impl SmoothedColors {
    pub fn step(&mut self, device: u32, target: [u8; 3], smoothing: f64) -> [u8; 3] {
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

#[derive(Default)]
pub struct SmoothedFrames {
    map: std::collections::HashMap<u32, Vec<[f64; 3]>>,
}

impl SmoothedFrames {
    pub fn step(&mut self, device: u32, frame: &[[u8; 3]], k: f64) -> Vec<[u8; 3]> {
        let k = k.clamp(0.0, 1.0);
        let e = self.map.entry(device).or_insert_with(|| {
            frame
                .iter()
                .map(|c| [c[0] as f64, c[1] as f64, c[2] as f64])
                .collect()
        });
        e.resize(frame.len(), [0.0; 3]);
        e.iter_mut()
            .zip(frame.iter())
            .map(|(cur, target)| {
                let mut out = [0u8; 3];
                for i in 0..3 {
                    cur[i] += (target[i] as f64 - cur[i]) * k;
                    out[i] = cur[i].round().clamp(0.0, 255.0) as u8;
                }
                out
            })
            .collect()
    }

    pub fn forget(&mut self, device: u32) {
        self.map.remove(&device);
    }

    pub fn device_ids(&self) -> Vec<u32> {
        self.map.keys().copied().collect()
    }
}

async fn engine_loop(
    mut rx: mpsc::Receiver<ZoneSample>,
    client: RgbClientHandle,
    last_sent_ms: Arc<AtomicU64>,
) {
    let mut smoothed = SmoothedColors::default();
    let mut anim_frames = SmoothedFrames::default();
    let mut last_anim_mode: Option<RgbMode> = None;
    let mut latest: Vec<ZoneSample> = Vec::new();
    const SAMPLE_TTL_MS: u64 = 3_000;
    const AUDIO_UI_FLOOR: f32 = 0.002;
    const AUDIO_UI_TAIL: std::time::Duration = std::time::Duration::from_millis(1_200);
    let mut cfg_rx = crate::config_store::watch();
    let mut ticker = tokio::time::interval(std::time::Duration::from_millis(25));
    let phase_start = std::time::Instant::now();
    let mut last_excluded: Vec<u32> = Vec::new();
    let mut last_enabled: Option<bool> = None;
    let mut flash_until: Option<std::time::Instant> = None;
    let mut blink_window: Option<(std::time::Instant, std::time::Instant)> = None;
    audio::ensure_started();
    crate::media_session::ensure_started();
    let mut last_tick = std::time::Instant::now();
    let mut last_audio_ui: Option<std::time::Instant> = None;

    loop {
        tokio::select! {
            item = rx.recv() => {
                match item {
                    Some(s) => {
                        latest.retain(|e| !(e.id == s.id && e.monitor == s.monitor));
                        latest.push(s);
                    }
                    None => break,
                }
            }
            _ = ticker.tick() => {}
        }

        let (mut cfg, blink_ms, blink_color) = {
            let snapshot = cfg_rx.borrow_and_update();
            (
                snapshot.rgb.clone(),
                snapshot.general.hotkey_blink_ms,
                snapshot.general.hotkey_blink_color,
            )
        };
        let now_tick = std::time::Instant::now();
        let dt_secs = now_tick.duration_since(last_tick).as_secs_f32();
        last_tick = now_tick;
        if let Some(cap) = night_cap(&cfg) {
            cfg.mixer.brightness = cfg.mixer.brightness.min(cap);
        }

        if crate::media_session::take_track_change() && cfg.track_flash_ms > 0 {
            flash_until = Some(std::time::Instant::now() + std::time::Duration::from_millis(cfg.track_flash_ms.clamp(150, 1000)));
        }
        if flash_until.is_some_and(|until| std::time::Instant::now() >= until) {
            flash_until = None;
        }

        let blink_requested = take_hotkey_blink();
        if blink_requested && blink_ms > 0 {
            let total = blink_ms.clamp(150, 1000);
            let now = std::time::Instant::now();
            log::info!("blink: arming hotkey blink for {total}ms");
            blink_window = Some((
                now,
                now + std::time::Duration::from_millis(total),
            ));
        } else if blink_requested {
            log::debug!("blink: requested but disabled (hotkey_blink_ms is 0)");
        }
        if blink_window.is_some_and(|(_, until)| std::time::Instant::now() >= until) {
            blink_window = None;
        }
        let blink_active = blink_window.is_some();
        let blink_on = blink_window.is_some_and(|(start, until)| {
            let now = std::time::Instant::now();
            now < until
                && blink_is_on(
                    now.saturating_duration_since(start).as_millis() as u64,
                    blink_ms.clamp(150, 1000),
                )
        });

        if !latest.is_empty() {
            let cutoff = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0)
                .saturating_sub(SAMPLE_TTL_MS);
            latest.retain(|s| s.received_ms >= cutoff);
        }

        if !latest.is_empty() {
            let accent = latest
                .iter()
                .find(|s| s.id == "all" && s.primary)
                .or_else(|| latest.iter().find(|s| s.id == "all"))
                .map(|s| s.rgb)
                .or_else(|| palette::dominant_over_samples(&latest));
            if let Some(c) = accent {
                if c != [0, 0, 0] {
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
                                    .iter()
                                    .zip(prev.iter())
                                    .map(|(a, b)| a.abs_diff(*b))
                                    .max()
                                    .unwrap_or(0);
                                if now_ms - ts >= 1000 && delta >= 12 {
                                    *last = Some((now_ms, c));
                                    push = true;
                                }
                            }
                            None => {
                                *last = Some((now_ms, c));
                                push = true;
                            }
                        }
                    }
                    if push {
                        if let Some(app) = crate::app_handle() {
                            crate::events::emit_all(
                                &app,
                                crate::events::WALLPAPER_COLOR,
                                &c,
                            );
                        }
                    }
                }
            }
        }

        audio::set_source(&cfg.audio_source);

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
                tokio::time::sleep(std::time::Duration::from_millis(70)).await;
            }
        }

        if !transitions.is_empty() {
            for (dev_id, excluded) in transitions {
                let n = status_len(&client, dev_id);
                if n == 0 {
                    continue;
                }
                let sweep = sweep_colors(sweep_base(&cfg, &latest), n, |f| {
                    if excluded { 1.0 - f } else { f }
                });
                client.push_device_colors(dev_id, sweep).await;
                tokio::time::sleep(std::time::Duration::from_millis(40)).await;
            }
        }
        let sleeping = SLEEPING.load(Ordering::Relaxed);
        if !cfg.enabled || sleeping {
            crate::dynlight::push_off(&cfg);
        }
        if !cfg.enabled {
            continue;
        }

        if !sleeping && !cfg.mode.is_animation() && latest.is_empty() && !blink_active {
            continue;
        }

        let mut min_interval = if cfg.mode.is_animation() {
            cfg.min_update_ms.min(33)
        } else {
            cfg.min_update_ms
        };
        if blink_active {
            min_interval = min_interval.min(25);
        }
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
        crate::dynlight::engine_tick(&cfg, &latest, t, flash_until.is_some(), sleeping);
        let status = client.status();
        for cached in anim_frames.device_ids() {
            if !status.devices.iter().any(|d| d.id == cached) {
                anim_frames.forget(cached);
            }
        }
        let live_devices: Vec<u32> = status.devices.iter().map(|d| d.id).collect();
        LAST_FRAMES.retain(&live_devices);
        let is_anim = cfg.mode.is_animation();
        let mut frame: Vec<DeviceColor> = Vec::new();
        for dev in &status.devices {
            let n = dev.leds as usize;
            if n == 0 {
                continue;
            }
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
            let blink_this = blink_active && is_keyboard(dev);
            let ambient: Option<Vec<[u8; 3]>> = if sleeping {
                Some(vec![[0u8; 3]; n])
            } else if flash_until.is_some() {
                let flash = palette::apply_mixer([235, 235, 235], cfg.mixer.brightness, cfg.mixer.saturation, cfg.mixer.gamma);
                Some(vec![flash; n])
            } else if is_anim {
                let accent = latest
                    .iter()
                    .find(|s| s.id == "all" && s.primary)
                    .or_else(|| latest.iter().find(|s| s.id == "all"))
                    .map(|s| s.rgb)
                    .or_else(|| palette::dominant_over_samples(&latest));
                match animation_frame(&cfg, n, t, accent) {
                    Some((_, per_led)) => {
                        let fade = if last_anim_mode != Some(cfg.mode) {
                            last_anim_mode = Some(cfg.mode);
                            0.35
                        } else {
                            1.0
                        };
                        Some(anim_frames.step(dev.id, &per_led, fade))
                    }
                    None => None,
                }
            } else {
                target_color_for_device(dev.id, &cfg, &latest)
                    .map(|target| smoothed.step(dev.id, target, cfg.mixer.smoothing))
                    .map(|color| vec![color; n])
            };

            let per_led: Vec<[u8; 3]> = match ambient {
                Some(per_led) => {
                    if blink_this && blink_on {
                        let flash = palette::apply_mixer(
                            blink_color,
                            cfg.mixer.brightness,
                            cfg.mixer.saturation,
                            cfg.mixer.gamma,
                        );
                        vec![flash; n]
                    } else {
                        LAST_FRAMES.record(dev.id, &per_led);
                        per_led
                    }
                }
                None => {
                    if blink_this {
                        restore_frame(LAST_FRAMES.get(dev.id).as_deref(), n)
                    } else {
                        continue;
                    }
                }
            };
            let rep = per_led.first().copied().unwrap_or([0u8; 3]);
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
                led_colors: if per_led.windows(2).any(|w| w[0] != w[1]) {
                    cap_leds(&per_led)
                } else {
                    vec![rep; 1]
                },
            });
        }
        if !frame.is_empty() {
            if let Some(app) = crate::app_handle() {
                crate::events::emit_all(&app, crate::events::RGB_FRAME, &frame);
            }
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
                        crate::sys_theme::feed_wallpaper_color(c.rgb);
                    }
                }
            }
        }
        audio::decay_pulse(dt_secs);

        let volume = audio::volume();
        let pulse = audio::pulse();
        let audible = volume > AUDIO_UI_FLOOR || pulse > AUDIO_UI_FLOOR;
        if audible {
            last_audio_ui = Some(std::time::Instant::now());
        }
        let still_settling = last_audio_ui
            .is_some_and(|t| t.elapsed() < AUDIO_UI_TAIL);
        if audible || still_settling {
            if let Some(app) = crate::app_handle() {
            #[derive(Clone, serde::Serialize)]
            struct AudioLevelPayload {
                volume: f32,
                pulse: f32,
                device_name: String,
            }
            let payload = AudioLevelPayload {
                volume,
                pulse,
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


    #[test]
    fn blink_starts_on_so_the_press_is_seen_immediately() {
        assert!(blink_is_on(0, 450));
    }

    #[test]
    fn blink_draws_the_configured_number_of_pulses() {
        let total = 450u64;
        let period = total / HOTKEY_BLINK_PULSES;
        for pulse in 0..HOTKEY_BLINK_PULSES {
            let start = pulse * period;
            assert!(blink_is_on(start, total), "pulse {pulse} must begin on");
            assert!(
                blink_is_on(start + period / 4, total),
                "pulse {pulse} must still be on at its midpoint"
            );
            assert!(
                !blink_is_on(start + period * 3 / 4, total),
                "pulse {pulse} must be off in its second half"
            );
        }
    }

    #[test]
    fn blink_ends_off_so_the_backlight_settles_back_to_ambient() {
        let total = 450u64;
        assert!(!blink_is_on(total - 1, total));
    }

    #[test]
    fn blink_survives_a_degenerate_duration() {
        assert!(blink_is_on(0, 0));
        assert!(blink_is_on(5, 1));
    }

    #[test]
    fn the_pre_blink_frame_is_what_gets_restored() {
        let lf = LastFrames::new();
        let ambient = vec![[10, 20, 30], [40, 50, 60]];
        lf.record(7, &ambient);
        let flash = vec![[255, 255, 255], [255, 255, 255]];
        assert!(!lf.get(7).unwrap().iter().any(|c| flash.contains(c)));
        assert_eq!(restore_frame(lf.get(7).as_deref(), 2), ambient);
    }

    #[test]
    fn a_device_with_no_remembered_frame_restores_to_black_not_a_flash() {
        assert_eq!(restore_frame(None, 3), vec![[0, 0, 0]; 3]);
    }

    #[test]
    fn restoring_survives_a_keyboard_reporting_a_different_led_count() {
        let lf = LastFrames::new();
        lf.record(1, &[[1, 2, 3], [4, 5, 6]]);
        assert_eq!(restore_frame(lf.get(1).as_deref(), 5).len(), 5);
        assert_eq!(restore_frame(lf.get(1).as_deref(), 1).len(), 1);
    }

    #[test]
    fn unplugged_devices_do_not_accumulate_frames() {
        let lf = LastFrames::new();
        lf.record(1, &[[1, 1, 1]]);
        lf.record(2, &[[2, 2, 2]]);
        lf.retain(&[1]);
        assert!(lf.get(1).is_some(), "a live device keeps its frame");
        assert!(lf.get(2).is_none(), "a gone device is dropped");
    }

    #[test]
    fn only_keyboards_blink() {
        let dev = |t: &str| DeviceInfo {
            id: 0,
            name: "x".into(),
            type_name: t.into(),
            leds: 4,
            zones: Vec::new(),
        };
        assert!(is_keyboard(&dev("Keyboard")));
        assert!(!is_keyboard(&dev("Light")));
        assert!(!is_keyboard(&dev("Mouse")));
        assert!(!is_keyboard(&dev("Headset")));
        assert!(!is_keyboard(&dev("LEDStrip")));
    }

    #[test]
    fn a_press_is_claimed_exactly_once() {
        HOTKEY_BLINK_PENDING.store(false, Ordering::Relaxed);
        request_hotkey_blink();
        assert!(take_hotkey_blink(), "the engine must see the request");
        assert!(
            !take_hotkey_blink(),
            "a blink must not replay on the following tick"
        );
    }

    #[test]
    fn mashed_keys_coalesce_into_one_blink() {
        HOTKEY_BLINK_PENDING.store(false, Ordering::Relaxed);
        for _ in 0..5 {
            request_hotkey_blink();
        }
        assert!(take_hotkey_blink());
        assert!(!take_hotkey_blink());
    }
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
        assert_eq!(out, [130, 130, 0]);
    }

    #[test]
    fn ambient_prefers_primary_monitor() {
        let cfg = RgbConfig {
            mode: RgbMode::Ambient,
            ..Default::default()
        };
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

    #[test]
    fn frame_crossfade_starts_from_frame() {
        let mut s = SmoothedFrames::default();
        let f = s.step(7, &[[255, 0, 0]; 4], 0.35);
        assert_eq!(f, vec![[255, 0, 0]; 4]);
    }

    #[test]
    fn frame_crossfade_blends_toward_target() {
        let mut s = SmoothedFrames::default();
        s.step(7, &[[0, 0, 0]; 4], 1.0);
        let f = s.step(7, &[[255, 0, 0]; 4], 0.35);
        assert_eq!(f[0][0], 89, "0.35 * 255 = 89");
        let g = s.step(7, &[[255, 0, 0]; 4], 1.0);
        assert_eq!(g, vec![[255, 0, 0]; 4]);
    }

    #[test]
    fn frame_crossfade_keeps_sub_byte_progress() {
        let mut s = SmoothedFrames::default();
        s.step(1, &[[0, 0, 0]], 1.0);
        let mut last = [0u8; 3];
        for _ in 0..40 {
            last = s.step(1, &[[255, 0, 0]], 0.35)[0];
        }
        assert_eq!(last, [255, 0, 0], "40 x 0.35 must converge exactly");
    }

    #[test]
    fn frame_crossfade_handles_resize() {
        let mut s = SmoothedFrames::default();
        s.step(2, &[[10, 10, 10]; 3], 1.0);
        let grown = s.step(2, &[[10, 10, 10], [200, 0, 0], [10, 10, 10], [0, 200, 0]], 1.0);
        assert_eq!(grown, vec![[10, 10, 10], [200, 0, 0], [10, 10, 10], [0, 200, 0]]);
    }

    #[test]
    fn frame_crossfade_forget_drops_cache() {
        let mut s = SmoothedFrames::default();
        s.step(3, &[[0, 0, 0]; 2], 1.0);
        assert_eq!(s.device_ids(), vec![3]);
        s.forget(3);
        assert!(s.device_ids().is_empty());
        let f = s.step(3, &[[5, 5, 5]; 2], 0.35);
        assert_eq!(f, vec![[5, 5, 5]; 2]);
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
        let c = night_cap(&night_cfg("00:00", "23:59", 4.0));
        assert!(matches!(c, Some(v) if (v - 1.0).abs() < f64::EPSILON));
    }
}
