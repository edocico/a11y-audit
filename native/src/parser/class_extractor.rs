use crate::types::ClassRegion;
use super::annotation_parser::ContextOverride;

/// Collects className attribute data and builds ClassRegion objects.
///
/// This is NOT a JsxVisitor — it's a builder that receives pre-processed data
/// from the integration orchestrator (Task 14). The orchestrator coordinates
/// between ContextTracker, AnnotationParser, and this struct by calling
/// `record()` with the appropriate context for each className event.
///
/// Port of: the ClassRegion construction logic in src/plugins/jsx/parser.ts
pub struct ClassExtractor {
    regions: Vec<ClassRegion>,
}

impl ClassExtractor {
    pub fn new() -> Self {
        Self {
            regions: Vec::new(),
        }
    }

    /// Record a className attribute event, building a ClassRegion with full context.
    ///
    /// # Arguments
    /// - `content`: the class string (e.g. "bg-red-500 text-white")
    /// - `line`: 1-based line number
    /// - `raw_tag`: full tag string (for inline style extraction)
    /// - `context_bg`: current effective background from ContextTracker
    /// - `context_override`: pending @a11y-context override (consumed)
    /// - `ignore_reason`: pending a11y-ignore reason (consumed)
    /// - `effective_opacity`: US-05 cumulative opacity from ancestors (None = fully opaque)
    pub fn record(
        &mut self,
        content: &str,
        line: u32,
        raw_tag: &str,
        context_bg: &str,
        context_override: Option<ContextOverride>,
        ignore_reason: Option<String>,
        effective_opacity: Option<f32>,
    ) {
        let inline_styles = extract_inline_style_colors(raw_tag);

        // Only store opacity if < 1.0 (saves serialization overhead)
        let opacity = effective_opacity.and_then(|o| {
            if o >= 0.999 { None } else { Some(o as f64) }
        });

        let mut region = ClassRegion {
            content: content.to_string(),
            start_line: line,
            context_bg: context_bg.to_string(),
            inline_color: inline_styles.as_ref().and_then(|s| s.color.clone()),
            inline_background_color: inline_styles.as_ref().and_then(|s| s.background_color.clone()),
            context_override_bg: None,
            context_override_fg: None,
            context_override_no_inherit: None,
            ignored: None,
            ignore_reason: None,
            effective_opacity: opacity,
        };

        // Apply @a11y-context override
        if let Some(ctx) = context_override {
            region.context_override_bg = ctx.bg;
            region.context_override_fg = ctx.fg;
            if ctx.no_inherit {
                region.context_override_no_inherit = Some(true);
            }
        }

        // Apply a11y-ignore suppression
        if let Some(reason) = ignore_reason {
            region.ignored = Some(true);
            region.ignore_reason = Some(if reason.is_empty() {
                "suppressed".to_string()
            } else {
                reason
            });
        }

        self.regions.push(region);
    }

    /// Consume the extractor and return all accumulated ClassRegion objects.
    pub fn into_regions(self) -> Vec<ClassRegion> {
        self.regions
    }

    /// Get a reference to the accumulated regions (for testing/inspection).
    pub fn regions(&self) -> &[ClassRegion] {
        &self.regions
    }
}

/// Inline style colors extracted from a JSX tag.
struct InlineStyleColors {
    color: Option<String>,
    background_color: Option<String>,
}

/// Extract inline style color/backgroundColor from a raw JSX tag string.
///
/// Looks for `style={{ color: "...", backgroundColor: "..." }}` patterns.
///
/// Port of: src/plugins/jsx/parser.ts → extractInlineStyleColors()
fn extract_inline_style_colors(raw_tag: &str) -> Option<InlineStyleColors> {
    // Find style={{ ... }} pattern
    let style_start = raw_tag.find("style={{")?;
    let body_start = style_start + "style={{".len();

    // Find matching closing }}
    let bytes = raw_tag.as_bytes();
    let mut depth = 2; // we're past {{
    let mut i = body_start;
    while i < bytes.len() && depth > 0 {
        if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
        }
        if depth > 0 {
            i += 1;
        }
    }

    if depth != 0 {
        return None;
    }

    let style_body = &raw_tag[body_start..i];

    let color = extract_style_property(style_body, "color");
    let background_color = extract_style_property(style_body, "backgroundColor");

    if color.is_none() && background_color.is_none() {
        return None;
    }

    Some(InlineStyleColors {
        color,
        background_color,
    })
}

