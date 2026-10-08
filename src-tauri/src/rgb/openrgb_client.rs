
use openrgb::data::{Color, Controller};
use openrgb::OpenRGB;
use serde::Serialize;
use std::time::Duration;
use tokio::sync::{mpsc, watch};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: u32,
    pub name: String,
    pub type_name: String,
    pub leds: u32,
    pub zones: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
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

const REMOVE_CONFIRM_POLLS: usize = 1;

const HOTPLUG_POLL_MS: u64 = 250;

const HOTPLUG_FULL_EVERY: u32 = 8;

struct StatusOut {
    tx: watch::Sender<RgbStatus>,
    published: Option<RgbStatus>,
}

impl StatusOut {
    fn new(tx: watch::Sender<RgbStatus>) -> Self {
        Self { tx, published: None }
    }

    fn set(&mut self, f: impl FnOnce(&mut RgbStatus)) {
        let mut next = self.tx.borrow().clone();
        f(&mut next);
        if self.published.as_ref() == Some(&next) {
            return;
        }
        self.published = Some(next.clone());
        let _ = self.tx.send(next.clone());
        if let Some(app) = crate::app_handle() {
            crate::events::emit_all(&app, crate::events::RGB_STATUS, &next);
        }
    }
}

fn tick_absent(
    listed: &[u32],
    present: &[u32],
    absent: &mut std::collections::HashMap<u32, usize>,
    grace: usize,
) -> Vec<u32> {
    absent.retain(|id, _| listed.contains(id));
    for &id in listed {
        if present.contains(&id) {
            absent.insert(id, 0);
        } else {
            *absent.entry(id).or_insert(0) += 1;
        }
    }
    let grace = grace.max(1);
    listed
        .iter()
        .copied()
        .filter(|id| absent.get(id).copied().unwrap_or(0) >= grace)
        .collect()
}

fn merge_registry(old: &[DeviceInfo], fresh: &[DeviceInfo], gone: &[u32]) -> Vec<DeviceInfo> {
    let mut merged: Vec<DeviceInfo> = old
        .iter()
        .filter(|d| !gone.contains(&d.id))
        .cloned()
        .collect();
    for dev in fresh {
        match merged.iter_mut().find(|d| d.id == dev.id) {
            Some(slot) => *slot = dev.clone(),
            None => merged.push(dev.clone()),
        }
    }
    merged
}

