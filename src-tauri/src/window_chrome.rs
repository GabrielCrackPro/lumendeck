//! Window chrome for the frameless dashboard.
//!
//! `decorations(false)` buys a window that matches the app's glass language,
//! but Windows only rounds the corners of a *decorated* window — take the
//! frame away and you get a hard-edged rectangle. That leaves the dashboard as
//! the one place its rounded panels meet a square corner, which is exactly
//! what you notice when the window sits on a bright desktop.
//!
//! The drop shadow is deliberately *not* handled here: tao keeps a hidden
//! frame for undecorated windows (`decoration_shadow` defaults to true) and
//! accounts for its insets when sizing, so the shadow is already there.
//! Extending a frame of our own would double that inset and shrink the
//! client area by a couple of pixels.
//!
//! Everything here is a hint to the Desktop Window Manager rather than a
//! requirement. On Windows 10 the corner attribute does not exist and is
//! rejected; with DWM disabled nothing is drawn at all. Either way the
//! dashboard is still a perfectly usable window, so failures are logged at
//! `debug` and swallowed.

/// `DWMWA_WINDOW_CORNER_PREFERENCE` — the attribute id Windows 11 reads to
/// decide how to round a window.
#[cfg(windows)]
const CORNER_ATTRIBUTE: u32 = 33;
/// `DWMWCP_ROUND` — the standard Windows 11 corner. Not `ROUNDSMALL`: the
/// dashboard's own panels are `radius-lg`, and matching the OS reads as
/// deliberate where a tighter radius reads as a mistake.
#[cfg(windows)]
const CORNER_ROUND: i32 = 2;
/// `DWMWA_BORDER_COLOR`.
#[cfg(windows)]
const BORDER_ATTRIBUTE: u32 = 34;
/// `DWMWA_COLOR_NONE` — suppress the hairline outline DWM otherwise paints
/// around a rounded window. Left alone it draws a 1px light edge that reads
/// as a seam against the dark panels.
#[cfg(windows)]
const BORDER_NONE: i32 = 0xFFFF_FFFEu32 as i32;

/// The DWM attributes this module writes, in the order `apply` maps them.
///
/// Exposed as a pure function so the mapping is unit-testable: these are raw
/// ids from a Windows 11-only ABI, and a typo fails *silently* on every
/// launch — no error, no warning above `debug`, just square corners. That is
/// precisely the kind of regression a test should catch.
#[cfg(windows)]
pub fn corner_attributes() -> [(u32, i32); 2] {
  [
    (CORNER_ATTRIBUTE, CORNER_ROUND),
    (BORDER_ATTRIBUTE, BORDER_NONE),
  ]
}

/// Round the dashboard window's corners and drop its border outline.
///
/// Call once, right after the window is built. Safe to call more than once.
#[cfg(windows)]
pub fn apply(win: &tauri::WebviewWindow) {
  use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE,
  };

  let Ok(hwnd) = win.hwnd() else {
    log::debug!("window chrome: no HWND, skipping corner rounding");
    return;
  };

  for (index, (attr, value)) in corner_attributes().into_iter().enumerate() {
    let attribute = if index == 0 {
      DWMWA_WINDOW_CORNER_PREFERENCE
    } else {
      DWMWA_BORDER_COLOR
    };
    // SAFETY: `hwnd` belongs to the live dashboard window and DWM reads
    // exactly four bytes from the value pointer, which outlives the call.
    let hr = unsafe {
      DwmSetWindowAttribute(hwnd, attribute, &value as *const i32 as *const _, 4)
    };
    if hr.is_err() {
      // Windows 10 has no corner preference. Expected, not a problem.
      log::debug!("window chrome: DWM attribute {attr} rejected ({hr:?})");
    }
  }
}

/// The crate refuses to compile off Windows, so this is unreachable in
/// practice; it exists so the call site in `lib.rs` stays unconditional and
/// the window setup does not fork per platform.
#[cfg(not(windows))]
pub fn apply(_win: &tauri::WebviewWindow) {
  log::debug!("window chrome: unsupported platform, skipping");
}

#[cfg(all(test, windows))]
mod tests {
  use super::corner_attributes;

  /// The ids and values are a raw ABI contract. If either number drifts, DWM
  /// rejects the attribute and the dashboard silently loses its corners.
  #[test]
  fn corner_attributes_target_dwm_corner_and_border_ids() {
    let attrs = corner_attributes();
    assert_eq!(
      attrs[0],
      (33, 2),
      "DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND"
    );
    assert_eq!(
      attrs[1],
      (34, 0xFFFF_FFFEu32 as i32),
      "DWMWA_BORDER_COLOR = DWMWA_COLOR_NONE"
    );
  }

  /// Corner first, border second. `apply` maps position to attribute id, so
  /// the order is load-bearing rather than cosmetic.
  #[test]
  fn corner_attributes_are_ordered_corner_then_border() {
    let attrs = corner_attributes();
    let corner = attrs.iter().position(|(id, _)| *id == 33);
    let border = attrs.iter().position(|(id, _)| *id == 34);
    assert!(corner.is_some() && border.is_some(), "both attributes present");
    assert!(corner < border, "corner must be written first");
  }
}
