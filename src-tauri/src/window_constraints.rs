
pub const MIN_LOGICAL_WIDTH: f64 = 900.0;
pub const MIN_LOGICAL_HEIGHT: f64 = 640.0;

pub const DEFAULT_LOGICAL_WIDTH: f64 = 1100.0;
pub const DEFAULT_LOGICAL_HEIGHT: f64 = 760.0;

pub const VISIBILITY_SLACK_PX: i32 = 8;

pub const fn min_inner_size() -> (f64, f64) {
    (MIN_LOGICAL_WIDTH, MIN_LOGICAL_HEIGHT)
}

pub fn clamp_to_min(width: f64, height: f64) -> (f64, f64) {
    (
        width.max(MIN_LOGICAL_WIDTH),
        height.max(MIN_LOGICAL_HEIGHT),
    )
}

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

pub enum RestoredSize {
    Clamp(f64, f64),
    Defaults,
}

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
        let (w, h) = clamp_to_min(800.0, 560.0);
        assert!(close(w, MIN_LOGICAL_WIDTH) && close(h, MIN_LOGICAL_HEIGHT));
        let (w, h) = clamp_to_min(1200.0, 500.0);
        assert!(close(w, 1200.0) && close(h, MIN_LOGICAL_HEIGHT));
    }

    #[test]
    fn a_rect_contained_in_the_work_area_is_visible() {
        assert!(visible_in_work_area((100, 100, 900, 600), (0, 0, 1920, 1040)));
    }

    #[test]
    fn a_rect_off_the_right_edge_is_not() {
        assert!(!visible_in_work_area(
            (2000, 100, 900, 600),
            (0, 0, 1920, 1040)
        ));
    }

    #[test]
    fn a_window_parked_half_on_a_second_screen_survives() {
        assert!(visible_in_work_area(
            (1500, 100, 900, 600),
            (0, 0, 1920, 1040)
        ));
    }

    #[test]
    fn a_one_pixel_sliver_does_not_count_as_visible() {
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