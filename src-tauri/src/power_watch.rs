#![cfg(windows)]

use std::sync::atomic::{AtomicBool, Ordering};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
    TranslateMessage, PBT_APMRESUMEAUTOMATIC, PBT_APMRESUMECRITICAL, PBT_APMRESUMESUSPEND,
    PBT_APMRESUMESTANDBY, WINDOW_EX_STYLE, WINDOW_STYLE, WM_POWERBROADCAST, WNDCLASSW,
};

const PBT_APMRESUMEAFTERRESET: u32 = 0x0011;
const RESUME_SETTLE_MS: u64 = 1_000;
static RESUME_PENDING: AtomicBool = AtomicBool::new(false);

pub fn is_resume_notice(wparam: u32) -> bool {
    matches!(
        wparam,
        PBT_APMRESUMEAUTOMATIC
            | PBT_APMRESUMESUSPEND
            | PBT_APMRESUMEAFTERRESET
            | PBT_APMRESUMECRITICAL
            | PBT_APMRESUMESTANDBY
    )
}

fn schedule_resume() {
    if RESUME_PENDING.swap(true, Ordering::SeqCst) {
        log::debug!("power: resume notice coalesced into the pending pass");
        return;
    }
    std::thread::Builder::new()
        .name("power-resume".into())
        .spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(RESUME_SETTLE_MS));
            RESUME_PENDING.store(false, Ordering::SeqCst);
            let Some(app) = crate::app_handle() else {
                return;
            };
            on_resume(&app);
        })
        .ok();
}

fn on_resume(app: &tauri::AppHandle) {
    log::info!("power: system resumed — re-checking the wallpaper attach");
    if crate::config_store::get().general.wallpaper_enabled {
        if let Err(e) = crate::wallpaper::ensure(app) {
            log::warn!("power: wallpaper re-attach after resume failed: {e}");
        }
    }
    crate::events::emit_all(app, crate::events::POWER_RESUMED, &true);
}

const CLASS_NAME: &[u16] = &[
    b'L' as u16, b'M' as u16, b'D' as u16, b'W' as u16, b'P' as u16, b'o' as u16,
    b'w' as u16, b'e' as u16, b'r' as u16, b'C' as u16, b'l' as u16, b'a' as u16,
    b's' as u16, b's' as u16, 0,
];

extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_POWERBROADCAST => {
            if is_resume_notice(wp.0 as u32) {
                schedule_resume();
            }
            LRESULT(1)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wp, lp) },
    }
}

pub fn spawn() {
    std::thread::Builder::new()
        .name("power-watch".into())
        .spawn(|| unsafe {
            let hinstance = GetModuleHandleW(None).unwrap_or_default();
            let class_name = windows::core::PCWSTR(CLASS_NAME.as_ptr());

            let wc = WNDCLASSW {
                lpfnWndProc: Some(wnd_proc),
                hInstance: hinstance.into(),
                lpszClassName: class_name,
                ..Default::default()
            };
            if RegisterClassW(&wc) == 0 {
                log::warn!("power-watch: RegisterClassW failed");
                return;
            }

            let hwnd = match CreateWindowExW(
                WINDOW_EX_STYLE(0),
                class_name,
                windows::core::w!("LumenDeck Power Watch"),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                None,
                None,
                Some(hinstance.into()),
                None,
            ) {
                Ok(h) => h,
                Err(e) => {
                    log::warn!("power-watch: CreateWindowExW failed: {e}");
                    return;
                }
            };
            if hwnd.is_invalid() {
                log::warn!("power-watch: CreateWindowExW returned invalid hwnd");
                return;
            }

            log::info!("power-watch: listening for WM_POWERBROADCAST");
            let mut msg = std::mem::zeroed();
            while GetMessageW(&mut msg, Some(hwnd), 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        })
        .expect("failed to spawn power watcher thread");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_resume_code_counts() {
        for code in [
            PBT_APMRESUMEAUTOMATIC,
            PBT_APMRESUMESUSPEND,
            PBT_APMRESUMEAFTERRESET,
            PBT_APMRESUMECRITICAL,
            PBT_APMRESUMESTANDBY,
        ] {
            assert!(is_resume_notice(code), "code {code:#x} should count");
        }
    }

    #[test]
    fn suspend_and_setting_changes_are_not_resumes() {
        assert!(!is_resume_notice(0x0004), "PBT_APMSUSPEND must not count");
        assert!(!is_resume_notice(0x8013), "PBT_POWERSETTINGCHANGE must not count");
        assert!(!is_resume_notice(0), "a zero wparam must not count");
    }

    #[test]
    fn the_settle_delay_is_long_enough_to_matter_but_short_enough_to_not() {
        assert!(RESUME_SETTLE_MS >= 250, "displays need a moment");
        assert!(RESUME_SETTLE_MS <= 5_000, "a resume must not feel laggy");
    }

    #[test]
    fn the_class_name_is_a_unique_c_string() {
        assert_eq!(CLASS_NAME.last(), Some(&0));
        assert_eq!(
            CLASS_NAME.iter().filter(|&&c| c == 0).count(),
            1,
            "exactly one terminator"
        );
    }
}
