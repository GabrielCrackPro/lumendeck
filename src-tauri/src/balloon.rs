//! One-shot tray balloons, raised with Shell_NotifyIcon.
//!
//! Neither Tauri nor muda (the tray library underneath it) exposes a balloon
//! API, so this drives the shell directly. The catch is that a balloon has to
//! belong to a registered tray icon, and the app's real icon is owned by
//! Tauri — its internal id is not something we can address from out here. So
//! a balloon gets a throwaway icon of its own, added in the NIS_HIDDEN state:
//! hidden icons take up no slot in the notification area, but their balloons
//! still appear. The icon lives only as long as the balloon does, then goes
//! away with it.
//!
//! Each balloon owns a hidden window and a thread with a message pump, both
//! created and torn down around the balloon itself.

#![cfg(windows)]

use std::time::{Duration, Instant};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::HBRUSH;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Shell::{
    Shell_NotifyIconW, NIF_ICON, NIF_INFO, NIF_STATE, NIF_TIP, NIIF_INFO,
    NIIF_RESPECT_QUIET_TIME, NIM_ADD, NIM_DELETE, NIS_HIDDEN, NOTIFYICONDATAW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, LoadIconW, RegisterClassW,
    TranslateMessage, HCURSOR, HICON, IDI_APPLICATION, MSG, WNDCLASSW, WNDCLASS_STYLES,
    WINDOW_EX_STYLE, WINDOW_STYLE,
};

const CLASS_NAME: &str = "LumenDeckBalloon";
/// Arbitrary: the throwaway icon is the only one this window owns.
const ICON_ID: u32 = 1;
/// Shell callback message. WM_USER with the default notification version
/// (no NIM_SETVERSION) puts the event id straight in lParam.
const CALLBACK_MESSAGE: u32 = 0_0400;
const NIN_BALLOONUSERCLICK: u32 = CALLBACK_MESSAGE + 3;

/// How long a balloon is given before we take the icon back, if the shell
/// never reports back. Windows dismisses it on its own well before this.
const DEFAULT_LIFETIME: Duration = Duration::from_secs(20);

/// Show a balloon titled `title` with `body`, on a background thread.
///
/// `on_click` runs if the user clicks the balloon; it is called on the
/// balloon's own thread, so it should do its work quickly (showing a
/// window, not a long task).
pub fn spawn<F>(title: &str, body: &str, on_click: F)
where
    F: FnOnce() + Send + 'static,
{
    let (title, body) = (title.to_owned(), body.to_owned());
    let thread = std::thread::Builder::new()
        .name("lumendeck-balloon".into())
        .spawn(move || {
            if let Err(e) = show(&title, &body, DEFAULT_LIFETIME, on_click) {
                log::warn!("tray balloon: {e}");
            }
        });
    if let Err(e) = thread {
        log::warn!("tray balloon thread: {e}");
    }
}

/// Raise the balloon and keep its icon alive until the shell is done with
/// it. Returns once the icon has been deleted.
fn show<F>(title: &str, body: &str, lifetime: Duration, on_click: F) -> Result<(), String>
where
    F: FnOnce(),
{
    unsafe {
        let hinstance: HINSTANCE = GetModuleHandleW(None)
            .map_err(|e| e.to_string())?
            .into();
        let mut class_name: Vec<u16> = CLASS_NAME.encode_utf16().collect();
        class_name.push(0);

        let class = WNDCLASSW {
            style: WNDCLASS_STYLES(0),
            lpfnWndProc: Some(wnd_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinstance,
            hIcon: HICON::default(),
            hCursor: HCURSOR::default(),
            hbrBackground: HBRUSH::default(),
            lpszMenuName: PCWSTR::null(),
            lpszClassName: PCWSTR(class_name.as_ptr()),
        };
        // A duplicate registration is only a problem if the class differs,
        // which it cannot: there is one class string, compiled in.
        if RegisterClassW(&class) == 0 {
            log::debug!("tray balloon: window class already registered");
        }

        // Never shown, never focused. It exists only to own the icon.
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            PCWSTR(class_name.as_ptr()),
            PCWSTR::null(),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            None,
            None,
            Some(hinstance),
            None,
        )
        .map_err(|e| e.to_string())?;

        // MAKEINTRESOURCE(1) is how Tauri embeds the app icon in the exe.
        let icon = LoadIconW(Some(hinstance), PCWSTR(1 as *const u16))
            .or_else(|_| LoadIconW(Some(hinstance), IDI_APPLICATION))
            .map_err(|e| e.to_string())?;

        let mut nid = NOTIFYICONDATAW {
            cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
            hWnd: hwnd,
            uID: ICON_ID,
            uFlags: NIF_ICON | NIF_TIP | NIF_INFO | NIF_STATE,
            uCallbackMessage: CALLBACK_MESSAGE,
            hIcon: icon,
            // Hidden, so the throwaway icon never shows up in the tray
            // while its balloon does.
            dwState: NIS_HIDDEN,
            dwStateMask: NIS_HIDDEN,
            dwInfoFlags: NIIF_INFO | NIIF_RESPECT_QUIET_TIME,
            ..Default::default()
        };
        wide_into("LumenDeck", &mut nid.szTip);
        wide_into(title, &mut nid.szInfoTitle);
        wide_into(body, &mut nid.szInfo);

        if !Shell_NotifyIconW(NIM_ADD, &nid).as_bool() {
            return Err("the shell refused the tray icon".into());
        }
        log::info!("tray balloon shown");

        // Pump until the shell reports the balloon is done, or the lifetime
        // runs out — whichever comes first.
        let deadline = Instant::now() + lifetime;
        let mut clicked = false;
        loop {
            if Instant::now() >= deadline {
                break;
            }
            let mut msg = MSG::default();
            // GetMessageW is not a Result: it returns 0 for WM_QUIT and -1 on
            // error, both of which mean there is nothing left to pump.
            if GetMessageW(&mut msg, None, 0, 0).0 <= 0 {
                break;
            }
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            if msg.message == CALLBACK_MESSAGE {
                if msg.lParam.0 as u32 == NIN_BALLOONUSERCLICK {
                    clicked = true;
                }
                // The shell only reports back once the balloon is finished
                // with us — clicked, timed out, or dismissed.
                break;
            }
        }

        let _ = Shell_NotifyIconW(NIM_DELETE, &nid);
        if clicked {
            on_click();
        }
        Ok(())
    }
}

/// Copy `s` into a fixed-size wide buffer, truncating to fit and always
/// leaving the NUL terminator the shell expects.
fn wide_into(s: &str, out: &mut [u16]) {
    let cap = out.len() - 1;
    let mut n = 0;
    for unit in s.encode_utf16() {
        if n == cap {
            break;
        }
        out[n] = unit;
        n += 1;
    }
    for slot in &mut out[n..] {
        *slot = 0;
    }
}

/// The balloon window does nothing but exist; the interesting messages are
/// the shell's, which we read on our own thread rather than here.
unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}
