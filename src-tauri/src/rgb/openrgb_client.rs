//! OpenRGB SDK client: supervised connection, device registry, color push.

use openrgb::data::{Color, Controller};
use openrgb::OpenRGB;
use serde::Serialize;
use std::time::Duration;
use tokio::sync::{mpsc, watch};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: u32,
    pub name: String,
    pub type_name: String,
    pub leds: u32,
    pub zones: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RgbStatus {
    pub connected: bool,
    pub protocol_version: Option<u32>,
    pub devices: Vec<DeviceInfo>,
    pub last_error: Option<String>,
}

enum PushMsg {
    Colors { device: u32, colors: Vec<Color> },
    Refresh,
}

/// Handle shared with IPC commands: latest status + a color push queue.
#[derive(Clone)]
pub struct RgbClientHandle {
    status: watch::Receiver<RgbStatus>,
    queue: mpsc::Sender<PushMsg>,
}

impl RgbClientHandle {
    pub fn new() -> Self {
        let (status_tx, status_rx) = watch::channel(RgbStatus {
            connected: false,
            protocol_version: None,
            devices: Vec::new(),
            last_error: None,
        });
        let (queue_tx, queue_rx) = mpsc::channel::<PushMsg>(256);
        tauri::async_runtime::spawn(connection_task(queue_rx, status_tx));
        Self {
            status: status_rx,
            queue: queue_tx,
        }
    }

    pub fn status(&self) -> RgbStatus {
        self.status.borrow().clone()
    }

    pub async fn push_device_colors(&self, device: u32, colors: Vec<Color>) {
        let _ = self.queue.send(PushMsg::Colors { device, colors }).await;
    }

    pub async fn refresh(&self) {
        let _ = self.queue.send(PushMsg::Refresh).await;
    }
}

fn set_status(status_tx: &watch::Sender<RgbStatus>, f: impl FnOnce(&mut RgbStatus)) {
    let mut s = status_tx.borrow().clone();
    f(&mut s);
    let _ = status_tx.send(s);
}

