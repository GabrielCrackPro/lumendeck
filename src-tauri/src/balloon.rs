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

use std::time::Duration;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::HBRUSH;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Shell::{
    Shell_NotifyIconW, NIF_ICON, NIF_INFO, NIF_STATE, NIF_TIP, NIIF_INFO, NIIF_LARGE_ICON,
    NIIF_RESPECT_QUIET_TIME, NIM_ADD, NIM_DELETE, NIS_HIDDEN, NOTIFYICONDATAW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIconFromResourceEx, CreateWindowExW, DefWindowProcW, DestroyIcon, DispatchMessageW,
    GetMessageW, KillTimer, LoadIconW, RegisterClassW, SetTimer, TranslateMessage, HCURSOR, HICON,
    IDI_APPLICATION, IMAGE_FLAGS, MSG, WNDCLASSW, WNDCLASS_STYLES, WINDOW_EX_STYLE, WINDOW_STYLE,
};

const CLASS_NAME: &str = "LumenDeckBalloon";
/// Arbitrary: the throwaway icon is the only one this window owns.
const ICON_ID: u32 = 1;
/// Shell callback message. WM_USER with the default notification version
/// (no NIM_SETVERSION) puts the event id straight in lParam.
const CALLBACK_MESSAGE: u32 = 0_0400;
const NIN_BALLOONCLICK: u32 = CALLBACK_MESSAGE + 1;
const NIN_BALLOONUSERCLICK: u32 = CALLBACK_MESSAGE + 3;

/// How long a balloon is given before we take the icon back, if the shell
/// never reports back. Windows dismisses it on its own well before this —
/// unless the user set notifications to "Never", in which case the balloon
/// waits for a click and this is the only thing that ends it.
const DEFAULT_LIFETIME: Duration = Duration::from_secs(20);
const TIMER_ID: usize = 1;
const WM_TIMER: u32 = 0x0113;

/// The app icon, compiled into the binary from icons/icon.ico.
///
/// This is the same artwork the tray, the taskbar and the installer use, and
/// it is the only source that works everywhere: LoadIconW can only reach the
/// icon in a *bundled* exe, so a `tauri dev` run falls through to the generic
/// Windows application glyph and the notification arrives wearing someone
/// else's face.
const APP_ICON_ICO: &[u8] = include_bytes!("../icons/icon.ico");

/// Size to build the icon at. The shell draws a balloon's icon at 16px, or
/// 32px when NIIF_LARGE_ICON is set; asking for 32 keeps the large variant
/// pixel-exact and lets the small one downsample cleanly.
const BALLOON_ICON_PX: u16 = 32;

/// RT_ICON format version 3 — the 32-bit DIB layout every frame in our .ico
/// uses. CreateIconFromResourceEx wants it spelled out.
const ICON_VERSION_3: u32 = 0x0003_0000;

/// Tooltip for the hidden icon. Never seen (the icon is hidden), but the
/// shell reads it while the balloon is up.
const TIP: &str = "LumenDeck — running in the background";

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
            .map_err(crate::error::err_str)?
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
        .map_err(crate::error::err_str)?;

        let (icon, icon_is_ours) = load_app_icon(hinstance);

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
            // LARGE: a 32px app icon instead of a 16px speck. This is the
            // one piece of visual design a shell balloon actually offers.
            dwInfoFlags: NIIF_INFO | NIIF_LARGE_ICON | NIIF_RESPECT_QUIET_TIME,
            ..Default::default()
        };
        wide_into(TIP, &mut nid.szTip);
        wide_into(title, &mut nid.szInfoTitle);
        wide_into(body, &mut nid.szInfo);

        if !Shell_NotifyIconW(NIM_ADD, &nid).as_bool() {
            destroy_icon(icon, icon_is_ours);
            return Err("the shell refused the tray icon".into());
        }
        log::info!("tray balloon shown: \"{title}\" — \"{body}\"");

        // GetMessageW blocks until something happens, so the lifetime has to
        // arrive as a message of its own or the pump would sit here forever
        // on a machine that never dismisses the balloon.
        SetTimer(Some(hwnd), TIMER_ID, lifetime.as_millis() as u32, None);

        let mut clicked = false;
        loop {
            let mut msg = MSG::default();
            // GetMessageW is not a Result: it returns 0 for WM_QUIT and -1 on
            // error, both of which mean there is nothing left to pump.
            if GetMessageW(&mut msg, None, 0, 0).0 <= 0 {
                break;
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
            if msg.message == WM_TIMER && msg.wParam.0 as usize == TIMER_ID {
                break;
            }
            if msg.message == CALLBACK_MESSAGE {
                // Two ways in: a click on the balloon body (BALLOONUSERCLICK,
                // what Win8+ raises) and a plain click on the balloon itself
                // (BALLOONCLICK, what the classic shell raises). Treat them
                // the same so the dashboard opens however it was clicked.
                if matches!(msg.lParam.0 as u32, NIN_BALLOONUSERCLICK | NIN_BALLOONCLICK) {
                    clicked = true;
                }
                // The shell only reports back once the balloon is finished
                // with us — clicked, timed out, or dismissed.
                break;
            }
        }

        let _ = KillTimer(Some(hwnd), TIMER_ID);
        let _ = Shell_NotifyIconW(NIM_DELETE, &nid);
        destroy_icon(icon, icon_is_ours);
        if clicked {
            on_click();
        }
        Ok(())
    }
}

