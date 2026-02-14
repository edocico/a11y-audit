/// Convert sRGB channel (0-255) to linear light value.
/// sRGB -> linear: if V <= 0.04045: V/12.92, else ((V+0.055)/1.055)^2.4
fn srgb_to_linear(channel: u8) -> f64 {
    let v = channel as f64 / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

/// Calculate relative luminance per WCAG 2.1.
/// L = 0.2126 * R + 0.7152 * G + 0.0722 * B (linear channels)
pub fn relative_luminance(hex: &str) -> f64 {
    let (r, g, b) = super::hex::parse_hex_rgb(hex);
    0.2126 * srgb_to_linear(r) + 0.7152 * srgb_to_linear(g) + 0.0722 * srgb_to_linear(b)
}

/// Calculate WCAG 2.1 contrast ratio between two colors.
/// ratio = (L1 + 0.05) / (L2 + 0.05) where L1 >= L2
pub fn contrast_ratio(hex1: &str, hex2: &str) -> f64 {
    let l1 = relative_luminance(hex1);
    let l2 = relative_luminance(hex2);
    let (lighter, darker) = if l1 > l2 { (l1, l2) } else { (l2, l1) };
    (lighter + 0.05) / (darker + 0.05)
}

/// Determine pass/fail for all WCAG thresholds.
pub fn check_wcag_thresholds(ratio: f64, is_large_text: bool) -> WcagResult {
    if is_large_text {
        WcagResult {
            pass_aa: ratio >= 3.0,
            pass_aa_large: ratio >= 3.0,
            pass_aaa: ratio >= 4.5,
            pass_aaa_large: ratio >= 4.5,
        }
    } else {
        WcagResult {
            pass_aa: ratio >= 4.5,
            pass_aa_large: ratio >= 3.0,
            pass_aaa: ratio >= 7.0,
            pass_aaa_large: ratio >= 4.5,
        }
    }
}

pub struct WcagResult {
    pub pass_aa: bool,
    pub pass_aa_large: bool,
    pub pass_aaa: bool,
    pub pass_aaa_large: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn black_on_white_is_21() {
        let ratio = contrast_ratio("#000000", "#ffffff");
        assert!((ratio - 21.0).abs() < 0.01);
    }

    #[test]
    fn white_on_white_is_1() {
        let ratio = contrast_ratio("#ffffff", "#ffffff");
        assert!((ratio - 1.0).abs() < 0.01);
    }

    #[test]
    fn gray_on_white() {
        // colord: 4.54
        let ratio = contrast_ratio("#767676", "#ffffff");
        assert!((ratio - 4.54).abs() < 0.1);
    }

    #[test]
    fn order_independent() {
        let r1 = contrast_ratio("#ff0000", "#ffffff");
        let r2 = contrast_ratio("#ffffff", "#ff0000");
        assert!((r1 - r2).abs() < 0.001);
    }

    #[test]
    fn red_on_white() {
        // colord: 3.99
        let ratio = contrast_ratio("#ff0000", "#ffffff");
        assert!((ratio - 3.99).abs() < 0.1);
    }

    #[test]
    fn slate_on_white() {
        // colord: 14.62
        let ratio = contrast_ratio("#1e293b", "#ffffff");
        assert!((ratio - 14.62).abs() < 0.1);
    }

    #[test]
    fn zinc_950_on_white() {
        // colord: 19.89
        let ratio = contrast_ratio("#09090b", "#ffffff");
        assert!((ratio - 19.89).abs() < 0.1);
    }

    #[test]
    fn zinc_400_on_zinc_950() {
        // colord: 7.76
        let ratio = contrast_ratio("#a1a1aa", "#09090b");
        assert!((ratio - 7.76).abs() < 0.1);
    }

    #[test]
    fn aa_normal_requires_4_5() {
        let r = check_wcag_thresholds(4.5, false);
        assert!(r.pass_aa);
        assert!(!r.pass_aaa);
    }

    #[test]
    fn aa_large_requires_3() {
        let r = check_wcag_thresholds(3.0, true);
        assert!(r.pass_aa);   // AA large = 3:1
        assert!(!r.pass_aaa); // AAA large = 4.5:1
    }

    #[test]
    fn aaa_normal_requires_7() {
        let r = check_wcag_thresholds(7.0, false);
        assert!(r.pass_aa);
        assert!(r.pass_aaa);
    }
}
