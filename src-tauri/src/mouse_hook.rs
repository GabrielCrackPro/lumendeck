//! Low-level global mouse hook (WH_MOUSE_LL): lets the user place stickers by
//! clicking directly on the desktop — no overlay window involved. Also powers
//! the on-wallpaper sticker editor (drag/resize) while editor mode is on.
//! A dedicated thread installs the hook once and pumps messages; the callback
//! stays installed forever.
//!
//! Events are observed, never swallowed: clicks still reach whatever is
//! underneath (harmless — the wallpaper layer has no interactive content).

#![cfg(windows)]

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

static ARMED: AtomicBool = AtomicBool::new(false);
/// Editor mode: stream all mouse activity to the wallpaper webviews.
static EDITOR_MODE: AtomicBool = AtomicBool::new(false);
static WAITER: Mutex<Option<tokio::sync::oneshot::Sender<ClickResult>>> = Mutex::new(None);

/// Timestamp (ms since epoch) of the last user input (mouse or keyboard).
static LAST_INPUT_MS: AtomicU64 = AtomicU64::new(0);

/// Returns the last time any input activity was observed.
pub fn last_input_ms() -> u64 {
    LAST_INPUT_MS.load(Ordering::Relaxed)
}

/// Record input activity with the current timestamp.
fn touch_input() {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    LAST_INPUT_MS.store(now, Ordering::Relaxed);
    // Wake the RGB engine immediately if it was sleeping due to idle.
    crate::rgb::wake_if_sleeping();
}

#[derive(Debug, Clone, Copy)]
pub enum ClickResult {
    Place(i32, i32),
    Cancel,
}

/// ESC pressed while an interactive session (placement/editor) is active.
/// The keyboard hook sets this; the editor forwarder drains it.
pub static ESC_PRESSED: AtomicBool = AtomicBool::new(false);

/// True when the last keyboard event was Escape with no other key held.
fn is_escape(vk: u32) -> bool {
    vk == 0x1B // VK_ESCAPE
}

/// Arm the hook. The next left click resolves the pending waiter with
/// `Place`; a right click resolves it with `Cancel`.
pub fn arm() {
    ARMED.store(true, Ordering::SeqCst);
}

/// Disarm and resolve any pending waiter as `Cancel` (UI cancel button).
pub fn disarm() {
    ARMED.store(false, Ordering::SeqCst);
    fire(ClickResult::Cancel);
}

/// Resolve the armed placement at a specific point (corner quick-place).
pub fn resolve_place_at(x: i32, y: i32) {
    ARMED.store(false, Ordering::SeqCst);
    log::info!("[mouse-hook] place via corner zone at ({x}, {y})");
    fire(ClickResult::Place(x, y));
}

/// Await the next armed click (must be called from a Tauri async command).
pub async fn wait() -> ClickResult {
    let (tx, rx) = tokio::sync::oneshot::channel();
    if WAITER.lock().expect("waiter poisoned").replace(tx).is_some() {
        // A previous waiter never resolved — resolve it as cancelled.
    }
    ARMED.store(true, Ordering::SeqCst);
    rx.await.unwrap_or(ClickResult::Cancel)
}

fn fire(result: ClickResult) {
    if let Some(tx) = WAITER.lock().expect("waiter poisoned").take() {
        let _ = tx.send(result);
    }
}

/// Editor mode on/off (streamed via CURSOR_TX with button states).
pub fn set_editor_mode(on: bool) {
    EDITOR_MODE.store(on, Ordering::SeqCst);
}

pub fn editor_mode_on() -> bool {
    EDITOR_MODE.load(Ordering::SeqCst)
}

/// Install the hook on a dedicated thread with a message pump. Call once at
/// startup; the hook lives for the process lifetime.
pub fn spawn() {
    std::thread::Builder::new()
        .name("sticker-mouse-hook".into())
        .spawn(|| {
            unsafe {
                let hook = match install() {
                    Ok(h) => h,
                    Err(e) => {
                        log::warn!("[mouse-hook] install failed: {e}");
                        return;
                    }
                };
                log::info!("[mouse-hook] installed");
                // Message pump keeps the hook thread alive.
                let mut msg = windows::Win32::UI::WindowsAndMessaging::MSG::default();
                while windows::Win32::UI::WindowsAndMessaging::GetMessageW(&mut msg, None, 0, 0)
                    .as_bool()
                {
                    // No window: nothing to translate/dispatch.
                }
                let _ = windows::Win32::UI::WindowsAndMessaging::UnhookWindowsHookEx(hook);
            }
        })
        .ok();
}

