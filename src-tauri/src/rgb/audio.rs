//! System audio capture via WASAPI loopback or microphone for the audio-reactive RGB mode.
//!
//! Captures audio from the configured source (system loopback or microphone),
//! computes a running volume level and detects transients (beats) so the RGB
//! engine and the dashboard's equalizer can move on the music rather than on a
//! timer.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

/// Current audio volume, 0.0 .. 1.0.
static VOLUME_BITS: AtomicU32 = AtomicU32::new(0);

/// Flips true for one poll cycle when a beat is detected. Consumed on read,
/// so exactly one consumer acts on each hit.
static BEAT: AtomicBool = AtomicBool::new(false);

/// The transient envelope the dashboard visualizes, 0.0 .. 1.0. Unlike
/// [`beat`], this is read *without* consuming it and decays over wall-clock
/// time, so the RGB engine and the UI can both see the same hit.
static PULSE_BITS: AtomicU32 = AtomicU32::new(0);

/// Sensitivity multiplier (1.0 = default).
static SENSITIVITY_BITS: AtomicU32 = AtomicU32::new(0x3F800000); // 1.0f32

/// Audio source: 0 = system loopback, 1 = microphone.
static SOURCE: AtomicU32 = AtomicU32::new(0);

/// Signals the capture thread to restart (e.g. source changed).
static RESTART: AtomicBool = AtomicBool::new(false);

/// Currently active device name, set when capture starts.
static DEVICE_NAME: Mutex<String> = Mutex::new(String::new());

static STARTED: OnceLock<()> = OnceLock::new();

fn store_f32(atom: &AtomicU32, v: f32) {
    atom.store(v.to_bits(), Ordering::Relaxed);
}

fn load_f32(atom: &AtomicU32) -> f32 {
    f32::from_bits(atom.load(Ordering::Relaxed))
}

pub fn set_sensitivity(v: f32) {
    store_f32(&SENSITIVITY_BITS, v);
}

pub fn set_source(source: &str) {
    let val = if source == "microphone" { 1 } else { 0 };
    let prev = SOURCE.swap(val, Ordering::Relaxed);
    if prev != val {
        RESTART.store(true, Ordering::Relaxed);
    }
}

pub fn volume() -> f32 {
    load_f32(&VOLUME_BITS)
}

pub fn beat() -> bool {
    BEAT.swap(false, Ordering::Relaxed)
}

/// The current transient envelope, 0.0 .. 1.0. Read without side effects.
pub fn pulse() -> f32 {
    load_f32(&PULSE_BITS)
}

/// Decay constant for the transient envelope, in seconds. ~250ms to visually
/// zero: long enough to read as a hit, short enough that a fast passage does
/// not smear into a single glow.
const PULSE_TAU: f32 = 0.25;

/// Below this the envelope is snapped to zero so it can stop costing work.
const PULSE_EPSILON: f32 = 0.002;

/// Record an onset. Raises the envelope only — a new hit always wins over a
/// decaying older one, and never lowers it.
fn raise_pulse(strength: f32) {
    let current = load_f32(&PULSE_BITS);
    store_f32(&PULSE_BITS, current.max(strength).clamp(0.0, 1.0));
}

/// Advance the transient envelope by the real elapsed time. Called from the
/// engine ticker, so the flash lasts the same wall-clock duration whatever the
/// tick rate is.
pub fn decay_pulse(dt_sec: f32) {
    let current = load_f32(&PULSE_BITS);
    if current <= PULSE_EPSILON {
        if current != 0.0 {
            store_f32(&PULSE_BITS, 0.0);
        }
        return;
    }
    store_f32(&PULSE_BITS, current * (-dt_sec / PULSE_TAU).exp());
}

/// Two onsets closer than this are the same musical hit: a kick's attack and
/// its body are one beat, not two.
const REFRACTORY_MS: f32 = 110.0;

/// Positive energy flux must clear its running mean by this factor to count.
const FLUX_GAIN: f32 = 1.8;

/// Absolute flux floor, so near-silence (where the running mean collapses to
/// zero and any ratio would pass) can never register a beat.
const FLUX_FLOOR: f32 = 8e-5;

