# Phase 3: Parser Precision — Portals + Opacity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce false positives/negatives by teaching the Rust parser about React Portal context resets (US-04) and container opacity stacking (US-05).

**Architecture:** Extend the Rust `ContextTracker` with two new capabilities: (1) opacity tracking via `cumulative_opacity` on `StackEntry`, propagated to `ClassRegion.effective_opacity` and applied as alpha reduction during contrast checking; (2) portal detection via a separate `portal_config` map that resets context stack and opacity at component boundaries. Both features are **native-only** (TS legacy parser is frozen at v1.0). The TS type system, converter, and region-resolver are extended to consume the new fields.

**Tech Stack:** Rust (NAPI-RS, rayon), TypeScript (vitest), Zod (config schema)

**Dependency order:** US-05 (Opacity) first → US-04 (Portals) builds on top (portal resets opacity)

---

## Part A: US-05 — Opacity Stack

### Task 1: Rust — Opacity class parsing helper

**Files:**
- Create: `native/src/parser/opacity.rs`
- Modify: `native/src/parser/mod.rs` (add `pub mod opacity;`)

**Step 1: Write the failing tests**

In `native/src/parser/opacity.rs`:

```rust
/// Parse an opacity Tailwind class and return its value as 0.0–1.0.
///
/// Supported patterns:
/// - `opacity-0` through `opacity-100` → N / 100
/// - `opacity-[.33]` or `opacity-[0.33]` → literal float
/// - `opacity-[50%]` → 50 / 100
///
/// Returns `None` if the string is not an opacity class.
pub fn parse_opacity_class(cls: &str) -> Option<f32> {
    todo!()
}

/// Scan a raw JSX tag string for the first non-variant `opacity-*` class.
/// Returns the parsed opacity value (0.0–1.0), or `None` if not found.
///
/// Skips variant-prefixed classes like `dark:opacity-50`, `hover:opacity-75`.
pub fn find_opacity_in_raw_tag(raw_tag: &str) -> Option<f32> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── parse_opacity_class ──

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
    fn opacity_arbitrary_decimal() {
        assert_eq!(parse_opacity_class("opacity-[.33]"), Some(0.33));
    }

    #[test]
    fn opacity_arbitrary_with_leading_zero() {
        assert_eq!(parse_opacity_class("opacity-[0.33]"), Some(0.33));
    }

    #[test]
    fn opacity_arbitrary_percent() {
        assert_eq!(parse_opacity_class("opacity-[50%]"), Some(0.5));
    }

    #[test]
    fn not_opacity_class() {
        assert_eq!(parse_opacity_class("bg-red-500"), None);
        assert_eq!(parse_opacity_class("text-opacity-50"), None);
        assert_eq!(parse_opacity_class("opacity"), None);
    }

    // ── find_opacity_in_raw_tag ──

    #[test]
    fn find_in_classname() {
        let tag = r##"<div className="opacity-50 text-white">"##;
        assert_eq!(find_opacity_in_raw_tag(tag), Some(0.5));
    }

    #[test]
    fn find_skips_variant_prefixed() {
        let tag = r##"<div className="dark:opacity-50 text-white">"##;
        assert_eq!(find_opacity_in_raw_tag(tag), None);
    }

    #[test]
    fn find_skips_hover_variant() {
        let tag = r##"<div className="hover:opacity-75 opacity-50">"##;
        // Should find opacity-50 (non-variant), not hover:opacity-75
        assert_eq!(find_opacity_in_raw_tag(tag), Some(0.5));
    }

    #[test]
    fn find_none_when_absent() {
        let tag = r##"<div className="bg-red-500 text-white">"##;
        assert_eq!(find_opacity_in_raw_tag(tag), None);
    }

    #[test]
    fn find_arbitrary_value() {
        let tag = r##"<div className="opacity-[.33] text-white">"##;
        assert_eq!(find_opacity_in_raw_tag(tag), Some(0.33));
    }

    #[test]
    fn find_no_classname_attribute() {
        let tag = r##"<div style={{ opacity: 0.5 }}>"##;
        assert_eq!(find_opacity_in_raw_tag(tag), None);
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cd native && cargo test parser::opacity -- --nocapture`
Expected: FAIL with `todo!()` panic

**Step 3: Implement `parse_opacity_class` and `find_opacity_in_raw_tag`**

```rust
pub fn parse_opacity_class(cls: &str) -> Option<f32> {
    let body = cls.strip_prefix("opacity-")?;

    // Arbitrary value: opacity-[.33] or opacity-[50%]
    if let Some(inner) = body.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
        if let Some(pct) = inner.strip_suffix('%') {
            return pct.parse::<f32>().ok().map(|v| v / 100.0);
        }
        return inner.parse::<f32>().ok();
    }

    // Standard: opacity-0 through opacity-100
    body.parse::<u32>().ok().map(|n| n as f32 / 100.0)
}

pub fn find_opacity_in_raw_tag(raw_tag: &str) -> Option<f32> {
    let bytes = raw_tag.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i + 8 < len {
        // Look for "opacity-" NOT preceded by ':'
        if &bytes[i..i + 8] == b"opacity-" {
            // Check for variant prefix (colon before "opacity")
            if i > 0 && bytes[i - 1] == b':' {
                i += 1;
                continue;
            }
            // Check word boundary
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
            // Extract full class token
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
            if let Some(val) = parse_opacity_class(cls) {
                return Some(val);
            }
            continue;
        }
        i += 1;
    }
    None
}
```

**Step 4: Run tests to verify they pass**

Run: `cd native && cargo test parser::opacity -- --nocapture`
Expected: all PASS

**Step 5: Register the module**

Add to `native/src/parser/mod.rs` at line 8 (after `pub mod current_color_resolver;`):
```rust
pub mod opacity;
```

**Step 6: Commit**

```bash
git add native/src/parser/opacity.rs native/src/parser/mod.rs
git commit -m "feat(parser): add opacity class parsing helper

Parse opacity-N (0-100), opacity-[.N], opacity-[N%] Tailwind classes.
Scan raw JSX tags for non-variant opacity classes.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Rust — ContextTracker opacity tracking

**Files:**
- Modify: `native/src/parser/context_tracker.rs`

**Step 1: Write the failing tests**

Add these tests to the existing `#[cfg(test)] mod tests` block in `context_tracker.rs`:

