//! WorkerW wallpaper attachment (Windows).
//!
//! Technique: broadcast message `0x052C` to Progman makes the shell spawn a
//! WorkerW window behind the desktop icons; the original WorkerW (owning the
//! static wallpaper image) stays above it. We find the WorkerW that directly
//! contains `SHELLDLL_DefView`, then reparent our window under its *next
//! sibling* — placing it between the wallpaper image and the desktop icons.

#![cfg(windows)]

use crate::win32;
use std::sync::Mutex;
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowExW, GA_PARENT, GetAncestor, GetClassNameW, GetWindowRect, SendMessageTimeoutW,
    SetParent, SetWindowPos, SMTO_NORMAL, SWP_NOACTIVATE, SWP_NOZORDER,
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

/// Ask Progman to spawn the extra WorkerW, then find the handle that should
/// become the parent of our wallpaper window.
fn find_workerw() -> Option<HWND> {
    unsafe {
        let progman: HWND = FindWindowExW(None, None, w!("Progman"), None).unwrap_or_default();
        if progman.is_invalid() {
            return None;
        }
        // Undocumented message: "spawn WorkerW behind icons".
        SendMessageTimeoutW(progman, 0x052C, WPARAM(0), LPARAM(0), SMTO_NORMAL, 1000, None);
    }

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
                // Does this WorkerW contain SHELLDLL_DefView (the icons host)?
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

    if let Some(icons) = walk.icons_workerw {
        // Next sibling WorkerW is the wallpaper host.
        let next: HWND = unsafe {
            FindWindowExW(None, Some(icons), w!("WorkerW"), None).unwrap_or_default()
        };
        if !next.is_invalid() {
            return Some(next);
        }
        // Fallback: parent under the icons WorkerW itself.
        return Some(icons);
    }

    // Last resort: Progman directly.
    unsafe {
        let progman: HWND = FindWindowExW(None, None, w!("Progman"), None).unwrap_or_default();
        if !progman.is_invalid() {
            return Some(progman);
        }
    }
    None
}

/// Attach a Tauri window (by HWND) as the live wallpaper layer.
///
/// `monitor` is the window's target rect in *screen* coordinates. After
/// `SetParent`, the window's position becomes relative to the parent WorkerW's
/// client origin — which on multi-monitor setups is the virtual-desktop
/// top-left, NOT the screen origin. We therefore re-apply the rect in
/// parent-relative coordinates, or the wallpaper lands offset by whatever
/// monitors sit above/left of the primary.
pub fn attach(hwnd: HWND, monitor: (i32, i32, u32, u32)) -> Result<(), String> {
    let parent = find_workerw()
        .ok_or_else(|| "no WorkerW/Progman parent available; wallpaper attach unsupported".to_string())?;

    let res = unsafe { SetParent(hwnd, Some(parent)) };
    if res.is_err() {
        return Err(format!("SetParent failed: {}", res.unwrap_err()));
    }

    // Convert the desired screen rect into parent-client coordinates.
    let mut pr = windows::Win32::Foundation::RECT::default();
    let _ = unsafe { GetWindowRect(parent, &mut pr) };
    let (mx, my, mw, mh) = monitor;
    let rel_x = mx - pr.left;
    let rel_y = my - pr.top;
    let _ = unsafe {
        SetWindowPos(
            hwnd,
            None,
            rel_x,
            rel_y,
            mw as i32,
            mh as i32,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
    };

    set_attach_state(AttachState::Attached);
    Ok(())
}

/// Detach the wallpaper window: reparent back to no parent (desktop).
pub fn detach(hwnd: HWND) -> Result<(), String> {
    let res = unsafe { SetParent(hwnd, None) };
    if res.is_err() {
        return Err(format!("SetParent(None) failed: {}", res.unwrap_err()));
    }
    win32::send_to_back(hwnd);
    set_attach_state(AttachState::Detached);
    Ok(())
}

/// Cheap liveness check: is `hwnd` still parented under the desktop shell
/// (WorkerW or Progman)? Used to skip redundant re-parenting/repositioning on
/// every config save, which would otherwise flicker the wallpaper layer.
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
