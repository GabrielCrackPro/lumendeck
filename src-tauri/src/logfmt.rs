
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WallClock {
    pub year: u64,
    pub month: u64,
    pub day: u64,
    pub hour: u64,
    pub minute: u64,
    pub second: u64,
    pub millis: u64,
}

pub fn timestamp(c: &WallClock) -> String {
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
        c.year, c.month, c.day, c.hour, c.minute, c.second, c.millis
    )
}

pub fn rotation_marker() -> String {
    "[--------- log rotated here ---------]".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clock(y: u64, mo: u64, d: u64, h: u64, mi: u64, s: u64, ms: u64) -> WallClock {
        WallClock { year: y, month: mo, day: d, hour: h, minute: mi, second: s, millis: ms }
    }

    #[test]
    fn the_stamp_is_year_first_and_zero_padded() {
        assert_eq!(
            timestamp(&clock(2026, 10, 2, 9, 5, 3, 7)),
            "2026-10-02 09:05:03.007"
        );
    }

    #[test]
    fn every_field_keeps_its_width_so_columns_stay_aligned() {
        let a = timestamp(&clock(2026, 1, 2, 3, 4, 5, 6));
        let b = timestamp(&clock(2026, 11, 12, 13, 14, 15, 16));
        assert_eq!(a.len(), b.len(), "{a} vs {b}");
        assert_eq!(a, "2026-01-02 03:04:05.006");
        assert_eq!(b, "2026-11-12 13:14:15.016");
    }

    #[test]
    fn a_midnight_stamp_does_not_borrow_from_the_day() {
        assert_eq!(
            timestamp(&clock(2026, 10, 2, 0, 0, 0, 0)),
            "2026-10-02 00:00:00.000"
        );
    }

    #[test]
    fn the_leap_day_formats_like_any_other_day() {
        assert_eq!(
            timestamp(&clock(2028, 2, 29, 12, 30, 15, 250)),
            "2028-02-29 12:30:15.250"
        );
    }

    #[test]
    fn the_rotation_marker_cannot_be_mistaken_for_a_record() {
        let marker = rotation_marker();
        assert!(!marker.contains("2026"));
        assert!(!marker.contains("INFO"));
        assert!(!marker.contains("WARN"));
        assert!(marker.starts_with('[') && marker.ends_with(']'));
    }

    #[test]
    fn the_marker_is_stable_so_a_reader_can_pattern_on_it() {
        assert_eq!(rotation_marker(), "[--------- log rotated here ---------]");
    }
}
