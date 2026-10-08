
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawTokens {
    default_glow: [u8; 3],
    hotkey_blink: [u8; 3],
    sticker_default_w: u32,
    sticker_default_h: u32,
    sticker_min_size: u32,
    sticker_max_size: u32,
}

static TOKENS: OnceLock<RawTokens> = OnceLock::new();

fn tokens() -> &'static RawTokens {
    TOKENS.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/shared/tokens.json"))
            .expect("src/shared/tokens.json does not match the shape in tokens.rs")
    })
}

pub fn default_glow() -> [u8; 3] {
    tokens().default_glow
}

pub fn hotkey_blink() -> [u8; 3] {
    tokens().hotkey_blink
}

pub fn sticker_default_w() -> u32 {
    tokens().sticker_default_w
}

pub fn sticker_default_h() -> u32 {
    tokens().sticker_default_h
}

pub fn sticker_min_size() -> u32 {
    tokens().sticker_min_size
}

pub fn sticker_max_size() -> u32 {
    tokens().sticker_max_size
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shared_token_file_deserializes() {
        assert_eq!(default_glow().len(), 3);
        assert!(tokens().sticker_default_w > 0);
    }

    #[test]
    fn the_tokens_are_the_documented_values() {
        assert_eq!(default_glow(), [56, 189, 248]);
        assert_eq!(hotkey_blink(), [255, 255, 255]);
        assert_eq!(sticker_default_w(), 220);
        assert_eq!(sticker_default_h(), 220);
        assert_eq!(sticker_min_size(), 48);
        assert_eq!(sticker_max_size(), 2000);
    }

    #[test]
    fn the_default_sticker_fits_the_minimum() {
        assert!(sticker_default_w() >= sticker_min_size());
        assert!(sticker_default_h() >= sticker_min_size());
        assert!(sticker_default_w() <= sticker_max_size());
        assert!(sticker_default_h() <= sticker_max_size());
    }
}
