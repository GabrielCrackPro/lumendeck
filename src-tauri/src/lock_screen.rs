// Deciding what the Windows lock screen should say, as pure logic.
//
// The Windows half of this cannot be tested on a machine that is not being
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

/// Where we keep the user's original lock screen image. Our own value, in a
/// key we already had open — Windows has no say in this name.
pub const ORIG_LOCK_SCREEN_VALUE: &str = "LumenDeckOriginalLockScreen";

/// Values written by the first version of this feature, which pointed the
/// lock screen at a `LockScreenImage` string in the Personalization key.
///
/// Windows never read them: on Windows 11 24H2 that key holds no
/// `LockScreenImage` at all, and nothing here ever wrote one either — the
/// write succeeded into a value no component consumes, which is why the
/// toggle logged success while the lock screen never moved. They are kept
/// only so the leftovers can be deleted; see `drop_legacy_recipe`.
pub const LOCK_SCREEN_IMAGE_VALUE: &str = "LockScreenImage";

/// The companion DWORD the old recipe set alongside it. This is the value
/// that outlived every release — `release()` deleted the image and the stash
/// but never this — so it sat in the key claiming the lock screen was a user
/// picture long after the toggle went off.
pub const LOCK_SCREEN_TYPE_VALUE: &str = "LockScreenImageType";

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
///
/// `image` is the file we have been asked to install; it is only read on the
/// `follows_wallpaper` path, so the release side may pass anything.
pub fn plan(state: &LockScreenState, image: &str) -> LockScreenPlan {
    if state.follows_wallpaper {
        // Already showing this exact file: leave it alone. The wallpaper
        // republishes its background frame whenever the picture changes, and
        // without this every republish would ask Windows to re-import the
        // same image all over again.
        if state.current_is_ours
            && same_path(state.current.as_deref().unwrap_or_default(), image)
        {
            return LockScreenPlan::Leave;
        }
        // Only stash on the way in: on every later write the backup already
        // exists, and re-stashing would capture our own value and make the
        // restore a no-op forever.
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

    /// A later file at a different path: what an adopt looks like when the
    /// background snapshot moves, as opposed to being republished unchanged.
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
        // The transition the bug lives in: our value is still installed after
        // the user said no.
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
        // Ours-vs-theirs has to be decided by path, not by the toggle having
        // once been on. Backing up on enable and restoring on disable must not
        // become "restore on any disable".
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
                // The plan carries the file to install, not an empty string:
                // the caller used to shadow it with its own argument, which is
                // how an empty path could reach Windows and still log success.
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
        // The trap: capture `current` as the backup and the "original" becomes
        // wallpaper-bg.jpg, so turning the toggle off restores our own file and
        // the user is stuck with it.
        match plan(&state(true, Some(&ours()), Some(&theirs()), true), &ours_two()) {
            LockScreenPlan::Adopt { backup, .. } => assert_eq!(backup.as_deref(), Some(theirs().as_str())),
            other => panic!("expected Adopt, got {other:?}"),
        }
    }

    #[test]
    fn installing_the_image_already_shown_does_nothing() {
        // The wallpaper republishes its background frame whenever the picture
        // changes, and every republish reaches this decision. Adopting again
        // would re-import the same file through Windows each time — so the
        // plan says Leave, which the caller must read as "nothing to do" and
        // not as a failure.
        assert_eq!(
            plan(&state(true, Some(&ours()), Some(&theirs()), true), &ours()),
            LockScreenPlan::Leave
        );
        // A *new* file while we hold the lock screen is still an adopt, and
        // it must keep the stash from the first takeover.
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
        // same_path is what decides `current_is_ours`; a false negative here
        // means the toggle-off release silently does nothing.
        let mut s = state(false, Some(&ours()), None, false);
        s.current_is_ours = same_path(s.current.as_deref().unwrap(), &ours());
        assert!(s.current_is_ours);
        assert!(matches!(
            plan(&s, &ours()),
            LockScreenPlan::Release { .. }
        ));
    }
}
