//! Shared error type for the LumenDeck backend.

use serde::Serialize;

#[derive(Debug, Serialize)]
pub enum LumenError {
    Config(String),
    Win32(String),
    Rgb(String),
    Wallpaper(String),
    Sticker(String),
    Io(String),
}

impl std::fmt::Display for LumenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LumenError::Config(m) => write!(f, "config error: {m}"),
            LumenError::Win32(m) => write!(f, "win32 error: {m}"),
            LumenError::Rgb(m) => write!(f, "rgb error: {m}"),
            LumenError::Wallpaper(m) => write!(f, "wallpaper error: {m}"),
            LumenError::Sticker(m) => write!(f, "sticker error: {m}"),
            LumenError::Io(m) => write!(f, "io error: {m}"),
        }
    }
}

impl std::error::Error for LumenError {}

impl From<std::io::Error> for LumenError {
    fn from(e: std::io::Error) -> Self {
        LumenError::Io(e.to_string())
    }
}

pub type LumenResult<T> = Result<T, LumenError>;
