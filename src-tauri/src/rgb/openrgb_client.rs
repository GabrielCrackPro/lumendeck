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

                loop {
                    match rx.recv().await {
                        Some(PushMsg::Colors { device, colors }) => {
                            if let Err(e) = client.update_leds(device, colors).await {
                                log::warn!("update_leds failed: {e}");
                                set_status(&status_tx, |s| {
                                    s.last_error = Some(e.to_string());
                                    s.connected = false;
                                });
                                break; // force reconnect
                            }
                        }
                        Some(PushMsg::Refresh) => break,
                        None => return, // app shutting down
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
