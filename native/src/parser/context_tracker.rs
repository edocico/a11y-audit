use std::collections::HashMap;

use super::visitor::JsxVisitor;

/// BG utility classes that are NOT color classes — skip these when detecting explicit bg.
const BG_NON_COLOR: &[&str] = &[
    "bg-clip-text",
    "bg-no-repeat",
    "bg-cover",
    "bg-contain",
    "bg-fixed",
    "bg-local",
    "bg-scroll",
];

/// Tracks the context background across nested JSX containers.
///
/// Manages a LIFO stack where each entry represents a container component
/// (e.g. Card, Dialog) or an `@a11y-context-block` annotation that overrides
/// the background for its children.
///
/// Port of: context stack logic in src/plugins/jsx/parser.ts
pub struct ContextTracker {
    /// Component → bg class mapping (from config, injected)
    container_config: HashMap<String, String>,
    /// Default background class (e.g. "bg-background")
    default_bg: String,
    /// LIFO stack: (tag_name, bg_class, is_annotation)
    stack: Vec<StackEntry>,
    /// Pending @a11y-context-block annotation to apply on next tag open
    pending_block_override: Option<String>,
}

struct StackEntry {
    tag: String,
    bg_class: String,
    #[allow(dead_code)]
    is_annotation: bool,
    cumulative_opacity: f32,
}

impl ContextTracker {
    pub fn new(container_config: HashMap<String, String>, default_bg: String) -> Self {
        Self {
            container_config,
            default_bg,
            stack: Vec::new(),
            pending_block_override: None,
        }
    }

    /// Get the current effective background class (top of stack or default).
    pub fn current_bg(&self) -> &str {
        self.stack
            .last()
            .map(|e| e.bg_class.as_str())
            .unwrap_or(&self.default_bg)
    }

    /// Get the current cumulative opacity (top of stack or 1.0 if empty).
    pub fn current_opacity(&self) -> f32 {
        self.stack
            .last()
            .map(|e| e.cumulative_opacity)
            .unwrap_or(1.0)
    }

    /// Resolve any pending @a11y-context-block annotation by pushing it onto the stack.
    /// Call this BEFORE capturing pre_tag_open_bg in the orchestrator, so that
    /// block annotations count as parent context (not as the tag's own bg).
    pub fn resolve_pending_block(&mut self, tag_name: &str, is_self_closing: bool) {
        if let Some(bg) = self.pending_block_override.take() {
            if !is_self_closing {
                self.stack.push(StackEntry {
                    tag: format!("_annotation_{}", tag_name),
                    bg_class: bg,
                    is_annotation: true,
                    cumulative_opacity: self.current_opacity(),
                });
            }
        }
    }
}

impl JsxVisitor for ContextTracker {
    fn on_tag_open(&mut self, tag_name: &str, is_self_closing: bool, raw_tag: &str) {
        // NOTE: pending @a11y-context-block is handled by resolve_pending_block(),
        // called by the orchestrator BEFORE this method. When used standalone
        // (without orchestrator), call resolve_pending_block manually first.

        if is_self_closing {
            return;
        }

        // Detect opacity-* class in the raw tag (US-05)
        let opacity = super::opacity::find_opacity_in_raw_tag(raw_tag);
        let parent_opacity = self.current_opacity();
        let cumulative = parent_opacity * opacity.unwrap_or(1.0);

        // Check if this is a configured container component
        if let Some(config_bg) = self.container_config.get(tag_name).cloned() {
            // Check for explicit bg-* class in the tag that overrides the config
            let explicit_bg = find_explicit_bg_in_raw_tag(raw_tag);
            let bg = explicit_bg.unwrap_or(config_bg);
            self.stack.push(StackEntry {
                tag: tag_name.to_string(),
                bg_class: bg,
                is_annotation: false,
                cumulative_opacity: cumulative,
            });
            return;
        }

        // Check for explicit bg-* class on any non-container tag
        if let Some(bg) = find_explicit_bg_in_raw_tag(raw_tag) {
            self.stack.push(StackEntry {
                tag: tag_name.to_string(),
                bg_class: bg,
                is_annotation: false,
                cumulative_opacity: cumulative,
            });
            return;
        }

        // Opacity-only tag: no container config, no explicit bg-*
        // Push an entry that inherits the parent's bg but tracks cumulative opacity
        if opacity.is_some() {
            self.stack.push(StackEntry {
                tag: tag_name.to_string(),
                bg_class: self.current_bg().to_string(),
                is_annotation: false,
                cumulative_opacity: cumulative,
            });
        }
    }

