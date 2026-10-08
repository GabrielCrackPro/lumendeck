
#![cfg(windows)]

use crate::win32;
use std::sync::Mutex;
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowExW, GA_PARENT, GetAncestor, GetClassNameW, GetWindow, GetWindowRect,
    GW_HWNDNEXT, GW_HWNDPREV, HWND_BOTTOM, SendMessageTimeoutW, SetParent, SetWindowPos,
    SMTO_NORMAL, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachState {
    Detached,
    Attached,
}

static ATTACH_STATE: Mutex<AttachState> = Mutex::new(AttachState::Detached);

pub fn attach_state() -> AttachState {
    *ATTACH_STATE.lock().expect("attach state mutex poisoned")
}

fn set_attach_state(s: AttachState) {
    *ATTACH_STATE.lock().expect("attach state mutex poisoned") = s;
}

struct WorkerWWalk {
    icons_workerw: Option<HWND>,
}

fn find_icons_workerw() -> Option<HWND> {
    let mut walk = WorkerWWalk {
        icons_workerw: None,
    };

    extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
        let walk = unsafe { &mut *(lparam.0 as *mut WorkerWWalk) };
        unsafe {
            let mut buf = [0u16; 64];
            let n = windows::Win32::UI::WindowsAndMessaging::GetClassNameW(hwnd, &mut buf);
            let class = String::from_utf16_lossy(&buf[..n as usize]);
            if class == "WorkerW" {
                let def_view: HWND =
                    FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), None)
                        .unwrap_or_default();
                if !def_view.is_invalid() {
                    walk.icons_workerw = Some(hwnd);
                }
            }
        }
        true.into()
    }

    unsafe {
        let _ = windows::Win32::UI::WindowsAndMessaging::EnumWindows(
            Some(enum_proc),
            LPARAM(&mut walk as *mut _ as isize),
        );
    }
    walk.icons_workerw
}

fn find_workerw() -> Option<HWND> {
    unsafe {
        let progman: HWND = FindWindowExW(None, None, w!("Progman"), None).unwrap_or_default();
        if progman.is_invalid() {
            return None;
        }
        SendMessageTimeoutW(progman, 0x052C, WPARAM(0), LPARAM(0), SMTO_NORMAL, 1000, None);
        let icons = find_icons_workerw();
        if icons.is_none() {
            SendMessageTimeoutW(progman, 0x052C, WPARAM(0), LPARAM(0), SMTO_NORMAL, 1000, None);
        }
    }

    if let Some(icons) = find_icons_workerw() {
        let next: HWND = unsafe {
            FindWindowExW(None, Some(icons), w!("WorkerW"), None).unwrap_or_default()
        };
        if !next.is_invalid() {
            return Some(next);
        }
        return Some(icons);
    }

    unsafe {
        let progman: HWND = FindWindowExW(None, None, w!("Progman"), None).unwrap_or_default();
        if !progman.is_invalid() {
            return Some(progman);
        }
    }
    None
}

pub fn attach(hwnd: HWND, monitor: (i32, i32, u32, u32)) -> Result<(), String> {
    let parent = find_workerw()
        .ok_or_else(|| "no WorkerW/Progman parent available; wallpaper attach unsupported".to_string())?;

    let res = unsafe { SetParent(hwnd, Some(parent)) };
    if res.is_err() {
        return Err(format!("SetParent failed: {}", res.unwrap_err()));
    }

    let mut pr = windows::Win32::Foundation::RECT::default();
    let _ = unsafe { GetWindowRect(parent, &mut pr) };
    let (mx, my, mw, mh) = monitor;
    let rel_x = mx - pr.left;
    let rel_y = my - pr.top;
    let def_view: HWND = unsafe {
        FindWindowExW(Some(parent), None, w!("SHELLDLL_DefView"), None).unwrap_or_default()
    };
    let after = if def_view.is_invalid() { HWND_BOTTOM } else { def_view };
    let _ = unsafe {
        SetWindowPos(hwnd, Some(after), rel_x, rel_y, mw as i32, mh as i32, SWP_NOACTIVATE)
    };

    set_attach_state(AttachState::Attached);
    let delayed = hwnd.0 as isize;
    std::thread::spawn(move || {
        let hwnd = HWND(delayed as *mut _);
        for _ in 0..20 {
            std::thread::sleep(std::time::Duration::from_secs(3));
            reassert_below_icons(hwnd);
        }
        loop {
            std::thread::sleep(std::time::Duration::from_secs(30));
            reassert_below_icons(hwnd);
        }
    });
    Ok(())
}

fn reassert_below_icons(hwnd: HWND) {
    unsafe {
        let parent = GetAncestor(hwnd, GA_PARENT);
        if parent.is_invalid() {
            return;
        }
        let def_view: HWND =
            FindWindowExW(Some(parent), None, w!("SHELLDLL_DefView"), None).unwrap_or_default();
        let after = if def_view.is_invalid() { HWND_BOTTOM } else { def_view };
        if after == HWND_BOTTOM {
            let below = GetWindow(hwnd, GW_HWNDNEXT).unwrap_or_default();
            if below.is_invalid() {
                return;
            }
        } else {
            let above = GetWindow(hwnd, GW_HWNDPREV).unwrap_or_default();
            if above == def_view {
                return;
            }
        }
        let _ = SetWindowPos(
            hwnd,
            Some(after),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

pub fn detach(hwnd: HWND) -> Result<(), String> {
    let res = unsafe { SetParent(hwnd, None) };
    if res.is_err() {
        return Err(format!("SetParent(None) failed: {}", res.unwrap_err()));
    }
    win32::send_to_back(hwnd);
    set_attach_state(AttachState::Detached);
    Ok(())
}

pub fn is_attached(hwnd: HWND) -> bool {
    unsafe {
        let parent = GetAncestor(hwnd, GA_PARENT);
        if parent.is_invalid() {
            return false;
        }
        let mut buf = [0u16; 64];
        let n = GetClassNameW(parent, &mut buf);
        let class = String::from_utf16_lossy(&buf[..n as usize]);
        class == "WorkerW" || class == "Progman"
    }
}
