
use crate::log_level;
use std::panic;

fn build_tag() -> &'static str {
    env!("LUMENDECK_BUILD_ID")
}

pub fn panic_line(message: &str, location: Option<&str>, thread: &str) -> String {
    let where_ = location.unwrap_or("unknown location");
    format!(
        "PANIC in thread '{thread}' at {where_}: {message} [build {}]",
        build_tag()
    )
}

static LAST_PANIC: std::sync::OnceLock<std::sync::Mutex<Option<String>>> =
    std::sync::OnceLock::new();

pub fn last() -> Option<String> {
    LAST_PANIC
        .get()
        .and_then(|m| m.lock().ok().and_then(|g| g.clone()))
}

pub fn install() {
    let previous = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
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

        let line = panic_line(&message, Some(&location), &thread);
        log::error!("{line}");

        if let Ok(mut slot) = LAST_PANIC.get_or_init(Default::default).lock() {
            *slot = Some(line);
        }

        previous(info);
    }));
}

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
        let line = panic_line("boom", None, "worker");
        assert!(line.contains("unknown location"), "{line}");
        assert!(line.contains("boom"), "{line}");
    }

    #[test]
    fn panic_line_identifies_a_dirty_build() {
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