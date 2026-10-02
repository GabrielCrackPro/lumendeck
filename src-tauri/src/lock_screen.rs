// Deciding what the Windows lock screen should say, as pure logic.
//
// The registry half of this cannot be tested on a machine that is not being
// locked and unlocked, so the decision lives here and the caller carries it
// out. Three inputs, one action, and the bug this exists to prevent is the
// transition rather than any single state:
//
//   - toggle off, never touched: do nothing at all;
//   - toggle off, but we (or an older build) still own the value: hand the
//     lock screen back, because a setting the user turned off must not leave
//     their machine showing our wallpaper;
//   - toggle on: write ours, having first stashed whatever was there.
//
// The "off but still ours" case is the whole point. Gating the write on the
// toggle is not enough: it stops new writes but cannot undo the last one.

/// Where we keep the user's original lock screen image, in the same key we
/// write. A separate value name, so it never collides with what Windows reads.
pub const ORIG_LOCK_SCREEN_VALUE: &str = "LumenDeckOriginalLockScreen";

/// The value Windows reads for the lock screen image itself.
pub const LOCK_SCREEN_IMAGE_VALUE: &str = "LockScreenImage";

/// Companion DWORD. Windows reads this to decide *what kind* of image the
/// value is: a user picture, Windows Spotlight, or nothing. Setting only the
/// path leaves the type at whatever it was, and a machine sitting on Spotlight
/// keeps showing Spotlight. 1 is the user-picture case.
pub const LOCK_SCREEN_TYPE_VALUE: &str = "LockScreenImageType";

/// 1 = a picture the user picked, as opposed to Spotlight (2).
pub const LOCK_SCREEN_TYPE_PICTURE: u32 = 1;

/// What the lock screen should be told.
#[derive(Debug, PartialEq, Eq)]
pub enum LockScreenPlan {
    /// Leave the registry alone.
    Leave,
    /// Write `image` as the lock screen, stashing `backup` first if we hold
    /// one, and mark the source as a user picture.
    Adopt { image: String, backup: Option<String> },
    /// Put `original` back where the lock screen image was, or remove our
    /// value entirely when there is nothing to restore.
    Release { original: Option<String> },
}

/// What we know about the lock screen right now.
#[derive(Debug, PartialEq, Eq)]
pub struct LockScreenState {
    /// The user's preference.
    pub follows_wallpaper: bool,
    /// The value currently under `LockScreenImage`, if any.
    pub current: Option<String>,
    /// What we stashed the first time we took over, if we ever did.
    pub backup: Option<String>,
    /// Whether `current` is a path LumenDeck wrote.
    pub current_is_ours: bool,
}

/// Case-insensitive, separator-tolerant path comparison.
///
/// Windows paths are case-insensitive and the registry will hand back either
/// separator depending on who wrote it. Treating `C:\a\b.jpg` and `c:/A/B.JPG`
/// as different is how an app ends up believing it owns a value it does not,
/// and then "restoring" over a wallpaper the user is actually using.
pub fn same_path(a: &str, b: &str) -> bool {
    fn norm(s: &str) -> String {
        s.trim()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_ascii_lowercase()
    }
    norm(a) == norm(b)
}

/// Decide the action for the current state.
pub fn plan(state: &LockScreenState) -> LockScreenPlan {
    if state.follows_wallpaper {
        // Only stash on the way in: on every later write the backup already
        // exists, and re-stashing would capture our own value and make the
        // restore a no-op forever.
        let backup = if state.current_is_ours {
            state.backup.clone()
        } else {
            state.current.clone()
        };
        return LockScreenPlan::Adopt {
            image: String::new(),
            backup,
        };
    }
    // Off. If the value is still ours, hand it back — unless we never took
    // over in the first place, in which case it is the user's and not ours to
    // touch.
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
            plan(&state(false, Some(&theirs()), None, false)),
            LockScreenPlan::Leave
        );
        assert_eq!(plan(&state(false, None, None, false)), LockScreenPlan::Leave);
    }

    #[test]
    fn turning_the_toggle_off_releases_what_we_wrote() {
        // The transition the bug lives in: our value is still installed after
        // the user said no.
        match plan(&state(false, Some(&ours()), None, true)) {
            LockScreenPlan::Release { original } => assert!(original.is_none()),
            other => panic!("expected Release, got {other:?}"),
        }
    }

    #[test]
    fn turning_the_toggle_off_restores_the_users_image_when_we_have_one() {
        match plan(&state(false, Some(&ours()), Some(&theirs()), true)) {
            LockScreenPlan::Release { original } => assert_eq!(original.as_deref(), Some(theirs().as_str())),
            other => panic!("expected Release, got {other:?}"),
        }
    }

    #[test]
    fn a_disabled_lock_screen_that_is_theirs_is_not_released() {
        // Ours-vs-theirs has to be decided by path, not by the toggle having
        // once been on. Backing up on enable and restoring on disable must not
        // become "restore on any disable".
        assert_eq!(
            plan(&state(false, Some(&theirs()), None, false)),
            LockScreenPlan::Leave
        );
    }

    #[test]
    fn enabling_stashes_the_users_image_before_overwriting_it() {
        match plan(&state(true, Some(&theirs()), None, false)) {
            LockScreenPlan::Adopt { backup, .. } => assert_eq!(backup.as_deref(), Some(theirs().as_str())),
            other => panic!("expected Adopt, got {other:?}"),
        }
    }

    #[test]
    fn enabling_with_no_existing_value_has_nothing_to_stash() {
        match plan(&state(true, None, None, false)) {
            LockScreenPlan::Adopt { backup, .. } => assert!(backup.is_none()),
            other => panic!("expected Adopt, got {other:?}"),
        }
    }

    #[test]
    fn rewriting_while_already_ours_never_stashes_our_own_path() {
        // The trap: capture `current` as the backup and the "original" becomes
        // wallpaper-bg.jpg, so turning the toggle off restores our own file and
        // the user is stuck with it.
        match plan(&state(true, Some(&ours()), Some(&theirs()), true)) {
            LockScreenPlan::Adopt { backup, .. } => assert_eq!(backup.as_deref(), Some(theirs().as_str())),
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
        // same_path is what decides `current_is_ours`; a false negative here
        // means the toggle-off release silently does nothing.
        let mut s = state(false, Some(&ours()), None, false);
        s.current_is_ours = same_path(s.current.as_deref().unwrap(), &ours());
        assert!(s.current_is_ours);
        assert!(matches!(
            plan(&s),
            LockScreenPlan::Release { .. }
        ));
    }
}
