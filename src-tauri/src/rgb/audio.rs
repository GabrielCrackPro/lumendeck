//! System audio capture via WASAPI loopback or microphone for the audio-reactive RGB mode.
//!
//! Captures audio from the configured source (system loopback or microphone),
//! computes a running volume level and a simple beat flag so the RGB engine
//! can pulse LEDs in sync with the music.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

/// Current audio volume, 0.0 .. 1.0.
static VOLUME_BITS: AtomicU32 = AtomicU32::new(0);

/// Flips true for one poll cycle when a beat is detected.
static BEAT: AtomicBool = AtomicBool::new(false);

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

    let mut avg_energy: f32 = 0.001;
    let mut sample_queue: VecDeque<u8> = VecDeque::with_capacity(16384);

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

        let energy = rms * rms;
        if energy > avg_energy * 1.6 && energy > 0.0001 {
            BEAT.store(true, Ordering::Relaxed);
        }
        avg_energy = avg_energy * 0.92 + energy * 0.08;

        if h_event.wait_for_event(1000).is_err() {
            log::warn!("audio: wait_for_event timeout, stopping");
            audio_client.stop_stream()?;
            break;
        }
    }

    Ok(())
}
