
#[cfg(windows)]
const CORNER_ATTRIBUTE: u32 = 33;
#[cfg(windows)]
const CORNER_ROUND: i32 = 2;
#[cfg(windows)]
const BORDER_ATTRIBUTE: u32 = 34;
#[cfg(windows)]
const BORDER_NONE: i32 = 0xFFFF_FFFEu32 as i32;

#[cfg(windows)]
pub fn corner_attributes() -> [(u32, i32); 2] {
  [
    (CORNER_ATTRIBUTE, CORNER_ROUND),
    (BORDER_ATTRIBUTE, BORDER_NONE),
  ]
}

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
    let hr = unsafe {
      DwmSetWindowAttribute(hwnd, attribute, &value as *const i32 as *const _, 4)
    };
    if hr.is_err() {
      log::debug!("window chrome: DWM attribute {attr} rejected ({hr:?})");
    }
  }
}

#[cfg(not(windows))]
pub fn apply(_win: &tauri::WebviewWindow) {
  log::debug!("window chrome: unsupported platform, skipping");
}

#[cfg(all(test, windows))]
mod tests {
  use super::corner_attributes;

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

  #[test]
  fn corner_attributes_are_ordered_corner_then_border() {
    let attrs = corner_attributes();
    let corner = attrs.iter().position(|(id, _)| *id == 33);
    let border = attrs.iter().position(|(id, _)| *id == 34);
    assert!(corner.is_some() && border.is_some(), "both attributes present");
    assert!(corner < border, "corner must be written first");
  }
}