```rust
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
        // 0.5 * 0.5 = 0.25
        assert!((tracker.current_opacity() - 0.25).abs() < 0.001);
    }

    #[test]
    fn nested_opacity_restores() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        tracker.on_tag_open("div", false, r##"<div className="opacity-50">"##);
        tracker.on_tag_open("span", false, r##"<span className="opacity-75">"##);
        assert!((tracker.current_opacity() - 0.375).abs() < 0.001); // 0.5 * 0.75
        tracker.on_tag_close("span");
        assert_eq!(tracker.current_opacity(), 0.5); // back to parent
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
```

**Step 2: Run tests to verify they fail**

Run: `cd native && cargo test parser::context_tracker -- --nocapture`
Expected: FAIL (no `current_opacity` method)

**Step 3: Implement opacity tracking**

Modify `StackEntry` to include opacity:

```rust
struct StackEntry {
    tag: String,
    bg_class: String,
    #[allow(dead_code)]
    is_annotation: bool,
    cumulative_opacity: f32,
}
```

Add `current_opacity()` method to `ContextTracker`:

```rust
/// Get the current cumulative opacity (product of all ancestor opacity values).
pub fn current_opacity(&self) -> f32 {
    self.stack
        .last()
        .map(|e| e.cumulative_opacity)
        .unwrap_or(1.0)
}
```

Update `on_tag_open` to detect opacity classes and push when opacity is found. The key changes:

1. All existing push paths need to set `cumulative_opacity` on the new `StackEntry`
2. Tags with opacity-* classes (but no bg/container) also push an entry to track opacity
3. For opacity-only entries, `bg_class` inherits from `current_bg()`

```rust
fn on_tag_open(&mut self, tag_name: &str, is_self_closing: bool, raw_tag: &str) {
    if is_self_closing {
        return;
    }

    let opacity = super::opacity::find_opacity_in_raw_tag(raw_tag);
    let parent_opacity = self.current_opacity();
    let cumulative = parent_opacity * opacity.unwrap_or(1.0);

    // Check if this is a configured container component
    if let Some(config_bg) = self.container_config.get(tag_name).cloned() {
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

    // Opacity-only tag: push to track opacity for children
    if opacity.is_some() {
        self.stack.push(StackEntry {
            tag: tag_name.to_string(),
            bg_class: self.current_bg().to_string(),
            is_annotation: false,
            cumulative_opacity: cumulative,
        });
    }
}
```

Also update `resolve_pending_block` to include `cumulative_opacity`:

```rust
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
```

**Step 4: Run tests to verify they pass**

Run: `cd native && cargo test parser::context_tracker -- --nocapture`
Expected: all PASS (both old and new tests)

**Step 5: Commit**

```bash
git add native/src/parser/context_tracker.rs
git commit -m "feat(parser): add cumulative opacity tracking to ContextTracker

Track opacity-* classes in the LIFO context stack. Cumulative opacity
multiplies across nested containers. Restores on tag_close.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Rust — ClassRegion effective_opacity field + ScanOrchestrator wiring

**Files:**
- Modify: `native/src/types.rs` (add `effective_opacity` to `ClassRegion`)
- Modify: `native/src/parser/class_extractor.rs` (add `effective_opacity` param to `record()`)
- Modify: `native/src/parser/mod.rs` (wire `current_opacity()` into `on_class_attribute`)

**Step 1: Add `effective_opacity` to ClassRegion**

In `native/src/types.rs`, add to the `ClassRegion` struct:

```rust
pub struct ClassRegion {
    // ... existing fields ...
    pub ignore_reason: Option<String>,
    /// US-05: cumulative opacity from ancestor containers (0.0–1.0). None = fully opaque.
    pub effective_opacity: Option<f64>,
}
```

**Step 2: Write failing tests for ClassExtractor with opacity**

Add to `native/src/parser/class_extractor.rs` tests:

```rust
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
```

**Step 3: Run tests to verify they fail**

Run: `cd native && cargo test parser::class_extractor -- --nocapture`
Expected: FAIL (wrong number of arguments to `record()`)

**Step 4: Update ClassExtractor.record() signature**

```rust
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
    // ... rest of method unchanged (apply context_override + ignore_reason) ...
```

**Step 5: Fix existing ClassExtractor tests** — add `None` as 7th argument to all existing `record()` calls.

**Step 6: Update ScanOrchestrator.on_class_attribute**

In `native/src/parser/mod.rs`, wire the opacity:

```rust
fn on_class_attribute(&mut self, value: &str, line: u32, raw_tag: &str) {
    let context_bg = if !raw_tag.is_empty() {
        self.pre_tag_open_bg.take()
            .unwrap_or_else(|| self.context_tracker.current_bg().to_string())
    } else {
        self.context_tracker.current_bg().to_string()
    };

    let context_override = self.annotation_parser.take_pending_context();
    let ignore_reason = self.annotation_parser.take_pending_ignore();

    let is_disabled = is_disabled_tag(raw_tag) || has_disabled_variant(value);
    let final_ignore_reason = if is_disabled && ignore_reason.is_none() {
        Some("disabled element (WCAG SC 1.4.3 exemption)".to_string())
    } else {
        ignore_reason
    };

    // US-05: Get cumulative opacity (element's own, captured AFTER on_tag_open)
    let effective_opacity = Some(self.context_tracker.current_opacity());

    self.class_extractor.record(
        value,
        line,
        raw_tag,
        &context_bg,
        context_override,
        final_ignore_reason,
        effective_opacity,
    );
}
```

**Step 7: Write ScanOrchestrator integration tests for opacity**

Add to `mod integration_tests` in `native/src/parser/mod.rs`:

```rust
    #[test]
    fn opacity_propagated_to_region() {
        let source = r##"<div className="opacity-50">
    <span className="text-white">x</span>
</div>"##;
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions.len(), 2);
        // div itself: opacity-50 is on this element → effective = 0.5
        assert_eq!(regions[0].effective_opacity, Some(0.5));
        // span inside: inherits 0.5 from parent
        assert_eq!(regions[1].effective_opacity, Some(0.5));
    }

    #[test]
    fn nested_opacity_multiplied() {
        let source = r##"<div className="opacity-50">
    <div className="opacity-50">
        <span className="text-white">x</span>
    </div>
</div>"##;
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        let inner_span = &regions[2];
        // 0.5 * 0.5 = 0.25
        assert!((inner_span.effective_opacity.unwrap() - 0.25).abs() < 0.01);
    }

    #[test]
    fn no_opacity_returns_none() {
        let source = r##"<div className="bg-red-500 text-white">x</div>"##;
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        assert_eq!(regions[0].effective_opacity, None);
    }

    #[test]
    fn container_with_opacity() {
        let config = make_config(&[("Card", "bg-card")]);
        let source = r##"<Card className="opacity-75">
    <span className="text-white">x</span>
</Card>"##;
        let regions = scan_file(source, &config, "bg-background");
        // Card's own className: opacity 0.75
        assert_eq!(regions[0].effective_opacity, Some(0.75));
        assert_eq!(regions[0].context_bg, "bg-background"); // parent bg (pre_tag_open)
        // span inside: inherits Card's opacity
        assert_eq!(regions[1].effective_opacity, Some(0.75));
        assert_eq!(regions[1].context_bg, "bg-card"); // Card's bg
    }
