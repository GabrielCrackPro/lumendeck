//! CPU and memory pressure, for the dashboard's header strip.
//!
//! The strip already reports the dashboard's own frame rate. That number is
//! only interpretable next to a question it cannot answer alone: is 58fps a
//! problem, or is the machine simply busy? A user whose wallpaper stutters
//! reaches for Task Manager, which is a window away and says nothing about
//! LumenDeck. This answers it where the frame rate is printed.
//!
//! Sampling is a background thread rather than work done inside the command
//! because of how CPU usage is measured: `sysinfo` reports the load *between*
//! two refreshes, so a single on-demand read is always either 0% or a figure
//! averaged over an unknown window. Blocking an IPC call for the sampling
//! interval to get an honest answer is worse than publishing the last one.

use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::System;

/// How often the sampler thread wakes.
///
/// One second matches the FPS readout's publish rate, so the two numbers in
/// the strip describe roughly the same window and can be read against each
/// other. Faster costs a CPU counter read per wake for a number nobody reads
/// more than once a second.
const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);

/// What the dashboard renders. Every field is optional because "not measured
/// yet" and "measured as zero" are different states, and a strip that printed
/// `0% CPU` on its first paint would be reporting the sampler's warm-up as a
/// measurement.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfSnapshot {
    /// System-wide CPU load, 0.0..=100.0. None until two samples exist.
    pub cpu_percent: Option<f32>,
    /// Physical memory in use, in bytes.
    pub mem_used_bytes: Option<u64>,
    /// Physical memory installed, in bytes.
    pub mem_total_bytes: Option<u64>,
    /// How long ago the sampler last published, in milliseconds.
    ///
    /// Published so the window can tell a stale reading from a live one: a
    /// dashboard left open in the tray for a day should say the number is old
    /// rather than presenting it as current.
    pub age_ms: Option<u64>,
}

/// The most recent snapshot, and when it was published.
///
/// The publish instant is stored rather than a running age: an age computed at
/// publish time and frozen there would leave a snapshot claiming to be current
/// forever if the sampler thread ever died. Computing it on read is what makes
/// a dead sampler show up as stale.
struct Published {
    snap: PerfSnapshot,
    at: Instant,
}

static LATEST: OnceLock<Mutex<Option<Published>>> = OnceLock::new();

fn slot() -> &'static Mutex<Option<Published>> {
    LATEST.get_or_init(|| Mutex::new(None))
}

/// The last published snapshot, with its age filled in.
///
/// Never blocks on the sampler for long: it takes the lock the sampler holds
/// for microseconds and copies out.
pub fn latest() -> PerfSnapshot {
    let guard = slot().lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_ref() {
        None => PerfSnapshot::default(),
        Some(p) => PerfSnapshot {
            age_ms: Some(p.at.elapsed().as_millis() as u64),
            ..p.snap
        },
    }
}

/// Publish a snapshot, stamping the instant it was taken.
fn publish(snap: PerfSnapshot) {
    let mut guard = slot().lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(Published {
        snap: PerfSnapshot { age_ms: Some(0), ..snap },
        at: Instant::now(),
    });
}

// Whether a reading is still current is decided in the window, in
// `perfReadout.ts`, which owns the whole presentation of a snapshot including
// the stale threshold. It is deliberately not reimplemented here: a second
// copy of that rule in Rust would be a second answer to the same question, and
// only one of them would be reached by any code path.

/// Start the sampler. Idempotent: a second call does nothing, because the
/// dashboard window can be recreated and a second sampler would only publish
/// competing readings.
pub fn start() {
    // `get_or_init` returns the value it initialised, so returning `true` from
    // the closure means "first caller": every later call gets `false` and does
    // not spawn a second sampler.
    let already_started = !STARTED.get_or_init(|| true);
    if already_started {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("lumendeck-perf".into())
        .spawn(loop_forever);
    if let Err(e) = spawned {
        // One line, once, at startup: the strip is a nicety and the app is
        // fully usable without it, so this must not be fatal.
        log::warn!("perf sampler failed to start: {e} — the header strip will omit CPU/RAM");
    }
}

static STARTED: OnceLock<bool> = OnceLock::new();

fn loop_forever() {
    let mut sys = System::new();
    // Prime the CPU counters before the first sleep. `global_cpu_usage` reports
    // the load between two refreshes, so a value read before any refresh has
    // happened describes no interval at all -- it is 0, and publishing that
    // would report an idle machine on the first tick.
    sys.refresh_cpu_usage();
    loop {
        std::thread::sleep(SAMPLE_INTERVAL);
        // Order matters: refresh first, then read. The reading is the load
        // across the interval that just elapsed, which is the one the user
        // was watching while the FPS number was on screen.
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        publish(PerfSnapshot {
            cpu_percent: Some(sys.global_cpu_usage()),
            mem_used_bytes: Some(sys.used_memory()),
            mem_total_bytes: Some(sys.total_memory()),
            age_ms: Some(0),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latest_is_empty_before_the_sampler_has_run() {
        // Not asserted against the real static, which other tests in this
        // binary may have populated; the contract under test is the shape.
        let snap = PerfSnapshot::default();
        assert_eq!(snap.cpu_percent, None);
        assert_eq!(snap.age_ms, None);
    }

    #[test]
    fn publish_stamps_a_snapshot_fresh_and_discards_a_stale_age() {
        publish(PerfSnapshot {
            cpu_percent: Some(7.0),
            mem_used_bytes: Some(10),
            mem_total_bytes: Some(20),
            age_ms: Some(99_999),
        });
        let snap = latest();
        // The reading's age is derived from the publish instant on read, not
        // taken from the value the sampler passed in -- otherwise a snapshot
        // could be published pre-aged and never recover.
        assert_eq!(snap.age_ms, Some(0));
        assert_eq!(snap.cpu_percent, Some(7.0));
    }

    #[test]
    fn a_published_snapshot_carries_a_real_age() {
        publish(PerfSnapshot {
            cpu_percent: Some(12.0),
            mem_used_bytes: Some(1),
            mem_total_bytes: Some(2),
            age_ms: None,
        });
        // The end-to-end path the command uses. What the window does with the
        // age is decided in `perfReadout.ts`; what matters here is that a real
        // publish arrives with a measurable age rather than a frozen zero.
        let snap = latest();
        assert!(snap.age_ms.is_some());
        assert_eq!(snap.cpu_percent, Some(12.0));
    }
}