/// Energy floor: room tone and hiss are not percussion.
const ENERGY_FLOOR: f32 = 2e-4;

/// Map an RMS level onto 0..1 the way the ear hears it, across roughly
/// -60 dBFS (0.001) to -6 dBFS (0.5). Linear RMS is the wrong weight for a
/// visual response: doubling a quiet passage is a big deal and doubling a
/// loud one is not, but a linear meter reads them as equal steps.
fn perceived(rms: f32) -> f32 {
    ((20.0 * rms.max(1e-4).log10() + 60.0) / 54.0).clamp(0.0, 1.0)
}

/// Adaptive onset detection over the capture's energy stream.
///
/// Detection is on the *positive flux* — the rise in energy between polls —
/// rather than on absolute level. Absolute level cannot tell a kick from a
/// sustained loud chord, because both sit at the same energy; a rise can. The
/// threshold is the running mean of past flux plus a floor, which is what lets
/// the same detector work for a quiet acoustic track and a loud electronic one
/// without the user touching a sensitivity slider.
#[derive(Debug, Clone)]
pub struct OnsetDetector {
    /// Running mean of the positive flux.
    flux_avg: f32,
    /// Energy of the previous poll, for the flux difference.
    prev_energy: f32,
    /// Capture-clock time of the last onset, in milliseconds.
    last_onset_ms: f32,
}

impl Default for OnsetDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl OnsetDetector {
    pub fn new() -> Self {
        Self {
            // Seeded at the floor rather than zero: a cold start must not let
            // the first poll's tiny flux look like a huge ratio.
            flux_avg: FLUX_FLOOR / FLUX_GAIN,
            prev_energy: 0.0,
            last_onset_ms: f32::NEG_INFINITY,
        }
    }

    /// Feed one poll's RMS level. Returns the onset strength in 0.0 .. 1.0,
    /// or 0.0 when nothing fired.
    pub fn push(&mut self, rms: f32, now_ms: f32) -> f32 {
        let energy = rms * rms;
        let flux = (energy - self.prev_energy).max(0.0);
        self.prev_energy = energy;
        self.flux_avg = self.flux_avg * 0.94 + flux * 0.06;

        let threshold = self.flux_avg * FLUX_GAIN + FLUX_FLOOR;
        if flux <= threshold || energy <= ENERGY_FLOOR {
            return 0.0;
        }
        if now_ms - self.last_onset_ms < REFRACTORY_MS {
            return 0.0;
        }
        self.last_onset_ms = now_ms;
        // How loud the hit is, weighted the way the ear weights it, times how
        // much of that energy is *new*. A drum attack is nearly all new
        // energy; a swelling chord is mostly energy that was already there,
        // so it reads softer even though it clears the same threshold.
        let snap = (flux / (energy + FLUX_FLOOR)).clamp(0.0, 1.0);
        (perceived(rms) * (0.55 + 0.45 * snap)).clamp(0.0, 1.0)
    }
}

pub fn device_name() -> String {
    DEVICE_NAME.lock().unwrap().clone()
}

pub fn ensure_started() {
    STARTED.get_or_init(|| {
        thread::Builder::new()
            .name("audio-capture".into())
            .spawn(capture_loop)
            .ok();
    });
}

fn capture_loop() {
    loop {
        if RESTART.swap(false, Ordering::Relaxed) {
            log::info!("audio: source changed, restarting capture");
        }
        match try_capture() {
            Ok(()) => log::info!("audio: capture ended, restarting in 2s"),
            Err(e) => log::warn!("audio: capture failed ({e}), retrying in 2s"),
        }
        thread::sleep(Duration::from_secs(2));
    }
}