/// The icon for the balloon, and whether we are the ones who have to free it.
///
/// The app icon compiled into the binary is the point: it is the one source
/// that is correct in a dev build and a bundled one alike. The exe resource
/// and the system default are only there so a missing or malformed
/// icon.ico degrades to *something* instead of a notification with a blank
/// square where its face should be.
fn load_app_icon(hinstance: HINSTANCE) -> (HICON, bool) {
    let Some(frame) = icon_frame(APP_ICON_ICO, BALLOON_ICON_PX) else {
        log::warn!("tray balloon: no usable frame in the embedded app icon");
        return fallback_icon(hinstance);
    };
    match unsafe {
        CreateIconFromResourceEx(
            frame,
            true,
            ICON_VERSION_3,
            i32::from(BALLOON_ICON_PX),
            i32::from(BALLOON_ICON_PX),
            IMAGE_FLAGS(0),
        )
    } {
        Ok(icon) => (icon, true),
        Err(e) => {
            log::warn!("tray balloon: the shell rejected the app icon: {e}");
            fallback_icon(hinstance)
        }
    }
}

/// The icon embedded in the exe (a bundled build only), else the system
/// application icon. Both are shared objects: never DestroyIcon either.
fn fallback_icon(hinstance: HINSTANCE) -> (HICON, bool) {
    // MAKEINTRESOURCE(1) is how a bundled build embeds the app icon.
    let loaded = unsafe { LoadIconW(Some(hinstance), PCWSTR(1 as *const u16)) }
        .or_else(|_| unsafe { LoadIconW(Some(hinstance), IDI_APPLICATION) });
    match loaded {
        Ok(icon) => (icon, false),
        Err(e) => {
            log::warn!("tray balloon: no icon available: {e}");
            // A null hIcon is legal: the shell draws its own default.
            (HICON::default(), false)
        }
    }
}

/// Free an icon only if we allocated it. Shared icons outlive us and must be
/// left alone, or the tray loses its artwork for the rest of the session.
fn destroy_icon(icon: HICON, is_ours: bool) {
    if is_ours {
        let _ = unsafe { DestroyIcon(icon) };
    }
}

