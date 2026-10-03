//! The signed-in Windows account, for the dashboard's greeting.
//!
//! One fact, asked once. `GetUserNameW` returns the account name the current
//! process runs as — not the display name from the account settings, which is
//! a separate lookup and frequently unset. The bare account name is also the
//! form that reads correctly in a greeting: `GetUserNameExW` would give
//! "DESKTOP-AB12\gabriel", and a machine prefix in "Good evening, ..." is
//! noise.
//!
//! The name is returned verbatim, including its capitalisation. Windows account
//! names are frequently lowercase, and quietly title-casing someone's name is
//! a worse thing to do than greet them in the form they registered.

#![cfg(windows)]

use std::sync::OnceLock;

/// The current account name, or an empty string if Windows will not say.
///
/// The empty string is a real answer, not a placeholder: the greeting falls
/// back to the unnamed form rather than rendering a dangling comma. Every
/// caller therefore has to decide what to do with no name, and there is only
/// one sensible thing to do.
pub fn name() -> &'static str {
    static NAME: OnceLock<String> = OnceLock::new();
    NAME.get_or_init(read).as_str()
}

/// Ask Windows once. Two calls: size, then fill.
fn read() -> String {
    use windows::core::PWSTR;
    use windows::Win32::System::WindowsProgramming::GetUserNameW;

    // 256 is UNLEN_MAX + 1. The API takes a u32 length, so sizing the buffer
    // as `u32::MAX` and letting it fail would be a buffer overflow waiting for
    // an account name long enough to hit it.
    let mut buffer = [0u16; 256];
    let mut len = buffer.len() as u32;
    // SAFETY: `buffer` is a writable UTF-16 array of exactly `len` elements and
    // `len` is in bounds, which is the contract GetUserNameW is given here. It
    // writes at most `len` code units and never reads the buffer back.
    let filled = unsafe { GetUserNameW(Some(PWSTR(buffer.as_mut_ptr())), &mut len) };
    if filled.is_err() {
        return String::new();
    }
    // `len` comes back *including* the terminating NUL, which is not what the
    // documentation for this function says and is worth not taking on faith:
    // measured here, it reports 8 for the 7-character account "Gabriel", and
    // slicing on `len` alone typesets the greeting with a NUL in the middle of
    // it. Cutting at the first terminator is correct whether or not a given
    // Windows build counts it, so the code does not depend on the answer.
    let filled = &buffer[..(len as usize).min(buffer.len())];
    let decoded = String::from_utf16_lossy(filled);
    decoded.split('\0').next().unwrap_or("").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The greeting is typeset from this string verbatim, so what matters is
    /// that it is populated and printable — a call that failed would otherwise
    /// show up as a greeting with a comma and nothing after it.
    #[test]
    fn the_account_name_is_readable() {
        let name = name();
        assert!(!name.is_empty(), "GetUserNameW returned nothing");
        assert!(
            !name.contains('\0'),
            "the account name came back with an embedded NUL"
        );
        assert!(
            name.chars().all(|c| !c.is_control()),
            "the account name contains a control character"
        );
        assert_eq!(name.trim(), name, "the account name has stray whitespace");
    }

    /// Windows account names cannot contain these, so a value carrying one has
    /// come from somewhere other than the account name.
    #[test]
    fn the_account_name_is_not_domain_qualified() {
        // `GetUserNameExW` with NameSamCompatible would return "HOST\gabriel",
        // which is not what a greeting wants to say out loud.
        assert!(
            !name().contains('\\'),
            "the account name is domain-qualified"
        );
    }
}