/// Extract a string value for a CSS property from a style object body.
/// Matches patterns like: `color: "red"` or `color: '#ff0000'`
fn extract_style_property(style_body: &str, property: &str) -> Option<String> {
    let bytes = style_body.as_bytes();
    let prop_bytes = property.as_bytes();
    let len = bytes.len();

    let mut i = 0;
    while i + prop_bytes.len() < len {
        // Check for word boundary before property name
        if i > 0 && (bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_') {
            i += 1;
            continue;
        }

        if &bytes[i..i + prop_bytes.len()] == prop_bytes {
            let after_name = i + prop_bytes.len();
            // Skip whitespace and colon
            let mut j = after_name;
            while j < len && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            if j < len && bytes[j] == b':' {
                j += 1;
                while j < len && bytes[j].is_ascii_whitespace() {
                    j += 1;
                }
                // Extract quoted string value
                if j < len && (bytes[j] == b'\'' || bytes[j] == b'"') {
                    let quote = bytes[j];
                    let str_start = j + 1;
                    let mut str_end = str_start;
                    while str_end < len && bytes[str_end] != quote {
                        if bytes[str_end] == b'\\' {
                            str_end += 1;
                        }
                        str_end += 1;
                    }
                    if str_end < len {
                        return Some(style_body[str_start..str_end].to_string());
                    }
                }
            }
        }

        i += 1;
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_extractor() -> ClassExtractor {
        ClassExtractor::new()
    }

    // ── Basic record tests ──

    #[test]
    fn record_simple_classname() {
        let mut ext = make_extractor();
        ext.record("bg-red-500 text-white", 1, "<div>", "bg-background", None, None, None);
        let regions = ext.into_regions();
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].content, "bg-red-500 text-white");
        assert_eq!(regions[0].start_line, 1);
        assert_eq!(regions[0].context_bg, "bg-background");
    }

    #[test]
    fn record_with_context_bg() {
        let mut ext = make_extractor();
        ext.record("text-white", 5, "<span>", "bg-card", None, None, None);
        let regions = ext.into_regions();
        assert_eq!(regions[0].context_bg, "bg-card");
    }

    #[test]
    fn record_with_context_override() {
        let mut ext = make_extractor();
        let ovr = ContextOverride {
            bg: Some("#09090b".to_string()),
            fg: None,
            no_inherit: false,
        };
        ext.record("text-white", 1, "<div>", "bg-background", Some(ovr), None, None);
        let regions = ext.into_regions();
        assert_eq!(regions[0].context_override_bg, Some("#09090b".to_string()));
        assert_eq!(regions[0].context_override_fg, None);
        assert_eq!(regions[0].context_override_no_inherit, None);
    }

    #[test]
    fn record_with_full_context_override() {
        let mut ext = make_extractor();
        let ovr = ContextOverride {
            bg: Some("bg-slate-900".to_string()),
            fg: Some("text-white".to_string()),
            no_inherit: true,
        };
        ext.record("text-muted-foreground", 1, "<p>", "bg-background", Some(ovr), None, None);
        let regions = ext.into_regions();
        assert_eq!(regions[0].context_override_bg, Some("bg-slate-900".to_string()));
        assert_eq!(regions[0].context_override_fg, Some("text-white".to_string()));
        assert_eq!(regions[0].context_override_no_inherit, Some(true));
    }

    #[test]
    fn record_with_ignore_reason() {
        let mut ext = make_extractor();
        ext.record("text-white", 1, "<div>", "bg-background", None, Some("dynamic background".to_string()), None);
        let regions = ext.into_regions();
        assert_eq!(regions[0].ignored, Some(true));
        assert_eq!(regions[0].ignore_reason, Some("dynamic background".to_string()));
    }

    #[test]
    fn record_with_empty_ignore_reason() {
        let mut ext = make_extractor();
        ext.record("text-white", 1, "<div>", "bg-background", None, Some(String::new()), None);
        let regions = ext.into_regions();
        assert_eq!(regions[0].ignored, Some(true));
        assert_eq!(regions[0].ignore_reason, Some("suppressed".to_string()));
    }

    #[test]
    fn record_multiple() {
        let mut ext = make_extractor();
        ext.record("bg-card p-4", 3, "<div>", "bg-background", None, None, None);
        ext.record("text-card-foreground", 4, "<h1>", "bg-card", None, None, None);
        ext.record("text-muted-foreground", 5, "<p>", "bg-card", None, None, None);
        let regions = ext.into_regions();
        assert_eq!(regions.len(), 3);
        assert_eq!(regions[1].context_bg, "bg-card");
        assert_eq!(regions[2].start_line, 5);
    }

    // ── Inline style extraction tests ──

    #[test]
    fn extract_inline_color() {
        let mut ext = make_extractor();
        ext.record(
            "text-white",
            1,
            r#"<div style={{ color: "red" }} className="text-white">"#,
            "bg-background",
            None,
            None,
            None,
        );
        let regions = ext.into_regions();
        assert_eq!(regions[0].inline_color, Some("red".to_string()));
    }

    #[test]
    fn extract_inline_background_color() {
        let mut ext = make_extractor();
        ext.record(
            "text-white",
            1,
            r#"<div style={{ backgroundColor: '#ff0000' }} className="text-white">"#,
            "bg-background",
            None,
            None,
            None,
        );
        let regions = ext.into_regions();
        assert_eq!(regions[0].inline_background_color, Some("#ff0000".to_string()));
    }

    #[test]
    fn extract_inline_both() {
        let mut ext = make_extractor();
        ext.record(
            "text-white",
            1,
            r##"<div style={{ color: "#fff", backgroundColor: "#000" }} className="text-white">"##,
            "bg-background",
            None,
            None,
            None,
        );
        let regions = ext.into_regions();
        assert_eq!(regions[0].inline_color, Some("#fff".to_string()));
        assert_eq!(regions[0].inline_background_color, Some("#000".to_string()));
    }

    #[test]
    fn no_inline_style_returns_none() {
        let mut ext = make_extractor();
        ext.record("text-white", 1, r#"<div className="text-white">"#, "bg-background", None, None, None);
        let regions = ext.into_regions();
        assert_eq!(regions[0].inline_color, None);
        assert_eq!(regions[0].inline_background_color, None);
    }

    // ── extract_inline_style_colors unit tests ──

    #[test]
    fn inline_style_color_double_quotes() {
        let result = extract_inline_style_colors(r#"<div style={{ color: "red" }}>"#).unwrap();
        assert_eq!(result.color, Some("red".to_string()));
    }

    #[test]
    fn inline_style_color_single_quotes() {
        let result = extract_inline_style_colors(r#"<div style={{ color: '#ff0000' }}>"#).unwrap();
        assert_eq!(result.color, Some("#ff0000".to_string()));
    }

    #[test]
    fn inline_style_background_color() {
        let result = extract_inline_style_colors(r##"<div style={{ backgroundColor: "#333" }}>"##).unwrap();
        assert_eq!(result.background_color, Some("#333".to_string()));
    }

    #[test]
    fn inline_style_no_match() {
        assert!(extract_inline_style_colors(r#"<div className="text-white">"#).is_none());
    }

    #[test]
    fn inline_style_no_color_properties() {
        assert!(extract_inline_style_colors(r#"<div style={{ display: "flex" }}>"#).is_none());
    }

    #[test]
    fn inline_style_background_color_not_matched_by_color() {
        // "backgroundColor" should NOT match "color" due to word boundary check
        let result = extract_inline_style_colors(r##"<div style={{ backgroundColor: "#000" }}>"##).unwrap();
        assert_eq!(result.color, None);
        assert_eq!(result.background_color, Some("#000".to_string()));
    }

    // ── extract_style_property unit tests ──

    #[test]
    fn property_with_spaces() {
        assert_eq!(
            extract_style_property(r#" color : "red" "#, "color"),
            Some("red".to_string())
        );
    }

    #[test]
    fn property_no_match() {
        assert_eq!(extract_style_property(r#" display: "flex" "#, "color"), None);
    }

    // ── Effective opacity tests ──

    #[test]
    fn record_with_effective_opacity() {
        let mut ext = make_extractor();
        ext.record("text-white", 1, "<div>", "bg-background", None, None, Some(0.5));
        let regions = ext.into_regions();
        assert_eq!(regions[0].effective_opacity, Some(0.5));
    }

    #[test]
    fn record_without_opacity_is_none() {
        let mut ext = make_extractor();
        ext.record("text-white", 1, "<div>", "bg-background", None, None, None);
        let regions = ext.into_regions();
        assert_eq!(regions[0].effective_opacity, None);
    }

    #[test]
    fn record_fully_opaque_is_none() {
        let mut ext = make_extractor();
        ext.record("text-white", 1, "<div>", "bg-background", None, None, Some(1.0));
        let regions = ext.into_regions();
        // 1.0 = fully opaque = no need to store
        assert_eq!(regions[0].effective_opacity, None);
    }
}
