use std::collections::HashSet;

use super::visitor::JsxVisitor;

/// Detects disabled elements in JSX by scanning for `disabled` attributes
/// and `aria-disabled="true"` patterns.
///
/// Native-only feature (US-07): not present in the TS parser.
/// Disabled elements are excluded from contrast checking since WCAG 2.1
/// SC 1.4.3 does not apply to inactive UI components.
pub struct DisabledDetector {
    /// Set of 1-based line numbers where disabled elements were found
    disabled_lines: HashSet<u32>,
    /// Current line being tracked (set during on_tag_open)
    current_line: u32,
}

impl DisabledDetector {
    pub fn new() -> Self {
        Self {
            disabled_lines: HashSet::new(),
            current_line: 0,
        }
    }

    /// Check if a given line has a disabled element.
    pub fn is_disabled_at(&self, line: u32) -> bool {
        self.disabled_lines.contains(&line)
    }

    /// Mark a specific line as disabled (used by the orchestrator when combining
    /// with tokenizer line tracking).
    pub fn mark_disabled(&mut self, line: u32) {
        self.disabled_lines.insert(line);
    }
}

impl JsxVisitor for DisabledDetector {
    fn on_tag_open(&mut self, _tag_name: &str, _is_self_closing: bool, raw_tag: &str) {
        if is_disabled_tag(raw_tag) {
            // We don't have line info in on_tag_open from the visitor trait directly,
            // but the orchestrator can provide it. For now, track via current_line.
            if self.current_line > 0 {
                self.disabled_lines.insert(self.current_line);
            }
        }
    }
}

/// Check if a raw JSX tag contains disabled indicators.
///
/// Detects:
/// - `disabled` as a standalone boolean attribute
/// - `disabled={true}` or `disabled={someVar}`
/// - `aria-disabled="true"` or `aria-disabled={"true"}` or `aria-disabled={true}`
///
/// Does NOT detect:
/// - `disabled={false}` — explicitly not disabled
/// - `aria-disabled="false"` — explicitly not disabled
pub fn is_disabled_tag(raw_tag: &str) -> bool {
    let bytes = raw_tag.as_bytes();
    let len = bytes.len();

    // Check for aria-disabled="true" / aria-disabled={true} / aria-disabled={"true"}
    if let Some(pos) = raw_tag.find("aria-disabled") {
        let after = pos + "aria-disabled".len();
        if after < len {
            let rest = &raw_tag[after..];
            // aria-disabled="true"
            if rest.starts_with("=\"true\"") || rest.starts_with("='true'") {
                return true;
            }
            // aria-disabled={true}
            if rest.starts_with("={true}") {
                return true;
            }
            // aria-disabled={"true"}
            if rest.starts_with("={\"true\"}") || rest.starts_with("={'true'}") {
                return true;
            }
            // aria-disabled="false" or ={false} — explicitly not disabled, skip
        }
    }

    // Check for standalone `disabled` attribute (not part of aria-disabled)
    // Must be preceded by whitespace and followed by whitespace, = or >
    let disabled_bytes = b"disabled";
    let mut i = 0;
    while i + disabled_bytes.len() <= len {
        if &bytes[i..i + disabled_bytes.len()] == disabled_bytes {
            // Check it's not part of "aria-disabled"
            if i >= 5 && &bytes[i - 5..i] == b"aria-" {
                i += disabled_bytes.len();
                continue;
            }

            // Check preceding char is a word boundary
            if i > 0
                && bytes[i - 1] != b' '
                && bytes[i - 1] != b'\t'
                && bytes[i - 1] != b'\n'
                && bytes[i - 1] != b'\r'
            {
                i += 1;
                continue;
            }

            let after_pos = i + disabled_bytes.len();
            if after_pos >= len {
                return true; // `disabled` at end of tag
            }

            let after_ch = bytes[after_pos];

            // disabled (standalone boolean attribute — followed by space, >, or /)
            if after_ch == b' '
                || after_ch == b'\t'
                || after_ch == b'\n'
                || after_ch == b'>'
                || after_ch == b'/'
            {
                return true;
            }

            // disabled={...} — check it's not disabled={false}
            if after_ch == b'=' {
                let eq_after = after_pos + 1;
                if eq_after < len {
                    let rest = &raw_tag[eq_after..];
                    // disabled={false} — not disabled
                    if rest.starts_with("{false}") {
                        i += disabled_bytes.len();
                        continue;
                    }
                    // disabled={true} or disabled={someVar} — disabled
                    return true;
                }
            }
        }
        i += 1;
    }

    false
}

