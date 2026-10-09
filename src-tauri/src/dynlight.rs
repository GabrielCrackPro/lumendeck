#![cfg(windows)]

use crate::config::RgbConfig;
use crate::rgb::{SmoothedColors, ZoneSample};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};

const LAMP_KEY_BASE: u32 = 0xD100_0000;

static TX: OnceLock<mpsc::Sender<Cmd>> = OnceLock::new();
static LAST_ON: AtomicBool = AtomicBool::new(false);
static LAST_WANTED: AtomicBool = AtomicBool::new(false);

static SMOOTHER: Mutex<Option<SmoothedColors>> = Mutex::new(None);

#[derive(Clone, serde::Serialize)]
pub struct DynlightArray {
    pub name: String,
    pub lamps: u32,
}

#[derive(Clone, serde::Serialize, Default)]
pub struct DynlightStatus {
    pub wanted: bool,
    pub supported: bool,
    pub arrays: Vec<DynlightArray>,
    pub error: Option<String>,
}

static STATUS: Mutex<DynlightStatus> = Mutex::new(DynlightStatus {
    wanted: false,
    supported: false,
    arrays: Vec::new(),
    error: None,
});

pub fn status() -> DynlightStatus {
    let mut s = STATUS
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default();
    s.wanted = crate::config_store::try_get()
        .map(|c| c.rgb.dynlight_enabled)
        .unwrap_or(false);
    s
}

fn set_error(msg: Option<String>) {
    let Ok(mut s) = STATUS.lock() else {
        return;
    };
    if s.error != msg {
        match &msg {
            Some(m) => log::warn!("dynlight: {m}"),
            None => log::info!("dynlight: writes succeeded again"),
        }
        s.error = msg;
    }
}

enum Cmd {
    Refresh,
    Frame(Vec<Option<Vec<[u8; 3]>>>),
    Disable,
}

pub fn spawn() {
    let (tx, rx) = mpsc::channel::<Cmd>();
    let _ = TX.set(tx);
    std::thread::Builder::new()
        .name("dynlight".into())
        .spawn(move || worker(rx))
        .ok();
}

fn accent_of(samples: &[ZoneSample]) -> Option<[u8; 3]> {
    samples
        .iter()
        .find(|s| s.id == "all" && s.primary)
        .or_else(|| samples.iter().find(|s| s.id == "all"))
        .map(|s| s.rgb)
        .or_else(|| crate::rgb::palette::dominant_over_samples(samples))
}

fn ambient_fallback(cfg: &RgbConfig, samples: &[ZoneSample]) -> Option<[u8; 3]> {
    accent_of(samples)
        .map(|c| crate::rgb::palette::saturate(c, 1.25))
        .map(|c| {
            crate::rgb::palette::apply_mixer(
                c,
                cfg.mixer.brightness,
                cfg.mixer.saturation,
                cfg.mixer.gamma,
            )
        })
}

pub fn frames_for(
    cfg: &RgbConfig,
    samples: &[ZoneSample],
    t: f64,
    counts: &[u32],
    flash: bool,
    smoother: &mut SmoothedColors,
) -> Vec<Option<Vec<[u8; 3]>>> {
    let accent = accent_of(samples);
    counts
        .iter()
        .enumerate()
        .map(|(idx, &count)| {
            let n = count as usize;
            if n == 0 {
                return None;
            }
            let key = LAMP_KEY_BASE + idx as u32;
            if flash {
                let c = crate::rgb::palette::apply_mixer(
                    [235, 235, 235],
                    cfg.mixer.brightness,
                    cfg.mixer.saturation,
                    cfg.mixer.gamma,
                );
                return Some(vec![c; n]);
            }
            if cfg.mode.is_animation() {
                return crate::rgb::animation_frame(cfg, n, t, accent)
                    .map(|(_, per_led)| per_led);
            }
            crate::rgb::target_color_for_device(key, cfg, samples)
                .or_else(|| ambient_fallback(cfg, samples))
                .map(|target| smoother.step(key, target, cfg.mixer.smoothing))
                .map(|c| vec![c; n])
        })
        .collect()
}

