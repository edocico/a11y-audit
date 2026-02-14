/// Parse a 6-digit hex string to RGB channels (0-255).
/// Handles 8-digit hex (extracts RGB, ignores alpha bytes).
/// Returns (0, 0, 0) on malformed input.
pub fn parse_hex_rgb(hex: &str) -> (u8, u8, u8) {
    let hex = hex.strip_prefix('#').unwrap_or(hex);
    if hex.len() < 6 {
        return (0, 0, 0);
    }
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);
    (r, g, b)
}

/// Extract alpha from 8-digit hex (#rrggbbaa) as f64 0.0-1.0.
/// Returns None if 6-digit hex or alpha >= 0.999.
pub fn extract_hex_alpha(hex: &str) -> Option<f64> {
    let hex = hex.strip_prefix('#').unwrap_or(hex);
    if hex.len() == 8 {
        let a = u8::from_str_radix(&hex[6..8], 16).ok()?;
        let alpha = a as f64 / 255.0;
        if alpha >= 0.999 { None } else { Some(alpha) }
    } else {
        None
    }
}

/// Strip alpha channel from 8-digit hex -> 6-digit hex.
pub fn strip_hex_alpha(hex: &str) -> String {
    let raw = hex.strip_prefix('#').unwrap_or(hex);
    if raw.len() == 8 {
        format!("#{}", &raw[0..6])
    } else {
        hex.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_6digit_hex() {
        assert_eq!(parse_hex_rgb("#ff0000"), (255, 0, 0));
        assert_eq!(parse_hex_rgb("#00ff00"), (0, 255, 0));
        assert_eq!(parse_hex_rgb("#1e293b"), (30, 41, 59));
    }

    #[test]
    fn parse_8digit_hex_ignores_alpha() {
        assert_eq!(parse_hex_rgb("#ff000080"), (255, 0, 0));
    }

    #[test]
    fn parse_malformed_returns_black() {
        assert_eq!(parse_hex_rgb("not-a-color"), (0, 0, 0));
        assert_eq!(parse_hex_rgb("#xyz"), (0, 0, 0));
    }

    #[test]
    fn extract_alpha_8digit() {
        let a = extract_hex_alpha("#ff000080").unwrap();
        assert!((a - 0.502).abs() < 0.01); // 128/255 ~ 0.502
    }

    #[test]
    fn extract_alpha_6digit_returns_none() {
        assert!(extract_hex_alpha("#ff0000").is_none());
    }

    #[test]
    fn extract_alpha_fully_opaque_returns_none() {
        assert!(extract_hex_alpha("#ff0000ff").is_none());
    }

    #[test]
    fn strip_alpha_8digit() {
        assert_eq!(strip_hex_alpha("#ff000080"), "#ff0000");
    }

    #[test]
    fn strip_alpha_6digit_passthrough() {
        assert_eq!(strip_hex_alpha("#ff0000"), "#ff0000");
    }
}