unsafe fn install() -> windows::core::Result<windows::Win32::UI::WindowsAndMessaging::HHOOK> {
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowsHookExW, WH_MOUSE_LL};
    let hmod = GetModuleHandleW(None)?;
    SetWindowsHookExW(WH_MOUSE_LL, Some(hook_proc), Some(hmod.into()), 0)
}

/// One streamed mouse observation: position + button state.
pub type MouseEv = (i32, i32, bool, bool); // x, y, left-down, right-down

/// Wheel deltas streamed while placement is armed (positive = up/zoom in).
pub static WHEEL_TX: Mutex<Option<tokio::sync::mpsc::UnboundedSender<i32>>> = Mutex::new(None);

unsafe extern "system" fn hook_proc(
    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, MSLLHOOKSTRUCT, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE,
        WM_MOUSEWHEEL, WM_RBUTTONDOWN, WM_RBUTTONUP,
    };

    if code >= 0 {
        let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        let msg = wparam.0 as u32;
        touch_input();

        if ARMED.load(Ordering::SeqCst) {
            // Placement: stream cursor movement so the wallpaper can preview.
            if msg == WM_MOUSEMOVE {
                let _ = CURSOR_TX.lock().map(|tx| {
                    if let Some(tx) = tx.as_ref() {
                        let _ = tx.send((info.pt.x, info.pt.y, false, false));
                    }
                });
            }
            if msg == WM_MOUSEWHEEL {
                // HIWORD of mouseData: positive when scrolled up.
                let delta = (info.mouseData as u16 as i32) >> 16;
                let _ = WHEEL_TX.lock().map(|tx| {
                    if let Some(tx) = tx.as_ref() {
                        let _ = tx.send(delta);
                    }
                });
            }
            if msg == WM_LBUTTONDOWN {
                ARMED.store(false, Ordering::SeqCst);
                log::info!("[mouse-hook] place click at ({}, {})", info.pt.x, info.pt.y);
                fire(ClickResult::Place(info.pt.x, info.pt.y));
            } else if msg == WM_RBUTTONDOWN {
                ARMED.store(false, Ordering::SeqCst);
                log::info!("[mouse-hook] placement cancelled (right click)");
                fire(ClickResult::Cancel);
            }
        } else if EDITOR_MODE.load(Ordering::SeqCst) {
            // Editor: stream moves + button edges with post-update button state.
            let event = match msg {
                WM_MOUSEMOVE => Some((info.pt.x, info.pt.y, L_DOWN.load(Ordering::Relaxed), R_DOWN.load(Ordering::Relaxed))),
                WM_LBUTTONDOWN => {
                    L_DOWN.store(true, Ordering::Relaxed);
                    Some((info.pt.x, info.pt.y, true, R_DOWN.load(Ordering::Relaxed)))
                }
                WM_LBUTTONUP => {
                    L_DOWN.store(false, Ordering::Relaxed);
                    Some((info.pt.x, info.pt.y, false, R_DOWN.load(Ordering::Relaxed)))
                }
                WM_RBUTTONDOWN => {
                    R_DOWN.store(true, Ordering::Relaxed);
                    Some((info.pt.x, info.pt.y, L_DOWN.load(Ordering::Relaxed), true))
                }
                WM_RBUTTONUP => {
                    R_DOWN.store(false, Ordering::Relaxed);
                    Some((info.pt.x, info.pt.y, L_DOWN.load(Ordering::Relaxed), false))
                }
                _ => None,
            };
            if let Some(ev) = event {
                let _ = CURSOR_TX.lock().map(|tx| {
                    if let Some(tx) = tx.as_ref() {
                        let _ = tx.send(ev);
                    }
                });
            }
            // Swallow button events while editing so clicks don't reach desktop
            // icons/windows underneath — EXCEPT clicks over LumenDeck's own
            // windows (the dashboard's "Done" button must stay clickable).
            // Moves always pass. (If this process dies, Windows removes the
            // hook automatically — no lock-out.)
            if msg == WM_LBUTTONDOWN
                || msg == WM_LBUTTONUP
                || msg == WM_RBUTTONDOWN
                || msg == WM_RBUTTONUP
            {
                if crate::win32::point_over_own_window(info.pt.x, info.pt.y) {
                    // Let our own UI receive the click normally. Also reset
                    // tracked button state so the editor doesn't think a drag
                    // is in progress when the click was on the dashboard.
                    if msg == WM_LBUTTONDOWN {
                        L_DOWN.store(false, Ordering::Relaxed);
                    } else if msg == WM_RBUTTONDOWN {
                        R_DOWN.store(false, Ordering::Relaxed);
                    }
                    return CallNextHookEx(None, code, wparam, lparam);
                }
                return LRESULT(1);
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

// Button state tracked for the editor stream (moves carry current buttons).
static L_DOWN: AtomicBool = AtomicBool::new(false);
static R_DOWN: AtomicBool = AtomicBool::new(false);

/// Sender side of the live cursor/editor stream.
static CURSOR_TX: Mutex<Option<tokio::sync::mpsc::UnboundedSender<MouseEv>>> = Mutex::new(None);

/// Take over the cursor stream (placement or editor). The forwarder task in
/// the command/setup broadcasts observations as events.
pub fn take_cursor_stream() -> Option<tokio::sync::mpsc::UnboundedReceiver<MouseEv>> {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    CURSOR_TX
        .lock()
        .expect("cursor tx poisoned")
        .replace(tx);
    Some(rx)
}

/// Release the cursor stream (placement finished / editor closed).
pub fn release_cursor_stream() {
    CURSOR_TX.lock().expect("cursor tx poisoned").take();
    L_DOWN.store(false, Ordering::Relaxed);
    R_DOWN.store(false, Ordering::Relaxed);
}

// ---------------------------------------------------------------------------
// Keyboard hook (WH_KEYBOARD_LL) — tracks input activity for idle detection.
// ---------------------------------------------------------------------------

/// Install a low-level keyboard hook on a dedicated thread. Observes all key
/// events and updates `LAST_INPUT_MS` so the idle timer resets on typing.
pub fn spawn_keyboard_hook() {
    std::thread::Builder::new()
        .name("sticker-keyboard-hook".into())
        .spawn(|| {
            unsafe {
                let hook = match install_keyboard_hook() {
                    Ok(h) => h,
                    Err(e) => {
                        log::warn!("[keyboard-hook] install failed: {e}");
                        return;
                    }
                };
                log::info!("[keyboard-hook] installed");
                let mut msg = windows::Win32::UI::WindowsAndMessaging::MSG::default();
                while windows::Win32::UI::WindowsAndMessaging::GetMessageW(&mut msg, None, 0, 0)
                    .as_bool()
                {
                }
                let _ = windows::Win32::UI::WindowsAndMessaging::UnhookWindowsHookEx(hook);
            }
        })
        .ok();
}

unsafe fn install_keyboard_hook() -> windows::core::Result<windows::Win32::UI::WindowsAndMessaging::HHOOK> {
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowsHookExW, WH_KEYBOARD_LL};
    let hmod = GetModuleHandleW(None)?;
    SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), Some(hmod.into()), 0)
}

unsafe extern "system" fn keyboard_hook_proc(
    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::WindowsAndMessaging::CallNextHookEx;
    use windows::Win32::UI::WindowsAndMessaging::{WM_KEYDOWN, WM_SYSKEYDOWN};

    if code >= 0 {
        touch_input();
        // Interactive sessions end on ESC (same convention as Wallpaper
        // Engine / Lively use for their placement flows). Observed, never
        // swallowed — the focused app gets its normal ESC handling too.
        let msg = wparam.0 as u32;
        if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN)
            && (editor_mode_on() || ARMED.load(Ordering::SeqCst))
        {
            let kbd = &*(lparam.0 as *const windows::Win32::UI::WindowsAndMessaging::KBDLLHOOKSTRUCT);
            if is_escape(kbd.vkCode) {
                ESC_PRESSED.store(true, Ordering::SeqCst);
                if ARMED.load(Ordering::SeqCst) {
                    ARMED.store(false, Ordering::SeqCst);
                    log::info!("[keyboard-hook] placement cancelled (ESC)");
                    fire(ClickResult::Cancel);
                }
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}
