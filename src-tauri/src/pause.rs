//! Background watcher applying pause rules (battery saver, fullscreen app).

use crate::events;
use crate::wallpaper;
use std::time::Duration;

pub fn spawn() {
    tauri::async_runtime::spawn(async move {
        let mut last: Option<bool> = None;
        loop {
            let cfg = crate::config_store::get();

            // Catch-all for topology changes that don't broadcast (sleep/wake,
            // RDP, some driver resets).
            crate::display_watch::poll();
            let mut paused = false;

            if cfg.general.pause_on_battery_saver {
                if let Some(true) = crate::win32::on_battery_or_saver() {
                    paused = true;
                }
            }
            if cfg.general.pause_on_fullscreen && crate::win32::has_fullscreen_foreground() {
                paused = true;
            }

            if last != Some(paused) {
                last = Some(paused);
                wallpaper::set_paused(paused);
                if let Some(app) = crate::app_handle() {
                    events::emit_all(&app, events::WALLPAUSE, &paused);
                }
                log::info!(
                    "auto-pause -> {paused} (battery_saver={} fullscreen={})",
                    cfg.general.pause_on_battery_saver,
                    cfg.general.pause_on_fullscreen
                );
            }

            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
}
