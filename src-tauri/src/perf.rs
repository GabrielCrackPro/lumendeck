
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::System;

const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfSnapshot {
    pub cpu_percent: Option<f32>,
    pub mem_used_bytes: Option<u64>,
    pub mem_total_bytes: Option<u64>,
    pub age_ms: Option<u64>,
}

struct Published {
    snap: PerfSnapshot,
    at: Instant,
}

static LATEST: OnceLock<Mutex<Option<Published>>> = OnceLock::new();

fn slot() -> &'static Mutex<Option<Published>> {
    LATEST.get_or_init(|| Mutex::new(None))
}

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

fn publish(snap: PerfSnapshot) {
    let mut guard = slot().lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(Published {
        snap: PerfSnapshot { age_ms: Some(0), ..snap },
        at: Instant::now(),
    });
}


pub fn start() {
    let already_started = !STARTED.get_or_init(|| true);
    if already_started {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("lumendeck-perf".into())
        .spawn(loop_forever);
    if let Err(e) = spawned {
        log::warn!("perf sampler failed to start: {e} — the header strip will omit CPU/RAM");
    }
}

static STARTED: OnceLock<bool> = OnceLock::new();

fn loop_forever() {
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    loop {
        std::thread::sleep(SAMPLE_INTERVAL);
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
        let snap = latest();
        assert!(snap.age_ms.is_some());
        assert_eq!(snap.cpu_percent, Some(12.0));
    }
}