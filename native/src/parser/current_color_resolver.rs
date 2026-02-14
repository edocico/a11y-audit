use super::visitor::JsxVisitor;

/// Non-color text-* utility prefixes to exclude from color tracking.
/// These are Tailwind utilities that start with `text-` but don't set a color.
const TEXT_NON_COLOR_PREFIXES: &[&str] = &[
    // Font size: text-xs, text-sm, text-base, text-lg, text-xl, text-2xl..text-9xl
    "text-xs",
    "text-sm",
    "text-base",
    "text-lg",
    "text-xl",
    // text-2xl through text-9xl are caught by starts_with_digit_after_text_dash below
    // Text alignment
    "text-left",
    "text-center",
    "text-right",
    "text-justify",
    "text-start",
    "text-end",
    // Text wrapping
    "text-wrap",
    "text-nowrap",
    "text-balance",
    "text-pretty",
    // Text overflow
    "text-ellipsis",
    "text-clip",
    "text-truncate",
    // Text decoration (these are separate utilities but listed for safety)
    "text-decoration-",
];

/// Tracks inherited text color across JSX nesting for resolving `currentColor`.
///
/// Native-only feature (US-08): the TS parser flags `unresolved_current_color`
/// but doesn't resolve it. This visitor maintains a stack so we can look up
/// the nearest ancestor's text color class.
///
/// When a JSX tag has a `text-{color}` class (not a size/alignment utility),
/// it's pushed onto the stack. When the tag closes, it's popped.
pub struct CurrentColorResolver {
    /// Stack of (tag_name, text_color_class) pairs
    color_stack: Vec<StackEntry>,
}

struct StackEntry {
    tag: String,
    color_class: String,
}

impl CurrentColorResolver {
    pub fn new() -> Self {
        Self {
            color_stack: Vec::new(),
        }
    }

    /// Get the current inherited text color class, if any.
    /// Returns None if no ancestor defines a text color in this scope.
    pub fn current_color(&self) -> Option<&str> {
        self.color_stack.last().map(|e| e.color_class.as_str())
    }
}

impl JsxVisitor for CurrentColorResolver {
    fn on_tag_open(&mut self, tag_name: &str, is_self_closing: bool, raw_tag: &str) {
        if is_self_closing {
            return;
        }

        if let Some(color_class) = find_text_color_in_raw_tag(raw_tag) {
            self.color_stack.push(StackEntry {
                tag: tag_name.to_string(),
                color_class,
            });
        }
    }

    fn on_tag_close(&mut self, tag_name: &str) {
        // Pop matching entry from top of stack
        if let Some(last) = self.color_stack.last() {
            if last.tag == tag_name {
                self.color_stack.pop();
                return;
            }
        }

        // Search deeper for a match (handles interleaved closes)
        if let Some(idx) = self.color_stack.iter().rposition(|e| e.tag == tag_name) {
            self.color_stack.truncate(idx);
        }
    }
}

/// Find the first text-{color} class in a raw JSX tag string.
/// Skips variant-prefixed (dark:text-*, hover:text-*) and non-color text utilities.
fn find_text_color_in_raw_tag(raw_tag: &str) -> Option<String> {
    let bytes = raw_tag.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i + 5 < len {
        // Look for 'text-' pattern
        if bytes[i] == b't'
            && bytes[i + 1] == b'e'
            && bytes[i + 2] == b'x'
            && bytes[i + 3] == b't'
            && bytes[i + 4] == b'-'
        {
            // Check that previous char is NOT ':' (skip variant-prefixed like dark:text-*)
            if i > 0 && bytes[i - 1] == b':' {
                i += 1;
                continue;
            }

            // Check that previous char is a word boundary
            if i > 0
                && !bytes[i - 1].is_ascii_whitespace()
                && bytes[i - 1] != b'"'
                && bytes[i - 1] != b'\''
                && bytes[i - 1] != b'`'
                && bytes[i - 1] != b'('
                && bytes[i - 1] != b','
            {
                i += 1;
                continue;
            }

            // Extract the full class name
            let start = i;
            let mut end = i;
            while end < len
                && !bytes[end].is_ascii_whitespace()
                && bytes[end] != b'"'
                && bytes[end] != b'\''
                && bytes[end] != b'`'
                && bytes[end] != b')'
                && bytes[end] != b','
            {
                end += 1;
            }
            let cls = &raw_tag[start..end];

            // Skip non-color text utilities
            if is_non_color_text_utility(cls) {
                i = end;
                continue;
            }

            return Some(cls.to_string());
        }

        i += 1;
    }

    None
}

