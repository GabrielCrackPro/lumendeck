//! The runtime constants the dashboard, the webviews and this backend all have
//! to agree on.
//!
//! These are read out of `src/shared/tokens.json` at compile time rather than
//! restated here. The default glow was once a literal in `sweep_base` that
//! matched a TypeScript constant only by coincidence, and the sticker size
//! existed in three places at once — two in TypeScript that nothing imported,
//! four in the placement overlay that did, and this module's own pair. A
//! comment saying "keep these in step" is not a mechanism; a file both sides
//! read is.
//!
//! The colours the CSS palette needs are deliberately absent: those are design
//! tokens, declared once in `src/shared/palette.ts` and written into the
//! stylesheet by a build plugin. What crosses this boundary is only what a
//! second runtime has to compute with.

use serde::Deserialize;
use std::sync::OnceLock;

/// The shape of `src/shared/tokens.json`.
///
/// `rename_all = "camelCase"` is what lets the JSON read naturally in
/// TypeScript and still deserialize here. A key renamed on the TS side without
/// this following stops the build rather than silently defaulting.
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

/// Parsed once. The JSON is tiny and the answer never changes, so a `OnceLock`
/// beats re-parsing on every sweep and re-reading the file from disk at all.
static TOKENS: OnceLock<RawTokens> = OnceLock::new();

fn tokens() -> &'static RawTokens {
    TOKENS.get_or_init(|| {
        // `include_str!` is resolved when this crate compiles, so a moved or
        // deleted JSON is a build error and not a runtime surprise. What it
        // cannot catch is a shape change, which is what the test below is for.
        serde_json::from_str(include_str!("../../src/shared/tokens.json"))
            .expect("src/shared/tokens.json does not match the shape in tokens.rs")
    })
}

/// The accent the UI falls back to; see [`crate::constants::DEFAULT_GLOW`].
pub fn default_glow() -> [u8; 3] {
    tokens().default_glow
}

/// The colour a hotkey's LED blinks in when a binding stores no colour.
pub fn hotkey_blink() -> [u8; 3] {
    tokens().hotkey_blink
}

/// The width a sticker gets when placement supplies no size.
pub fn sticker_default_w() -> u32 {
    tokens().sticker_default_w
}

/// The height a sticker gets when placement supplies no size.
pub fn sticker_default_h() -> u32 {
    tokens().sticker_default_h
}

/// The smallest size a sticker may be placed at.
///
/// Enforced on both sides and previously written down twice: the placement
/// overlay clamps its resize pad to it, and `ipc.rs` floors an aspect-fitted
/// size with it. Two literals meant the overlay could offer a size the backend
/// would then silently enlarge.
pub fn sticker_min_size() -> u32 {
    tokens().sticker_min_size
}

/// The largest size a sticker may be resized to.
///
/// The same story as [sticker_min_size]: the overlay's pad ceiling and the
/// backend's wheel-handler ceiling were both a literal `2000`.
pub fn sticker_max_size() -> u32 {
    tokens().sticker_max_size
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shared file has to deserialize into the struct above. A key renamed
    /// or retyped in tokens.json breaks here, at `cargo test`, rather than at
    /// the first accent write.
    #[test]
    fn the_shared_token_file_deserializes() {
        assert_eq!(default_glow().len(), 3);
        assert!(tokens().sticker_default_w > 0);
    }

    /// These four values are the app's identity — the blue every accent falls
    /// back to, the hotkey blink, and the sticker a click produces. Pinned so a
    /// change to the shared file reads as a deliberate edit here.
    #[test]
    fn the_tokens_are_the_documented_values() {
        assert_eq!(default_glow(), [56, 189, 248]);
        assert_eq!(hotkey_blink(), [255, 255, 255]);
        assert_eq!(sticker_default_w(), 220);
        assert_eq!(sticker_default_h(), 220);
        assert_eq!(sticker_min_size(), 48);
        assert_eq!(sticker_max_size(), 2000);
    }

    /// A sticker cannot be smaller than the overlay allows, so the default has
    /// to clear that floor or the preview and the real thing disagree on the
    /// first frame.
    #[test]
    fn the_default_sticker_fits_the_minimum() {
        assert!(sticker_default_w() >= sticker_min_size());
        assert!(sticker_default_h() >= sticker_min_size());
        assert!(sticker_default_w() <= sticker_max_size());
        assert!(sticker_default_h() <= sticker_max_size());
    }
}
