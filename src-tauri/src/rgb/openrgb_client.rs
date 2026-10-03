//! OpenRGB SDK client: supervised connection, device registry, color push.

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

/// `rename_all` is not decoration here: the dashboard's `RgbStatus` in
/// `shared/types.ts` is camelCase, and without it `protocol_version` crossed
/// the IPC boundary as `protocolVersion: undefined` to every reader.
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

/// Consecutive polls a controller must be missing from OpenRGB's list before
/// it is treated as unplugged.
///
/// One, so a disconnect is visible on the very next poll. This was three, and
/// that was wrong on the evidence: unplugging a device should not leave a
/// card sitting on the dashboard for three seconds pretending to still be
/// there, which reads as the app not noticing rather than as caution.
///
/// The reason a grace period exists at all is that OpenRGB under-reports its
/// controller count while hardware is enumerating, and an internal keyboard
/// can blink out for a poll during a re-enumeration. That risk is real but it
/// belongs to the *add* side — a device being seen too early — and a device
/// that was present and is now absent is strong evidence on its own. The
/// flicker this guards against is now handled where it actually starts: a
/// device that reappears within the poll interval is simply added again.
const REMOVE_CONFIRM_POLLS: usize = 1;

/// How often the cheap controller-count check runs.
///
/// Split from the full enumeration on purpose. A single 1s tick put a second
/// between unplugging something and it leaving the dashboard — the gap between
/// "the app noticed" and "the app did not". Enumerating every device at that
/// rate would cost one RPC per device per tick, so the count is checked often
/// and the expensive part runs only when the count moves.
const HOTPLUG_POLL_MS: u64 = 250;

/// How many count checks may pass before a full enumeration runs anyway.
///
/// The fast path cannot see a change that leaves the count identical, and two
/// devices swapping places is exactly that. Two seconds is the ceiling on how
/// long that case can hide.
const HOTPLUG_FULL_EVERY: u32 = 8;

/// The single writer of connection status, so every transition is published
/// the same way.
///
/// The supervisor polls OpenRGB once a second forever. Emitting `rgb-status`
/// on every poll would wake all four webviews to re-render a device list that
/// has not changed, so an event is owed only when the status actually differs.
/// Funnelling all writes through here means no call site can forget to tell
/// the UI — which is exactly how the dashboard used to sit on a stale device
/// list forever, since nothing here emitted at all.
struct StatusOut {
    tx: watch::Sender<RgbStatus>,
    /// Last status handed to the webviews, so we can tell a change from a poll.
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
        // Channel first: `status()` readers must never see the UI get told
        // about a device list that the rest of the app has not caught up to.
        let _ = self.tx.send(next.clone());
        if let Some(app) = crate::app_handle() {
            crate::events::emit_all(&app, crate::events::RGB_STATUS, &next);
        }
    }
}

/// How many consecutive polls each listed device has been missing from
/// OpenRGB's controller list, and which ones have aged out of the registry.
///
/// Pure apart from mutating `absent`, so the removal policy is testable
/// without a clock or an OpenRGB server. Returns ids to drop.
///
/// Devices already removed are forgotten, so the counter cannot keep a stale
/// entry alive and resurrect it if the same id is ever reused.
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

/// Fold a freshly enumerated registry into the one currently displayed:
/// refresh the details of devices already listed, add newcomers, and drop the
/// ids in `gone`. Pure, so "what does the user now see" is a testable claim
/// rather than an inference from the merge loop.
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