#[cfg(test)]
fn dev(id: u32, name: &str, leds: u32) -> DeviceInfo {
    DeviceInfo {
        id,
        name: name.to_string(),
        type_name: "Keyboard".to_string(),
        leds,
        zones: Vec::new(),
    }
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

async fn connection_task(mut rx: mpsc::Receiver<PushMsg>, status_tx: watch::Sender<RgbStatus>) {
    let mut backoff: u64 = 1;
    let mut out = StatusOut::new(status_tx);
    loop {
        let (host, port, enabled) = {
            let cfg = crate::config_store::get();
            (cfg.rgb.host.clone(), cfg.rgb.port, cfg.rgb.enabled)
        };

        if !enabled {
            out.set(|s| {
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
                out.set(|s| {
                    s.connected = true;
                    s.protocol_version = Some(proto);
                    s.devices = registry_from(controllers);
                    s.last_error = None;
                });

                let mut poll = tokio::time::interval(Duration::from_millis(HOTPLUG_POLL_MS));
                poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                let mut last_count: Option<u32> = None;
                let mut ticks_since_full: u32 = u32::MAX;
                let mut push_fails: std::collections::HashSet<u32> = std::collections::HashSet::new();
                let mut absent: std::collections::HashMap<u32, usize> = std::collections::HashMap::new();
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
                                            out.set(|s| {
                                                s.devices.retain(|d| d.id != device);
                                            });
                                            absent.remove(&device);
                                            if push_fails.len() >= 2 {
                                                out.set(|s| {
                                                    s.last_error = Some(e.to_string());
                                                    s.connected = false;
                                                });
                                                break;
                                            }
                                        }
                                    }
                                }
                                Some(PushMsg::Refresh) => break,
                                None => return,
                            }
                        }
                        _ = poll.tick() => {
                            let count = match client.get_controller_count().await {
                                Ok(c) => c,
                                Err(e) => {
                                    log::debug!("hotplug: controller count failed ({e}), skipping poll");
                                    continue;
                                }
                            };
                            ticks_since_full = ticks_since_full.saturating_add(1);
                            if last_count == Some(count) && ticks_since_full < HOTPLUG_FULL_EVERY {
                                continue;
                            }
                            last_count = Some(count);
                            ticks_since_full = 0;
                            let present_ids: Vec<u32> = (0..count).collect();
                            let mut fresh: Vec<(u32, Controller)> = Vec::new();
                            for id in &present_ids {
                                match client.get_controller(*id).await {
                                    Ok(c) => fresh.push((*id, c)),
                                    Err(e) => log::debug!("hotplug: could not fetch controller {id} ({e}); keeping the previous entry"),
                                }
                            }
                            let new_registry = registry_from(fresh);

                            let old_devices = out.tx.borrow().devices.clone();
                            let old_ids: Vec<u32> = old_devices.iter().map(|d| d.id).collect();

                            log::debug!(
                                "hotplug: OpenRGB reports {count} controller(s) {present_ids:?} (details: {}), known {old_ids:?}",
                                new_registry
                                    .iter()
                                    .map(|d| format!("{}={}led", d.id, d.leds))
                                    .collect::<Vec<_>>()
                                    .join(" ")
                            );

                            let gone = tick_absent(
                                &old_ids,
                                &present_ids,
                                &mut absent,
                                REMOVE_CONFIRM_POLLS,
                            );
                            let added: Vec<u32> = present_ids
                                .iter()
                                .filter(|id| !old_ids.contains(id))
                                .copied()
                                .collect();

                            for id in &gone {
                                let name = old_devices
                                    .iter()
                                    .find(|d| d.id == *id)
                                    .map(|d| d.name.clone())
                                    .unwrap_or_else(|| format!("device {id}"));
                                log::info!("hotplug: {name} disconnected");
                            }
                            for id in &added {
                                let name = new_registry
                                    .iter()
                                    .find(|d| d.id == *id)
                                    .map(|d| d.name.clone())
                                    .unwrap_or_else(|| format!("device {id}"));
                                log::info!("hotplug: {name} connected");
                            }

                            let merged = merge_registry(&old_devices, &new_registry, &gone);
                            out.set(|s| {
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
                        }
                    }
                }
            }
            Err(e) => {
                out.set(|s| {
                    s.connected = false;
                    s.last_error = Some(format!("connect: {e}"));
                });
            }
        }

        tokio::time::sleep(Duration::from_secs(backoff.min(30))).await;
        backoff = (backoff * 2).max(2).min(30);
    }
}

