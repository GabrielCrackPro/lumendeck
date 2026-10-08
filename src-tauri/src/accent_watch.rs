
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccentVerdict {
    Unchanged,
    Emit,
    OurOwnWrite,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct AccentWatch {
    last_seen: Option<[u8; 3]>,
}

impl AccentWatch {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn observe(&mut self, observed: Option<[u8; 3]>, ours: Option<[u8; 3]>) -> AccentVerdict {
        let Some(rgb) = observed else {
            return AccentVerdict::Unchanged;
        };
        if self.last_seen == Some(rgb) {
            return AccentVerdict::Unchanged;
        }
        self.last_seen = Some(rgb);
        if ours == Some(rgb) {
            AccentVerdict::OurOwnWrite
        } else {
            AccentVerdict::Emit
        }
    }

    pub fn seed(&mut self, rgb: Option<[u8; 3]>) {
        self.last_seen = rgb;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OURS: [u8; 3] = [90, 77, 117];
    const THEIRS: [u8; 3] = [12, 200, 88];

    #[test]
    fn the_first_poll_after_our_write_is_recognised_as_an_echo() {
        let mut w = AccentWatch::new();
        assert_eq!(w.observe(Some(OURS), Some(OURS)), AccentVerdict::OurOwnWrite);
    }

    #[test]
    fn the_poll_after_an_echo_is_quiet_too() {
        let mut w = AccentWatch::new();
        let _ = w.observe(Some(OURS), Some(OURS));
        assert_eq!(w.observe(Some(OURS), Some(OURS)), AccentVerdict::Unchanged);
    }

    #[test]
    fn a_genuine_user_change_is_still_emitted() {
        let mut w = AccentWatch::new();
        let _ = w.observe(Some(OURS), Some(OURS));
        assert_eq!(w.observe(Some(THEIRS), Some(OURS)), AccentVerdict::Emit);
    }

    #[test]
    fn a_user_change_to_our_own_last_value_is_still_emitted() {
        let mut w = AccentWatch::new();
        assert_eq!(w.observe(Some([1, 2, 3]), None), AccentVerdict::Emit);
        assert_eq!(w.observe(Some(OURS), None), AccentVerdict::Emit);
    }

    #[test]
    fn a_failed_registry_read_is_not_reported_as_a_change() {
        let mut w = AccentWatch::new();
        let _ = w.observe(Some(OURS), Some(OURS));
        assert_eq!(w.observe(None, Some(OURS)), AccentVerdict::Unchanged);
    }

    #[test]
    fn seeding_at_startup_stops_the_existing_accent_being_reported() {
        let mut w = AccentWatch::new();
        w.seed(Some(THEIRS));
        assert_eq!(w.observe(Some(THEIRS), None), AccentVerdict::Unchanged);
    }

    #[test]
    fn an_unseeded_first_poll_still_emits_so_a_real_change_is_not_lost() {
        let mut w = AccentWatch::new();
        assert_eq!(w.observe(Some(THEIRS), None), AccentVerdict::Emit);
    }

    #[test]
    fn a_write_that_never_lands_does_not_poison_later_polls() {
        let mut w = AccentWatch::new();
        assert_eq!(w.observe(Some(THEIRS), Some(OURS)), AccentVerdict::Emit);
        assert_eq!(w.observe(Some(THEIRS), Some(OURS)), AccentVerdict::Unchanged);
    }

    #[test]
    fn a_value_we_never_wrote_is_an_emit_even_with_no_recorded_write() {
        let mut w = AccentWatch::new();
        assert_eq!(w.observe(Some(THEIRS), None), AccentVerdict::Emit);
        assert_eq!(w.observe(Some([9, 9, 9]), None), AccentVerdict::Emit);
    }
}
