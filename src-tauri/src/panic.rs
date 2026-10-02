//! Crash reporting: make a panic say which build it came from.
//!
//! There was no panic hook, so a Rust panic printed to stderr through the
//! default handler and that was the end of it. In a release build there is no
//! stderr worth reading, so the one moment the log matters most recorded nothing
//! — and the log is exactly what a user attaches to a bug report.
//!
//! The report carries the build identity because a panic that says only what
//! failed cannot be matched to a build. Two of them, one from an installer and
//! one from a dirty working tree, are the same string.

use crate::log_level;
use std::panic;

/// The build this binary was made from, as the panic line should show it.
///
/// `build.rs` already folds the dirty state into the id as a `-dirty` suffix,
/// so there is nothing to add here — this exists as a name for it so the
/// meaning is written down once rather than at every use.
fn build_tag() -> &'static str {
    env!("LUMENDECK_BUILD_ID")
}

/// One line describing a panic, for the log.
///
/// Separate from the hook so it can be tested: a panic hook cannot be exercised
/// from a test without killing the test process, but this is pure.
pub fn panic_line(message: &str, location: Option<&str>, thread: &str) -> String {
    let where_ = location.unwrap_or("unknown location");
    format!(
        "PANIC in thread '{thread}' at {where_}: {message} [build {}]",
        build_tag()
    )
}

/// The most recent panic, if any.
///
/// Set by the hook. A static because a panic can arrive on any thread at any
/// time, and the caller is usually the UI polling for diagnostics.
static LAST_PANIC: std::sync::OnceLock<std::sync::Mutex<Option<String>>> =
    std::sync::OnceLock::new();

/// The last panic recorded, or `None`.
pub fn last() -> Option<String> {
    LAST_PANIC
        .get()
        .and_then(|m| m.lock().ok().and_then(|g| g.clone()))
}

/// Install the hook. Safe to call more than once; each call chains onto the last.
pub fn install() {
    let previous = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        // A payload is `Any`, and it may not be a string at all — `panic_any`
        // puts whatever the caller likes in there. Reading it must not itself
        // panic, so every branch has a fallback.
        let payload = info.payload();
        let message = if let Some(s) = payload.downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = payload.downcast_ref::<String>() {
            s.clone()
        } else {
            "non-string panic payload".to_string()
        };
        let location = info
            .location()
            .map(|l| l.to_string())
            .unwrap_or_else(|| "unknown location".to_string());
        let thread = std::thread::current()
            .name()
            .unwrap_or("unnamed")
            .to_string();

        // Goes through the logger, so it lands in the same file the rest of the
        // diagnostics live in, rather than on a stderr nobody is reading.
        let line = panic_line(&message, Some(&location), &thread);
        log::error!("{line}");

        // Recorded as well, because a panicking background thread does not
        // always take the app down with it, and a report filed from a session
        // that "looked fine" is the case with no other trace.
        if let Ok(mut slot) = LAST_PANIC.get_or_init(Default::default).lock() {
            *slot = Some(line);
        }

        // Chained last, and deliberately: the previous hook is what prints to
        // the console in `tauri dev`, and skipping it would make a dev crash
        // silent too.
        previous(info);
    }));
}

/// The log level's textual form, for the report header.
///
/// A panic is logged at `error`, so the report saying so is not redundant — it
/// tells whoever reads the line which filter it came out of.
pub fn report_header() -> String {
    format!(
        "LumenDeck {} — {} (log level {})",
        env!("CARGO_PKG_VERSION"),
        build_tag(),
        log_level()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panic_line_carries_message_location_thread_and_build() {
        let line = panic_line("index out of bounds", Some("src/rgb/mod.rs:42"), "main");
        assert!(line.contains("index out of bounds"), "{line}");
        assert!(line.contains("src/rgb/mod.rs:42"), "{line}");
        assert!(line.contains("'main'"), "{line}");
        assert!(line.contains("build "), "{line}");
    }

    #[test]
    fn panic_line_survives_a_missing_location() {
        // `panic!` inside a `catch_unwind`-free path can have no location on
        // some toolchains; the line still has to be readable.
        let line = panic_line("boom", None, "worker");
        assert!(line.contains("unknown location"), "{line}");
        assert!(line.contains("boom"), "{line}");
    }

    #[test]
    fn panic_line_identifies_a_dirty_build() {
        // The repository's normal development state is a dirty tree, so this is
        // the case that has to be right rather than an edge case.
        let line = panic_line("boom", None, "t");
        if env!("LUMENDECK_BUILD_DIRTY") == "true" {
            assert!(line.ends_with("-dirty]"), "{line}");
        } else {
            assert!(!line.contains("-dirty"), "{line}");
        }
    }

    #[test]
    fn report_header_states_version_build_and_log_level() {
        let header = report_header();
        assert!(header.starts_with("LumenDeck "), "{header}");
        assert!(header.contains(env!("CARGO_PKG_VERSION")), "{header}");
        assert!(header.contains("log level"), "{header}");
    }
}