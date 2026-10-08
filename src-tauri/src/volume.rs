
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

pub fn get() -> Result<f32, String> {
    let vol = endpoint_volume().map_err(|e| format!("volume unavailable: {e}"))?;
    unsafe { vol.GetMasterVolumeLevelScalar() }
        .map_err(|e| format!("volume read failed: {e}"))
}

pub fn muted() -> Result<bool, String> {
    let vol = endpoint_volume().map_err(|e| format!("volume unavailable: {e}"))?;
    unsafe { vol.GetMute() }
        .map(|m| m.as_bool())
        .map_err(|e| format!("mute read failed: {e}"))
}

pub fn set(v: f32) -> Result<(), String> {
    let v = v.clamp(0.0, 1.0);
    let vol = endpoint_volume().map_err(|e| format!("volume unavailable: {e}"))?;
    unsafe { vol.SetMasterVolumeLevelScalar(v, &ENDPOINT_VOLUME_GUID) }
        .map_err(|e| format!("volume write failed: {e}"))
}

pub fn set_mute(m: bool) -> Result<(), String> {
    let vol = endpoint_volume().map_err(|e| format!("volume unavailable: {e}"))?;
    unsafe { vol.SetMute(m, &ENDPOINT_VOLUME_GUID) }
        .map_err(|e| format!("mute write failed: {e}"))
}

pub fn toggle_mute() -> Result<bool, String> {
    let next = !muted()?;
    set_mute(next)?;
    Ok(next)
}


#[windows::core::implement(windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolumeCallback)]
struct VolumeNotifier {
    app: tauri::AppHandle,
}

impl windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolumeCallback_Impl for VolumeNotifier_Impl {
    fn OnNotify(
        &self,
        pnotify: *mut windows::Win32::Media::Audio::AUDIO_VOLUME_NOTIFICATION_DATA,
    ) -> windows::core::Result<()> {
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
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3600));
        }
    });
}
