// Deciding whether a quiet capture loop is silent or broken.
//
// The bug this exists to fix: the capture loop treated an empty sample queue
// as a fatal error. When nothing is playing — which is most of the time on a
// normal machine — the queue stayed empty, the one-second event wait timed out,
// the code logged a warning, stopped the stream, and returned. The supervisor
// two functions up then slept two seconds and built the entire WASAPI capture
// graph again. Forever. 389 times in a 26-hour log on an idle desktop.
//
// Silence is not a failure. A WASAPI render-device loopback emits nothing while
// no application is playing audio, so "no data" is the *expected* steady state,
// not a signal that anything is wrong.
//
// The subtlety is that a genuinely removed or disabled device also produces no
// data, and that case does need to be recovered from. Distinguishing the two by
// "no data" alone is impossible, so this is a grace period: keep waiting, and
// only give up after a genuinely long silence. The trade is deliberate — a
// device unplugged while music is playing recovers after the grace period
// instead of immediately, which is a delay nobody will ever notice, in exchange
// for not rebuilding an audio graph every three seconds for the other 23 hours
// of the day.

/// Consecutive silent polls tolerated before the loop gives up.
///
/// Each poll is one second of waiting, so this is also "seconds of silence
/// before we assume the device is gone". Long enough to cover a pause between
/// tracks, an alt-tab to a video call, or a device that is present but idle.
/// Short enough that a real unplug still recovers without the user filing a
/// bug about audio-reactive lighting.
pub const SILENCE_POLLS_BEFORE_GIVE_UP: u32 = 120;

/// What the capture loop should do after a poll produced no samples.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnSilence {
    /// Nothing is playing. Wait for the next period.
    KeepWaiting,
    /// Nothing at all for a long time. The device is probably gone; tear the
    /// capture down so the supervisor can rebuild it.
    GiveUp,
}

/// Counts consecutive silent polls, so the caller can tell a pause from a
/// device that has stopped existing.
///
/// Kept separate from the capture loop so the decision is testable. There is
/// no audio device in CI, and "does the loop survive an idle machine" is
/// exactly the question a test cannot otherwise answer.
#[derive(Debug, Default, Clone, Copy)]
pub struct SilenceWatch {
    consecutive: u32,
}

impl SilenceWatch {
    pub fn new() -> Self {
        Self::default()
    }

    /// A poll came back empty. Returns what to do about it.
    pub fn on_silence(&mut self) -> OnSilence {
        // Saturating: a counter that wrapped would reset the grace period and
        // let a dead device run forever.
        self.consecutive = self.consecutive.saturating_add(1);
        if self.consecutive >= SILENCE_POLLS_BEFORE_GIVE_UP {
            OnSilence::GiveUp
        } else {
            OnSilence::KeepWaiting
        }
    }

    /// Audio arrived. The grace period starts again.
    pub fn on_audio(&mut self) {
        self.consecutive = 0;
    }

    /// How many silent polls in a row. For the log line that explains a give-up.
    pub fn consecutive(&self) -> u32 {
        self.consecutive
    }

    /// Whether any silence has been seen at all, so the loop can log the first
    /// quiet period once instead of on every poll.
    pub fn is_silent(&self) -> bool {
        self.consecutive > 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_single_silent_poll_keeps_waiting() {
        // The regression, stated as a test: one empty queue must not end the
        // stream. Before, this returned GiveUp on the first call.
        let mut w = SilenceWatch::new();
        assert_eq!(w.on_silence(), OnSilence::KeepWaiting);
    }

    #[test]
    fn silence_shorter_than_the_grace_period_never_gives_up() {
        // Covers the gap between two tracks, and an app that buffers before
        // playing. Every one of these polls used to be a full teardown.
        let mut w = SilenceWatch::new();
        for _ in 0..(SILENCE_POLLS_BEFORE_GIVE_UP - 1) {
            assert_eq!(w.on_silence(), OnSilence::KeepWaiting);
        }
    }

    #[test]
    fn a_long_silence_gives_up_so_a_removed_device_recovers() {
        // The other half of the trade: silence forever means the device is gone
        // and the graph has to be rebuilt, or audio-reactive lighting stays
        // dead until the app restarts.
        let mut w = SilenceWatch::new();
        for _ in 0..(SILENCE_POLLS_BEFORE_GIVE_UP - 1) {
            let _ = w.on_silence();
        }
        assert_eq!(w.on_silence(), OnSilence::GiveUp);
    }

    #[test]
    fn audio_resets_the_grace_period() {
        // A device that hiccups for a minute and comes back must not be one
        // more poll from being torn down.
        let mut w = SilenceWatch::new();
        for _ in 0..(SILENCE_POLLS_BEFORE_GIVE_UP - 5) {
            let _ = w.on_silence();
        }
        w.on_audio();
        for _ in 0..(SILENCE_POLLS_BEFORE_GIVE_UP - 1) {
            assert_eq!(w.on_silence(), OnSilence::KeepWaiting);
        }
    }

    #[test]
    fn the_counter_does_not_wrap_into_permanent_silence() {
        // A u32 wrap at ~4 billion seconds would reset the grace period and
        // turn a dead device into an infinite loop. Saturating add is the whole
        // point of this test.
        let mut w = SilenceWatch::new();
        for _ in 0..10_000 {
            let _ = w.on_silence();
        }
        assert_eq!(w.consecutive(), 10_000);
        assert_eq!(w.on_silence(), OnSilence::GiveUp);
    }

    #[test]
    fn a_fresh_watch_has_not_been_silent() {
        let w = SilenceWatch::new();
        assert!(!w.is_silent());
        assert_eq!(w.consecutive(), 0);
    }

    #[test]
    fn silence_is_reported_once_the_first_time_it_happens() {
        // Drives the "went quiet" log line, so the log records the transition
        // into silence rather than one line per poll.
        let mut w = SilenceWatch::new();
        assert!(!w.is_silent());
        let _ = w.on_silence();
        assert!(w.is_silent());
        let _ = w.on_silence();
        assert!(w.is_silent());
    }

    #[test]
    fn the_grace_period_is_long_enough_to_survive_an_idle_machine() {
        // Two minutes of wall clock. Asserted because the number is the whole
        // design: a shorter one reintroduces the teardown storm on a quiet
        // desktop, a longer one delays recovery from an unplugged device.
        assert_eq!(SILENCE_POLLS_BEFORE_GIVE_UP, 120);
    }
}
