use std::ffi::c_void;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::OnceLock;
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
    CreateIcon, DestroyIcon, RegisterWindowMessageW, SendMessageW, HICON, ICON_SMALL, WM_COMMAND,
    WM_GETICON,
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
static ACTION_ICONS: OnceLock<Result<(isize, isize), String>> = OnceLock::new();

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
    let (pause_icon, next_mode_icon) = action_icons()?;
    let buttons = [
        make_button(BUTTON_OPEN, "Open LumenDeck", HICON(icon.0 as *mut c_void)),
        make_button(
            BUTTON_PAUSE,
            "Pause or resume wallpaper",
            pause_icon,
        ),
        make_button(
            BUTTON_NEXT_MODE,
            "Next RGB mode",
            next_mode_icon,
        ),
    ];
    unsafe { taskbar.ThumbBarAddButtons(hwnd, &buttons) }
        .map_err(|e| format!("add taskbar thumbnail buttons: {e}"))
}

fn action_icons() -> Result<(HICON, HICON), String> {
    let icons = ACTION_ICONS.get_or_init(|| {
        let pause = create_action_icon(is_pause_pixel)?;
        match create_action_icon(is_next_mode_pixel) {
            Ok(next_mode) => Ok((pause.0 as isize, next_mode.0 as isize)),
            Err(error) => {
                unsafe {
                    let _ = DestroyIcon(pause);
                }
                Err(error)
            }
        }
    });
    icons
        .as_ref()
        .map(|(pause, next_mode)| {
            (HICON(*pause as *mut c_void), HICON(*next_mode as *mut c_void))
        })
        .map_err(Clone::clone)
}

fn create_action_icon(is_glyph_pixel: fn(usize, usize) -> bool) -> Result<HICON, String> {
    const SIZE: usize = 16;
    const ROW_BYTES: usize = SIZE / 8;
    let mut and_mask = [0xFFu8; ROW_BYTES * SIZE];
    let mut xor_mask = [0u8; ROW_BYTES * SIZE];
    for y in 0..SIZE {
        for x in 0..SIZE {
            if is_glyph_pixel(x, y) {
                let offset = (SIZE - 1 - y) * ROW_BYTES + x / 8;
                let bit = 0x80 >> (x % 8);
                and_mask[offset] &= !bit;
                xor_mask[offset] |= bit;
            }
        }
    }
    unsafe {
        CreateIcon(
            None,
            SIZE as i32,
            SIZE as i32,
            1,
            1,
            and_mask.as_ptr(),
            xor_mask.as_ptr(),
        )
        .map_err(|e| format!("create taskbar action icon: {e}"))
    }
}

fn is_pause_pixel(x: usize, y: usize) -> bool {
    (3..13).contains(&y) && ((4..7).contains(&x) || (9..12).contains(&x))
}

fn is_next_mode_pixel(x: usize, y: usize) -> bool {
    if !(3..13).contains(&y) {
        return false;
    }
    let row = y - 3;
    let half_width = if row <= 4 { row } else { 9 - row };
    (3..=3 + half_width * 2).contains(&x) || x == 13
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
