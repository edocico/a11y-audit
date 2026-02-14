use super::hex::parse_hex_rgb;

/// Alpha-composite a foreground color over a background color.
/// formula per channel: result = fg * alpha + bg * (1 - alpha)
/// Returns 6-digit hex string.
///
/// Port of: src/core/contrast-checker.ts -> compositeOver()
pub fn composite_over(fg_hex: &str, bg_hex: &str, alpha: f64) -> String {
    let (fr, fg, fb) = parse_hex_rgb(fg_hex);
    let (br, bg_g, bb) = parse_hex_rgb(bg_hex);

    let blend = |f: u8, b: u8| -> u8 {
        let result = f as f64 * alpha + b as f64 * (1.0 - alpha);
        result.round() as u8
    };

    let r = blend(fr, br);
    let g = blend(fg, bg_g);
    let b = blend(fb, bb);

    format!("#{:02x}{:02x}{:02x}", r, g, b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_fg_returns_fg() {
        assert_eq!(composite_over("#ff0000", "#0000ff", 1.0), "#ff0000");
    }

    #[test]
    fn transparent_fg_returns_bg() {
        assert_eq!(composite_over("#ff0000", "#0000ff", 0.0), "#0000ff");
    }

    #[test]
    fn half_transparent_blends() {
        // red 50% over blue -> #800080 (purple-ish)
        let result = composite_over("#ff0000", "#0000ff", 0.5);
        // R: 255*0.5 + 0*0.5 = 128, G: 0, B: 0*0.5 + 255*0.5 = 128
        assert_eq!(result, "#800080");
    }

    #[test]
    fn white_50_on_black() {
        let result = composite_over("#ffffff", "#000000", 0.5);
        assert_eq!(result, "#808080");
    }
}