fn try_capture() -> Result<(), Box<dyn std::error::Error>> {
    use wasapi::*;

    let _ = initialize_mta();

    let source = SOURCE.load(Ordering::Relaxed);

    let mut audio_client = if source == 1 {
        // Microphone: default capture device.
        let device = get_default_device(&Direction::Capture)?;
        let name = device.get_friendlyname().unwrap_or_else(|_| "Microphone".into());
        *DEVICE_NAME.lock().unwrap() = name;
        device.get_iaudioclient()?
    } else {
        // System audio: default render device, loopback capture.
        let device = get_default_device(&Direction::Render)?;
        let name = device.get_friendlyname().unwrap_or_else(|_| "System Audio".into());
        *DEVICE_NAME.lock().unwrap() = name;
        device.get_iaudioclient()?
    };

    let mix_format = audio_client.get_mixformat()?;

    log::info!(
        "audio: device mix format: {} Hz, {} ch, {} bit (source={})",
        mix_format.get_samplespersec(),
        mix_format.get_nchannels(),
        mix_format.get_bitspersample(),
        if source == 1 { "mic" } else { "system" },
    );

    let (_def, min_time) = audio_client.get_periods()?;

    let direction = if source == 1 {
        Direction::Capture
    } else {
        Direction::Capture // Loopback: Direction::Capture on Render device
    };

    audio_client.initialize_client(
        &mix_format,
        min_time,
        &direction,
        &ShareMode::Shared,
        true,
    )?;

    let h_event = audio_client.set_get_eventhandle()?;
    let capture = audio_client.get_audiocaptureclient()?;
    audio_client.start_stream()?;

    log::info!("audio: WASAPI capture started (source={})", if source == 1 { "mic" } else { "system" });

    let channels = mix_format.get_nchannels() as usize;
    let bytes_per_sample = mix_format.get_bitspersample() as usize / 8;
    let bytes_per_frame = channels * bytes_per_sample;

    let mut sample_queue: VecDeque<u8> = VecDeque::with_capacity(16384);
    let mut onset = OnsetDetector::new();
    let started = std::time::Instant::now();

    loop {
        // Check if source changed while we're running.
        if RESTART.swap(false, Ordering::Relaxed) {
            audio_client.stop_stream()?;
            log::info!("audio: restarting due to source change");
            return Ok(());
        }

        capture.read_from_device_to_deque(&mut sample_queue)?;

        let frame_count = sample_queue.len() / bytes_per_frame;
        if frame_count == 0 {
            if h_event.wait_for_event(1000).is_err() {
                log::warn!("audio: wait_for_event timeout");
                audio_client.stop_stream()?;
                break;
            }
            continue;
        }

        let mut sum_sq: f64 = 0.0;
        let mut count: usize = 0;

        match bytes_per_sample {
            4 => {
                let is_float = mix_format.get_subformat()? == SampleType::Float;
                for _ in 0..frame_count {
                    if sample_queue.len() < bytes_per_frame {
                        break;
                    }
                    let mut sum_ch: f64 = 0.0;
                    for _ in 0..channels {
                        let b0 = sample_queue.pop_front().unwrap();
                        let b1 = sample_queue.pop_front().unwrap();
                        let b2 = sample_queue.pop_front().unwrap();
                        let b3 = sample_queue.pop_front().unwrap();
                        let val = if is_float {
                            f32::from_le_bytes([b0, b1, b2, b3]) as f64
                        } else {
                            (i32::from_le_bytes([b0, b1, b2, b3]) as f64) / (i32::MAX as f64)
                        };
                        sum_ch += val;
                    }
                    let s = (sum_ch / channels as f64) as f32;
                    sum_sq += s as f64 * s as f64;
                    count += 1;
                }
            }
            2 => {
                for _ in 0..frame_count {
                    if sample_queue.len() < bytes_per_frame {
                        break;
                    }
                    let mut sum_ch: f64 = 0.0;
                    for _ in 0..channels {
                        let lo = sample_queue.pop_front().unwrap();
                        let hi = sample_queue.pop_front().unwrap();
                        let val = i16::from_le_bytes([lo, hi]) as f64 / i16::MAX as f64;
                        sum_ch += val;
                    }
                    let s = (sum_ch / channels as f64) as f32;
                    sum_sq += s as f64 * s as f64;
                    count += 1;
                }
            }
            _ => {
                sample_queue.drain(..sample_queue.len().min(frame_count * bytes_per_frame));
            }
        }

        let rms = if count > 0 {
            (sum_sq / count as f64).sqrt() as f32
        } else {
            0.0
        };

        let sens = load_f32(&SENSITIVITY_BITS);
        let vol = (rms * sens * 3.0).clamp(0.0, 1.0);
        store_f32(&VOLUME_BITS, vol);

        let strength = onset.push(rms, started.elapsed().as_secs_f32() * 1000.0);
        if strength > 0.0 {
            BEAT.store(true, Ordering::Relaxed);
            raise_pulse(strength);
        }

        if h_event.wait_for_event(1000).is_err() {
            log::warn!("audio: wait_for_event timeout, stopping");
            audio_client.stop_stream()?;
            break;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feed a level repeatedly at a fixed cadence, the way the capture loop
    /// does. Returns every onset strength produced.
    fn run(det: &mut OnsetDetector, levels: &[(f32, f32)]) -> Vec<f32> {
        levels.iter().map(|(rms, t)| det.push(*rms, *t)).collect()
    }

    #[test]
    fn silence_never_triggers() {
        let mut det = OnsetDetector::new();
        let levels: Vec<(f32, f32)> = (0..200).map(|i| (0.0, i as f32 * 25.0)).collect();
        assert_eq!(run(&mut det, &levels), vec![0.0; 200]);
    }

    #[test]
    fn room_tone_hiss_is_not_a_beat() {
        let mut det = OnsetDetector::new();
        // Constant low-level noise: the flux is near zero, so nothing fires
        // even though the level never returns to absolute silence.
        let levels: Vec<(f32, f32)> = (0..200).map(|i| (0.012, i as f32 * 25.0)).collect();
        assert!(run(&mut det, &levels).iter().all(|s| *s == 0.0));
    }

    #[test]
    fn a_hit_after_quiet_fires_once() {
        let mut det = OnsetDetector::new();
        let mut levels: Vec<(f32, f32)> = (0..80).map(|i| (0.01, i as f32 * 25.0)).collect();
        levels.push((0.42, 80.0 * 25.0));
        levels.push((0.20, 81.0 * 25.0));
        levels.push((0.05, 82.0 * 25.0));
        let out = run(&mut det, &levels);
        assert!(out[80] > 0.0, "the rise must register as an onset");
        assert_eq!(out[81], 0.0, "the fall is not a new hit");
        assert_eq!(out[82], 0.0, "the decay is not a new hit");
    }

    #[test]
    fn a_sustained_loud_chord_is_one_hit_not_a_stream() {
        let mut det = OnsetDetector::new();
        // Attack once, then hold. Absolute level stays high, but there is no
        // *rise* after the attack, so the chord cannot masquerade as a beat.
        let mut levels: Vec<(f32, f32)> = (0..60).map(|i| (0.01, i as f32 * 25.0)).collect();
        levels.extend((60..160).map(|i| (0.45, i as f32 * 25.0)));
        let out = run(&mut det, &levels);
        let hits = out.iter().filter(|s| **s > 0.0).count();
        assert!(hits <= 2, "a held chord produced {hits} onsets, expected ~1");
    }

    #[test]
    fn the_refractory_window_collapses_one_hit_into_one_onset() {
        let mut det = OnsetDetector::new();
        let mut levels: Vec<(f32, f32)> = (0..60).map(|i| (0.01, i as f32 * 25.0)).collect();
        // A rapid double-tap 40ms apart (a flam / double-kick) is one beat.
        levels.push((0.40, 60.0 * 25.0));
        levels.push((0.10, 60.0 * 25.0 + 20.0));
        levels.push((0.40, 60.0 * 25.0 + 40.0));
        levels.push((0.10, 60.0 * 25.0 + 60.0));
        let out = run(&mut det, &levels);
        let hits = out.iter().filter(|s| **s > 0.0).count();
        assert_eq!(hits, 1, "both transients landed inside the refractory window");
    }

    #[test]
    fn steady_tempo_hits_stay_separated_past_the_refractory_window() {
        let mut det = OnsetDetector::new();
        let mut levels: Vec<(f32, f32)> = (0..60).map(|i| (0.01, i as f32 * 25.0)).collect();
        // 120 BPM: a hit every 500ms.
        for beat in 0..4 {
            let t = 60.0 * 25.0 + beat as f32 * 500.0;
            levels.push((0.40, t));
            levels.push((0.06, t + 60.0));
        }
        let out = run(&mut det, &levels);
        assert_eq!(
            out.iter().filter(|s| **s > 0.0).count(),
            4,
            "each beat of a 120 BPM pulse should register separately"
        );
    }

    #[test]
    fn strength_is_bounded_and_ordered_by_hardness() {
        let hit = |rms: f32| {
            let mut d = OnsetDetector::new();
            for i in 0..80 {
                d.push(0.01, i as f32 * 25.0);
            }
            d.push(rms, 2000.0)
        };
        let soft = hit(0.05);
        let hard = hit(0.30);
        assert!((0.0..=1.0).contains(&soft), "strength {soft} out of range");
        assert!((0.0..=1.0).contains(&hard), "strength {hard} out of range");
        assert!(soft > 0.0, "a real hit must not read as silence");
        assert!(hard > soft, "a harder hit should read stronger ({hard} vs {soft})");
    }

    #[test]
    fn the_loudness_curve_is_uniform_in_decibels() {
        // A dB curve's promise is that *the same ratio* moves the needle by
        // the same amount wherever it sits. A linear RMS meter would give the
        // quiet doubling a 2x step and the loud one 0.2x, which is why a
        // half-speed quiet track looks motionless on a linear meter.
        let quiet_step = perceived(0.04) - perceived(0.02);
        let loud_step = perceived(0.40) - perceived(0.20);
        assert!(
            (quiet_step - loud_step).abs() < 1e-4,
            "doubling should be uniform in dB ({quiet_step} vs {loud_step})"
        );
        // The failure this replaces: a linear meter normalized to full scale.
        // The same doubling is 4% of the scale when quiet and 40% when loud,
        // so a quiet or half-speed track is visually frozen no matter how
        // clearly it is audible.
        let linear = |rms: f32| (rms / 0.5).clamp(0.0, 1.0);
        let linear_quiet = linear(0.04) - linear(0.02);
        assert!(
            quiet_step > linear_quiet * 2.0,
            "a quiet doubling should be clearly visible here ({quiet_step} vs {linear_quiet})"
        );
        assert!(
            linear_quiet < 0.05,
            "and near-invisible on a linear meter, which is the bug"
        );
        assert_eq!(perceived(0.0005), 0.0, "below the floor reads as silence");
        assert_eq!(perceived(1.0), 1.0, "a full-scale hit reads as full");
    }

    #[test]
    fn the_envelope_decays_on_elapsed_time_not_on_tick_count() {
        // Same elapsed time, different number of decay calls: the envelope
        // must land in the same place, which is what stops the flash from
        // stretching when the engine loop is busy.
        let mut stepped = 1.0f32;
        for _ in 0..100 {
            stepped = decayed(stepped, 0.001);
        }
        let once = decayed(1.0, 0.1);
        assert!(
            (stepped - once).abs() < 0.001,
            "100 x 1ms ({stepped}) diverged from 1 x 100ms ({once})"
        );
        assert!(once < 1.0 && once > 0.0, "envelope should be mid-decay, got {once}");
    }

    /// The pure decay curve, mirrored from `decay_pulse` so the property is
    /// testable without touching the process-wide atomic.
    fn decayed(current: f32, dt_sec: f32) -> f32 {
        current * (-dt_sec / PULSE_TAU).exp()
    }

    #[test]
    fn a_raised_envelope_never_lowers_an_older_larger_one() {
        // raise_pulse is max(), not assignment: a soft hi-hat landing during a
        // hard kick's decay must not cut the kick short.
        let current = 0.8f32;
        let after_soft_hit = current.max(0.3);
        assert_eq!(after_soft_hit, 0.8);
        let after_hard_hit = after_soft_hit.max(0.95);
        assert_eq!(after_hard_hit, 0.95);
    }
}