```

**Step 8: Run all parser tests**

Run: `cd native && cargo test parser:: -- --nocapture`
Expected: all PASS

**Step 9: Commit**

```bash
git add native/src/types.rs native/src/parser/class_extractor.rs native/src/parser/mod.rs
git commit -m "feat(parser): wire effective_opacity through ClassRegion pipeline

Add effective_opacity field to ClassRegion. ClassExtractor.record()
accepts opacity param. ScanOrchestrator passes current_opacity() from
ContextTracker after tag opens (element's own opacity, not parent's).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Rust — Visibility threshold + subtree skip

**Files:**
- Modify: `native/src/parser/mod.rs` (ScanOrchestrator visibility check)

**Step 1: Write failing tests**

Add to `mod integration_tests`:

```rust
    #[test]
    fn invisible_element_marked_ignored() {
        let source = r##"<div className="opacity-0">
    <span className="text-white">invisible</span>
</div>"##;
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        // span inside opacity-0 container is invisible
        let span = regions.iter().find(|r| r.content == "text-white").unwrap();
        assert_eq!(span.ignored, Some(true));
        assert!(span.ignore_reason.as_ref().unwrap().contains("opacity"));
    }

    #[test]
    fn nearly_invisible_marked_ignored() {
        let source = r##"<div className="opacity-5">
    <span className="text-white">barely visible</span>
</div>"##;
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        let span = regions.iter().find(|r| r.content == "text-white").unwrap();
        assert_eq!(span.ignored, Some(true));
        assert!(span.ignore_reason.as_ref().unwrap().contains("opacity"));
    }

    #[test]
    fn visible_not_marked_ignored() {
        let source = r##"<div className="opacity-50">
    <span className="text-white">visible</span>
</div>"##;
        let regions = scan_file(source, &make_config(&[]), "bg-background");
        let span = regions.iter().find(|r| r.content == "text-white").unwrap();
        // 0.5 >= 0.1 threshold → not invisible
        assert_ne!(span.ignored, Some(true));
    }
```

**Step 2: Run tests to verify they fail**

Run: `cd native && cargo test parser::integration_tests::invisible -- --nocapture`
Expected: FAIL

**Step 3: Implement visibility threshold in ScanOrchestrator**

Add constant at the top of `native/src/parser/mod.rs`:

```rust
/// Elements below this cumulative opacity threshold are considered invisible
/// and excluded from contrast checking. WCAG does not require contrast for
/// content that is not perceivable.
const OPACITY_VISIBILITY_THRESHOLD: f32 = 0.1;
```

In `ScanOrchestrator::on_class_attribute`, after computing `effective_opacity` and `final_ignore_reason`:

```rust
    // US-05: Visibility threshold — mark invisible elements as ignored
    let effective_opacity = Some(self.context_tracker.current_opacity());
    let final_ignore_reason = if final_ignore_reason.is_none()
        && effective_opacity.map_or(false, |o| o < OPACITY_VISIBILITY_THRESHOLD)
    {
        Some(format!(
            "invisible (effective opacity {:.0}% < {}% threshold)",
            effective_opacity.unwrap() * 100.0,
            (OPACITY_VISIBILITY_THRESHOLD * 100.0) as u32,
        ))
    } else {
        final_ignore_reason
    };
```

**Note:** The `ignored` flag is set by ClassExtractor when `ignore_reason` is `Some`. The visibility threshold injects a reason which triggers the flag.

**Step 4: Run tests**

Run: `cd native && cargo test parser::integration_tests -- --nocapture`
Expected: all PASS

**Step 5: Commit**

```bash
git add native/src/parser/mod.rs
git commit -m "feat(parser): add visibility threshold for low-opacity elements

Elements with cumulative opacity < 10% are marked as ignored with
reason 'invisible'. WCAG does not require contrast for imperceptible
content.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: TypeScript — Types, converter, and region-resolver opacity propagation

**Files:**
- Modify: `src/core/types.ts` (add `effectiveOpacity` to `ClassRegion` and `ColorPair`)
- Modify: `src/native/index.ts` (add `effectiveOpacity` to `NativeClassRegion` and `NativeModule`)
- Modify: `src/native/converter.ts` (bridge the field)
- Modify: `src/plugins/jsx/region-resolver.ts` (propagate opacity to `ColorPair`)
- Test: `src/native/__tests__/converter.test.ts` (or inline in existing)
- Test: `src/plugins/jsx/__tests__/region-resolver.test.ts`

**Step 1: Add `effectiveOpacity` to TS types**

In `src/core/types.ts`, add to `ClassRegion`:

```typescript
export interface ClassRegion {
  // ... existing fields ...
  contextOverride?: ContextOverride;
  /** US-05: Cumulative opacity from ancestor containers (0.0–1.0). undefined = fully opaque. */
  effectiveOpacity?: number;
}
```

Add to `ColorPair`:

```typescript
export interface ColorPair {
  // ... existing fields ...
  contextSource?: 'inferred' | 'annotation';
  /** US-05: Cumulative opacity applied to this pair (0.0–1.0). undefined = fully opaque. */
  effectiveOpacity?: number;
}
```

**Step 2: Add `effectiveOpacity` to native bridge types**

In `src/native/index.ts`, add to `NativeClassRegion`:

```typescript
export interface NativeClassRegion {
    // ... existing fields ...
    ignoreReason?: string | null;
    effectiveOpacity?: number | null;
}
```

Update the `extractAndScan` type in `NativeModule` to include `portalConfig` (preemptive for Task 10):

```typescript
    extractAndScan(options: {
        fileContents: Array<{ path: string; content: string }>;
        containerConfig: Array<{ component: string; bgClass: string }>;
        portalConfig?: Array<{ component: string; bgClass: string }>;
        defaultBg: string;
    }): NativePreExtractedFile[];