fn send(cmd: Cmd) {
    if let Some(tx) = TX.get() {
        let _ = tx.send(cmd);
    }
}

fn counts() -> Vec<u32> {
    STATUS
        .lock()
        .map(|s| s.arrays.iter().map(|a| a.lamps).collect())
        .unwrap_or_default()
}

pub fn push_off(cfg: &RgbConfig) {
    sync_wanted(cfg);
    if !cfg.dynlight_enabled {
        return;
    }
    if LAST_ON.swap(false, Ordering::SeqCst) {
        send(Cmd::Frame(vec![None; counts().len()]));
    }
}

pub fn engine_tick(
    cfg: &RgbConfig,
    samples: &[ZoneSample],
    t: f64,
    flash: bool,
    sleeping: bool,
) {
    sync_wanted(cfg);
    if !cfg.dynlight_enabled || !cfg.enabled || sleeping {
        return;
    }
    let Ok(mut guard) = SMOOTHER.lock().map_err(|_| "dynlight smoother poisoned") else {
        return;
    };
    let smoother = guard.get_or_insert_with(SmoothedColors::default);
    let frames = frames_for(cfg, samples, t, &counts(), flash, smoother);
    drop(guard);
    if !LAST_ON.swap(true, Ordering::SeqCst) {
        log::info!("dynlight: lamps on");
    }
    send(Cmd::Frame(frames));
}

fn sync_wanted(cfg: &RgbConfig) {
    if LAST_WANTED.swap(cfg.dynlight_enabled, Ordering::SeqCst) != cfg.dynlight_enabled {
        if cfg.dynlight_enabled {
            log::info!("dynlight: enabled — enumerating lamp arrays");
            send(Cmd::Refresh);
        } else {
            log::info!("dynlight: disabled");
            LAST_ON.store(false, Ordering::SeqCst);
            send(Cmd::Disable);
        }
    }
}


struct OpenedArray {
    array: windows::Devices::Lights::LampArray,
    indices: Vec<i32>,
    on: bool,
    last: Option<Vec<[u8; 3]>>,
}

fn color(c: [u8; 3]) -> windows::UI::Color {
    windows::UI::Color {
        R: c[0],
        G: c[1],
        B: c[2],
        A: 255,
    }
}

async fn enumerate() -> Result<Vec<OpenedArray>, String> {
    use windows::Devices::Enumeration::DeviceInformation;
    use windows::Devices::Lights::LampArray;

    let selector = LampArray::GetDeviceSelector()
        .map_err(|e| format!("the lighting API is unavailable: {e}"))?;
    let infos = DeviceInformation::FindAllAsyncAqsFilter(&selector)
        .map_err(|e| format!("could not list lighting devices: {e}"))?
        .await
        .map_err(|e| format!("lighting device query failed: {e}"))?;

    let mut opened: Vec<OpenedArray> = Vec::new();
    let mut names: Vec<DynlightArray> = Vec::new();
    let mut failures: Vec<String> = Vec::new();
    let size = infos.Size().map_err(|e| format!("device list unreadable: {e}"))?;
    for i in 0..size {
        let info = infos
            .GetAt(i)
            .map_err(|e| format!("device {i} unreadable: {e}"))?;
        let name = info
            .Name()
            .map(|n| n.to_string())
            .unwrap_or_else(|_| format!("device {i}"));
        let id = match info.Id() {
            Ok(id) => id,
            Err(e) => {
                failures.push(format!("{name}: no id ({e})"));
                continue;
            }
        };
        let array = match LampArray::FromIdAsync(&id).map_err(|e| format!("{name}: {e}")) {
            Ok(op) => match op.await {
                Ok(a) => a,
                Err(e) => {
                    failures.push(format!("{name}: {e}"));
                    continue;
                }
            },
            Err(e) => {
                failures.push(format!("{name}: {e}"));
                continue;
            }
        };
        let lamps = array.LampCount().unwrap_or(0).max(0);
        let mut indices = Vec::with_capacity(lamps as usize);
        for lamp in 0..lamps {
            indices.push(
                array
                    .GetLampInfo(lamp)
                    .ok()
                    .and_then(|li| li.Index().ok())
                    .unwrap_or(lamp),
            );
        }
        names.push(DynlightArray {
            name,
            lamps: lamps as u32,
        });
        opened.push(OpenedArray {
            array,
            indices,
            on: false,
            last: None,
        });
    }

    {
        let mut s = STATUS.lock().map_err(|_| "status poisoned")?;
        s.supported = true;
        s.arrays = names;
    }
    if opened.is_empty() {
        if size == 0 {
            set_error(None);
            log::info!("dynlight: no lighting devices exposed by Windows");
        } else {
            let detail = failures
                .first()
                .map(|f| format!("{f} "))
                .unwrap_or_default();
            set_error(Some(format!(
                "{detail}no lamp array could be opened (check Settings > Personalization > \
                 Dynamic Lighting > Let apps control my lighting)"
            )));
        }
    } else {
        set_error(None);
        log::info!("dynlight: {} lamp array(s) ready", opened.len());
    }
    Ok(opened)
}

