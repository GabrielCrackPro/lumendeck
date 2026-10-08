
pub const ORIG_LOCK_SCREEN_VALUE: &str = "LumenDeckOriginalLockScreen";

pub const LOCK_SCREEN_IMAGE_VALUE: &str = "LockScreenImage";

pub const LOCK_SCREEN_TYPE_VALUE: &str = "LockScreenImageType";

#[derive(Debug, PartialEq, Eq)]
pub enum LockScreenPlan {
    Leave,
    Adopt { image: String, backup: Option<String> },
    Release { original: Option<String> },
}

#[derive(Debug, PartialEq, Eq)]
pub struct LockScreenState {
    pub follows_wallpaper: bool,
    pub current: Option<String>,
    pub backup: Option<String>,
    pub current_is_ours: bool,
}

pub fn same_path(a: &str, b: &str) -> bool {
    fn norm(s: &str) -> String {
        s.trim()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_ascii_lowercase()
    }
    norm(a) == norm(b)
}

pub fn plan(state: &LockScreenState, image: &str) -> LockScreenPlan {
    if state.follows_wallpaper {
        if state.current_is_ours
            && same_path(state.current.as_deref().unwrap_or_default(), image)
        {
            return LockScreenPlan::Leave;
        }
        let backup = if state.current_is_ours {
            state.backup.clone()
        } else {
            state.current.clone()
        };
        return LockScreenPlan::Adopt {
            image: image.to_string(),
            backup,
        };
    }
    if state.current_is_ours {
        return LockScreenPlan::Release {
            original: state.backup.clone(),
        };
    }
    LockScreenPlan::Leave
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ours() -> String {
        r"C:\Users\Someone\AppData\Roaming\LumenDeck\wallpaper-bg.jpg".to_string()
    }

    fn ours_two() -> String {
        r"C:\Users\Someone\AppData\Roaming\LumenDeck\wallpaper-bg-2.jpg".to_string()
    }

    fn theirs() -> String {
        r"C:\Users\Someone\Pictures\cat.jpg".to_string()
    }

    fn state(
        follows_wallpaper: bool,
        current: Option<&str>,
        backup: Option<&str>,
        current_is_ours: bool,
    ) -> LockScreenState {
        LockScreenState {
            follows_wallpaper,
            current: current.map(str::to_string),
            backup: backup.map(str::to_string),
            current_is_ours,
        }
    }

    #[test]
    fn an_untouched_off_lock_screen_is_left_alone() {
        assert_eq!(
            plan(&state(false, Some(&theirs()), None, false), &ours()),
            LockScreenPlan::Leave
        );
        assert_eq!(
            plan(&state(false, None, None, false), &ours()),
            LockScreenPlan::Leave
        );
    }

    #[test]
    fn turning_the_toggle_off_releases_what_we_wrote() {
        match plan(&state(false, Some(&ours()), None, true), &ours()) {
            LockScreenPlan::Release { original } => assert!(original.is_none()),
            other => panic!("expected Release, got {other:?}"),
        }
    }

    #[test]
    fn turning_the_toggle_off_restores_the_users_image_when_we_have_one() {
        match plan(&state(false, Some(&ours()), Some(&theirs()), true), &ours()) {
            LockScreenPlan::Release { original } => assert_eq!(original.as_deref(), Some(theirs().as_str())),
            other => panic!("expected Release, got {other:?}"),
        }
    }

    #[test]
    fn a_disabled_lock_screen_that_is_theirs_is_not_released() {
        assert_eq!(
            plan(&state(false, Some(&theirs()), None, false), &ours()),
            LockScreenPlan::Leave
        );
    }

    #[test]
    fn enabling_stashes_the_users_image_before_overwriting_it() {
        match plan(&state(true, Some(&theirs()), None, false), &ours()) {
            LockScreenPlan::Adopt { image, backup } => {
                assert_eq!(backup.as_deref(), Some(theirs().as_str()));
                assert_eq!(image, ours());
            }
            other => panic!("expected Adopt, got {other:?}"),
        }
    }

    #[test]
    fn enabling_with_no_existing_value_has_nothing_to_stash() {
        match plan(&state(true, None, None, false), &ours()) {
            LockScreenPlan::Adopt { backup, .. } => assert!(backup.is_none()),
            other => panic!("expected Adopt, got {other:?}"),
        }
    }

    #[test]
    fn rewriting_with_a_different_file_never_stashes_our_own_path() {
        match plan(&state(true, Some(&ours()), Some(&theirs()), true), &ours_two()) {
            LockScreenPlan::Adopt { backup, .. } => assert_eq!(backup.as_deref(), Some(theirs().as_str())),
            other => panic!("expected Adopt, got {other:?}"),
        }
    }

    #[test]
    fn installing_the_image_already_shown_does_nothing() {
        assert_eq!(
            plan(&state(true, Some(&ours()), Some(&theirs()), true), &ours()),
            LockScreenPlan::Leave
        );
        match plan(&state(true, Some(&ours()), Some(&theirs()), true), &ours_two()) {
            LockScreenPlan::Adopt { backup, .. } => {
                assert_eq!(backup.as_deref(), Some(theirs().as_str()))
            }
            other => panic!("expected Adopt, got {other:?}"),
        }
    }

    #[test]
    fn paths_compare_case_insensitively_across_separators() {
        assert!(same_path(
            r"C:\Users\Me\wallpaper-bg.jpg",
            "c:/users/me/WALLPAPER-BG.JPG"
        ));
        assert!(same_path(r"C:\a\b\", r"C:\a\b"));
        assert!(same_path("  C:\\a\\b.jpg  ", r"C:\a\b.jpg"));
        assert!(!same_path(r"C:\a\b.jpg", r"C:\a\c.jpg"));
        assert!(!same_path("", r"C:\a\b.jpg"));
    }

    #[test]
    fn a_rewritten_path_is_recognised_as_ours_even_with_different_case() {
        let mut s = state(false, Some(&ours()), None, false);
        s.current_is_ours = same_path(s.current.as_deref().unwrap(), &ours());
        assert!(s.current_is_ours);
        assert!(matches!(
            plan(&s, &ours()),
            LockScreenPlan::Release { .. }
        ));
    }
}