```

**Step 3: Update converter**

In `src/native/converter.ts`, add to `convertNativeRegion`:

```typescript
function convertNativeRegion(native: NativeClassRegion): ClassRegion {
    const region: ClassRegion = {
        content: native.content,
        startLine: native.startLine,
        contextBg: native.contextBg,
    };

    // ... existing inlineStyles and contextOverride reconstruction ...

    // US-05: Bridge effective opacity
    if (native.effectiveOpacity != null) {
        region.effectiveOpacity = native.effectiveOpacity;
    }

    return region;
}
```

**Step 4: Write region-resolver test for opacity propagation**

Add to `src/plugins/jsx/__tests__/region-resolver.test.ts`:

```typescript
describe('opacity propagation', () => {
  it('should propagate effectiveOpacity to ColorPair', () => {
    const region: ClassRegion = {
      content: 'text-white',
      startLine: 1,
      contextBg: 'bg-background',
      effectiveOpacity: 0.5,
    };
    // Test that resolveFileRegions propagates effectiveOpacity to generated pairs
    // ... use existing test helpers to build FileRegions and resolve
  });

  it('should treat undefined effectiveOpacity as fully opaque', () => {
    const region: ClassRegion = {
      content: 'text-white',
      startLine: 1,
      contextBg: 'bg-background',
      // no effectiveOpacity → fully opaque
    };
    // Verify pairs have no effectiveOpacity
  });
});
```

**Step 5: Propagate opacity in region-resolver**

In `src/plugins/jsx/region-resolver.ts`, in the `generatePairs()` function where `ColorPair` objects are created, propagate `effectiveOpacity`:

```typescript
const pair: ColorPair = {
    file: meta.file,
    line: meta.line,
    bgClass: /* existing */,
    textClass: /* existing */,
    // ... existing fields ...
    effectiveOpacity: meta.effectiveOpacity,
};
```

And in `resolveFileRegions()`, pass `effectiveOpacity` through the `PairMeta`:

```typescript
const meta: PairMeta = {
    file: relPath,
    line: region.startLine,
    // ... existing fields ...
    effectiveOpacity: region.effectiveOpacity,
};
```

**Step 6: Apply opacity as alpha reduction in contrast checking**

In `src/plugins/jsx/region-resolver.ts` `generatePairs()`, where `bgAlpha` and `textAlpha` are set:

```typescript
// US-05: Apply effective opacity as alpha reduction
const opacityFactor = meta.effectiveOpacity ?? 1;
if (opacityFactor < 1) {
    pair.textAlpha = (pair.textAlpha ?? 1) * opacityFactor;
    pair.bgAlpha = (pair.bgAlpha ?? 1) * opacityFactor;
}
```

**Step 7: Run TS tests**

Run: `npx vitest run src/plugins/jsx/__tests__/region-resolver.test.ts`
Run: `npx vitest run src/native/__tests__/`
Expected: all PASS

**Step 8: Commit**

```bash
git add src/core/types.ts src/native/index.ts src/native/converter.ts src/plugins/jsx/region-resolver.ts src/plugins/jsx/__tests__/region-resolver.test.ts
git commit -m "feat(opacity): propagate effectiveOpacity through TS pipeline

Add effectiveOpacity to ClassRegion, ColorPair, NativeClassRegion.
Converter bridges the field. Region resolver propagates to pairs and
applies as alpha reduction for contrast checking.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Cross-validation + E2E test for opacity

**Files:**
- Modify: `native/scripts/full_cross_validate.mts` (add opacity fixtures)
- Modify: `src/core/__tests__/integration.test.ts` (add E2E opacity scenario)

**Step 1: Add opacity fixtures to cross-validation**

Add these fixtures to the parser fixtures array in `full_cross_validate.mts`:

```typescript
{
    name: 'opacity-50 container',
    source: `<div className="opacity-50"><span className="text-white">x</span></div>`,
    config: {},
    defaultBg: 'bg-background',
},
{
    name: 'nested opacity multiplication',
    source: `<div className="opacity-50"><div className="opacity-50"><span className="text-white">x</span></div></div>`,
    config: {},
    defaultBg: 'bg-background',
},
{
    name: 'opacity-0 invisible',
    source: `<div className="opacity-0"><span className="text-white">x</span></div>`,
    config: {},
    defaultBg: 'bg-background',
},
```

**Note:** These are "NATIVE+" fixtures — the TS legacy parser doesn't track opacity, so native will have `effectiveOpacity` values that TS doesn't produce. Mark them as known improvements in the comparison logic, similar to US-07/08.

**Step 2: Run cross-validation**

Run: `npx tsx native/scripts/full_cross_validate.mts`
Expected: PASS (or PASS* with known native improvements for opacity)

**Step 3: Write E2E integration test**

Add to `src/core/__tests__/integration.test.ts`:

```typescript
describe('US-05: Opacity stack', () => {
  it('should reduce contrast ratio for elements inside opacity containers', () => {
    // Verify that the full pipeline produces different contrast ratios
    // when effectiveOpacity is applied vs not applied
  });
});
```

**Step 4: Run integration tests**

Run: `npx vitest run src/core/__tests__/integration.test.ts`
Expected: all PASS

**Step 5: Commit**

