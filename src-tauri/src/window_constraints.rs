//! The main window's size constraints, and what happens when a saved size
//! disagrees with them.
//!
//! The dashboard is frameless and restores its previous geometry through
//! `tauri-plugin-window-state`. That plugin re-applies the saved physical size
//! verbatim on launch (`restore_state` → `set_size`), and `WM_GETMINMAXINFO`
//! only constrains the sizes a *user* can drag to — nothing re-checks a size
//! the app itself sets. Two ways to break it:
//!
//! 1. The saved size predates a minimum-size increase (the minimum has only
//!    ever gone up), so an old, smaller window comes back smaller than the
//!    UI can lay out.
//! 2. The window is moved onto a monitor whose scale factor is higher than
//!    the one it was sized on. A size that was 900 logical px on a 1.0x
//!    display can be under 900 logical px on a 1.5x one after restore.
//!
//! So the constraints are enforced in three places, matching how established
//! apps handle this (Electron's `BrowserWindow` min bounds + window-state
//! clamping; Spotify and Discord ship hard minimums and squeeze their layout
//! inside them): the builder states the minimum, every resize past the
//! minimum is a no-op at the OS level, and — the part the OS cannot do —
//! anything *this app* sets is clamped to the minimum and to the monitor it
//! will land on before it is applied.
//!
//! Everything decision-shaped here is pure so it can be asserted without a
//! window; `lib.rs` owns the event plumbing.

/// The smallest window the UI is designed for, in logical pixels.
///
/// 900×640 is what the app has always claimed. The Overview collapses its
/// 12-column card grid below `xl` (1280 CSS px), so the two-column rows stack
/// one column narrower than the widest layout — tight but intentional. Below
/// this the status strip and transport rows wrap onto two lines and the
/// shortcuts card loses its key caps, which is the "window got so small it is
/// unusable" report this module exists to prevent.
pub const MIN_LOGICAL_WIDTH: f64 = 900.0;
pub const MIN_LOGICAL_HEIGHT: f64 = 640.0;

/// The size a machine with no saved window state starts from.
pub const DEFAULT_LOGICAL_WIDTH: f64 = 1100.0;
pub const DEFAULT_LOGICAL_HEIGHT: f64 = 760.0;

/// Slack between the window's outer rect and the monitor's work area before
/// the window counts as "partially off-screen".
///
/// Zero would treat a window whose edge exactly touches the taskbar as lost.
/// 8 px absorbs rounding from DPI conversion on both edges without ever
/// letting a genuinely off-screen window through.
pub const VISIBILITY_SLACK_PX: i32 = 8;

/// The builder constraints, in logical units. Stated once so the builder call
/// and the clamp cannot disagree about a number.
pub const fn min_inner_size() -> (f64, f64) {
    (MIN_LOGICAL_WIDTH, MIN_LOGICAL_HEIGHT)
}

/// A saved or computed size clamped to the minimum, in logical units.
///
/// `set_size` on a frameless window sets the *inner* size (tao resizes the
/// client area to what it is asked for), which is the same space the
/// constraints are declared in — so the clamp is a plain max against both
/// axes, and a size that is already legal comes back unchanged.
pub fn clamp_to_min(width: f64, height: f64) -> (f64, f64) {
    (
        width.max(MIN_LOGICAL_WIDTH),
        height.max(MIN_LOGICAL_HEIGHT),
    )
}

/// Whether an outer rect sits inside a monitor's work area, with slack.
///
/// `windowWithinBounds` from electron-window-state, less strict at the edges:
/// it required the whole window inside the display, which snaps a window
/// back that a user deliberately parked half onto a second monitor. Windows'
/// own convention (and the reason this exists at all) is that the window is
/// findable while any meaningful part of it is on-screen — so this asks
/// whether the window *intersects* the work area by more than the slack, not
/// whether it is contained.
pub fn visible_in_work_area(
    window: (i32, i32, u32, u32),
    work_area: (i32, i32, u32, u32),
) -> bool {
    let (wx, wy, ww, wh) = window;
    let (ax, ay, aw, ah) = work_area;
    if ww == 0 || wh == 0 || aw == 0 || ah == 0 {
        return false;
    }
    let overlap_x = (wx + ww as i32).min(ax + aw as i32) - wx.max(ax);
    let overlap_y = (wy + wh as i32).min(ay + ah as i32) - wy.max(ay);
    overlap_x > VISIBILITY_SLACK_PX && overlap_y > VISIBILITY_SLACK_PX
}

/// The decision for a saved size about to be restored, given the monitor it
/// will land on.
///
/// `Clamp` is the common case: a legal size that predates a minimum bump, or
/// one restored onto a higher-DPI monitor. `Defaults` means the state cannot
/// be honoured at all — it is empty, or it is invisible on every monitor,
/// which is the lost-window case electron-window-state resets for. Callers
/// that get `Defaults` should start the window fresh rather than guess at a
/// repair.
pub enum RestoredSize {
    /// Saved size is legal once clamped; the pair is in logical units.
    Clamp(f64, f64),
    /// Nothing usable was saved; start from the default size.
    Defaults,
}