/// Supervisor: connects, refreshes the device list, services the push queue,
/// reconnects with backoff on errors.
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

                // Hotplug watch: cheap count check on a fast tick, full
                // enumeration only when that count moves.
                let mut poll = tokio::time::interval(Duration::from_millis(HOTPLUG_POLL_MS));
                poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                let mut last_count: Option<u32> = None;
                // Starts past the threshold so the first tick enumerates.
                let mut ticks_since_full: u32 = u32::MAX;
                // Track which devices failed update_leds so we can reconnect
                // immediately when a device disappears (clears OpenRGB cache).
                let mut push_fails: std::collections::HashSet<u32> = std::collections::HashSet::new();
                // Consecutive-miss counters behind the disconnect grace period.
                // Scoped to one connection: a reconnect re-enumerates from
                // scratch, so counters from a dead socket must not carry over.
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
                                            // The device rejected a write, which
                                            // is stronger evidence than a missing
                                            // poll: drop it now rather than waiting
                                            // out the grace period. Internal
                                            // keyboards never fail update_leds, so
                                            // the one device most likely to blink
                                            // out during re-enumeration still gets
                                            // the full grace.
                                            out.set(|s| {
                                                s.devices.retain(|d| d.id != device);
                                            });
                                            absent.remove(&device);
                                            // If multiple devices fail, OpenRGB
                                            // connection is likely dead — reconnect.
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
                                None => return, // app shutting down
                            }
                        }
                        _ = poll.tick() => {
                            // A failed count is not evidence that no
                            // controllers exist. It used to be folded into
                            // `unwrap_or(0)`, which combined with removing on
                            // the first miss meant a single dropped RPC wiped
                            // every device off the dashboard. Polling four
                            // times as often makes that more likely, not less.
                            let count = match client.get_controller_count().await {
                                Ok(c) => c,
                                Err(e) => {
                                    log::debug!("hotplug: controller count failed ({e}), skipping poll");
                                    continue;
                                }
                            };
                            ticks_since_full = ticks_since_full.saturating_add(1);
                            // Nothing moved and we are not overdue: skip the
                            // per-device RPCs entirely. `continue` here resumes
                            // this inner loop, leaving the push queue serviced.
                            if last_count == Some(count) && ticks_since_full < HOTPLUG_FULL_EVERY {
                                continue;
                            }
                            last_count = Some(count);
                            ticks_since_full = 0;
                            // The count is the authority on *presence*: a
                            // controller whose id is below it still exists
                            // even if fetching its details fails this tick.
                            // Details are only ever a refresh, never evidence.
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

                            // What OpenRGB actually reported this poll, so the
                            // log can answer "is this app failing to notice a
                            // disconnect, or is OpenRGB still listing the
                            // device?". Without it the two are
                            // indistinguishable from outside, which is the
                            // difference between a bug here and one upstream.
                            // Debug, not info: it is one line per enumeration.
                            log::debug!(
                                "hotplug: OpenRGB reports {count} controller(s) {present_ids:?} (details: {}), known {old_ids:?}",
                                new_registry
                                    .iter()
                                    .map(|d| format!("{}={}led", d.id, d.leds))
                                    .collect::<Vec<_>>()
                                    .join(" ")
                            );

                            // A device goes stale here once it has been missing
                            // for the whole grace period. Logging the
                            // transitions (rather than every poll) keeps a 5MB
                            // log readable, and each one arrives with a
                            // matching rgb-status event below.
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
                                // Report the name the user last saw, not the one
                                // OpenRGB just reported for a device that is gone.
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

                            // Always fold the fresh enumeration in, not only when
                            // the id set moved: a device can come back with a
                            // different LED count or zone list under the same id.
                            // Publishes only if the resulting list differs.
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

// Re-export for ipc.rs use.
pub use crate::events::RGB_STATUS;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_device_that_appears_shows_up_in_the_registry() {
        // The whole point of hotplug: plug in a keyboard, it is in the list.
        let merged = merge_registry(&[], &[dev(0, "Board", 12)], &[]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].id, 0);
    }

    #[test]
    fn a_single_missing_poll_removes_the_device() {
        // Requirement, not a preference: unplugging something must take it off
        // the dashboard at once. This was three polls, which left the card
        // sitting there for three seconds looking like the app had not noticed
        // — a gamepad in particular reported zero LEDs, so it never reached
        // the `update_leds`-failure path either and the grace period was the
        // only thing that could ever remove it.
        assert_eq!(REMOVE_CONFIRM_POLLS, 1);
        let mut absent = std::collections::HashMap::new();
        let listed = [0u32];
        let empty: [u32; 0] = [];
        assert_eq!(tick_absent(&listed, &empty, &mut absent, REMOVE_CONFIRM_POLLS), vec![0]);
    }

    #[test]
    fn a_device_that_is_still_reported_is_never_removed() {
        // The reason a device briefly disappears from an enumeration is a
        // transient, so the flip side has to hold: however many polls run,
        // hardware OpenRGB is still reporting must survive all of them.
        let mut absent = std::collections::HashMap::new();
        for _ in 0..20 {
            assert!(tick_absent(&[0, 1], &[0, 1], &mut absent, REMOVE_CONFIRM_POLLS).is_empty());
        }
    }

    #[test]
    fn a_device_absent_for_the_whole_grace_period_is_removed() {
        // The other half of the promise: unplugging must actually take the
        // card off the dashboard, not leave it there forever.
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
        // The flapping case: absent for two polls, back for one. It must end up
        // with its counter cleared, not be removed on the next silence.
        let mut absent = std::collections::HashMap::new();
        let listed = [0u32];
        let empty: [u32; 0] = [];
        tick_absent(&listed, &empty, &mut absent, REMOVE_CONFIRM_POLLS);
        tick_absent(&listed, &empty, &mut absent, REMOVE_CONFIRM_POLLS);
        assert!(tick_absent(&listed, &[0u32], &mut absent, REMOVE_CONFIRM_POLLS).is_empty());
        assert_eq!(absent.get(&0), Some(&0));
        // ...and it survives the next full grace period only because it is
        // actually still being reported.
        assert!(tick_absent(&listed, &[0u32], &mut absent, REMOVE_CONFIRM_POLLS).is_empty());
    }

    #[test]
    fn each_device_ages_out_on_its_own_clock() {
        // One absent device must not drag a healthy one down with it.
        let mut absent = std::collections::HashMap::new();
        let listed = [0u32, 1u32];
        tick_absent(&listed, &[0u32], &mut absent, REMOVE_CONFIRM_POLLS);
        tick_absent(&listed, &[0u32], &mut absent, REMOVE_CONFIRM_POLLS);
        // 0 is back, 1 has now missed its full grace.
        assert_eq!(tick_absent(&listed, &[0u32], &mut absent, REMOVE_CONFIRM_POLLS), vec![1]);
    }

    #[test]
    fn a_removed_device_does_not_leave_a_counter_to_resurrect_it() {
        // Ids get reused across OpenRGB restarts. A counter left behind for a
        // device already dropped would fire on its first poll back and take a
        // freshly connected device straight out of the registry again.
        let mut absent = std::collections::HashMap::new();
        let listed = [0u32];
        let empty: [u32; 0] = [];
        for _ in 0..REMOVE_CONFIRM_POLLS {
            tick_absent(&listed, &empty, &mut absent, REMOVE_CONFIRM_POLLS);
        }
        // Next poll: device 0 is gone from the listing entirely.
        tick_absent(&[], &[], &mut absent, REMOVE_CONFIRM_POLLS);
        assert!(!absent.contains_key(&0));
        // A brand new device 0 is not born already overdue.
        assert!(tick_absent(&[0u32], &[0u32], &mut absent, REMOVE_CONFIRM_POLLS).is_empty());
    }

    #[test]
    fn a_device_whose_details_failed_to_fetch_is_kept_not_dropped() {
        // Presence is decided by the controller count, never by which per-device
        // RPCs happened to succeed this tick. Dropping the entry because one
        // fetch failed would delete real hardware on a dropped packet — and
        // with removal on the first miss, there is no second chance.
        let old = vec![dev(0, "Board", 12), dev(1, "Gamepad", 0)];
        // Controller 1 was below the count but its fetch failed this poll.
        let fresh = vec![dev(0, "Board", 12)];
        let merged = merge_registry(&old, &fresh, &[]);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[1].id, 1);
    }

    #[test]
    fn a_reconnected_device_reports_its_new_led_count() {
        // Same id, different hardware state. The dashboard draws a device from
        // the LED count, so a stale one makes the preview the wrong length.
        let fresh = vec![dev(0, "Board", 34)];
        let merged = merge_registry(&[dev(0, "Board", 12)], &fresh, &[]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].leds, 34);
    }

    #[test]
    fn a_disconnect_and_a_connect_in_one_poll_both_land() {
        // Replugging into a different USB port between two polls replaces one
        // device with another. Neither half may be lost.
        let fresh = vec![dev(2, "New Board", 9)];
        let merged = merge_registry(&[dev(1, "Old Board", 12)], &fresh, &[1]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].id, 2);
    }

    #[test]
    fn an_identical_poll_reports_nothing_to_remove() {
        // The steady state: a poll where nothing moved must not age anything
        // out, or an idle-but-healthy setup would empty itself over time.
        let mut absent = std::collections::HashMap::new();
        for _ in 0..10 {
            assert!(tick_absent(&[0, 1], &[0, 1], &mut absent, REMOVE_CONFIRM_POLLS).is_empty());
        }
    }

    #[test]
    fn a_zero_grace_removes_on_the_first_miss_but_never_on_a_present_poll() {
        // The guarantee that matters: whatever the constant, a device
        // OpenRGB *is* reporting survives. Only an absent one can be dropped,
        // so a misconfigured 0 cannot empty the registry on sight.
        let mut absent = std::collections::HashMap::new();
        assert!(tick_absent(&[0], &[0], &mut absent, 0).is_empty());
        assert!(tick_absent(&[0], &[0], &mut absent, 0).is_empty());
        assert_eq!(tick_absent(&[0], &[], &mut absent, 0), vec![0]);
    }
}
