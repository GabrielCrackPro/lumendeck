
use std::time::Duration;

pub fn spawn() {
    tauri::async_runtime::spawn(async move {
        let mut was_idle = false;
        loop {
            let cfg = crate::config_store::get();
            let timeout_min = cfg.rgb.idle_timeout_sec;
            let interval = cfg.rgb.idle_check_interval_sec.clamp(1, 60);

            if timeout_min == 0 {
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
            if last == 0 {
                tokio::time::sleep(Duration::from_secs(interval)).await;
                continue;
            }
            let elapsed = now_ms.saturating_sub(last);
            let idle = elapsed >= timeout_ms;

            if idle && !was_idle {
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