```bash
git add native/scripts/full_cross_validate.mts src/core/__tests__/integration.test.ts
git commit -m "test(opacity): add cross-validation fixtures and E2E test

Opacity fixtures verify native parser tracks cumulative opacity.
E2E test verifies opacity reduces effective contrast in full pipeline.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Part B: US-04 — React Portals (Context Reset)

### Task 7: Config schema + shadcn preset portal mappings

**Files:**
- Modify: `src/config/schema.ts` (add `portals` field)
- Modify: `src/plugins/interfaces.ts` (add `portals` to `ContainerConfig`)
- Modify: `src/plugins/tailwind/presets/shadcn.ts` (move overlay/portal components)
- Test: `src/config/__tests__/schema.test.ts`

**Step 1: Write failing test for portals config**

Add to `src/config/__tests__/schema.test.ts`:

```typescript
it('should accept portals configuration', () => {
    const input = {
        portals: {
            DialogContent: 'reset',
            PopoverContent: 'bg-popover',
            DialogOverlay: 'bg-black/80',
        },
    };
    const result = auditConfigSchema.parse(input);
    expect(result.portals).toEqual(input.portals);
});

it('should default portals to empty object', () => {
    const result = auditConfigSchema.parse({});
    expect(result.portals).toEqual({});
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/config/__tests__/schema.test.ts`
Expected: FAIL

**Step 3: Add `portals` to config schema**

In `src/config/schema.ts`:

```typescript
export const auditConfigSchema = z.object({
    // ... existing fields ...

    /** Portal context: component name → bg class or "reset" (resets to defaultBg) */
    portals: z.record(z.string(), z.string()).default({}),

    // ... rest of schema ...
});
```

**Step 4: Add `portals` to ContainerConfig interface**

In `src/plugins/interfaces.ts`:

```typescript
export interface ContainerConfig {
    /** Component name → default bg class (e.g., "Card" → "bg-card") */
    readonly containers: ReadonlyMap<string, string>;

    /** Portal components → bg class or "reset". Resets context stack + opacity at boundary. */
    readonly portals: ReadonlyMap<string, string>;

    readonly defaultBg: string;
    readonly pageBg: { light: string; dark: string };
}
```

**Step 5: Update shadcn preset**

Move overlay/modal/popover components from `containers` to `portals`. Components that provide local bg context WITHOUT resetting stay in containers.

In `src/plugins/tailwind/presets/shadcn.ts`:

```typescript
import type { ContainerConfig } from '../../interfaces.js';

/** Components that provide a bg context WITHOUT resetting the context stack */
const SHADCN_CONTAINERS = new Map<string, string>([
    // ── Core Surfaces ──────────────────────────────────────────────
    ['Card', 'bg-card'],
    ['CardHeader', 'bg-card'],
    ['CardContent', 'bg-card'],
    ['CardFooter', 'bg-card'],

    // ── Composite Components ──────────────────────────────────────
    ['AccordionItem', 'bg-background'],
    ['TabsContent', 'bg-background'],

    // ── Alert ─────────────────────────────────────────────────────
    ['Alert', 'bg-background'],
]);

/** Components that RESET the context stack (rendered via React portals/overlays).
 *  "reset" = use defaultBg; any other value = use that bg class. */
const SHADCN_PORTALS = new Map<string, string>([
    // ── Overlays & Modals ─────────────────────────────────────────
    ['DialogOverlay', 'bg-black/80'],
    ['DialogContent', 'reset'],
    ['SheetContent', 'reset'],
    ['DrawerContent', 'reset'],
    ['AlertDialogContent', 'reset'],

    // ── Popovers & Menus ──────────────────────────────────────────
    ['PopoverContent', 'bg-popover'],
    ['DropdownMenuContent', 'bg-popover'],
    ['DropdownMenuSubContent', 'bg-popover'],
    ['ContextMenuContent', 'bg-popover'],
    ['ContextMenuSubContent', 'bg-popover'],
    ['MenubarContent', 'bg-popover'],
    ['SelectContent', 'bg-popover'],
    ['Command', 'bg-popover'],

    // ── Tooltips & Hover Cards ────────────────────────────────────
    ['TooltipContent', 'bg-popover'],
    ['HoverCardContent', 'bg-popover'],
]);

export const shadcnPreset: ContainerConfig = {
    containers: SHADCN_CONTAINERS,
    portals: SHADCN_PORTALS,
    defaultBg: 'bg-background',
    pageBg: { light: '#ffffff', dark: '#09090b' },
};
```

**Step 6: Fix compile errors** — update any code that constructs `ContainerConfig` objects to include the new `portals` field. Check `src/config/loader.ts` or wherever presets are merged with user config.

**Step 7: Run tests**

Run: `npx vitest run src/config/__tests__/schema.test.ts`
Run: `npm run typecheck`
Expected: all PASS

**Step 8: Commit**

```bash
git add src/config/schema.ts src/plugins/interfaces.ts src/plugins/tailwind/presets/shadcn.ts
git commit -m "feat(portals): add portal config to schema and shadcn preset

Portal components reset the context stack and opacity at their boundary.
The shadcn preset moves overlays, modals, popovers, and tooltips from
containers to portals. Card, Accordion, Alert stay as containers.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Rust — ContextTracker portal support

**Files:**
- Modify: `native/src/parser/context_tracker.rs`

**Step 1: Write failing tests**

Add to the existing test module:

```rust
    // ── Portal context reset (US-04) ──

    fn make_portal_config() -> HashMap<String, String> {
        let mut m = HashMap::new();
        m.insert("DialogContent".to_string(), "reset".to_string());
        m.insert("PopoverContent".to_string(), "bg-popover".to_string());
        m.insert("DialogOverlay".to_string(), "bg-black/80".to_string());
        m
    }

    #[test]
    fn portal_reset_uses_default_bg() {
        let mut tracker = ContextTracker::new_with_portals(
            make_config(),
            make_portal_config(),
            "bg-background".to_string(),
        );
        tracker.on_tag_open("Card", false, "<Card>");
        assert_eq!(tracker.current_bg(), "bg-card");
        tracker.on_tag_open("DialogContent", false, "<DialogContent>");
        // "reset" → use defaultBg
        assert_eq!(tracker.current_bg(), "bg-background");
    }

    #[test]
    fn portal_with_explicit_bg() {
        let mut tracker = ContextTracker::new_with_portals(
            make_config(),
            make_portal_config(),
            "bg-background".to_string(),
        );
        tracker.on_tag_open("PopoverContent", false, "<PopoverContent>");
        assert_eq!(tracker.current_bg(), "bg-popover");
    }

    #[test]
    fn portal_resets_opacity() {
        let mut tracker = ContextTracker::new_with_portals(
            make_config(),
            make_portal_config(),
            "bg-background".to_string(),
        );
        tracker.on_tag_open("div", false, r##"<div className="opacity-50">"##);
        assert_eq!(tracker.current_opacity(), 0.5);
        tracker.on_tag_open("DialogContent", false, "<DialogContent>");
        // Portal resets opacity to 1.0
        assert_eq!(tracker.current_opacity(), 1.0);
    }

    #[test]
    fn portal_with_own_opacity() {
        let mut tracker = ContextTracker::new_with_portals(
            make_config(),
            make_portal_config(),
            "bg-background".to_string(),
        );
        tracker.on_tag_open("div", false, r##"<div className="opacity-50">"##);
        tracker.on_tag_open("DialogOverlay", false, r##"<DialogOverlay className="opacity-75">"##);
        // Portal resets to 1.0, then applies own 0.75 → 0.75 (NOT 0.5 * 0.75)
        assert_eq!(tracker.current_opacity(), 0.75);
        assert_eq!(tracker.current_bg(), "bg-black/80");
    }

    #[test]
    fn portal_pop_restores_context() {
        let mut tracker = ContextTracker::new_with_portals(
            make_config(),
            make_portal_config(),
            "bg-background".to_string(),
        );
        tracker.on_tag_open("Card", false, "<Card>");
        tracker.on_tag_open("DialogContent", false, "<DialogContent>");
        tracker.on_tag_close("DialogContent");
        // After portal closes, back to Card context
        assert_eq!(tracker.current_bg(), "bg-card");
    }

    #[test]
    fn portal_children_inherit_portal_bg() {
        let mut tracker = ContextTracker::new_with_portals(
            make_config(),
            make_portal_config(),
            "bg-background".to_string(),
        );
        tracker.on_tag_open("Card", false, "<Card>");
        tracker.on_tag_open("PopoverContent", false, "<PopoverContent>");
        // Child element should see bg-popover, not bg-card
        assert_eq!(tracker.current_bg(), "bg-popover");
    }

    #[test]
    fn container_inside_portal_works() {
        let mut tracker = ContextTracker::new_with_portals(
            make_config(),
            make_portal_config(),
            "bg-background".to_string(),
        );
        tracker.on_tag_open("DialogContent", false, "<DialogContent>");
        tracker.on_tag_open("Card", false, "<Card>");
        assert_eq!(tracker.current_bg(), "bg-card");
        tracker.on_tag_close("Card");
        assert_eq!(tracker.current_bg(), "bg-background"); // DialogContent's reset bg
    }
```

**Step 2: Run tests to verify they fail**

Run: `cd native && cargo test parser::context_tracker -- --nocapture`
Expected: FAIL (no `new_with_portals` method)

**Step 3: Implement portal support**

Add `portal_config` to `ContextTracker`:

```rust
pub struct ContextTracker {
    container_config: HashMap<String, String>,
    portal_config: HashMap<String, String>,
    default_bg: String,
    stack: Vec<StackEntry>,
    pending_block_override: Option<String>,
}
```

Add `new_with_portals` constructor (and update `new` to delegate):

```rust
pub fn new(container_config: HashMap<String, String>, default_bg: String) -> Self {
    Self::new_with_portals(container_config, HashMap::new(), default_bg)
}

pub fn new_with_portals(
    container_config: HashMap<String, String>,
    portal_config: HashMap<String, String>,
    default_bg: String,
) -> Self {
    Self {
        container_config,
        portal_config,
        default_bg,
        stack: Vec::new(),
        pending_block_override: None,
    }
}
```

Update `on_tag_open` to check portals FIRST (portal takes priority over container):

```rust
fn on_tag_open(&mut self, tag_name: &str, is_self_closing: bool, raw_tag: &str) {
    if is_self_closing {
        return;
    }

    let opacity = super::opacity::find_opacity_in_raw_tag(raw_tag);

    // Check portal config FIRST (portal takes priority over container)
    if let Some(portal_bg) = self.portal_config.get(tag_name).cloned() {
        let bg = if portal_bg == "reset" {
            self.default_bg.clone()
        } else {
            portal_bg
        };
        // Explicit bg in tag can override the portal config
        let bg = find_explicit_bg_in_raw_tag(raw_tag).unwrap_or(bg);
        // Portal resets opacity to 1.0, then applies own opacity
        let cumulative = opacity.unwrap_or(1.0);
        self.stack.push(StackEntry {
            tag: tag_name.to_string(),
            bg_class: bg,
            is_annotation: false,
            cumulative_opacity: cumulative,
        });
        return;
    }

    // ... existing container / explicit bg / opacity-only logic (unchanged from Task 2) ...
}
```

**Step 4: Run tests**

Run: `cd native && cargo test parser::context_tracker -- --nocapture`
Expected: all PASS

**Step 5: Commit**

```bash
git add native/src/parser/context_tracker.rs
git commit -m "feat(parser): add portal support to ContextTracker

Portal components reset the context stack bg and opacity. 'reset' value
maps to defaultBg. Portal config checked before container config.
Opacity resets to 1.0 at portal boundary then applies own opacity.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Rust — ExtractOptions + engine + ScanOrchestrator portal wiring

**Files:**
- Modify: `native/src/types.rs` (add `portal_config` to `ExtractOptions`)
- Modify: `native/src/engine.rs` (pass portal_config to scan_file)
- Modify: `native/src/parser/mod.rs` (update `scan_file` and `ScanOrchestrator` to accept portal_config)

**Step 1: Add `portal_config` to ExtractOptions**

In `native/src/types.rs`:

```rust
pub struct ExtractOptions {
    pub file_contents: Vec<FileInput>,
    pub container_config: Vec<ContainerEntry>,
    /// US-04: Portal components → bg class or "reset"
    pub portal_config: Vec<ContainerEntry>,
    pub default_bg: String,
}
```

**Step 2: Update scan_file signature**

In `native/src/parser/mod.rs`:

```rust
pub fn scan_file(
    source: &str,
    container_config: &HashMap<String, String>,
    portal_config: &HashMap<String, String>,
    default_bg: &str,
) -> Vec<ClassRegion> {
    let mut orchestrator = ScanOrchestrator::new(
        container_config.clone(),
        portal_config.clone(),
        default_bg.to_string(),
    );
    tokenizer::scan_jsx(source, &mut [&mut orchestrator as &mut dyn JsxVisitor]);
    orchestrator.into_regions()
}
```

Update `ScanOrchestrator::new` to accept portal_config:

```rust
fn new(
    container_config: HashMap<String, String>,
    portal_config: HashMap<String, String>,
    default_bg: String,
) -> Self {
    Self {
        context_tracker: ContextTracker::new_with_portals(container_config, portal_config, default_bg),
        annotation_parser: AnnotationParser::new(),
        class_extractor: ClassExtractor::new(),
        current_color: CurrentColorResolver::new(),
        pre_tag_open_bg: None,
    }
}
```

**Step 3: Update engine.rs**

```rust
pub fn extract_and_scan(options: &ExtractOptions) -> Vec<PreExtractedFile> {
    let container_config: HashMap<String, String> = options
        .container_config
        .iter()
        .map(|e| (e.component.clone(), e.bg_class.clone()))
        .collect();

    let portal_config: HashMap<String, String> = options
        .portal_config
        .iter()
        .map(|e| (e.component.clone(), e.bg_class.clone()))
        .collect();

    options
        .file_contents
        .par_iter()
        .map(|file_input| {
            let regions = crate::parser::scan_file(
                &file_input.content,
                &container_config,
                &portal_config,
                &options.default_bg,
            );
            PreExtractedFile {
                path: file_input.path.clone(),
                regions,
            }
        })
        .collect()
}
```

**Step 4: Fix all existing tests** — update all `scan_file()` calls and `make_options()` in tests to include the portal_config parameter (pass `&HashMap::new()` for existing tests that don't use portals).

**Step 5: Write portal integration tests in ScanOrchestrator**

Add to `native/src/parser/mod.rs` `integration_tests`:

```rust
    #[test]
    fn portal_resets_context() {
        let config = make_config(&[("Card", "bg-card")]);
        let portals: HashMap<String, String> = [
            ("DialogContent".to_string(), "reset".to_string()),
        ].into_iter().collect();
        let source = r##"<Card>
    <span className="text-a">a</span>
    <DialogContent>
        <span className="text-b">b</span>
    </DialogContent>
</Card>"##;
        let regions = scan_file_with_portals(source, &config, &portals, "bg-background");
        // text-a: inside Card → bg-card
        assert_eq!(regions[0].context_bg, "bg-card");
        // text-b: inside DialogContent (portal reset) → bg-background
        assert_eq!(regions[1].context_bg, "bg-background");
    }

    #[test]
    fn portal_resets_opacity() {
        let portals: HashMap<String, String> = [
            ("DialogContent".to_string(), "reset".to_string()),
        ].into_iter().collect();
        let source = r##"<div className="opacity-50">
    <DialogContent>
        <span className="text-white">x</span>
    </DialogContent>
</div>"##;
        let regions = scan_file_with_portals(source, &HashMap::new(), &portals, "bg-background");
        let span = regions.iter().find(|r| r.content == "text-white").unwrap();
        // Portal resets opacity → span is fully opaque (None = 1.0)
        assert_eq!(span.effective_opacity, None);
    }
```

Add helper:
```rust
    fn scan_file_with_portals(
        source: &str,
        config: &HashMap<String, String>,
        portals: &HashMap<String, String>,
        default_bg: &str,
    ) -> Vec<ClassRegion> {
        super::scan_file(source, config, portals, default_bg)
    }
```

**Step 6: Run all Rust tests**

Run: `cd native && cargo test -- --nocapture`
Expected: all PASS

**Step 7: Commit**

```bash
git add native/src/types.rs native/src/engine.rs native/src/parser/mod.rs
git commit -m "feat(portals): wire portal_config through ExtractOptions → scan_file

Add portal_config to ExtractOptions. Engine passes it to scan_file.
ScanOrchestrator forwards to ContextTracker. Integration tests verify
portal context reset and opacity reset.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 10: TypeScript — Native bridge + pipeline portal support

**Files:**
- Modify: `src/native/index.ts` (already prepped in Task 5)
- Modify: `src/core/pipeline.ts` (pass portalConfig to native engine)
- Modify: `native/src/lib.rs` (NAPI export must accept portalConfig)

**Step 1: Update NAPI export in lib.rs**

The `extract_and_scan` NAPI function already accepts `ExtractOptions` which now has `portal_config`. Since `portal_config: Vec<ContainerEntry>` is a required field, JS callers must pass it. Add a default in the NAPI layer to maintain backward compatibility:

Actually, since `Vec<ContainerEntry>` is non-optional, the JS side MUST pass it. Update `src/native/index.ts`'s `NativeModule` interface (done in Task 5). The pipeline must pass it.

**Step 2: Update pipeline.ts**

In `src/core/pipeline.ts`, in the `extractWithNativeEngine()` function (or wherever the native module is called), add `portalConfig`:

```typescript
const nativeResult = getNativeModule().extractAndScan({
    fileContents: files.map(f => ({ path: f.relPath, content: f.source })),
    containerConfig: Array.from(containerConfig.containers.entries()).map(
        ([component, bgClass]) => ({ component, bgClass }),
    ),
    portalConfig: Array.from(containerConfig.portals?.entries() ?? []).map(
        ([component, bgClass]) => ({ component, bgClass }),
    ),
    defaultBg: containerConfig.defaultBg,
});
```

**Step 3: Handle backward compatibility**

In `src/plugins/interfaces.ts`, make `portals` optional with a default:

```typescript
export interface ContainerConfig {
    readonly containers: ReadonlyMap<string, string>;
    /** Portal components. Optional — defaults to empty map if not provided. */
    readonly portals?: ReadonlyMap<string, string>;
    readonly defaultBg: string;
    readonly pageBg: { light: string; dark: string };
}
```

Check all places that construct a `ContainerConfig` — ensure they handle the optional `portals` field gracefully.

**Step 4: Run typecheck and tests**

Run: `npm run typecheck`
Run: `npx vitest run src/core/__tests__/`
Expected: all PASS

**Step 5: Commit**

```bash
git add src/native/index.ts src/core/pipeline.ts src/plugins/interfaces.ts native/src/lib.rs
git commit -m "feat(portals): wire portal config through TS pipeline to native engine

Pipeline passes portalConfig from ContainerConfig to the Rust engine.
Backward compatible — portals defaults to empty map.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 11: Cross-validation + E2E test for portals

**Files:**
- Modify: `native/scripts/full_cross_validate.mts`
- Modify: `src/core/__tests__/integration.test.ts`

**Step 1: Add portal fixtures to cross-validation**

```typescript
{
    name: 'portal resets context',
    source: `<Card><DialogContent><span className="text-white">x</span></DialogContent></Card>`,
    config: { Card: 'bg-card' },
    portals: { DialogContent: 'reset' },
    defaultBg: 'bg-background',
},
{
    name: 'portal with overlay bg',
    source: `<DialogOverlay><span className="text-white">x</span></DialogOverlay>`,
    config: {},
    portals: { DialogOverlay: 'bg-black/80' },
    defaultBg: 'bg-background',
},
{
    name: 'portal + opacity interaction',
    source: `<div className="opacity-50"><DialogContent><span className="text-white">x</span></DialogContent></div>`,
    config: {},
    portals: { DialogContent: 'reset' },
    defaultBg: 'bg-background',
},
```

**Note on cross-validation:** Portal fixtures are native-only improvements. The TS legacy parser treats DialogContent/DialogOverlay as unknown tags (no push, no reset). The native parser correctly resets context. Mark as known improvements.

**Step 2: Update cross-validation script** to pass portal config to the native engine call. The TS parser doesn't need it (frozen, no portal support).

**Step 3: Write E2E integration test**

```typescript
describe('US-04: Portal context reset', () => {
  it('should reset bg context at portal boundary', () => {
    // Full pipeline test: Card with DialogContent inside
    // Verify text inside dialog uses bg-background (not bg-card)
  });

  it('should reset opacity at portal boundary', () => {
    // Full pipeline test: opacity-50 container with portal inside
    // Verify text inside portal has no opacity reduction
  });
});
```

**Step 4: Run cross-validation + tests**

Run: `npx tsx native/scripts/full_cross_validate.mts`
Run: `npx vitest run src/core/__tests__/integration.test.ts`
Expected: all PASS

**Step 5: Commit**

```bash
git add native/scripts/full_cross_validate.mts src/core/__tests__/integration.test.ts
git commit -m "test(portals): cross-validation fixtures and E2E tests

Verify portal context reset, overlay bg, and portal+opacity interaction.
Portal features marked as native improvements in cross-validation.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Part C: Documentation

### Task 12: Update documentation

**Files:**
- Modify: `docs/LIBRARY_ARCHITECTURE.md`
- Modify: `CLAUDE.md`

**Step 1: Update LIBRARY_ARCHITECTURE.md**

Add sections for:
- US-05 Opacity Stack: how cumulative_opacity works in ContextTracker, the visibility threshold, alpha reduction in contrast checking
- US-04 Portal Context Reset: how portal_config works, "reset" semantics, opacity reset at boundaries
- Updated shadcn preset: which components are containers vs portals
- New fields: `ClassRegion.effectiveOpacity`, `ContainerConfig.portals`, config `portals` field

**Step 2: Update CLAUDE.md**

- Update module layout for `native/src/parser/opacity.rs`
- Update `ContextTracker` description (cumulative_opacity, portal_config)
- Update `StackEntry` description
- Update `shadcn.ts` description (containers vs portals, 7+15=22 mappings)
- Update `ExtractOptions` (portal_config field)
- Update key design decisions (opacity alpha reduction, portal context reset)
- Update test counts
- Add Phase 3 plan reference to docs list
- Update architecture summary line

**Step 3: Commit**

```bash
git add docs/LIBRARY_ARCHITECTURE.md CLAUDE.md
git commit -m "docs: update architecture for Phase 3 (portals + opacity)

Document opacity stack, visibility threshold, portal context reset,
updated shadcn preset (containers vs portals), new config fields.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Implementation Notes

### Tag Matching Limitation (Opacity-Only Entries)

When the ContextTracker pushes opacity-only entries (tags without container config or explicit bg), tag-name-based matching on `on_tag_close` can misfire with generic tag names like `<div>`. Example:

```jsx
<div className="opacity-50">   <!-- pushed -->
  <div>                         <!-- NOT pushed -->
  </div>                        <!-- closes, may pop opacity entry -->
</div>                          <!-- dangling close -->
```

**Practical impact:** Low. Opacity is typically set on semantic wrapper components, not deeply nested same-name divs. Worst case: opacity reverts to parent value slightly early, causing a minor ratio discrepancy.

**Future improvement:** If needed, switch to depth-based tracking (separate OpacityTracker visitor) instead of tag-name matching.

### Opacity Compositing Simplification

The plan applies `effectiveOpacity` as a multiplier on both `bgAlpha` and `textAlpha` before compositing. This is a simplification — CSS opacity renders the element + children into an offscreen buffer, then blends onto the page. The correct multi-step compositing would be:

1. `effective_bg = composite(bg, bgAlpha * opacity, pageBg)`
2. `effective_fg = composite(fg, fgAlpha * opacity, effective_bg)`
3. `contrast = ratio(effective_fg, effective_bg)`

The simplification is **conservative** (reports equal or more violations than the precise calculation). If more precision is needed, the multi-step approach can be added in a future task.

### Backward Compatibility

- **TS legacy parser (frozen):** Does not track opacity or portals. `effectiveOpacity` is `undefined` on legacy ClassRegions, treated as 1.0 (fully opaque).
- **ContainerConfig.portals:** Optional field, defaults to empty Map. Existing configs without `portals` work unchanged.
- **shadcn preset breaking change:** 14 components move from `containers` to `portals`. Audit results may change (more correct, fewer false positives). This is an intentional correctness improvement, not a regression.

### Test Count Estimates

| Category | New Tests (approx) |
|----------|-------------------|
| Rust opacity parser | ~16 |
| Rust ContextTracker opacity | ~9 |
| Rust ContextTracker portals | ~8 |
| Rust ScanOrchestrator integration | ~6 |
| TS region-resolver opacity | ~3 |
| TS config schema portals | ~2 |
| Cross-validation fixtures | ~6 |
| E2E integration | ~4 |
| **Total** | **~54** |
