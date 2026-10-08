
#![cfg(windows)]

use std::sync::OnceLock;

pub fn name() -> &'static str {
    static NAME: OnceLock<String> = OnceLock::new();
    NAME.get_or_init(read).as_str()
}

fn read() -> String {
    use windows::core::PWSTR;
    use windows::Win32::System::WindowsProgramming::GetUserNameW;

    let mut buffer = [0u16; 256];
    let mut len = buffer.len() as u32;
    let filled = unsafe { GetUserNameW(Some(PWSTR(buffer.as_mut_ptr())), &mut len) };
    if filled.is_err() {
        return String::new();
    }
    let filled = &buffer[..(len as usize).min(buffer.len())];
    let decoded = String::from_utf16_lossy(filled);
    decoded.split('\0').next().unwrap_or("").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn the_account_name_is_not_domain_qualified() {
        assert!(
            !name().contains('\\'),
            "the account name is domain-qualified"
        );
    }
}