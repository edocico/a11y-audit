/// Parse an opacity Tailwind class and return its value as 0.0-1.0.
///
/// Supported patterns:
/// - `opacity-0` through `opacity-100` -> N / 100
/// - `opacity-[.33]` or `opacity-[0.33]` -> literal float
/// - `opacity-[50%]` -> 50 / 100
///
/// Returns `None` if the string is not an opacity class.
/// Must NOT match `text-opacity-50` or bare `opacity` (no dash suffix).
pub fn parse_opacity_class(cls: &str) -> Option<f32> {
    let suffix = cls.strip_prefix("opacity-")?;

    if suffix.is_empty() {
        return None;
    }

    // Arbitrary value: opacity-[...]
    if let Some(inner) = suffix.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
        if inner.is_empty() {
            return None;
        }

        // Percentage: opacity-[50%]
        if let Some(pct_str) = inner.strip_suffix('%') {
            let pct: f32 = pct_str.parse().ok()?;
            return Some(pct / 100.0);
        }

        // Float literal: opacity-[.33] or opacity-[0.33]
        let val: f32 = inner.parse().ok()?;
        return Some(val);
    }

    // Standard numeric: opacity-0 through opacity-100
    let n: u32 = suffix.parse().ok()?;
    if n > 100 {
        return None;
    }
    Some(n as f32 / 100.0)
}

