use super::visitor::JsxVisitor;

/// Override information parsed from `@a11y-context` annotations.
#[derive(Debug, Clone)]
pub struct ContextOverride {
    pub bg: Option<String>,
    pub fg: Option<String>,
    pub no_inherit: bool,
}

/// Parses per-element annotations from JSX comments.
///
/// Handles two annotation types:
/// - `@a11y-context bg:<class> [fg:<class>] [no-inherit]` — context override for next element
/// - `a11y-ignore[: <reason>]` — suppression for next element
///
/// Block annotations (`@a11y-context-block`) are handled by ContextTracker, NOT here.
///
/// Port of: src/plugins/jsx/categorizer.ts → getContextOverrideForLine(), getIgnoreReasonForLine()
pub struct AnnotationParser {
    /// Pending @a11y-context for next element (consumed on take)
    pending_context: Option<ContextOverride>,
    /// Pending a11y-ignore for next element (consumed on take)
    pending_ignore: Option<String>,
}

impl AnnotationParser {
    pub fn new() -> Self {
        Self {
            pending_context: None,
            pending_ignore: None,
        }
    }

    /// Take and consume the pending context override, if any.
    /// Returns None if no pending override, or if already consumed.
    pub fn take_pending_context(&mut self) -> Option<ContextOverride> {
        self.pending_context.take()
    }

    /// Take and consume the pending ignore reason, if any.
    /// Returns None if no pending ignore, or if already consumed.
    pub fn take_pending_ignore(&mut self) -> Option<String> {
        self.pending_ignore.take()
    }
}

impl JsxVisitor for AnnotationParser {
    fn on_comment(&mut self, content: &str, _line: u32) {
        let trimmed = content.trim();

        // Skip block annotations — those are handled by ContextTracker
        if trimmed.starts_with("@a11y-context-block") {
            return;
        }

        // Check for @a11y-context (single-element override)
        if let Some(body) = trimmed.strip_prefix("@a11y-context") {
            if let Some(ctx) = parse_context_params(body) {
                self.pending_context = Some(ctx);
            }
            return;
        }

        // Check for a11y-ignore (suppression)
        if let Some(rest) = trimmed.strip_prefix("a11y-ignore") {
            let reason = if let Some(after_colon) = rest.strip_prefix(':') {
                after_colon.trim().to_string()
            } else {
                String::new()
            };
            self.pending_ignore = Some(reason);
        }
    }
}

