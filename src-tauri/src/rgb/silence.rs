
pub const SILENCE_POLLS_BEFORE_GIVE_UP: u32 = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnSilence {
    KeepWaiting,
    GiveUp,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SilenceWatch {
    consecutive: u32,
}

impl SilenceWatch {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn on_silence(&mut self) -> OnSilence {
        self.consecutive = self.consecutive.saturating_add(1);
        if self.consecutive >= SILENCE_POLLS_BEFORE_GIVE_UP {
            OnSilence::GiveUp
        } else {
            OnSilence::KeepWaiting
        }
    }

    pub fn on_audio(&mut self) {
        self.consecutive = 0;
    }

    pub fn consecutive(&self) -> u32 {
        self.consecutive
    }

    pub fn is_silent(&self) -> bool {
        self.consecutive > 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_single_silent_poll_keeps_waiting() {
        let mut w = SilenceWatch::new();
        assert_eq!(w.on_silence(), OnSilence::KeepWaiting);
    }

    #[test]
    fn silence_shorter_than_the_grace_period_never_gives_up() {
        let mut w = SilenceWatch::new();
        for _ in 0..(SILENCE_POLLS_BEFORE_GIVE_UP - 1) {
            assert_eq!(w.on_silence(), OnSilence::KeepWaiting);
        }
    }

    #[test]
    fn a_long_silence_gives_up_so_a_removed_device_recovers() {
        let mut w = SilenceWatch::new();
        for _ in 0..(SILENCE_POLLS_BEFORE_GIVE_UP - 1) {
            let _ = w.on_silence();
        }
        assert_eq!(w.on_silence(), OnSilence::GiveUp);
    }

    #[test]
    fn audio_resets_the_grace_period() {
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
        let mut w = SilenceWatch::new();
        assert!(!w.is_silent());
        let _ = w.on_silence();
        assert!(w.is_silent());
        let _ = w.on_silence();
        assert!(w.is_silent());
    }

    #[test]
    fn the_grace_period_is_long_enough_to_survive_an_idle_machine() {
        assert_eq!(SILENCE_POLLS_BEFORE_GIVE_UP, 120);
    }
}