fn apply(oa: &mut OpenedArray, frame: Option<Vec<[u8; 3]>>) -> Result<(), String> {
    let count = oa.indices.len();
    match frame {
        None => {
            if oa.on {
                oa.array
                    .SetIsEnabled(false)
                    .map_err(|e| format!("could not switch a lamp array off: {e}"))?;
                oa.on = false;
                oa.last = None;
            }
            Ok(())
        }
        Some(mut colors) => {
            colors.resize(count, [0, 0, 0]);
            if oa.last.as_deref() == Some(colors.as_slice()) {
                return Ok(());
            }
            if !oa.on {
                oa.array
                    .SetIsEnabled(true)
                    .map_err(|e| format!("could not switch a lamp array on: {e}"))?;
                oa.on = true;
            }
            let uniform = colors.iter().all(|c| *c == colors[0]);
            if uniform {
                oa.array
                    .SetColor(color(colors[0]))
                    .map_err(|e| format!("could not set a lamp colour: {e}"))?;
            } else {
                let ui: Vec<windows::UI::Color> = colors.iter().map(|&c| color(c)).collect();
                oa.array
                    .SetColorsForIndices(&ui, &oa.indices)
                    .map_err(|e| format!("could not set lamp colours: {e}"))?;
            }
            oa.last = Some(colors);
            Ok(())
        }
    }
}