/// Parse `bg:<class> [fg:<class>] [no-inherit]` tokens from annotation body.
///
/// Port of: src/plugins/jsx/categorizer.ts → parseContextParams()
fn parse_context_params(param_string: &str) -> Option<ContextOverride> {
    let mut ctx = ContextOverride {
        bg: None,
        fg: None,
        no_inherit: false,
    };

    for token in param_string.trim().split_whitespace() {
        if let Some(bg) = token.strip_prefix("bg:") {
            ctx.bg = Some(bg.to_string());
        } else if let Some(fg) = token.strip_prefix("fg:") {
            ctx.fg = Some(fg.to_string());
        } else if token == "no-inherit" {
            ctx.no_inherit = true;
        }
    }

    // Must have at least bg or fg to be valid (matches TS behavior)
    if ctx.bg.is_none() && ctx.fg.is_none() {
        return None;
    }

    Some(ctx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_a11y_context_bg() {
        let mut ap = AnnotationParser::new();
        ap.on_comment(" @a11y-context bg:#09090b", 1);
        let ctx = ap.take_pending_context().unwrap();
        assert_eq!(ctx.bg, Some("#09090b".to_string()));
        assert_eq!(ctx.fg, None);
        assert!(!ctx.no_inherit);
    }

    #[test]
    fn parse_a11y_context_bg_and_fg() {
        let mut ap = AnnotationParser::new();
        ap.on_comment(" @a11y-context bg:bg-slate-900 fg:text-white", 1);
        let ctx = ap.take_pending_context().unwrap();
        assert_eq!(ctx.bg, Some("bg-slate-900".to_string()));
        assert_eq!(ctx.fg, Some("text-white".to_string()));
    }

    #[test]
    fn parse_a11y_context_no_inherit() {
        let mut ap = AnnotationParser::new();
        ap.on_comment(" @a11y-context bg:#fff no-inherit", 1);
        let ctx = ap.take_pending_context().unwrap();
        assert_eq!(ctx.bg, Some("#fff".to_string()));
        assert!(ctx.no_inherit);
    }

    #[test]
    fn parse_a11y_context_fg_only() {
        let mut ap = AnnotationParser::new();
        ap.on_comment(" @a11y-context fg:text-red-500", 1);
        let ctx = ap.take_pending_context().unwrap();
        assert_eq!(ctx.bg, None);
        assert_eq!(ctx.fg, Some("text-red-500".to_string()));
    }

    #[test]
    fn parse_a11y_context_no_params_invalid() {
        let mut ap = AnnotationParser::new();
        ap.on_comment(" @a11y-context", 1);
        // No bg or fg → invalid, should be None
        assert!(ap.take_pending_context().is_none());
    }

    #[test]
    fn parse_a11y_context_only_no_inherit_invalid() {
        let mut ap = AnnotationParser::new();
        ap.on_comment(" @a11y-context no-inherit", 1);
        // Only no-inherit without bg/fg → invalid
        assert!(ap.take_pending_context().is_none());
    }

    #[test]
    fn parse_a11y_ignore_with_reason() {
        let mut ap = AnnotationParser::new();
        ap.on_comment(" a11y-ignore: dynamic background", 1);
        let reason = ap.take_pending_ignore().unwrap();
        assert_eq!(reason, "dynamic background");
    }

    #[test]
    fn parse_a11y_ignore_no_reason() {
        let mut ap = AnnotationParser::new();
        ap.on_comment(" a11y-ignore", 1);
        let reason = ap.take_pending_ignore().unwrap();
        assert_eq!(reason, "");
    }

    #[test]
    fn parse_a11y_ignore_colon_no_space() {
        let mut ap = AnnotationParser::new();
        ap.on_comment(" a11y-ignore:no-space-reason", 1);
        let reason = ap.take_pending_ignore().unwrap();
        assert_eq!(reason, "no-space-reason");
    }

    #[test]
    fn pending_consumed_once() {
        let mut ap = AnnotationParser::new();
        ap.on_comment(" @a11y-context bg:#fff", 1);
        assert!(ap.take_pending_context().is_some());
        assert!(ap.take_pending_context().is_none()); // consumed
    }

    #[test]
    fn pending_ignore_consumed_once() {
        let mut ap = AnnotationParser::new();
        ap.on_comment(" a11y-ignore: reason", 1);
        assert!(ap.take_pending_ignore().is_some());
        assert!(ap.take_pending_ignore().is_none()); // consumed
    }

    #[test]
    fn block_comment_not_captured() {
        let mut ap = AnnotationParser::new();
        ap.on_comment(" @a11y-context-block bg:bg-slate-900", 1);
        // Block annotations go to ContextTracker, not AnnotationParser
        assert!(ap.take_pending_context().is_none());
    }

    #[test]
    fn newer_annotation_replaces_pending() {
        let mut ap = AnnotationParser::new();
        ap.on_comment(" @a11y-context bg:#111", 1);
        ap.on_comment(" @a11y-context bg:#222", 2);
        let ctx = ap.take_pending_context().unwrap();
        assert_eq!(ctx.bg, Some("#222".to_string()));
    }

    #[test]
    fn both_context_and_ignore_pending() {
        let mut ap = AnnotationParser::new();
        ap.on_comment(" @a11y-context bg:#111", 1);
        ap.on_comment(" a11y-ignore: reason", 2);
        assert!(ap.take_pending_context().is_some());
        assert!(ap.take_pending_ignore().is_some());
    }
}