/// The frame in an .ico whose size is closest to `want` pixels, as the raw
/// RT_ICON bytes `CreateIconFromResourceEx` wants.
///
/// Pure and bounds-checked throughout, because this is the one place we parse
/// a binary asset by hand. An .ico is an ICONDIR (reserved, type, count)
/// followed by one 16-byte directory entry per frame: width and height in one
/// byte each (0 meaning 256), colour count, reserved, planes, bit depth, byte
/// length, and offset to the frame itself. Frames are stored back to back and
/// in no guaranteed order, so every one is validated before it is trusted.
fn icon_frame(ico: &[u8], want: u16) -> Option<&[u8]> {
    /// ICONDIR is a 6-byte header; each ICONDIRENTRY after it is 16.
    const DIR_HEADER: usize = 6;
    const DIR_ENTRY: usize = 16;
    /// ICONDIR.type for an icon file (a cursor is 2).
    const TYPE_ICON: u16 = 1;

    if ico.len() < DIR_HEADER {
        return None;
    }
    let u16_at = |o: usize| u16::from_le_bytes([ico[o], ico[o + 1]]);
    if u16_at(0) != 0 || u16_at(2) != TYPE_ICON {
        return None;
    }

    let mut best: Option<(u32, &[u8])> = None;
    for i in 0..usize::from(u16_at(4)) {
        let e = DIR_HEADER + i * DIR_ENTRY;
        let Some(entry) = ico.get(e..e + DIR_ENTRY) else {
            break;
        };
        let len = u32::from_le_bytes(entry[8..12].try_into().ok()?) as usize;
        let off = u32::from_le_bytes(entry[12..16].try_into().ok()?) as usize;
        // A frame must be non-empty and wholly inside the file, or the
        // offsets were never ours to trust.
        let Some(frame) = ico
            .get(off..off.checked_add(len)?)
            .filter(|f| !f.is_empty())
        else {
            continue;
        };
        // 0 in the directory means 256, the format's way of not fitting in a
        // byte.
        let width = if entry[0] == 0 {
            256u16
        } else {
            u16::from(entry[0])
        };
        let distance = u32::from(width.abs_diff(want));
        if best.is_none_or(|(d, _)| distance < d) {
            best = Some((distance, frame));
        }
    }
    best.map(|(_, frame)| frame)
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

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Graphics::Gdi::{DeleteObject, GetObjectW, BITMAP, HGDIOBJ};
    use windows::Win32::UI::WindowsAndMessaging::{GetIconInfo, ICONINFO};

    /// A minimal but valid .ico holding `sizes`, each frame one byte long.
    /// Enough to exercise the directory walk without the real 284 KB asset.
    /// Sizes are directory bytes, so 0 stands for 256.
    fn fake_ico(sizes: &[u8]) -> Vec<u8> {
        let count = sizes.len();
        let mut ico = vec![0, 0, 1, 0, count as u8, 0];
        let base = 6 + count * 16;
        for (i, &size) in sizes.iter().enumerate() {
            ico.extend_from_slice(&[size, size, 0, 0, 1, 0, 32, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
            let e = 6 + i * 16;
            let off = (base + i) as u32;
            ico[e + 12..e + 16].copy_from_slice(&off.to_le_bytes());
        }
        ico.resize(base + count, 0);
        ico
    }

    #[test]
    fn picks_the_frame_closest_to_the_wanted_size() {
        let ico = fake_ico(&[16, 32, 64, 0]);
        let base = 6 + 4 * 16;
        let at = |i: usize| Some(&ico[base + i..base + i + 1]);
        // 32 is an exact match even though 64 and 256 sit in the same file.
        assert_eq!(icon_frame(&ico, 32), at(1));
        // Nothing is 30px; 32 is still the nearest.
        assert_eq!(icon_frame(&ico, 30), at(1));
        // 0 in the directory is 256, not 0.
        assert_eq!(icon_frame(&ico, 250), at(3));
        // Nothing is 80px either; 64 and 256 are equally far, first wins.
        assert_eq!(icon_frame(&ico, 80), at(2));
    }

    #[test]
    fn refuses_anything_that_is_not_a_truncated_ico() {
        assert_eq!(icon_frame(&[], 32), None);
        assert_eq!(icon_frame(&[0, 0], 32), None);
        // Right size, wrong type: a cursor file (type 2).
        assert_eq!(icon_frame(&[0, 0, 2, 0, 1, 0], 32), None);
        // Claims a frame past the end of the file.
        let mut broken = fake_ico(&[32]);
        broken[6 + 12..6 + 16].copy_from_slice(&9_999u32.to_le_bytes());
        assert_eq!(icon_frame(&broken, 32), None);
        // Claims a frame that runs off the end.
        let mut overlong = fake_ico(&[32]);
        overlong[6 + 8..6 + 12].copy_from_slice(&9_999u32.to_le_bytes());
        assert_eq!(icon_frame(&overlong, 32), None);
        // A directory promising more entries than the file holds: the frames
        // already found are still usable.
        let mut truncated = fake_ico(&[32]);
        truncated[4..6].copy_from_slice(&9u16.to_le_bytes());
        assert_eq!(icon_frame(&truncated, 32), Some(&truncated[22..23]));
    }

    #[test]
    fn the_embedded_app_icon_has_a_usable_32px_frame() {
        // The real asset, not a fixture: a bad export here would ship a
        // notification with a blank square, and this is the only guard.
        let frame = icon_frame(APP_ICON_ICO, BALLOON_ICON_PX).expect("app icon frame");
        // Every frame starts with a BITMAPINFOHEADER: 40 bytes, and a
        // doubled height covering the colour and mask bitmaps.
        assert_eq!(u32::from_le_bytes(frame[0..4].try_into().unwrap()), 40);
        let width = i32::from_le_bytes(frame[4..8].try_into().unwrap());
        let height = i32::from_le_bytes(frame[8..12].try_into().unwrap());
        assert_eq!(width, 32);
        assert_eq!(height, 64, "colour bitmap plus 1-bit mask");
        assert_eq!(
            u16::from_le_bytes(frame[14..16].try_into().unwrap()),
            32,
            "bpp"
        );
    }

    #[test]
    fn the_embedded_icon_becomes_a_real_handle_at_the_size_we_ask_for() {
        // The end-to-end check a byte-layout test cannot give us: the shell
        // is the only authority on whether it will accept the frame. Runs in
        // the test process, whose exe has no resource 1, so if this passes
        // the icon genuinely came from the embedded .ico.
        let hinstance = unsafe { GetModuleHandleW(None) }.unwrap().into();
        let (icon, is_ours) = load_app_icon(hinstance);
        assert!(
            is_ours,
            "fell back to a shared icon instead of the app icon"
        );
        assert!(!icon.0.is_null(), "the shell returned no icon at all");

        // GetIconInfo hands back the two bitmaps the icon is made of; the
        // colour one carries the dimensions we asked for.
        let mut info = ICONINFO::default();
        unsafe { GetIconInfo(icon, &mut info) }.expect("the shell made no icon");
        assert!(info.fIcon.as_bool(), "a cursor, not an icon");
        assert!(!info.hbmColor.0.is_null(), "no colour bitmap");
        let mut bitmap = BITMAP::default();
        let read = unsafe {
            GetObjectW(
                HGDIOBJ(info.hbmColor.0),
                size_of::<BITMAP>() as i32,
                Some(&raw mut bitmap as *mut _ as *mut _),
            )
        };
        assert_eq!(read, size_of::<BITMAP>() as i32, "GetObjectW read nothing");
        assert_eq!(
            (bitmap.bmWidth, bitmap.bmHeight),
            (i32::from(BALLOON_ICON_PX), i32::from(BALLOON_ICON_PX)),
            "the shell gave back a different size than we requested"
        );
        assert_eq!(bitmap.bmBitsPixel, 32, "alpha channel dropped");

        for hbm in [info.hbmColor, info.hbmMask] {
            if !hbm.0.is_null() {
                let _ = unsafe { DeleteObject(HGDIOBJ(hbm.0)) };
            }
        }
        destroy_icon(icon, is_ours);
    }

    #[test]
    fn truncates_long_text_and_always_null_terminates() {
        let long = "x".repeat(400);
        let mut buf = [0xAAAAu16; 8];
        wide_into(&long, &mut buf);
        let x = b'x' as u16;
        assert_eq!(
            buf,
            [x, x, x, x, x, x, x, 0],
            "seven characters, then a NUL"
        );
        // Exactly filling the buffer leaves no room for the terminator.
        let mut buf = [0xAAAAu16; 4];
        wide_into("abcd", &mut buf);
        assert_eq!(buf, [b'a' as u16, b'b' as u16, b'c' as u16, 0]);
        // Non-ASCII past the cut must not split a surrogate pair in half.
        let mut buf = [0xAAAAu16; 3];
        wide_into("\u{1F600}ab", &mut buf);
        assert_eq!(buf, [0xD83D, 0xDE00, 0]);
    }
}
