//! System master volume (WASAPI endpoint volume).
//!
//! The dashboard's Now playing card exposes a volume slider. SMTC has no
//! per-app volume concept, so this drives the default render endpoint's
//! master volume — the same knob the taskbar speaker controls.

#![cfg(windows)]

use windows::core::GUID;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

const ENDPOINT_VOLUME_GUID: GUID = GUID::from_u128(0x5b4a5f2c_11a1_4c0e_b5f3_1a2b3c4d5e6f);

fn endpoint_volume() -> windows::core::Result<IAudioEndpointVolume> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        device.Activate(CLSCTX_ALL, None)
    }
}

/// Master volume of the default render endpoint, 0.0..1.0.
pub fn get() -> Result<f32, String> {
    let vol = endpoint_volume().map_err(|e| format!("volume unavailable: {e}"))?;
    unsafe { vol.GetMasterVolumeLevelScalar() }
        .map_err(|e| format!("volume read failed: {e}"))
}

/// Master mute state of the default render endpoint.
pub fn muted() -> Result<bool, String> {
    let vol = endpoint_volume().map_err(|e| format!("volume unavailable: {e}"))?;
    unsafe { vol.GetMute() }
        .map(|m| m.as_bool())
        .map_err(|e| format!("mute read failed: {e}"))
}

/// Set the master volume (0.0..1.0). Clamped; out-of-range input is not an
/// error because sliders only produce the range they declare.
pub fn set(v: f32) -> Result<(), String> {
    let v = v.clamp(0.0, 1.0);
    let vol = endpoint_volume().map_err(|e| format!("volume unavailable: {e}"))?;
    unsafe { vol.SetMasterVolumeLevelScalar(v, &ENDPOINT_VOLUME_GUID) }
        .map_err(|e| format!("volume write failed: {e}"))
}

/// Set (or clear) the master mute.
pub fn set_mute(m: bool) -> Result<(), String> {
    let vol = endpoint_volume().map_err(|e| format!("volume unavailable: {e}"))?;
    unsafe { vol.SetMute(m, &ENDPOINT_VOLUME_GUID) }
        .map_err(|e| format!("mute write failed: {e}"))
}

/// Flip the mute bit; returns the new state.
pub fn toggle_mute() -> Result<bool, String> {
    let next = !muted()?;
    set_mute(next)?;
    Ok(next)
}

// ---------- change notifications ----------

/// COM callback that fires whenever anything (taskbar, keyboard, another
/// app, this app) changes the endpoint volume or mute. Holds the Tauri app
/// handle and broadcasts VOLUME_CHANGED so the dashboard's slider mirrors
/// external changes live instead of syncing on tab reopen.
#[windows::core::implement(windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolumeCallback)]
struct VolumeNotifier {
    app: tauri::AppHandle,
}

impl windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolumeCallback_Impl for VolumeNotifier_Impl {
    fn OnNotify(
        &self,
        pnotify: *mut windows::Win32::Media::Audio::AUDIO_VOLUME_NOTIFICATION_DATA,
    ) -> windows::core::Result<()> {
        // The data struct is only valid for the duration of the callback.
        if pnotify.is_null() {
            return Ok(());
        }
        let d = unsafe { *pnotify };
        let payload = [
            d.fMasterVolume * 100.0,
            if d.bMuted.as_bool() { 1.0 } else { 0.0 },
        ];
        crate::events::emit_all(&self.app, crate::events::VOLUME_CHANGED, &payload);
        Ok(())
    }
}

/// Register a volume-change notifier and keep it alive for the process
/// lifetime. Runs on its own thread because the callback object must stay
/// alive (unregistering on drop would kill the stream) and COM init is
/// apartment-bound to whatever thread registers.
pub fn spawn_watcher(app: tauri::AppHandle) {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolumeCallback;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    std::thread::spawn(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let Ok(vol) = endpoint_volume() else {
            log::warn!("volume watcher: no audio endpoint; not watching");
            return;
        };
        let notifier: IAudioEndpointVolumeCallback = VolumeNotifier { app }.into();
        let registered = unsafe { vol.RegisterControlChangeNotify(&notifier) };
        if registered.is_err() {
            log::warn!("volume watcher: registration failed");
            return;
        }
        log::info!("volume watcher active");
        // The notifier must outlive the registration; parking this thread
        // forever is the simplest correct keep-alive (matches the accent
        // watcher's shape). COM is never torn down — process-lifetime.
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3600));
        }
    });
}