fn registry_from(controllers: Vec<(u32, Controller)>) -> Vec<DeviceInfo> {
    controllers
        .into_iter()
        .map(|(id, c)| DeviceInfo {
            id,
            name: c.name.trim_end_matches('\0').to_string(),
            type_name: format!("{:?}", c.r#type),
            leds: c.leds.len() as u32,
            zones: c.zones.iter().map(|z| z.name.clone()).collect(),
        })
        .collect()
}

/// Supervisor: connects, refreshes the device list, services the push queue,
/// reconnects with backoff on errors.
async fn connection_task(mut rx: mpsc::Receiver<PushMsg>, status_tx: watch::Sender<RgbStatus>) {
    let mut backoff: u64 = 1;
    loop {
        let (host, port, enabled) = {
            let cfg = crate::config_store::get();
            (cfg.rgb.host.clone(), cfg.rgb.port, cfg.rgb.enabled)
        };

        if !enabled {
            set_status(&status_tx, |s| {
                s.connected = false;
                s.devices.clear();
            });
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        }

        match OpenRGB::connect_to((host.as_str(), port)).await {
            Ok(client) => {
                backoff = 1;
                let _ = client.set_name("LumenDeck").await;
                let proto = client.get_protocol_version();

                let count = client.get_controller_count().await.unwrap_or(0);
                let mut controllers: Vec<(u32, Controller)> = Vec::new();
                for id in 0..count {
                    if let Ok(c) = client.get_controller(id).await {
                        controllers.push((id, c));
                    }
                }
                set_status(&status_tx, |s| {
                    s.connected = true;
                    s.protocol_version = Some(proto);
                    s.devices = registry_from(controllers);
                    s.last_error = None;
                });

                // Hotplug watch: re-enumerate controllers every 1s.
                let mut poll = tokio::time::interval(Duration::from_secs(1));
                poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                // Track which devices failed update_leds so we can reconnect
                // immediately when a device disappears (clears OpenRGB cache).
                let mut push_fails: std::collections::HashSet<u32> = std::collections::HashSet::new();
                loop {
                    tokio::select! {
                        msg = rx.recv() => {
                            match msg {
                                Some(PushMsg::Colors { device, colors }) => {
                                    match client.update_leds(device, colors).await {
                                        Ok(()) => {
                                            push_fails.remove(&device);
                                        }
                                        Err(e) => {
                                            log::warn!("update_leds failed for device {device}: {e}");
                                            push_fails.insert(device);
                                            // Remove the dead device from the list
                                            // immediately. Internal keyboards never
                                            // fail update_leds so they stay.
                                            set_status(&status_tx, |s| {
                                                s.devices.retain(|d| d.id != device);
                                            });
                                            // If multiple devices fail, OpenRGB
                                            // connection is likely dead — reconnect.
                                            if push_fails.len() >= 2 {
                                                set_status(&status_tx, |s| {
                                                    s.last_error = Some(e.to_string());
                                                    s.connected = false;
                                                });
                                                break;
                                            }
                                        }
                                    }
                                }
                                Some(PushMsg::Refresh) => break,
                                None => return, // app shutting down
                            }
                        }
                        _ = poll.tick() => {
                            let count = client.get_controller_count().await.unwrap_or(0);
                            let mut fresh: Vec<(u32, Controller)> = Vec::new();
                            for id in 0..count {
                                if let Ok(c) = client.get_controller(id).await {
                                    fresh.push((id, c));
                                }
                            }
                            let new_registry = registry_from(fresh);

                            let old_ids: Vec<u32> = status_tx.borrow().devices.iter().map(|d| d.id).collect();
                            let new_ids: Vec<u32> = new_registry.iter().map(|d| d.id).collect();
                            let changed = old_ids != new_ids;

                            if changed {
                                let added: Vec<u32> = new_ids.iter().filter(|id| !old_ids.contains(id)).copied().collect();
                                let removed: Vec<u32> = old_ids.iter().filter(|id| !new_ids.contains(id)).copied().collect();
                                if !added.is_empty() {
                                    log::info!("hotplug: added device(s) {added:?}");
                                }
                                if !removed.is_empty() {
                                    log::info!("hotplug: removed device(s) {removed:?} (will keep in list until confirmed offline)");
                                }

                                // Merge: keep old devices, update/add new ones.
                                // Devices are never removed from the list here —
                                // only when update_leds explicitly fails for them.
                                // This prevents internal keyboards from flickering
                                // off during reconnection.
                                let old_devices = status_tx.borrow().devices.clone();
                                let mut merged: Vec<DeviceInfo> = old_devices;
                                for dev in &new_registry {
                                    if let Some(existing) = merged.iter_mut().find(|d| d.id == dev.id) {
                                        *existing = dev.clone();
                                    } else {
                                        merged.push(dev.clone());
                                    }
                                }
                                set_status(&status_tx, |s| {
                                    s.devices = merged;
                                });
                                for id in added {
                                    let leds = new_registry.iter().find(|d| d.id == id).map(|d| d.leds as usize).unwrap_or(0);
                                    if leds == 0 {
                                        continue;
                                    }
                                    log::info!("hotplug: welcome sweep for device {id}");
                                    let sweep: Vec<crate::rgb::Color> = (0..leds)
                                        .map(|i| {
                                            let f = i as f32 / (leds as f32 - 1.0).max(1.0);
                                            let w = ((f * 2.0 - 1.0).abs() * 3.0 - 1.0)
                                                .clamp(0.0, 1.0);
                                            let v = w;
                                            crate::rgb::Color {
                                                r: (56.0 * v + 20.0) as u8,
                                                g: (189.0 * v + 20.0) as u8,
                                                b: (248.0 * v + 30.0) as u8,
                                            }
                                        })
                                        .collect();
                                    let _ = client.update_leds(id, sweep).await;
                                    tokio::time::sleep(Duration::from_millis(60)).await;
                                }
                            } else if new_ids.len() < old_ids.len() {
                                // Count shrank but IDs didn't change.
                                // Force reconnect to clear cache.
                                log::info!("hotplug: device count shrank ({} -> {}), forcing reconnect", old_ids.len(), new_ids.len());
                                break;
                            }
                        }
                    }
                }
            }
            Err(e) => {
                set_status(&status_tx, |s| {
                    s.connected = false;
                    s.last_error = Some(format!("connect: {e}"));
                });
            }
        }

        tokio::time::sleep(Duration::from_secs(backoff.min(30))).await;
        backoff = (backoff * 2).max(2).min(30);
    }
}

// Re-export for ipc.rs use.
pub use crate::events::RGB_STATUS;