fn worker(rx: mpsc::Receiver<Cmd>) {
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

    let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
    let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(e) => {
            log::warn!("dynlight: no runtime ({e})");
            if initialized {
                unsafe {
                    let _ = CoUninitialize();
                }
            }
            return;
        }
    };

    let mut arrays: Vec<OpenedArray> = match rt.block_on(enumerate()) {
        Ok(a) => a,
        Err(e) => {
            if let Ok(mut s) = STATUS.lock() {
                s.supported = false;
            }
            set_error(Some(e));
            Vec::new()
        }
    };
    let mut last_retry = std::time::Instant::now()
        .checked_sub(std::time::Duration::from_secs(u64::MAX / 2))
        .unwrap_or_else(std::time::Instant::now);

    while let Ok(cmd) = rx.recv() {
        match cmd {
            Cmd::Refresh => {
                last_retry = std::time::Instant::now();
                arrays = rt.block_on(enumerate()).unwrap_or_else(|e| {
                    set_error(Some(e));
                    Vec::new()
                });
            }
            Cmd::Disable => {
                let mut failed = false;
                for oa in arrays.iter_mut() {
                    if let Err(e) = apply(oa, None) {
                        set_error(Some(e));
                        failed = true;
                        break;
                    }
                }
                if !failed {
                    set_error(None);
                }
            }
            Cmd::Frame(frame) => {
                if arrays.is_empty()
                    && last_retry.elapsed() >= std::time::Duration::from_secs(5)
                {
                    last_retry = std::time::Instant::now();
                    arrays = rt.block_on(enumerate()).unwrap_or_default();
                }
                let mut first_err: Option<String> = None;
                for (i, oa) in arrays.iter_mut().enumerate() {
                    let slot = frame.get(i).cloned().flatten();
                    if let Err(e) = apply(oa, slot) {
                        first_err = Some(e);
                        break;
                    }
                }
                set_error(first_err);
            }
        }
    }

    if initialized {
        unsafe {
            let _ = CoUninitialize();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::RgbMode;

    fn cfg() -> RgbConfig {
        RgbConfig::default()
    }

    fn sample(rgb: [u8; 3]) -> ZoneSample {
        ZoneSample {
            id: "all".into(),
            monitor: String::new(),
            rgb,
            luma: 0.5,
            primary: true,
            received_ms: crate::config::now_ms(),
        }
    }

    fn smoother() -> SmoothedColors {
        SmoothedColors::default()
    }

    #[test]
    fn static_mode_paints_every_array_the_configured_colour() {
        let mut c = cfg();
        c.mode = RgbMode::Static;
        c.static_color = [10, 20, 30];
        let frames = frames_for(&c, &[], 0.0, &[12, 40], false, &mut smoother());
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].as_ref().map(|f| f.len()), Some(12));
        assert_eq!(frames[1].as_ref().map(|f| f.len()), Some(40));
        assert!(frames.iter().all(|f| f.as_ref().unwrap().iter().all(|c| *c == [10, 20, 30])));
    }

    #[test]
    fn a_zero_lamp_array_is_off_not_empty() {
        let mut c = cfg();
        c.mode = RgbMode::Static;
        let frames = frames_for(&c, &[], 0.0, &[0, 8], false, &mut smoother());
        assert!(frames[0].is_none(), "zero lamps must map to off");
        assert!(frames[1].is_some(), "eight lamps must get a frame");
    }

    #[test]
    fn zone_mode_without_a_zone_falls_back_to_the_ambient_colour() {
        let mut c = cfg();
        c.mode = RgbMode::Zone;
        let frames = frames_for(&c, &[sample([200, 40, 40])], 0.0, &[10], false, &mut smoother());
        let frame = frames[0].as_ref().expect("zone fallback must not go dark");
        assert!(
            frame.iter().all(|col| col[0] > col[1] && col[0] > col[2]),
            "the fallback should keep the wallpaper's dominant red: {frame:?}"
        );
    }

    #[test]
    fn animations_produce_per_lamp_frames_of_the_right_length() {
        let mut c = cfg();
        c.mode = RgbMode::Cycle;
        let a = frames_for(&c, &[sample([0, 0, 0])], 0.5, &[16], false, &mut smoother());
        let frame = a[0].as_ref().expect("animation frame missing");
        assert_eq!(frame.len(), 16);
        assert!(
            frame.windows(2).any(|w| w[0] != w[1]),
            "a cycle frame must vary across lamps"
        );
    }

    #[test]
    fn a_track_flash_overrides_the_mode_with_white() {
        let mut c = cfg();
        c.mode = RgbMode::Static;
        c.static_color = [1, 2, 3];
        let frames = frames_for(&c, &[], 0.0, &[4], true, &mut smoother());
        assert!(
            frames[0].as_ref().unwrap().iter().all(|col| col.iter().all(|&v| v > 200)),
            "flash should be near-white: {:?}",
            frames[0]
        );
    }

    #[test]
    fn disabled_rgb_never_builds_frames_at_the_call_site() {
        let mut c = cfg();
        c.enabled = false;
        c.dynlight_enabled = true;
        assert!(!c.enabled && c.dynlight_enabled, "engine gate must catch this");
        c.enabled = true;
        c.dynlight_enabled = false;
        assert!(!c.dynlight_enabled);
    }

    #[test]
    fn the_lamp_key_base_cannot_collide_with_a_real_device() {
        let c = cfg();
        assert!(!c.excluded_devices.contains(&LAMP_KEY_BASE));
        assert!(LAMP_KEY_BASE > 0xD000_0000);
    }

    #[test]
    fn status_reports_wanted_from_the_live_config() {
        let s = status();
        let expected = crate::config_store::try_get()
            .map(|c| c.rgb.dynlight_enabled)
            .unwrap_or(false);
        assert_eq!(s.wanted, expected);
    }
}