/// What to do with a saved physical size and position at restore time.
///
/// `scale` is the scale factor of the monitor the window will land on —
/// `current_monitor()` after the position is set, the primary monitor's
/// before it. Physical pixels are what the state file stores and what
/// `set_size` takes, so the minimum travels through the scale factor rather
/// than being compared in the wrong space.
pub fn plan_restore(
    saved: Option<(u32, u32)>,
    position: Option<(i32, i32)>,
    scale: f64,
    work_area: (i32, i32, u32, u32),
) -> RestoredSize {
    let Some((w, h)) = saved else {
        return RestoredSize::Defaults;
    };
    if w == 0 || h == 0 {
        return RestoredSize::Defaults;
    }
    // A position with no monitor under it (unplugged second display, layout
    // change) is the other half of the lost-window case; the size is fine but
    // the window will be nowhere, so the whole state is discarded.
    if let Some((x, y)) = position {
        if !visible_in_work_area((x, y, w, h), work_area) {
            return RestoredSize::Defaults;
        }
    }
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    let (lw, lh) = clamp_to_min(w as f64 / scale, h as f64 / scale);
    RestoredSize::Clamp(lw, lh)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 0.001
    }

    #[test]
    fn min_matches_the_builder_claim() {
        // One number, stated once: if the builder's call and the clamp ever
        // disagree, the window can be dragged under the layout and the clamp
        // will then drag it back on the next launch — a window that fights
        // its user. This is the test that catches the disagreement.
        let (w, h) = min_inner_size();
        assert_eq!(w, MIN_LOGICAL_WIDTH);
        assert_eq!(h, MIN_LOGICAL_HEIGHT);
    }

    #[test]
    fn legal_sizes_pass_through_the_clamp_unchanged() {
        let (w, h) = clamp_to_min(1100.0, 760.0);
        assert!(close(w, 1100.0) && close(h, 760.0));
    }

    #[test]
    fn a_saved_size_older_than_the_minimum_is_brought_up_to_it() {
        // The historical case: 800×560 was legal before the minimum rose,
        // and the state plugin would have restored it verbatim forever.
        let (w, h) = clamp_to_min(800.0, 560.0);
        assert!(close(w, MIN_LOGICAL_WIDTH) && close(h, MIN_LOGICAL_HEIGHT));
        // One axis small, one fine: each axis clamps on its own.
        let (w, h) = clamp_to_min(1200.0, 500.0);
        assert!(close(w, 1200.0) && close(h, MIN_LOGICAL_HEIGHT));
    }

    #[test]
    fn a_rect_contained_in_the_work_area_is_visible() {
        assert!(visible_in_work_area((100, 100, 900, 600), (0, 0, 1920, 1040)));
    }

    #[test]
    fn a_rect_off_the_right_edge_is_not() {
        // The "window opened somewhere I cannot see it" case: every pixel of
        // it is past the monitor's right edge.
        assert!(!visible_in_work_area(
            (2000, 100, 900, 600),
            (0, 0, 1920, 1040)
        ));
    }

    #[test]
    fn a_window_parked_half_on_a_second_screen_survives() {
        // Stricter tools reset a window that is half off-display; that would
        // fight a user who deliberately straddles two monitors. Overlap with
        // real area on the work area is the test, not containment.
        assert!(visible_in_work_area(
            (1500, 100, 900, 600),
            (0, 0, 1920, 1040)
        ));
    }

    #[test]
    fn a_one_pixel_sliver_does_not_count_as_visible() {
        // Slack absorbs edge rounding; it must not rescue a window whose
        // entire presence on the monitor is the rounding itself.
        assert!(!visible_in_work_area(
            (1915, 100, 900, 600),
            (0, 0, 1920, 1040)
        ));
    }

    #[test]
    fn no_saved_state_means_defaults() {
        assert!(matches!(
            plan_restore(None, Some((0, 0)), 1.0, (0, 0, 1920, 1040)),
            RestoredSize::Defaults
        ));
    }

    #[test]
    fn a_position_off_every_monitor_discards_the_whole_state() {
        // Size alone was fine, but the window would open in the void —
        // clamping the size without looking at the position is how a
        // "restored" window still ends up unfindable.
        assert!(matches!(
            plan_restore(
                Some((1100, 760)),
                Some((5000, -800)),
                1.0,
                (0, 0, 1920, 1040)
            ),
            RestoredSize::Defaults
        ));
    }

    #[test]
    fn restore_clamps_through_the_monitor_scale_factor() {
        // 810 physical px on a 1.5x display is 540 logical — under the
        // minimum even though the raw number looks large. Comparing in
        // physical pixels here is the mistake this test pins.
        match plan_restore(Some((810, 600)), Some((0, 0)), 1.5, (0, 0, 1920, 1040)) {
            RestoredSize::Clamp(w, h) => {
                assert!(close(w, MIN_LOGICAL_WIDTH), "{w}");
                assert!(close(h, MIN_LOGICAL_HEIGHT), "{h}");
            }
            RestoredSize::Defaults => panic!("a visible legal state must not be discarded"),
        }
    }

    #[test]
    fn restore_leaves_a_legal_size_alone() {
        match plan_restore(
            Some((1100, 760)),
            Some((10, 10)),
            1.0,
            (0, 0, 1920, 1040),
        ) {
            RestoredSize::Clamp(w, h) => {
                assert!(close(w, 1100.0) && close(h, 760.0));
            }
            RestoredSize::Defaults => panic!("legal state discarded"),
        }
    }

    #[test]
    fn a_zero_saved_size_is_not_a_state() {
        assert!(matches!(
            plan_restore(Some((0, 0)), Some((0, 0)), 1.0, (0, 0, 1920, 1040)),
            RestoredSize::Defaults
        ));
    }
}