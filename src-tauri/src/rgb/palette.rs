//! Color science helpers: dominant color extraction, mixer, luma scaling.
//! Pure functions so they are unit-testable without any hardware.

/// Average a set of colors (simple but robust dominant approximation).
pub fn dominant(pixels: &[[u8; 3]]) -> Option<[u8; 3]> {
    if pixels.is_empty() {
        return None;
    }
    let n = pixels.len() as f64;
    let r = pixels.iter().map(|p| p[0] as f64).sum::<f64>() / n;
    let g = pixels.iter().map(|p| p[1] as f64).sum::<f64>() / n;
    let b = pixels.iter().map(|p| p[2] as f64).sum::<f64>() / n;
    Some([r.round() as u8, g.round() as u8, b.round() as u8])
}

/// Dominant color over a set of samples (average of their colors).
pub fn dominant_over_samples(samples: &[(String, super::ZoneSample)]) -> Option<[u8; 3]> {
    if samples.is_empty() {
        return None;
    }
    let colors: Vec<[u8; 3]> = samples.iter().map(|(_, s)| s.rgb).collect();
    dominant(&colors)
}

/// Relative luminance (Rec. 709).
pub fn luma(c: [u8; 3]) -> f64 {
    0.2126 * c[0] as f64 + 0.7152 * c[1] as f64 + 0.0722 * c[2] as f64
}

/// Scale a color's brightness by a luma factor (0..1 normal, >1 boosts).
pub fn scale_luma(c: [u8; 3], factor: f64) -> [u8; 3] {
    c.map(|ch| (ch as f64 * factor).round().clamp(0.0, 255.0) as u8)
}

/// Boost or reduce saturation around the color's luma.
pub fn saturate(c: [u8; 3], amount: f64) -> [u8; 3] {
    let l = luma(c);
    c.map(|ch| {
        let v = l + (ch as f64 - l) * amount;
        v.round().clamp(0.0, 255.0) as u8
    })
}

/// Apply gamma correction (positive brightens midtones).
pub fn gamma(c: [u8; 3], g: f64) -> [u8; 3] {
    if g <= 0.0 {
        return c;
    }
    let inv = 1.0 / g;
    c.map(|ch| {
        let v = (ch as f64 / 255.0).powf(inv);
        (v * 255.0).round().clamp(0.0, 255.0) as u8
    })
}

/// Full mixer pipeline: saturation -> gamma -> brightness.
pub fn apply_mixer(c: [u8; 3], brightness: f64, saturation: f64, gamma_val: f64) -> [u8; 3] {
    let s = saturate(c, saturation);
    let g = gamma(s, gamma_val);
    scale_luma(g, brightness)
}

/// Convert an RGB color to HSV (h in 0..360, s/v in 0..1). For near-gray
/// colors the hue is arbitrary (0).
pub fn rgb_to_hsv(c: [u8; 3]) -> (f64, f64, f64) {
    let r = c[0] as f64 / 255.0;
    let g = c[1] as f64 / 255.0;
    let b = c[2] as f64 / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let d = max - min;
    let v = max;
    let s = if max <= 0.0 { 0.0 } else { d / max };
    let h = if d <= 0.0 {
        0.0
    } else if max == r {
        60.0 * (((g - b) / d).rem_euclid(6.0))
    } else if max == g {
        60.0 * (((b - r) / d) + 2.0)
    } else {
        60.0 * (((r - g) / d) + 4.0)
    };
    (h, s, v)
}

