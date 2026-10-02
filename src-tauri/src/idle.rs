//! Background watcher: turns off RGB lights after a period of user inactivity.
//!
//! Polls `mouse_hook::last_input_ms()` at the configured interval. When
//! inactivity exceeds `idle_timeout_min`, tells the RGB engine to sleep (push
//! black). On input wake, resumes normal output.

use std::time::Duration;

pub fn spawn() {
    tauri::async_runtime::spawn(async move {
        let mut was_idle = false;
        loop {
            // Re-read config every tick so changes take effect immediately.
            let cfg = crate::config_store::get();
            let timeout_min = cfg.rgb.idle_timeout_sec;
            let interval = cfg.rgb.idle_check_interval_sec.clamp(1, 60);

            if timeout_min == 0 {
                // Disabled — make sure we're awake if we were sleeping.
                if was_idle {
                    crate::rgb::set_sleeping(false);
                    was_idle = false;
                }
                tokio::time::sleep(Duration::from_secs(interval)).await;
                continue;
            }

            let timeout_ms = timeout_min.saturating_mul(1_000);
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let last = crate::mouse_hook::last_input_ms();
            // Zero means no input has been observed yet, which is not the same
            // as "no input since 1970". Treating it as an epoch timestamp is
            // what produced `idle: no input for 1790755853423ms` on every fresh
            // install: a number that looks like a hang and means nothing. Skip
            // the tick instead, and let the next one decide once a hook has
            // armed. The hooks call `mouse_hook::arm()` at startup, so this only
            // covers the seconds before they do.
            if last == 0 {
                tokio::time::sleep(Duration::from_secs(interval)).await;
                continue;
            }
            let elapsed = now_ms.saturating_sub(last);
            let idle = elapsed >= timeout_ms;

            if idle && !was_idle {
                // Whole seconds, not the raw millisecond count: 30901ms is
                // harder to read at a glance than "31s", and the threshold is
                // already in the same unit.
                log::info!(
                    "idle: no input for {}s (threshold {}s) — sleeping RGB",
                    elapsed / 1_000,
                    timeout_ms / 1_000
                );
                crate::rgb::set_sleeping(true);
                was_idle = true;
            } else if !idle && was_idle {
                log::info!("idle: input activity detected — waking RGB");
                crate::rgb::set_sleeping(false);
                was_idle = false;
            }

            tokio::time::sleep(Duration::from_secs(interval)).await;
        }
    });
}
