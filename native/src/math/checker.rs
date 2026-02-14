use crate::types::{ColorPair, ContrastResult};

/// Check contrast for a single color pair.
/// Performs alpha compositing, then WCAG ratio + APCA Lc.
///
/// Port of: src/core/contrast-checker.ts → checkContrast()
pub fn check_contrast(pair: &ColorPair, page_bg: &str) -> ContrastResult {
    let bg_hex = pair.bg_hex.as_deref().unwrap_or(page_bg);
    let text_hex = pair.text_hex.as_deref().unwrap_or("#000000");

    // Step 1: composite bg alpha against page bg
    let effective_bg = match pair.bg_alpha {
        Some(a) if a < 0.999 => super::composite::composite_over(bg_hex, page_bg, a),
        _ => bg_hex.to_string(),
    };

    // Step 2: composite text alpha against effective bg
    let effective_fg = match pair.text_alpha {
        Some(a) if a < 0.999 => super::composite::composite_over(text_hex, &effective_bg, a),
        _ => text_hex.to_string(),
    };

    let ratio_raw = super::wcag::contrast_ratio(&effective_fg, &effective_bg);
    let ratio = (ratio_raw * 100.0).round() / 100.0;
    let is_large = pair.is_large_text.unwrap_or(false);
    let wcag = super::wcag::check_wcag_thresholds(ratio_raw, is_large);

    let apca_lc_raw = super::apca::calc_apca_lc(&effective_fg, &effective_bg);
    let apca_lc = Some((apca_lc_raw * 100.0).round() / 100.0);

    ContrastResult {
        file: pair.file.clone(),
        line: pair.line,
        bg_class: pair.bg_class.clone(),
        text_class: pair.text_class.clone(),
        bg_hex: pair.bg_hex.clone(),
        text_hex: pair.text_hex.clone(),
        bg_alpha: pair.bg_alpha,
        text_alpha: pair.text_alpha,
        is_large_text: pair.is_large_text,
        pair_type: pair.pair_type.clone(),
        interactive_state: pair.interactive_state.clone(),
        ignored: pair.ignored,
        ignore_reason: pair.ignore_reason.clone(),
        context_source: pair.context_source.clone(),
        effective_opacity: pair.effective_opacity,
        is_disabled: pair.is_disabled,
        unresolved_current_color: pair.unresolved_current_color,
        ratio,
        pass_aa: wcag.pass_aa,
        pass_aa_large: wcag.pass_aa_large,
        pass_aaa: wcag.pass_aaa,
        pass_aaa_large: wcag.pass_aaa_large,
        apca_lc,
        deuteranopia_ratio: None,
        protanopia_ratio: None,
    }
}

/// Check all pairs and categorize into violations/passed/ignored/skipped.
///
/// Port of: src/core/contrast-checker.ts → checkAllPairs()
pub fn check_all_pairs(
    pairs: &[ColorPair],
    threshold: &str, // "AA" or "AAA"
    page_bg: &str,
) -> CheckResult {
    let mut violations = Vec::new();
    let mut passed = Vec::new();
    let mut ignored = Vec::new();
    let mut ignored_count: u32 = 0;
    let mut skipped_count: u32 = 0;

    for pair in pairs {
        // Skip pairs with unresolved colors
        if pair.bg_hex.is_none() || pair.text_hex.is_none() {
            skipped_count += 1;
            continue;
        }

        // Skip disabled elements (US-07)
        if pair.is_disabled == Some(true) {
            skipped_count += 1;
            continue;
        }

        let result = check_contrast(pair, page_bg);

        // Determine violation based on conformance level and pair type
        // Non-text elements (border, ring, outline) use large-text thresholds
        let is_non_text = pair.pair_type.as_deref().map_or(false, |t| t != "text");
        let uses_large_threshold = is_non_text || pair.is_large_text.unwrap_or(false);

        let is_violation = if threshold == "AAA" {
            if uses_large_threshold {
                !result.pass_aaa_large
            } else {
                !result.pass_aaa
            }
        } else {
            // AA
            if uses_large_threshold {
                !result.pass_aa_large
            } else {
                !result.pass_aa
            }
        };

        if is_violation && pair.ignored == Some(true) {
            ignored_count += 1;
            ignored.push(result);
        } else if is_violation {
            violations.push(result);
        } else {
            passed.push(result);
        }
    }

    CheckResult {
        violations,
        passed,
        ignored,
        ignored_count,
        skipped_count,
    }
}

pub struct CheckResult {
    pub violations: Vec<ContrastResult>,
    pub passed: Vec<ContrastResult>,
    pub ignored: Vec<ContrastResult>,
    pub ignored_count: u32,
    pub skipped_count: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ColorPair;

    fn make_pair(bg_hex: &str, text_hex: &str) -> ColorPair {
        ColorPair {
            file: "test.tsx".to_string(),
            line: 1,
            bg_class: "bg-test".to_string(),
            text_class: "text-test".to_string(),
            bg_hex: Some(bg_hex.to_string()),
            text_hex: Some(text_hex.to_string()),
            bg_alpha: None,
            text_alpha: None,
            is_large_text: Some(false),
            pair_type: Some("text".to_string()),
            interactive_state: None,
            ignored: None,
            ignore_reason: None,
            context_source: None,
            effective_opacity: None,
            is_disabled: None,
            unresolved_current_color: None,
        }
    }

    // --- check_contrast tests ---

    #[test]
    fn black_on_white_passes_all() {
        let pair = make_pair("#ffffff", "#000000");
        let result = check_contrast(&pair, "#ffffff");
        assert!(result.pass_aa);
        assert!(result.pass_aaa);
        assert!((result.ratio - 21.0).abs() < 0.1);
    }

