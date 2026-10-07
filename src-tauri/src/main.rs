//! LumenDeck binary entry point.

// Always a windowed app, debug builds included.
//
// The old form — `cfg_attr(not(debug_assertions), …)` — gave every debug
// build the *console* subsystem, which is invisible when the process is
// started from a terminal (it just attaches) and pops a terminal window when
// it is not: the "PowerShell window" that appeared at logon was this, hosting
// the Run key's launch of `target\debug\lumendeck.exe`.
//
// Nothing in the app writes to stdout — `log` goes to the 5 MB file and the
// Developer card reads it from there — and the test binaries are separate
// targets, so `cargo test --nocapture` still prints.
#![windows_subsystem = "windows"]

fn main() {
    lumendeck_lib::run();
}