/// Scan a raw JSX tag string for the first non-variant `opacity-*` class.
/// Returns the parsed opacity value (0.0-1.0), or `None` if not found.
///
/// Must skip variant-prefixed classes like `dark:opacity-50`, `hover:opacity-75`.
/// Must handle word boundaries correctly (same pattern as `find_explicit_bg_in_raw_tag`
/// in `context_tracker.rs`).
/// Must not match inline `style={{ opacity: 0.5 }}`.
pub fn find_opacity_in_raw_tag(raw_tag: &str) -> Option<f32> {
    let bytes = raw_tag.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    let prefix = b"opacity-";
    let prefix_len = prefix.len(); // 8

    while i + prefix_len < len {
        // Look for "opacity-" at position i
        if &bytes[i..i + prefix_len] == prefix {
            // Check that previous char is a word boundary (not preceded by ':' for variants,
            // not preceded by alphanumeric or '-' which would mean e.g. "text-opacity-")
            if i > 0 {
                let prev = bytes[i - 1];
                // Variant prefix: skip (dark:opacity-50, hover:opacity-75)
                if prev == b':' {
                    i += 1;
                    continue;
                }
                // Part of a longer class name like "text-opacity-50"
                if prev == b'-' || prev.is_ascii_alphanumeric() || prev == b'_' {
                    i += 1;
                    continue;
                }
                // Must be a delimiter: whitespace, quote, paren, comma, backtick
                if !prev.is_ascii_whitespace()
                    && prev != b'"'
                    && prev != b'\''
                    && prev != b'`'
                    && prev != b'('
                    && prev != b','
                {
                    i += 1;
                    continue;
                }
            }

            // Extract the full class token starting at i
            let start = i;
            while i < len
                && !bytes[i].is_ascii_whitespace()
                && bytes[i] != b'"'
                && bytes[i] != b'\''
                && bytes[i] != b'`'
                && bytes[i] != b')'
                && bytes[i] != b','
            {
                i += 1;
            }
            let cls = &raw_tag[start..i];

            // Try to parse it
            if let Some(val) = parse_opacity_class(cls) {
                return Some(val);
            }

            // Not a valid opacity class, continue scanning
            continue;
        }

        i += 1;
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── parse_opacity_class tests ──

    #[test]
    fn opacity_0() {
        assert_eq!(parse_opacity_class("opacity-0"), Some(0.0));
    }

    #[test]
    fn opacity_50() {
        assert_eq!(parse_opacity_class("opacity-50"), Some(0.5));
    }

    #[test]
    fn opacity_100() {
        assert_eq!(parse_opacity_class("opacity-100"), Some(1.0));
    }

    #[test]
    fn opacity_75() {
        assert_eq!(parse_opacity_class("opacity-75"), Some(0.75));
    }

    #[test]
    fn opacity_5() {
        assert_eq!(parse_opacity_class("opacity-5"), Some(0.05));
    }

    #[test]
    fn arbitrary_dot_prefix() {
        assert_eq!(parse_opacity_class("opacity-[.33]"), Some(0.33));
    }

    #[test]
    fn arbitrary_zero_dot_prefix() {
        assert_eq!(parse_opacity_class("opacity-[0.33]"), Some(0.33));
    }

    #[test]
    fn arbitrary_percentage() {
        assert_eq!(parse_opacity_class("opacity-[50%]"), Some(0.5));
    }

    #[test]
    fn non_opacity_class() {
        assert_eq!(parse_opacity_class("bg-red-500"), None);
    }

    #[test]
    fn text_opacity_rejected() {
        assert_eq!(parse_opacity_class("text-opacity-50"), None);
    }

    #[test]
    fn bare_opacity_rejected() {
        assert_eq!(parse_opacity_class("opacity"), None);
    }

    #[test]
    fn opacity_above_100_rejected() {
        assert_eq!(parse_opacity_class("opacity-150"), None);
    }

    #[test]
    fn arbitrary_empty_brackets_rejected() {
        assert_eq!(parse_opacity_class("opacity-[]"), None);
    }

    #[test]
    fn arbitrary_invalid_value_rejected() {
        assert_eq!(parse_opacity_class("opacity-[abc]"), None);
    }

    #[test]
    fn opacity_25() {
        assert_eq!(parse_opacity_class("opacity-25"), Some(0.25));
    }

    #[test]
    fn opacity_10() {
        assert_eq!(parse_opacity_class("opacity-10"), Some(0.1));
    }

    #[test]
    fn arbitrary_percentage_0() {
        assert_eq!(parse_opacity_class("opacity-[0%]"), Some(0.0));
    }

    #[test]
    fn arbitrary_percentage_100() {
        assert_eq!(parse_opacity_class("opacity-[100%]"), Some(1.0));
    }

    // ── find_opacity_in_raw_tag tests ──

    #[test]
    fn finds_opacity_in_classname() {
        assert_eq!(
            find_opacity_in_raw_tag(r#"<div className="opacity-50 text-white">"#),
            Some(0.5)
        );
    }

    #[test]
    fn skips_variant_prefixed_opacity() {
        assert_eq!(
            find_opacity_in_raw_tag(r#"<div className="dark:opacity-50 text-white">"#),
            None
        );
    }

    #[test]
    fn finds_non_variant_after_variant() {
        assert_eq!(
            find_opacity_in_raw_tag(r#"<div className="hover:opacity-75 opacity-50">"#),
            Some(0.5)
        );
    }

    #[test]
    fn no_opacity_class_returns_none() {
        assert_eq!(
            find_opacity_in_raw_tag(r#"<div className="bg-red-500 text-white">"#),
            None
        );
    }

    #[test]
    fn finds_arbitrary_opacity() {
        assert_eq!(
            find_opacity_in_raw_tag(r#"<div className="opacity-[.33] text-white">"#),
            Some(0.33)
        );
    }

    #[test]
    fn no_match_in_style_attribute() {
        // style={{ opacity: 0.5 }} does not contain a className-like "opacity-*" token
        assert_eq!(
            find_opacity_in_raw_tag(r#"<div style={{ opacity: 0.5 }}>"#),
            None
        );
    }

    #[test]
    fn skips_text_opacity_in_raw_tag() {
        assert_eq!(
            find_opacity_in_raw_tag(r#"<div className="text-opacity-50 text-white">"#),
            None
        );
    }

    #[test]
    fn finds_opacity_in_cn_call() {
        assert_eq!(
            find_opacity_in_raw_tag(r#"<div className={cn("opacity-75", "text-white")}>"#),
            Some(0.75)
        );
    }

    #[test]
    fn finds_opacity_after_other_classes() {
        assert_eq!(
            find_opacity_in_raw_tag(r#"<div className="bg-white text-black opacity-80">"#),
            Some(0.8)
        );
    }

    #[test]
    fn empty_tag_returns_none() {
        assert_eq!(find_opacity_in_raw_tag(""), None);
    }

    #[test]
    fn multiple_variant_prefixes_all_skipped() {
        assert_eq!(
            find_opacity_in_raw_tag(
                r#"<div className="dark:opacity-50 hover:opacity-75 focus:opacity-90">"#
            ),
            None
        );
    }

    #[test]
    fn finds_opacity_in_template_literal() {
        assert_eq!(
            find_opacity_in_raw_tag(r#"<div className={`opacity-25 text-white`}>"#),
            Some(0.25)
        );
    }
}