pub use crate::events::RGB_STATUS;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_device_that_appears_shows_up_in_the_registry() {
        let merged = merge_registry(&[], &[dev(0, "Board", 12)], &[]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].id, 0);
    }

    #[test]
    fn a_single_missing_poll_removes_the_device() {
        assert_eq!(REMOVE_CONFIRM_POLLS, 1);
        let mut absent = std::collections::HashMap::new();
        let listed = [0u32];
        let empty: [u32; 0] = [];
        assert_eq!(tick_absent(&listed, &empty, &mut absent, REMOVE_CONFIRM_POLLS), vec![0]);
    }

    #[test]
    fn a_device_that_is_still_reported_is_never_removed() {
        let mut absent = std::collections::HashMap::new();
        for _ in 0..20 {
            assert!(tick_absent(&[0, 1], &[0, 1], &mut absent, REMOVE_CONFIRM_POLLS).is_empty());
        }
    }

    #[test]
    fn a_device_absent_for_the_whole_grace_period_is_removed() {
        let mut absent = std::collections::HashMap::new();
        let listed = [0u32];
        let empty: [u32; 0] = [];
        let mut gone = Vec::new();
        for _ in 0..REMOVE_CONFIRM_POLLS {
            gone = tick_absent(&listed, &empty, &mut absent, REMOVE_CONFIRM_POLLS);
        }
        assert_eq!(gone, vec![0]);
        assert!(merge_registry(&[dev(0, "Board", 12)], &[], &gone).is_empty());
    }

    #[test]
    fn a_device_that_comes_back_mid_grace_is_not_removed() {
        let mut absent = std::collections::HashMap::new();
        let listed = [0u32];
        let empty: [u32; 0] = [];
        tick_absent(&listed, &empty, &mut absent, REMOVE_CONFIRM_POLLS);
        tick_absent(&listed, &empty, &mut absent, REMOVE_CONFIRM_POLLS);
        assert!(tick_absent(&listed, &[0u32], &mut absent, REMOVE_CONFIRM_POLLS).is_empty());
        assert_eq!(absent.get(&0), Some(&0));
        assert!(tick_absent(&listed, &[0u32], &mut absent, REMOVE_CONFIRM_POLLS).is_empty());
    }

    #[test]
    fn each_device_ages_out_on_its_own_clock() {
        let mut absent = std::collections::HashMap::new();
        let listed = [0u32, 1u32];
        tick_absent(&listed, &[0u32], &mut absent, REMOVE_CONFIRM_POLLS);
        tick_absent(&listed, &[0u32], &mut absent, REMOVE_CONFIRM_POLLS);
        assert_eq!(tick_absent(&listed, &[0u32], &mut absent, REMOVE_CONFIRM_POLLS), vec![1]);
    }

    #[test]
    fn a_removed_device_does_not_leave_a_counter_to_resurrect_it() {
        let mut absent = std::collections::HashMap::new();
        let listed = [0u32];
        let empty: [u32; 0] = [];
        for _ in 0..REMOVE_CONFIRM_POLLS {
            tick_absent(&listed, &empty, &mut absent, REMOVE_CONFIRM_POLLS);
        }
        tick_absent(&[], &[], &mut absent, REMOVE_CONFIRM_POLLS);
        assert!(!absent.contains_key(&0));
        assert!(tick_absent(&[0u32], &[0u32], &mut absent, REMOVE_CONFIRM_POLLS).is_empty());
    }

    #[test]
    fn a_device_whose_details_failed_to_fetch_is_kept_not_dropped() {
        let old = vec![dev(0, "Board", 12), dev(1, "Gamepad", 0)];
        let fresh = vec![dev(0, "Board", 12)];
        let merged = merge_registry(&old, &fresh, &[]);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[1].id, 1);
    }

    #[test]
    fn a_reconnected_device_reports_its_new_led_count() {
        let fresh = vec![dev(0, "Board", 34)];
        let merged = merge_registry(&[dev(0, "Board", 12)], &fresh, &[]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].leds, 34);
    }

    #[test]
    fn a_disconnect_and_a_connect_in_one_poll_both_land() {
        let fresh = vec![dev(2, "New Board", 9)];
        let merged = merge_registry(&[dev(1, "Old Board", 12)], &fresh, &[1]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].id, 2);
    }

    #[test]
    fn an_identical_poll_reports_nothing_to_remove() {
        let mut absent = std::collections::HashMap::new();
        for _ in 0..10 {
            assert!(tick_absent(&[0, 1], &[0, 1], &mut absent, REMOVE_CONFIRM_POLLS).is_empty());
        }
    }

    #[test]
    fn a_zero_grace_removes_on_the_first_miss_but_never_on_a_present_poll() {
        let mut absent = std::collections::HashMap::new();
        assert!(tick_absent(&[0], &[0], &mut absent, 0).is_empty());
        assert!(tick_absent(&[0], &[0], &mut absent, 0).is_empty());
        assert_eq!(tick_absent(&[0], &[], &mut absent, 0), vec![0]);
    }
}
