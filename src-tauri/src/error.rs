//! Error conventions for the LumenDeck backend.
//!
//! All fallible functions return `Result<T, String>`. `err_str` is the shared
//! `map_err` adapter for that convention.

/// Map any displayable error into the `String` used across the backend.
pub fn err_str<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