    #[test]
    fn ratio_rounded_to_2_decimals() {
        let pair = make_pair("#ffffff", "#767676");
        let result = check_contrast(&pair, "#ffffff");
        // Ratio should be rounded to 2 decimal places (like TS version)
        let rounded = (result.ratio * 100.0).round() / 100.0;
        assert!((result.ratio - rounded).abs() < 0.001);
    }

    #[test]
    fn apca_lc_computed() {
        let pair = make_pair("#ffffff", "#000000");
        let result = check_contrast(&pair, "#ffffff");
        assert!(result.apca_lc.is_some());
        let lc = result.apca_lc.unwrap();
        // calc_apca_lc("#000000", "#ffffff") → ~106.0 (dark text on light bg → positive)
        assert!((lc - 106.0).abs() < 1.0, "got {lc}");
    }

    #[test]
    fn semi_transparent_fg_composited() {
        // White text 50% alpha on black bg → effective gray
        let mut pair = make_pair("#000000", "#ffffff");
        pair.text_alpha = Some(0.5);
        let result = check_contrast(&pair, "#000000");
        // Effective fg ≈ #808080, contrast against #000000 ≈ 5.3:1
        assert!(result.ratio > 4.0 && result.ratio < 6.0);
    }

    #[test]
    fn semi_transparent_bg_composited_against_page() {
        // Semi-transparent bg composited against page bg first
        let mut pair = make_pair("#000000", "#000000");
        pair.bg_alpha = Some(0.5); // 50% black on white page → gray bg
        let result = check_contrast(&pair, "#ffffff");
        // Effective bg ≈ #808080, black text on gray → ~5.3:1
        assert!(result.ratio > 4.0 && result.ratio < 6.0);
    }

    #[test]
    fn missing_text_hex_skipped() {
        let mut pair = make_pair("#ffffff", "#000000");
        pair.text_hex = None;
        let result = check_all_pairs(&[pair], "AA", "#ffffff");
        assert_eq!(result.violations.len(), 0);
        assert_eq!(result.passed.len(), 0);
        assert_eq!(result.skipped_count, 1);
    }

    #[test]
    fn missing_bg_hex_skipped() {
        let mut pair = make_pair("#ffffff", "#000000");
        pair.bg_hex = None;
        let result = check_all_pairs(&[pair], "AA", "#ffffff");
        assert_eq!(result.violations.len(), 0);
        assert_eq!(result.passed.len(), 0);
        assert_eq!(result.skipped_count, 1);
    }

    // --- check_all_pairs tests ---

    #[test]
    fn high_contrast_passes_aa() {
        let pair = make_pair("#ffffff", "#000000");
        let result = check_all_pairs(&[pair], "AA", "#ffffff");
        assert_eq!(result.violations.len(), 0);
        assert_eq!(result.passed.len(), 1);
    }

    #[test]
    fn low_contrast_fails_aa() {
        // Light gray on white → low contrast
        let pair = make_pair("#ffffff", "#cccccc");
        let result = check_all_pairs(&[pair], "AA", "#ffffff");
        assert_eq!(result.violations.len(), 1);
        assert_eq!(result.passed.len(), 0);
    }

    #[test]
    fn ignored_pair_goes_to_ignored() {
        let mut pair = make_pair("#ffffff", "#cccccc"); // low contrast
        pair.ignored = Some(true);
        pair.ignore_reason = Some("test ignore".to_string());
        let result = check_all_pairs(&[pair], "AA", "#ffffff");
        assert_eq!(result.violations.len(), 0);
        assert_eq!(result.passed.len(), 0);
        assert_eq!(result.ignored_count, 1);
        assert_eq!(result.ignored.len(), 1);
    }

    #[test]
    fn disabled_pair_skipped() {
        let mut pair = make_pair("#ffffff", "#cccccc");
        pair.is_disabled = Some(true);
        let result = check_all_pairs(&[pair], "AA", "#ffffff");
        assert_eq!(result.violations.len(), 0);
        assert_eq!(result.skipped_count, 1);
    }

    #[test]
    fn non_text_pair_uses_large_text_threshold() {
        // 3.5:1 ratio would fail AA for normal text (4.5:1) but pass for non-text (3:1)
        let mut pair = make_pair("#ffffff", "#949494"); // ~3.5:1
        pair.pair_type = Some("border".to_string());
        let result = check_all_pairs(&[pair], "AA", "#ffffff");
        assert_eq!(result.violations.len(), 0);
        assert_eq!(result.passed.len(), 1);
    }

    #[test]
    fn large_text_uses_large_threshold() {
        // 3.5:1 would fail AA normal but pass AA large
        let mut pair = make_pair("#ffffff", "#949494"); // ~3.5:1
        pair.is_large_text = Some(true);
        let result = check_all_pairs(&[pair], "AA", "#ffffff");
        assert_eq!(result.violations.len(), 0);
        assert_eq!(result.passed.len(), 1);
    }

    #[test]
    fn aaa_threshold_stricter() {
        // ~5:1 ratio → passes AA but fails AAA
        let mut pair = make_pair("#ffffff", "#757575");
        pair.is_large_text = Some(false);
        let result = check_all_pairs(&[pair], "AAA", "#ffffff");
        assert_eq!(result.violations.len(), 1);
    }

    #[test]
    fn multiple_pairs_categorized() {
        let pairs = vec![
            make_pair("#ffffff", "#000000"), // high contrast → pass
            make_pair("#ffffff", "#cccccc"), // low contrast → violation
        ];
        let result = check_all_pairs(&pairs, "AA", "#ffffff");
        assert_eq!(result.violations.len(), 1);
        assert_eq!(result.passed.len(), 1);
    }
}
