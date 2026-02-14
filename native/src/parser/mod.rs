pub mod visitor;
pub mod tokenizer;
pub mod context_tracker;
pub mod annotation_parser;
pub mod class_extractor;
pub mod disabled_detector;
pub mod current_color_resolver;

use std::collections::HashMap;

use crate::types::ClassRegion;
use annotation_parser::AnnotationParser;
use class_extractor::ClassExtractor;
use context_tracker::ContextTracker;
use current_color_resolver::CurrentColorResolver;
use disabled_detector::{is_disabled_tag, has_disabled_variant};
use visitor::JsxVisitor;

/// Combined orchestrator that owns all parser sub-components and coordinates
/// cross-visitor state flow during JSX scanning.
///
/// This is the single JsxVisitor passed to the tokenizer. It delegates events
/// to each sub-component and coordinates state on `on_class_attribute`:
///   1. ContextTracker → provides `current_bg()`
///   2. AnnotationParser → provides pending `@a11y-context` / `a11y-ignore`
///   3. DisabledDetector → checks `disabled` / `aria-disabled` in the raw tag
///   4. CurrentColorResolver → tracks inherited text color (for US-08)
///   5. ClassExtractor → receives all the above and builds ClassRegion objects
struct ScanOrchestrator {
    context_tracker: ContextTracker,
    annotation_parser: AnnotationParser,
    class_extractor: ClassExtractor,
    current_color: CurrentColorResolver,
    /// The context_bg captured BEFORE the most recent on_tag_open.
    /// Used so a tag's own className region gets the parent's bg, not its own.
    /// Set in on_tag_open, consumed by the next on_class_attribute.
    pre_tag_open_bg: Option<String>,
}

impl ScanOrchestrator {
    fn new(container_config: HashMap<String, String>, default_bg: String) -> Self {
        Self {
            context_tracker: ContextTracker::new(container_config, default_bg),
            annotation_parser: AnnotationParser::new(),
            class_extractor: ClassExtractor::new(),
            current_color: CurrentColorResolver::new(),
            pre_tag_open_bg: None,
        }
    }

    fn into_regions(self) -> Vec<ClassRegion> {
        self.class_extractor.into_regions()
    }
}

impl JsxVisitor for ScanOrchestrator {
    fn on_tag_open(&mut self, tag_name: &str, is_self_closing: bool, raw_tag: &str) {
        // 1. Resolve pending @a11y-context-block (part of parent context)
        self.context_tracker.resolve_pending_block(tag_name, is_self_closing);
        // 2. Capture bg AFTER block annotation, BEFORE tag's own bg modifies context
        self.pre_tag_open_bg = Some(self.context_tracker.current_bg().to_string());
        // 3. Process tag's own bg (container config, explicit bg-* class)
        self.context_tracker.on_tag_open(tag_name, is_self_closing, raw_tag);
        self.current_color.on_tag_open(tag_name, is_self_closing, raw_tag);
    }

    fn on_tag_close(&mut self, tag_name: &str) {
        self.context_tracker.on_tag_close(tag_name);
        self.current_color.on_tag_close(tag_name);
    }

    fn on_comment(&mut self, content: &str, line: u32) {
        self.context_tracker.on_comment(content, line);
        self.annotation_parser.on_comment(content, line);
    }

    fn on_class_attribute(&mut self, value: &str, line: u32, raw_tag: &str) {
        // 1. Get context bg: use pre-open bg if this is on the same tag that just
        //    opened (the tag's own className should use the parent's bg, not its own).
        //    For standalone cn() calls (empty raw_tag), use the current tracker bg.
        let context_bg = if !raw_tag.is_empty() {
            self.pre_tag_open_bg.take()
                .unwrap_or_else(|| self.context_tracker.current_bg().to_string())
        } else {
            self.context_tracker.current_bg().to_string()
        };

        // 2. Consume pending annotations
        let context_override = self.annotation_parser.take_pending_context();
        let ignore_reason = self.annotation_parser.take_pending_ignore();

        // 3. Check for disabled elements (US-07)
        let is_disabled = is_disabled_tag(raw_tag) || has_disabled_variant(value);
        let final_ignore_reason = if is_disabled && ignore_reason.is_none() {
            Some("disabled element (WCAG SC 1.4.3 exemption)".to_string())
        } else {
            ignore_reason
        };

        // 4. Build ClassRegion via ClassExtractor
        self.class_extractor.record(
            value,
            line,
            raw_tag,
            &context_bg,
            context_override,
            final_ignore_reason,
        );
    }
}

