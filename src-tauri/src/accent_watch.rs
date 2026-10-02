// Deciding whether an observed accent change is real.
//
// The bug this fixes: LumenDeck writes the Windows accent to follow the
// wallpaper, then polls the registry every three seconds to notice when *the
// user* changes it. The poll cannot tell its own write from a user's — so every
// write was immediately reported back as a change, re-theming the dashboard
// off LumenDeck's own output and logging two lines for one event. 1,511 of
// ~4,900 lines in a real log were this echo.
//
// The fix is bookkeeping, not timing: remember what we last wrote, and treat an
// observed value equal to that as our own echo rather than a user change.
//
// Note this is deliberately NOT a "recently wrote, so ignore everything"
// window. A time-based suppression would swallow a genuine user change that
// happened to land in the same window — the user picking an accent that happens
// to match what we picked. Comparing values has no such failure mode.

/// What the watcher should do with an accent it just read from the registry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccentVerdict {
    /// First observation, or nothing to do. Seed `last_seen`, stay quiet.
    Unchanged,
    /// The user changed it. Worth an event and a log line.
    Emit,
    /// We changed it. Silence, but remember it so the next poll is quiet too.
    OurOwnWrite,
}

/// Tracks the last accent seen and the last accent written, and decides which
/// of the two an observation is.
#[derive(Debug, Default, Clone, Copy)]
pub struct AccentWatch {
    /// What the last poll returned.
    last_seen: Option<[u8; 3]>,
}

impl AccentWatch {
    pub fn new() -> Self {
        Self::default()
    }

    /// A poll returned `observed`. Decides what it means.
    ///
    /// `ours` is the last value this process wrote to the registry, or `None`
    /// if it has never written one. Passed in rather than tracked here because
    /// the write happens on the sampling thread and the poll on the watcher
    /// thread — the watcher reads what the writer recorded, so there is exactly
    /// one record of it rather than one per thread.
    pub fn observe(&mut self, observed: Option<[u8; 3]>, ours: Option<[u8; 3]>) -> AccentVerdict {
        let Some(rgb) = observed else {
            // The read failed. Not a change, and definitely not something to
            // act on — reporting a failure as a user edit would blank the UI.
            return AccentVerdict::Unchanged;
        };
        if self.last_seen == Some(rgb) {
            return AccentVerdict::Unchanged;
        }
        self.last_seen = Some(rgb);
        if ours == Some(rgb) {
            // This is the value we put there. Recording it as seen is what
            // makes the *next* poll quiet as well.
            AccentVerdict::OurOwnWrite
        } else {
            AccentVerdict::Emit
        }
    }

    /// Seed from the value already in the registry at startup, so the first
    /// poll does not report the pre-existing accent as a change.
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
        // The regression: we write, the poll sees it, and it must not come back
        // as a user change.
        let mut w = AccentWatch::new();
        assert_eq!(w.observe(Some(OURS), Some(OURS)), AccentVerdict::OurOwnWrite);
    }

    #[test]
    fn the_poll_after_an_echo_is_quiet_too() {
        // The echo has to be recorded as seen, or every subsequent poll
        // re-reports the same value forever.
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
        // The case a time-based suppression window would get wrong. We wrote
        // OURS, the registry drifted to something else, and the user then
        // deliberately picks OURS. Passing `None` for "ours" is what the writer
        // does when sync is off, so this is reachable — and it is reported.
        // Being noisy here is the safe direction; swallowing a user edit is not.
        let mut w = AccentWatch::new();
        assert_eq!(w.observe(Some([1, 2, 3]), None), AccentVerdict::Emit);
        assert_eq!(w.observe(Some(OURS), None), AccentVerdict::Emit);
    }

    #[test]
    fn a_failed_registry_read_is_not_reported_as_a_change() {
        // A transient read failure must not blank the dashboard's accent.
        let mut w = AccentWatch::new();
        let _ = w.observe(Some(OURS), Some(OURS));
        assert_eq!(w.observe(None, Some(OURS)), AccentVerdict::Unchanged);
    }

    #[test]
    fn seeding_at_startup_stops_the_existing_accent_being_reported() {
        // Without this, every launch reports the user's current accent as a
        // change on the first poll.
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
        // The OS can reject an accent write (policy, a racing Settings app).
        // We recorded it as ours, the registry kept the old value, and the next
        // poll sees something we never wrote — that must be reported.
        let mut w = AccentWatch::new();
        assert_eq!(w.observe(Some(THEIRS), Some(OURS)), AccentVerdict::Emit);
        assert_eq!(w.observe(Some(THEIRS), Some(OURS)), AccentVerdict::Unchanged);
    }

    #[test]
    fn a_value_we_never_wrote_is_an_emit_even_with_no_recorded_write() {
        // Sync disabled for the whole run: there is no recorded write, so every
        // genuine user change flows through as an Emit.
        let mut w = AccentWatch::new();
        assert_eq!(w.observe(Some(THEIRS), None), AccentVerdict::Emit);
        assert_eq!(w.observe(Some([9, 9, 9]), None), AccentVerdict::Emit);
    }
}