    fn on_tag_close(&mut self, tag_name: &str) {
        // Pop matching container or annotation entry
        if let Some(last) = self.stack.last() {
            if last.tag == tag_name {
                self.stack.pop();
                return;
            }
            // Check for annotation block pop
            let annotation_key = format!("_annotation_{}", tag_name);
            if last.tag == annotation_key {
                self.stack.pop();
                return;
            }
        }

        // Search deeper in the stack for a match (handles interleaved pops)
        if let Some(idx) = self.stack.iter().rposition(|e| {
            e.tag == tag_name || e.tag == format!("_annotation_{}", tag_name)
        }) {
            self.stack.truncate(idx);
        }
    }

    fn on_comment(&mut self, content: &str, _line: u32) {
        // Detect @a11y-context-block annotations
        let trimmed = content.trim();
        if let Some(body) = trimmed.strip_prefix("@a11y-context-block") {
            let body = body.trim();
            for token in body.split_whitespace() {
                if let Some(bg) = token.strip_prefix("bg:") {
                    self.pending_block_override = Some(bg.to_string());
                }
            }
        }
    }
}

/// Find first explicit bg-* color class in a raw tag string.
/// Skips variant-prefixed (dark:bg-*, hover:bg-*) and non-color bg utilities.
fn find_explicit_bg_in_raw_tag(raw_tag: &str) -> Option<String> {
    // Use a simple word-boundary scan for bg-* patterns
    let bytes = raw_tag.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        // Look for 'bg-' preceded by whitespace, quote, or start of attribute value
        if i + 3 < len && bytes[i] == b'b' && bytes[i + 1] == b'g' && bytes[i + 2] == b'-' {
            // Check that previous char is a word boundary (not preceded by ':' for variants)
            if i > 0 && bytes[i - 1] == b':' {
                i += 1;
                continue;
            }
            // Check that previous char is whitespace, quote, or similar delimiter
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
            while i < len && !bytes[i].is_ascii_whitespace()
                && bytes[i] != b'"'
                && bytes[i] != b'\''
                && bytes[i] != b'`'
                && bytes[i] != b')'
                && bytes[i] != b','
            {
                i += 1;
            }
            let cls = &raw_tag[start..i];

            // Skip non-color bg utilities
            if cls.starts_with("bg-linear-")
                || cls.starts_with("bg-gradient-")
                || BG_NON_COLOR.contains(&cls)
            {
                continue;
            }

            return Some(cls.to_string());
        }

        i += 1;
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_config() -> HashMap<String, String> {
        let mut m = HashMap::new();
        m.insert("Card".to_string(), "bg-card".to_string());
        m.insert("Dialog".to_string(), "bg-background".to_string());
        m
    }

    #[test]
    fn default_bg_when_empty() {
        let tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        assert_eq!(tracker.current_bg(), "bg-background");
    }

    #[test]
    fn push_on_container_open() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("Card", false, "<Card>");
        assert_eq!(tracker.current_bg(), "bg-card");
    }

    #[test]
    fn pop_on_container_close() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("Card", false, "<Card>");
        tracker.on_tag_close("Card");
        assert_eq!(tracker.current_bg(), "bg-background");
    }

    #[test]
    fn self_closing_does_not_push() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("Card", true, "<Card />");
        assert_eq!(tracker.current_bg(), "bg-background");
    }

    #[test]
    fn nested_containers() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("Card", false, "<Card>");
        tracker.on_tag_open("Dialog", false, "<Dialog>");
        assert_eq!(tracker.current_bg(), "bg-background"); // Dialog overrides Card
        tracker.on_tag_close("Dialog");
        assert_eq!(tracker.current_bg(), "bg-card"); // Back to Card
    }

    #[test]
    fn annotation_block_pushes() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_comment(" @a11y-context-block bg:bg-slate-900", 1);
        // resolve_pending_block must be called before on_tag_open (orchestrator does this)
        tracker.resolve_pending_block("div", false);
        tracker.on_tag_open("div", false, "<div>");
        assert_eq!(tracker.current_bg(), "bg-slate-900");
        tracker.on_tag_close("div");
        assert_eq!(tracker.current_bg(), "bg-background");
    }

    #[test]
    fn annotation_block_self_closing_no_push() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_comment(" @a11y-context-block bg:bg-slate-900", 1);
        tracker.resolve_pending_block("br", true);
        tracker.on_tag_open("br", true, "<br />");
        // Self-closing tag should not consume the block annotation
        assert_eq!(tracker.current_bg(), "bg-background");
    }

    #[test]
    fn explicit_bg_in_tag_overrides() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("div", false, r#"<div className="bg-red-500">"#);
        assert_eq!(tracker.current_bg(), "bg-red-500");
    }

    #[test]
    fn explicit_bg_overrides_container_config() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("Card", false, r#"<Card className="bg-red-500">"#);
        // Explicit bg in tag overrides configured bg-card
        assert_eq!(tracker.current_bg(), "bg-red-500");
    }

    #[test]
    fn bg_non_color_skipped() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("div", false, r#"<div className="bg-clip-text">"#);
        assert_eq!(tracker.current_bg(), "bg-background");
    }

    #[test]
    fn bg_gradient_skipped() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("div", false, r#"<div className="bg-gradient-to-r">"#);
        assert_eq!(tracker.current_bg(), "bg-background");
    }

    #[test]
    fn variant_prefixed_bg_skipped() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("div", false, r#"<div className="dark:bg-red-500">"#);
        // dark: prefix means it's a variant, should be skipped
        assert_eq!(tracker.current_bg(), "bg-background");
    }

    // ── find_explicit_bg_in_raw_tag unit tests ──

    #[test]
    fn find_bg_in_classname() {
        assert_eq!(
            find_explicit_bg_in_raw_tag(r#"<div className="bg-red-500 text-white">"#),
            Some("bg-red-500".to_string())
        );
    }

    #[test]
    fn find_bg_with_opacity() {
        assert_eq!(
            find_explicit_bg_in_raw_tag(r#"<div className="bg-red-500/50">"#),
            Some("bg-red-500/50".to_string())
        );
    }

    #[test]
    fn find_bg_none_for_non_color() {
        assert_eq!(
            find_explicit_bg_in_raw_tag(r#"<div className="bg-clip-text">"#),
            None
        );
    }

    #[test]
    fn find_bg_skips_gradient() {
        assert_eq!(
            find_explicit_bg_in_raw_tag(r#"<div className="bg-gradient-to-r">"#),
            None
        );
    }

    #[test]
    fn find_bg_skips_variant() {
        assert_eq!(
            find_explicit_bg_in_raw_tag(r#"<div className="dark:bg-red-500">"#),
            None
        );
    }

    // ── Opacity tracking (US-05) ──

    #[test]
    fn default_opacity_is_one() {
        let tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        assert_eq!(tracker.current_opacity(), 1.0);
    }

    #[test]
    fn opacity_class_pushes_entry() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("div", false, r##"<div className="opacity-50">"##);
        assert_eq!(tracker.current_opacity(), 0.5);
    }

    #[test]
    fn opacity_pops_on_close() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("div", false, r##"<div className="opacity-50">"##);
        tracker.on_tag_close("div");
        assert_eq!(tracker.current_opacity(), 1.0);
    }

    #[test]
    fn nested_opacity_multiplies() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("div", false, r##"<div className="opacity-50">"##);
        tracker.on_tag_open("span", false, r##"<span className="opacity-50">"##);
        assert!((tracker.current_opacity() - 0.25).abs() < 0.001);
    }

    #[test]
    fn nested_opacity_restores() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("div", false, r##"<div className="opacity-50">"##);
        tracker.on_tag_open("span", false, r##"<span className="opacity-75">"##);
        assert!((tracker.current_opacity() - 0.375).abs() < 0.001);
        tracker.on_tag_close("span");
        assert_eq!(tracker.current_opacity(), 0.5);
    }

    #[test]
    fn container_with_opacity() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("Card", false, r##"<Card className="opacity-75">"##);
        assert_eq!(tracker.current_bg(), "bg-card");
        assert_eq!(tracker.current_opacity(), 0.75);
    }

    #[test]
    fn self_closing_opacity_no_push() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("img", true, r##"<img className="opacity-50" />"##);
        assert_eq!(tracker.current_opacity(), 1.0);
    }

    #[test]
    fn opacity_arbitrary_value() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("div", false, r##"<div className="opacity-[.33]">"##);
        assert!((tracker.current_opacity() - 0.33).abs() < 0.001);
    }

    #[test]
    fn opacity_zero_tracked() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("div", false, r##"<div className="opacity-0">"##);
        assert_eq!(tracker.current_opacity(), 0.0);
    }

    #[test]
    fn opacity_only_inherits_bg() {
        // When opacity-only tag is pushed, bg should be inherited from parent
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("Card", false, "<Card>");
        tracker.on_tag_open("div", false, r##"<div className="opacity-50">"##);
        assert_eq!(tracker.current_bg(), "bg-card"); // inherited from Card
        assert_eq!(tracker.current_opacity(), 0.5);
    }
}