/// Check if a text-* class is a non-color utility (size, alignment, wrap, etc.)
fn is_non_color_text_utility(cls: &str) -> bool {
    // Exact matches against known non-color prefixes
    for prefix in TEXT_NON_COLOR_PREFIXES {
        if cls == *prefix || cls.starts_with(&format!("{}/", prefix)) {
            return true;
        }
    }

    // text-2xl through text-9xl (digit after "text-")
    let after_dash = &cls["text-".len()..];
    if after_dash.starts_with(|c: char| c.is_ascii_digit()) {
        return true;
    }

    // text-opacity-* is a modifier, not a color
    if cls.starts_with("text-opacity-") {
        return true;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── CurrentColorResolver struct tests ──

    #[test]
    fn no_color_returns_none() {
        let resolver = CurrentColorResolver::new();
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn inherits_parent_text_color() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r##"<div className="text-red-500">"##);
        assert_eq!(resolver.current_color(), Some("text-red-500"));
    }

    #[test]
    fn nested_color_overrides() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r##"<div className="text-red-500">"##);
        resolver.on_tag_open("span", false, r##"<span className="text-blue-500">"##);
        assert_eq!(resolver.current_color(), Some("text-blue-500"));
        resolver.on_tag_close("span");
        assert_eq!(resolver.current_color(), Some("text-red-500"));
    }

    #[test]
    fn self_closing_no_push() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("hr", true, r##"<hr className="text-red-500" />"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn pop_restores_previous() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r##"<div className="text-red-500">"##);
        resolver.on_tag_close("div");
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn no_text_class_no_push() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r##"<div className="bg-red-500 p-4">"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn text_foreground_class() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r##"<div className="text-foreground">"##);
        assert_eq!(resolver.current_color(), Some("text-foreground"));
    }

    #[test]
    fn text_muted_foreground_class() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("p", false, r##"<p className="text-muted-foreground">"##);
        assert_eq!(resolver.current_color(), Some("text-muted-foreground"));
    }

    #[test]
    fn deeply_nested() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r##"<div className="text-red-500">"##);
        resolver.on_tag_open("section", false, "<section>");
        // No text color on section, should inherit from div
        assert_eq!(resolver.current_color(), Some("text-red-500"));
        resolver.on_tag_open("p", false, r##"<p className="text-blue-300">"##);
        assert_eq!(resolver.current_color(), Some("text-blue-300"));
        resolver.on_tag_close("p");
        assert_eq!(resolver.current_color(), Some("text-red-500"));
        resolver.on_tag_close("section");
        assert_eq!(resolver.current_color(), Some("text-red-500"));
        resolver.on_tag_close("div");
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn text_with_opacity_modifier() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r##"<div className="text-red-500/75">"##);
        assert_eq!(resolver.current_color(), Some("text-red-500/75"));
    }

    // ── Non-color text utility exclusion tests ──

    #[test]
    fn skip_text_size_xs() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("p", false, r##"<p className="text-xs">"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn skip_text_size_sm() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("p", false, r##"<p className="text-sm">"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn skip_text_size_base() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("p", false, r##"<p className="text-base">"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn skip_text_size_lg() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("p", false, r##"<p className="text-lg">"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn skip_text_size_xl() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("p", false, r##"<p className="text-xl">"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn skip_text_size_2xl() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("h1", false, r##"<h1 className="text-2xl">"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn skip_text_size_9xl() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("h1", false, r##"<h1 className="text-9xl">"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn skip_text_align_center() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r##"<div className="text-center">"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn skip_text_align_left() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r##"<div className="text-left">"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn skip_text_wrap() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r##"<div className="text-wrap">"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn skip_text_nowrap() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r##"<div className="text-nowrap">"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn skip_text_ellipsis() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r##"<div className="text-ellipsis">"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn skip_text_balance() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r##"<div className="text-balance">"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn skip_text_pretty() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r##"<div className="text-pretty">"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn skip_text_opacity() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r##"<div className="text-opacity-50">"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn skip_variant_prefix() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r##"<div className="dark:text-red-500">"##);
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn picks_first_color_class() {
        // When both size and color present, picks the color
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("p", false, r##"<p className="text-sm text-red-500">"##);
        assert_eq!(resolver.current_color(), Some("text-red-500"));
    }

    #[test]
    fn color_before_size() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("p", false, r##"<p className="text-red-500 text-sm">"##);
        assert_eq!(resolver.current_color(), Some("text-red-500"));
    }

    // ── find_text_color_in_raw_tag unit tests ──

    #[test]
    fn find_simple_color() {
        assert_eq!(
            find_text_color_in_raw_tag(r##"<div className="text-white">"##),
            Some("text-white".to_string())
        );
    }

    #[test]
    fn find_color_with_shade() {
        assert_eq!(
            find_text_color_in_raw_tag(r##"<div className="text-red-500">"##),
            Some("text-red-500".to_string())
        );
    }

    #[test]
    fn find_none_for_size() {
        assert_eq!(
            find_text_color_in_raw_tag(r##"<div className="text-sm">"##),
            None
        );
    }

    #[test]
    fn find_none_for_alignment() {
        assert_eq!(
            find_text_color_in_raw_tag(r##"<div className="text-center">"##),
            None
        );
    }

    #[test]
    fn find_skips_variant() {
        assert_eq!(
            find_text_color_in_raw_tag(r##"<div className="hover:text-red-500">"##),
            None
        );
    }

    #[test]
    fn find_color_among_mixed_classes() {
        assert_eq!(
            find_text_color_in_raw_tag(r##"<div className="bg-white text-sm text-foreground p-4">"##),
            Some("text-foreground".to_string())
        );
    }

    // ── is_non_color_text_utility tests ──

    #[test]
    fn non_color_sizes() {
        assert!(is_non_color_text_utility("text-xs"));
        assert!(is_non_color_text_utility("text-sm"));
        assert!(is_non_color_text_utility("text-base"));
        assert!(is_non_color_text_utility("text-lg"));
        assert!(is_non_color_text_utility("text-xl"));
        assert!(is_non_color_text_utility("text-2xl"));
        assert!(is_non_color_text_utility("text-3xl"));
        assert!(is_non_color_text_utility("text-9xl"));
    }

    #[test]
    fn non_color_alignment() {
        assert!(is_non_color_text_utility("text-left"));
        assert!(is_non_color_text_utility("text-center"));
        assert!(is_non_color_text_utility("text-right"));
        assert!(is_non_color_text_utility("text-justify"));
        assert!(is_non_color_text_utility("text-start"));
        assert!(is_non_color_text_utility("text-end"));
    }

    #[test]
    fn non_color_wrap() {
        assert!(is_non_color_text_utility("text-wrap"));
        assert!(is_non_color_text_utility("text-nowrap"));
        assert!(is_non_color_text_utility("text-balance"));
        assert!(is_non_color_text_utility("text-pretty"));
    }

    #[test]
    fn non_color_overflow() {
        assert!(is_non_color_text_utility("text-ellipsis"));
        assert!(is_non_color_text_utility("text-clip"));
        assert!(is_non_color_text_utility("text-truncate"));
    }

    #[test]
    fn color_not_excluded() {
        assert!(!is_non_color_text_utility("text-white"));
        assert!(!is_non_color_text_utility("text-red-500"));
        assert!(!is_non_color_text_utility("text-foreground"));
        assert!(!is_non_color_text_utility("text-muted-foreground"));
        assert!(!is_non_color_text_utility("text-red-500/75"));
    }
}
