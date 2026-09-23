//! Generic Win32 helpers: virtual-screen geometry, window ex-styles, z-order,
//! fullscreen detection, power state. Uses the `windows` crate (0.62).

#![cfg(windows)]

use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, HMONITOR,
    MONITOR_DEFAULTTONEAREST, MONITORINFOEXW,
};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetForegroundWindow, GetSystemMetrics, GetWindowLongPtrW, GetWindowRect,
    SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_BOTTOM, HWND_TOP, SM_CXVIRTUALSCREEN,
    SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOSIZE, SWP_NOZORDER, WINDOW_EX_STYLE,
};

pub const WS_EX_LAYERED: WINDOW_EX_STYLE = WINDOW_EX_STYLE(0x0008_0000);
pub const WS_EX_TRANSPARENT: WINDOW_EX_STYLE = WINDOW_EX_STYLE(0x0000_0020);
pub const WS_EX_TOOLWINDOW: WINDOW_EX_STYLE = WINDOW_EX_STYLE(0x0000_0080);
pub const WS_EX_NOACTIVATE: WINDOW_EX_STYLE = WINDOW_EX_STYLE(0x0800_0000);

/// Full virtual desktop bounding rect (all monitors), in pixels: (x, y, w, h).
pub fn virtual_screen_rect() -> (i32, i32, i32, i32) {
    unsafe {
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        (x, y, w, h)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MonitorRect {
    pub device: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub primary: bool,
}

/// 0-based index of the monitor containing the given point, in the same
/// order as `monitors()`. Returns 0 when the point matches no monitor.
pub fn monitor_index_for_point(x: i32, y: i32) -> usize {
    let pt = windows::Win32::Foundation::POINT { x, y };
    let hmon = unsafe { MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST) };
    if hmon.is_invalid() {
        return 0;
    }
    let mut mi = MONITORINFOEXW::default();
    mi.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    unsafe { let _ = GetMonitorInfoW(hmon, &mut mi.monitorInfo); };
    let rect = mi.monitorInfo.rcMonitor;
    monitors()
        .iter()
        .position(|m| m.x == rect.left && m.y == rect.top)
        .unwrap_or(0)
}

/// Enumerate display monitors with device names.
/// Local wall-clock time as minutes-of-day (for the playlist scheduler).
/// Uses GetLocalTime to stay independent of any timezone crate.
pub fn local_time_minutes() -> Option<u32> {
    #[cfg(windows)]
    {
        use windows::Win32::System::SystemInformation::GetLocalTime;
        let st = unsafe { GetLocalTime() };
        let h = st.wHour as u32;
        let m = st.wMinute as u32;
        if h > 23 || m > 59 {
            return None;
        }
        Some(h * 60 + m)
    }
    #[cfg(not(windows))]
    {
        None
    }
}

pub fn monitors() -> Vec<MonitorRect> {
    extern "system" fn callback(
        hmon: HMONITOR,
        _hdc: windows::Win32::Graphics::Gdi::HDC,
        _clip: *mut RECT,
        lparam: LPARAM,
    ) -> windows::core::BOOL {
        let out = unsafe { &mut *(lparam.0 as *mut Vec<MonitorRect>) };
        let mut mi = MONITORINFOEXW::default();
        mi.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        unsafe {
            if GetMonitorInfoW(hmon, &mut mi.monitorInfo).as_bool() {
                out.push(MonitorRect {
                    device: wchar_to_string(&mi.szDevice),
                    x: mi.monitorInfo.rcMonitor.left,
                    y: mi.monitorInfo.rcMonitor.top,
                    w: mi.monitorInfo.rcMonitor.right - mi.monitorInfo.rcMonitor.left,
                    h: mi.monitorInfo.rcMonitor.bottom - mi.monitorInfo.rcMonitor.top,
                    primary: (mi.monitorInfo.dwFlags & 1) != 0, // MONITORINFOF_PRIMARY
                });
            }
        }
        true.into()
    }

    let mut out: Vec<MonitorRect> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(callback),
            LPARAM(&mut out as *mut _ as isize),
        );
    }
    out
}

fn wchar_to_string(p: &[u16]) -> String {
    let len = p.iter().position(|&c| c == 0).unwrap_or(p.len());
    String::from_utf16_lossy(&p[..len])
}

pub fn get_ex_style(hwnd: HWND) -> WINDOW_EX_STYLE {
    unsafe { WINDOW_EX_STYLE(GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32) }
}

pub fn set_ex_style(hwnd: HWND, style: WINDOW_EX_STYLE) {
    unsafe {
        let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style.0 as isize);
    }
}

/// Toggle a window's click-through (transparent-to-input) behavior.
pub fn set_click_through(hwnd: HWND, on: bool) {
    let cur = get_ex_style(hwnd);
    let next = if on {
        cur | WS_EX_LAYERED | WS_EX_TRANSPARENT
    } else {
        cur & !(WS_EX_LAYERED | WS_EX_TRANSPARENT)
    };
    set_ex_style(hwnd, next);
}

/// Toggle only WS_EX_TRANSPARENT (keep layered per-pixel transparency) so a
/// window can accept input on its interactive elements while transparent
/// areas still pass clicks through to whatever is underneath.
pub fn set_input_transparent(hwnd: HWND, on: bool) {
    let cur = get_ex_style(hwnd);
    let next = if on {
        cur | WS_EX_TRANSPARENT
    } else {
        cur & !WS_EX_TRANSPARENT
    };
    set_ex_style(hwnd, next);
}

/// Raise or sink a window in z-order. (topmost handling is done via Tauri's
/// set_always_on_top; this is for taskbar-below stickers.)
pub fn set_z_order(hwnd: HWND, top: bool) {
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            Some(if top { HWND_TOP } else { HWND_BOTTOM }),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

/// Is there a fullscreen (monitor-covering) foreground window?
pub fn has_fullscreen_foreground() -> bool {
    unsafe {
        let fg = GetForegroundWindow();
        if fg.is_invalid() {
            return false;
        }
        // Our own wallpaper windows are behind the desktop and never
        // foreground, but a misplaced class-name match (e.g. after a re-parent
        // where the shell hands focus back) must never pause ourselves.
        let mut buf = [0u16; 64];
        let n = GetClassNameW(fg, &mut buf);
        let class = String::from_utf16_lossy(&buf[..n as usize]);
        if class == "WorkerW" || class == "Progman" {
            return false;
        }
        let mut r = RECT::default();
        if GetWindowRect(fg, &mut r).is_err() {
            return false;
        }
        let hmon = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFOEXW::default();
        mi.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if !GetMonitorInfoW(hmon, &mut mi.monitorInfo).as_bool() {
            return false;
        }
        r == mi.monitorInfo.rcMonitor
    }
}

/// AC-power detection for pause rules. Some(true) = on battery.
pub fn on_battery_or_saver() -> Option<bool> {
    unsafe {
        let mut st = SYSTEM_POWER_STATUS::default();
        if GetSystemPowerStatus(&mut st).is_err() {
            return None;
        }
        // ACLineStatus: 0 = offline (battery), 1 = online, 255 = unknown.
        Some(st.ACLineStatus == 0)
    }
}

/// Keep a window out of Alt-Tab and prevent focus stealing.
pub fn make_tool_window(hwnd: HWND) {
    let cur = get_ex_style(hwnd);
    set_ex_style(hwnd, cur | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
}

/// Send the window to the very back without activating it.
pub fn send_to_back(hwnd: HWND) {
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_BOTTOM),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER,
        );
    }
}