/// Parse a single JSX file and return all extracted ClassRegion objects.
///
/// This is the main entry point for the Rust parser. It wires together:
/// - Tokenizer (lossy JSX scanner emitting events)
/// - ContextTracker (container bg stack)
/// - AnnotationParser (@a11y-context / a11y-ignore)
/// - DisabledDetector (US-07: disabled element detection)
/// - CurrentColorResolver (US-08: inherited text color tracking)
/// - ClassExtractor (builds ClassRegion objects)
///
/// Port of: src/plugins/jsx/parser.ts → extractClassRegions()
pub fn scan_file(
    source: &str,
    container_config: &HashMap<String, String>,
    default_bg: &str,
) -> Vec<ClassRegion> {
    let mut orchestrator = ScanOrchestrator::new(
        container_config.clone(),
        default_bg.to_string(),
    );

    tokenizer::scan_jsx(source, &mut [&mut orchestrator as &mut dyn JsxVisitor]);

    orchestrator.into_regions()
}

#[cfg(test)]
mod integration_tests {
    use super::*;

    fn make_config(entries: &[(&str, &str)]) -> HashMap<String, String> {
        entries.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    // ── Basic extraction ──

    #[test]
    fn simple_static_classname() {
        let regions = scan_file(
            r##"<div className="bg-red-500 text-white">x</div>"##,
            &make_config(&[]),
            "bg-background",
        );
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].content, "bg-red-500 text-white");
        assert_eq!(regions[0].start_line, 1);
        assert_eq!(regions[0].context_bg, "bg-background");
    }

    #[test]
    fn multiple_elements() {
        let source = r##"<div className="bg-card p-4">
    <h1 className="text-card-foreground text-2xl font-bold">Title</h1>
    <p className="text-muted-foreground">Description</p>
</div>"##;
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions.len(), 3);
        assert_eq!(regions[0].content, "bg-card p-4");
        assert_eq!(regions[1].content, "text-card-foreground text-2xl font-bold");
        assert_eq!(regions[2].content, "text-muted-foreground");
    }

    // ── Container context tracking ──

    #[test]
    fn container_config_sets_context_bg() {
        let config = make_config(&[("Card", "bg-card")]);
        let regions = scan_file(
            r##"<Card><span className="text-white">x</span></Card>"##,
            &config,
            "bg-background",
        );
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].context_bg, "bg-card");
    }

    #[test]
    fn nested_containers() {
        let config = make_config(&[("Card", "bg-card"), ("Dialog", "bg-dialog")]);
        let source = r##"<Card>
    <span className="text-a">a</span>
    <Dialog>
        <span className="text-b">b</span>
    </Dialog>
    <span className="text-c">c</span>
</Card>"##;
        let regions = scan_file(source, &config, "bg-background");
        assert_eq!(regions.len(), 3);
        assert_eq!(regions[0].context_bg, "bg-card");
        assert_eq!(regions[1].context_bg, "bg-dialog");
        assert_eq!(regions[2].context_bg, "bg-card"); // back to Card after Dialog closes
    }

    #[test]
    fn explicit_bg_overrides_default() {
        let regions = scan_file(
            r##"<div className="bg-red-500"><span className="text-white">x</span></div>"##,
            &make_config(&[]),
            "bg-background",
        );
        assert_eq!(regions.len(), 2);
        // The div itself gets the default bg context (it's at root level)
        assert_eq!(regions[0].context_bg, "bg-background");
        // But the span inside the div inherits bg-red-500
        assert_eq!(regions[1].context_bg, "bg-red-500");
    }

    // ── Annotation overrides ──

    #[test]
    fn a11y_context_single_element() {
        let source = "// @a11y-context bg:#09090b\n<div className=\"text-white\">x</div>";
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].context_override_bg, Some("#09090b".to_string()));
    }

    #[test]
    fn a11y_context_with_fg() {
        let source = "// @a11y-context bg:bg-slate-900 fg:text-white\n<div className=\"text-muted\">x</div>";
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions[0].context_override_bg, Some("bg-slate-900".to_string()));
        assert_eq!(regions[0].context_override_fg, Some("text-white".to_string()));
    }

    #[test]
    fn a11y_context_no_inherit() {
        let source = "// @a11y-context bg:#fff no-inherit\n<div className=\"text-black\">x</div>";
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions[0].context_override_no_inherit, Some(true));
    }

    #[test]
    fn a11y_context_block_scope() {
        let source = r##"{/* @a11y-context-block bg:bg-slate-900 */}
<div>
    <span className="text-white">inside block</span>
</div>"##;
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].context_bg, "bg-slate-900");
    }

    #[test]
    fn a11y_context_consumed_once() {
        let source = "// @a11y-context bg:#09090b\n<div className=\"text-white\">x</div>\n<div className=\"text-gray\">y</div>";
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions.len(), 2);
        // First element gets the override
        assert_eq!(regions[0].context_override_bg, Some("#09090b".to_string()));
        // Second element does NOT (annotation was consumed)
        assert_eq!(regions[1].context_override_bg, None);
    }

    // ── a11y-ignore suppression ──

    #[test]
    fn a11y_ignore_with_reason() {
        let source = "// a11y-ignore: dynamic background\n<div className=\"text-white\">x</div>";
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions[0].ignored, Some(true));
        assert_eq!(regions[0].ignore_reason, Some("dynamic background".to_string()));
    }

    #[test]
    fn a11y_ignore_no_reason() {
        let source = "// a11y-ignore\n<div className=\"text-white\">x</div>";
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions[0].ignored, Some(true));
        assert_eq!(regions[0].ignore_reason, Some("suppressed".to_string()));
    }

    // ── Disabled element detection (US-07) ──

    #[test]
    fn disabled_attribute_flags_region() {
        let source = r##"<button disabled className="text-gray-400 bg-gray-100">Disabled</button>"##;
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].ignored, Some(true));
        assert!(regions[0].ignore_reason.as_ref().unwrap().contains("disabled"));
    }

    #[test]
    fn aria_disabled_true_flags_region() {
        let source = r##"<div aria-disabled="true" className="text-gray-400">x</div>"##;
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions[0].ignored, Some(true));
        assert!(regions[0].ignore_reason.as_ref().unwrap().contains("disabled"));
    }

    #[test]
    fn disabled_variant_in_class_flags_region() {
        let source = r##"<button className="disabled:opacity-50 text-gray-400">x</button>"##;
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions[0].ignored, Some(true));
        assert!(regions[0].ignore_reason.as_ref().unwrap().contains("disabled"));
    }

    #[test]
    fn not_disabled_no_flag() {
        let source = r##"<button className="text-gray-400 bg-gray-100">Active</button>"##;
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions[0].ignored, None);
        assert_eq!(regions[0].ignore_reason, None);
    }

    #[test]
    fn explicit_a11y_ignore_takes_precedence_over_disabled() {
        // If both disabled and a11y-ignore are present, a11y-ignore reason wins
        let source = "// a11y-ignore: custom reason\n<button disabled className=\"text-gray-400\">x</button>";
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions[0].ignored, Some(true));
        assert_eq!(regions[0].ignore_reason, Some("custom reason".to_string()));
    }

    // ── Inline styles ──

    #[test]
    fn inline_style_color_extracted() {
        let source = r##"<div style={{ color: "red" }} className="text-white">x</div>"##;
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions[0].inline_color, Some("red".to_string()));
    }

    #[test]
    fn inline_style_background_color_extracted() {
        let source = r##"<div style={{ backgroundColor: '#ff0000' }} className="text-white">x</div>"##;
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions[0].inline_background_color, Some("#ff0000".to_string()));
    }

    // ── className patterns ──

    #[test]
    fn classname_single_quoted() {
        let regions = scan_file(
            r##"<div className={'bg-red-500 text-white'}>x</div>"##,
            &make_config(&[]),
            "bg-background",
        );
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].content, "bg-red-500 text-white");
    }

    #[test]
    fn classname_template_literal() {
        let regions = scan_file(
            r##"<div className={`bg-red-500 ${expr} text-white`}>x</div>"##,
            &make_config(&[]),
            "bg-background",
        );
        assert_eq!(regions.len(), 1);
        assert!(regions[0].content.contains("bg-red-500"));
        assert!(regions[0].content.contains("text-white"));
    }

    #[test]
    fn classname_cn_function() {
        let regions = scan_file(
            r##"<div className={cn("bg-red-500", "text-white")}>x</div>"##,
            &make_config(&[]),
            "bg-background",
        );
        assert_eq!(regions.len(), 1);
        assert!(regions[0].content.contains("bg-red-500"));
    }

    // ── Line number tracking ──

    #[test]
    fn line_numbers_correct() {
        let source = "line1\n<div className=\"bg-red\">\nx\n</div>";
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions[0].start_line, 2);
    }

    // ── Full pipeline test ──

    #[test]
    fn full_component_pipeline() {
        let source = r##"export function MyPage() {
    return (
        <Card>
            <h1 className="text-card-foreground text-2xl font-bold">Title</h1>
            {/* @a11y-context-block bg:bg-slate-900 */}
            <div className="bg-slate-900">
                <p className="text-slate-200">Dark section</p>
            </div>
            // @a11y-context bg:#custom
            <span className="text-muted-foreground">Annotated</span>
            // a11y-ignore: dynamic
            <div className="text-gray-500">Ignored</div>
            <button disabled className="text-gray-300">Disabled</button>
        </Card>
    );
}"##;
        let config = make_config(&[("Card", "bg-card")]);
        let regions = scan_file(source, &config, "bg-background");

        // h1: inside Card, gets bg-card context
        assert_eq!(regions[0].content, "text-card-foreground text-2xl font-bold");
        assert_eq!(regions[0].context_bg, "bg-card");

        // div with bg-slate-900: inside the @a11y-context-block scope
        assert_eq!(regions[1].content, "bg-slate-900");
        assert_eq!(regions[1].context_bg, "bg-slate-900"); // block annotation overrides Card

        // p: inside bg-slate-900 div
        assert_eq!(regions[2].content, "text-slate-200");
        assert_eq!(regions[2].context_bg, "bg-slate-900");

        // span: annotated with @a11y-context bg:#custom
        assert_eq!(regions[3].content, "text-muted-foreground");
        assert_eq!(regions[3].context_override_bg, Some("#custom".to_string()));

        // div: a11y-ignore suppressed
        assert_eq!(regions[4].content, "text-gray-500");
        assert_eq!(regions[4].ignored, Some(true));
        assert_eq!(regions[4].ignore_reason, Some("dynamic".to_string()));

        // button: disabled
        assert_eq!(regions[5].content, "text-gray-300");
        assert_eq!(regions[5].ignored, Some(true));
        assert!(regions[5].ignore_reason.as_ref().unwrap().contains("disabled"));
    }

    // ── Edge cases ──

    #[test]
    fn empty_source_returns_empty() {
        let regions = scan_file("", &make_config(&[]), "bg-background");
        assert!(regions.is_empty());
    }

    #[test]
    fn no_classname_returns_empty() {
        let regions = scan_file("<div>hello</div>", &make_config(&[]), "bg-background");
        assert!(regions.is_empty());
    }

    #[test]
    fn self_closing_with_class() {
        let regions = scan_file(
            r##"<input className="text-white" />"##,
            &make_config(&[]),
            "bg-background",
        );
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].content, "text-white");
    }

    #[test]
    fn container_self_closing_no_context_push() {
        // Self-closing container should NOT push context for subsequent elements
        let config = make_config(&[("Card", "bg-card")]);
        let source = r##"<Card /><span className="text-white">x</span>"##;
        let regions = scan_file(source, &config, "bg-background");
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].context_bg, "bg-background"); // NOT bg-card
    }
}