/// Convert HSV to RGB. `h` in 0..360, `s`/`v` in 0..1.
pub fn hsv_to_rgb(h: f64, s: f64, v: f64) -> [u8; 3] {
    let h = h.rem_euclid(360.0);
    let c = v * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = v - c;
    let (r, g, b) = match h as u32 {
        0..=59 => (c, x, 0.0),
        60..=119 => (x, c, 0.0),
        120..=179 => (0.0, c, x),
        180..=239 => (0.0, x, c),
        240..=299 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    [
        ((r + m) * 255.0).round().clamp(0.0, 255.0) as u8,
        ((g + m) * 255.0).round().clamp(0.0, 255.0) as u8,
        ((b + m) * 255.0).round().clamp(0.0, 255.0) as u8,
    ]
}

/// Rotate a color's hue by `degrees`, keeping saturation/value.
pub fn rotate_hue(c: [u8; 3], degrees: f64) -> [u8; 3] {
    let (h, s, v) = rgb_to_hsv(c);
    hsv_to_rgb(h + degrees, s, v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dominant_empty_is_none() {
        assert!(dominant(&[]).is_none());
    }

    #[test]
    fn dominant_single_color() {
        assert_eq!(dominant(&[[10, 20, 30]]), Some([10, 20, 30]));
    }

    #[test]
    fn dominant_average() {
        assert_eq!(dominant(&[[0, 0, 0], [255, 255, 255]]), Some([128, 128, 128]));
    }

    #[test]
    fn luma_gray() {
        assert!((luma([128, 128, 128]) - 128.0).abs() < 0.01);
    }

    #[test]
    fn saturate_zero_is_gray() {
        let c = saturate([200, 100, 50], 0.0);
        let l = luma([200, 100, 50]);
        assert!(
            (luma(c) - l).abs() < 1.0,
            "luma must be preserved within rounding: {c:?} vs {l}"
        );
        assert_eq!(c[0], c[1]);
        assert_eq!(c[1], c[2]);
    }

    #[test]
    fn saturate_two_boosts() {
        let c = saturate([200, 100, 50], 2.0);
        assert!(c[0] > 200); // red pushed further from luma
    }

    #[test]
    fn gamma_one_identity() {
        assert_eq!(gamma([10, 128, 250], 1.0), [10, 128, 250]);
    }

    #[test]
    fn gamma_two_brightens_midtones() {
        assert!(gamma([64, 64, 64], 2.0)[0] > 64);
    }

    #[test]
    fn apply_mixer_clamps() {
        let c = apply_mixer([255, 255, 255], 10.0, 1.0, 1.0);
        assert_eq!(c, [255, 255, 255]);
    }

    #[test]
    fn scale_luma_zero_is_black() {
        assert_eq!(scale_luma([200, 100, 50], 0.0), [0, 0, 0]);
    }

    #[test]
    fn hsv_roundtrip_primary_colors() {
        assert_eq!(hsv_to_rgb(0.0, 1.0, 1.0), [255, 0, 0]);
        assert_eq!(hsv_to_rgb(120.0, 1.0, 1.0), [0, 255, 0]);
        assert_eq!(hsv_to_rgb(240.0, 1.0, 1.0), [0, 0, 255]);
    }

    #[test]
    fn hsv_wraps_negative_and_overflow() {
        assert_eq!(hsv_to_rgb(-120.0, 1.0, 1.0), hsv_to_rgb(240.0, 1.0, 1.0));
        assert_eq!(hsv_to_rgb(420.0, 1.0, 1.0), hsv_to_rgb(60.0, 1.0, 1.0));
    }

    #[test]
    fn rgb_to_hsv_of_primary_is_exact() {
        let (h, s, v) = rgb_to_hsv([255, 0, 0]);
        assert!((h - 0.0).abs() < 0.01 && (s - 1.0).abs() < 0.01 && (v - 1.0).abs() < 0.01);
        let (h, s, v) = rgb_to_hsv([0, 128, 0]);
        assert!((h - 120.0).abs() < 0.01 && (s - 1.0).abs() < 0.01);
        assert!((v - 128.0 / 255.0).abs() < 0.01);
    }

    #[test]
    fn rotate_hue_moves_and_preserves_value() {
        let (h0, _, v0) = rgb_to_hsv([255, 0, 0]);
        let rotated = rotate_hue([255, 0, 0], 120.0);
        let (h1, _, v1) = rgb_to_hsv(rotated);
        assert!((h1 - (h0 + 120.0).rem_euclid(360.0)).abs() < 1.0);
        assert!((v1 - v0).abs() < 0.011);
        assert!(rotated[1] > rotated[0]); // rotated toward green
    }
}