/// Check if a class string contains `disabled:` variant prefix,
/// indicating the element has disabled styling.
pub fn has_disabled_variant(class_content: &str) -> bool {
    class_content.split_whitespace().any(|cls| cls.starts_with("disabled:"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── is_disabled_tag tests ──

    #[test]
    fn detect_disabled_boolean_attribute() {
        assert!(is_disabled_tag(r#"<button disabled className="text-gray-400">"#));
    }

    #[test]
    fn detect_disabled_boolean_self_closing() {
        assert!(is_disabled_tag(r#"<input disabled />"#));
    }

    #[test]
    fn detect_disabled_true() {
        assert!(is_disabled_tag(r#"<button disabled={true} className="text-gray-400">"#));
    }

    #[test]
    fn detect_disabled_variable() {
        assert!(is_disabled_tag(r#"<button disabled={isDisabled} className="text-gray-400">"#));
    }

    #[test]
    fn detect_aria_disabled_string_true() {
        assert!(is_disabled_tag(r#"<div aria-disabled="true" className="text-gray-400">"#));
    }

    #[test]
    fn detect_aria_disabled_bool_true() {
        assert!(is_disabled_tag(r#"<div aria-disabled={true} className="text-gray-400">"#));
    }

    #[test]
    fn detect_aria_disabled_string_expr_true() {
        assert!(is_disabled_tag(r#"<div aria-disabled={"true"} className="text-gray-400">"#));
    }

    #[test]
    fn not_disabled_without_attribute() {
        assert!(!is_disabled_tag(r#"<button className="text-gray-400">"#));
    }

    #[test]
    fn not_disabled_false() {
        assert!(!is_disabled_tag(r#"<button disabled={false} className="text-gray-400">"#));
    }

    #[test]
    fn not_disabled_aria_false() {
        assert!(!is_disabled_tag(r#"<div aria-disabled="false" className="text-gray-400">"#));
    }

    #[test]
    fn disabled_at_end_of_tag() {
        assert!(is_disabled_tag(r#"<button disabled>"#));
    }

    #[test]
    fn disabled_before_close() {
        assert!(is_disabled_tag(r#"<input type="text" disabled />"#));
    }

    #[test]
    fn not_matched_inside_classname() {
        // "disabled" inside a className value should not trigger
        // In this case it's part of "text-disabled" — no word boundary before "disabled"
        assert!(!is_disabled_tag(r#"<div className="text-disabled">"#));
    }

    // ── has_disabled_variant tests ──

    #[test]
    fn variant_disabled_colon() {
        assert!(has_disabled_variant("disabled:opacity-50 text-gray-400"));
    }

    #[test]
    fn variant_disabled_multiple() {
        assert!(has_disabled_variant("bg-red-500 disabled:bg-gray-300 text-white"));
    }

    #[test]
    fn no_variant() {
        assert!(!has_disabled_variant("bg-red-500 text-white"));
    }

    #[test]
    fn disabled_not_variant() {
        // Just "disabled" without colon is not a variant
        assert!(!has_disabled_variant("disabled text-white"));
    }

    // ── DisabledDetector struct tests ──

    #[test]
    fn detector_marks_line() {
        let mut dd = DisabledDetector::new();
        dd.current_line = 5;
        dd.on_tag_open("button", false, r#"<button disabled className="text-gray-400">"#);
        assert!(dd.is_disabled_at(5));
        assert!(!dd.is_disabled_at(1));
    }

    #[test]
    fn detector_mark_disabled_directly() {
        let mut dd = DisabledDetector::new();
        dd.mark_disabled(10);
        assert!(dd.is_disabled_at(10));
    }

    #[test]
    fn detector_not_disabled_skips() {
        let mut dd = DisabledDetector::new();
        dd.current_line = 5;
        dd.on_tag_open("button", false, r#"<button className="text-gray-400">"#);
        assert!(!dd.is_disabled_at(5));
    }
}
