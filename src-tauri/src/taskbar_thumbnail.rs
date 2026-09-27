use std::ffi::c_void;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::Manager;
use windows::core::{BOOL, GUID, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    ITaskbarList3, THBF_ENABLED, THBN_CLICKED, THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
};
use windows::Win32::UI::WindowsAndMessaging::{
    RegisterWindowMessageW, SendMessageW, HICON, ICON_SMALL, WM_COMMAND, WM_GETICON,
};

const CLSID_TASKBAR_LIST: GUID = GUID {
    data1: 0x56FDF344,
    data2: 0xFD6D,
    data3: 0x11D0,
    data4: [0x95, 0x8A, 0x00, 0x60, 0x97, 0xC9, 0xA0, 0x90],
};
const BUTTON_OPEN: u32 = 1;
const BUTTON_PAUSE: u32 = 2;
const BUTTON_NEXT_MODE: u32 = 3;
const SUBCLASS_ID: usize = 0x4C554D454E444543;
static TASKBAR_BUTTON_CREATED: AtomicU32 = AtomicU32::new(0);

type SubclassProc = unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM, usize, usize) -> LRESULT;

#[link(name = "comctl32")]
extern "system" {
    fn SetWindowSubclass(
        hwnd: HWND,
        callback: Option<SubclassProc>,
        subclass_id: usize,
        reference_data: usize,
    ) -> BOOL;
    fn DefSubclassProc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT;
}

pub fn attach(window: &tauri::WebviewWindow) -> Result<(), String> {
    let hwnd = window
        .hwnd()
        .map(|handle| HWND(handle.0))
        .map_err(|e| format!("main window handle: {e}"))?;
    let message_name: Vec<u16> = "TaskbarButtonCreated"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let message = unsafe { RegisterWindowMessageW(PCWSTR::from_raw(message_name.as_ptr())) };
    if message == 0 {
        return Err("could not register TaskbarButtonCreated".into());
    }
    TASKBAR_BUTTON_CREATED.store(message, Ordering::Release);
    let installed = unsafe { SetWindowSubclass(hwnd, Some(window_subclass_proc), SUBCLASS_ID, 0) };
    if installed.0 == 0 {
        return Err("could not attach taskbar message handler".into());
    }
    Ok(())
}

unsafe extern "system" fn window_subclass_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _reference_data: usize,
) -> LRESULT {
    if message == TASKBAR_BUTTON_CREATED.load(Ordering::Acquire) {
        if let Err(e) = add_buttons(hwnd) {
            log::warn!("taskbar thumbnail setup failed: {e}");
        }
    } else if message == WM_COMMAND && ((wparam.0 >> 16) & 0xFFFF) as u32 == THBN_CLICKED {
        let button = (wparam.0 & 0xFFFF) as u32;
        if handle_button(button) {
            return LRESULT(0);
        }
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

fn add_buttons(hwnd: HWND) -> Result<(), String> {
    let com_init = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    if com_init.is_err() && com_init != windows::Win32::Foundation::RPC_E_CHANGED_MODE {
        return Err(format!("initialize COM: {com_init:?}"));
    }
    let result = add_buttons_with_com(hwnd);
    if com_init.is_ok() {
        unsafe { CoUninitialize() };
    }
    result
}

fn add_buttons_with_com(hwnd: HWND) -> Result<(), String> {
    let taskbar: ITaskbarList3 = unsafe {
        CoCreateInstance(&CLSID_TASKBAR_LIST, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| format!("create taskbar interface: {e}"))?
    };
    unsafe {
        taskbar
            .HrInit()
            .map_err(|e| format!("initialize taskbar: {e}"))?
    };

    let icon = unsafe {
        SendMessageW(
            hwnd,
            WM_GETICON,
            Some(WPARAM(ICON_SMALL as usize)),
            Some(LPARAM(0)),
        )
    };
    if icon.0 == 0 {
        return Err("main window has no small icon".into());
    }
    let buttons = [
        make_button(BUTTON_OPEN, "Open LumenDeck", HICON(icon.0 as *mut c_void)),
        make_button(
            BUTTON_PAUSE,
            "Pause or resume wallpaper",
            HICON(icon.0 as *mut c_void),
        ),
        make_button(
            BUTTON_NEXT_MODE,
            "Next RGB mode",
            HICON(icon.0 as *mut c_void),
        ),
    ];
    unsafe {
        taskbar
            .ThumbBarAddButtons(hwnd, &buttons)
            .map_err(|e| format!("add taskbar thumbnail buttons: {e}"))?;
    }
    Ok(())
}

fn make_button(id: u32, tooltip: &str, icon: HICON) -> THUMBBUTTON {
    let mut button = THUMBBUTTON {
        dwMask: THB_FLAGS | THB_ICON | THB_TOOLTIP,
        iId: id,
        hIcon: icon,
        dwFlags: THBF_ENABLED,
        ..Default::default()
    };
    for (target, value) in button
        .szTip
        .iter_mut()
        .zip(tooltip.encode_utf16().chain(std::iter::once(0)))
    {
        *target = value;
    }
    button
}

fn handle_button(button: u32) -> bool {
    let Some(app) = crate::app_handle() else {
        return false;
    };
    match button {
        BUTTON_OPEN => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            true
        }
        BUTTON_PAUSE => crate::tray::handle(&app, crate::tray::ID_PAUSE),
        BUTTON_NEXT_MODE => crate::tray::handle(&app, "next-mode"),
        _ => false,
    }
}
