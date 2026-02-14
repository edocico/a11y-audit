use napi_derive::napi;

/// Equivalent of TypeScript ClassRegion (src/core/types.ts)
#[napi(object)]
#[derive(Debug, Clone)]
pub struct ClassRegion {
    pub content: String,
    pub start_line: u32,
    pub context_bg: String,
    pub inline_color: Option<String>,
    pub inline_background_color: Option<String>,
    pub context_override_bg: Option<String>,
    pub context_override_fg: Option<String>,
    pub context_override_no_inherit: Option<bool>,
    pub ignored: Option<bool>,
    pub ignore_reason: Option<String>,
    /// US-05: cumulative opacity from ancestor containers (0.0-1.0). None = fully opaque.
    pub effective_opacity: Option<f64>,
}

/// Equivalent of TypeScript ResolvedColor
#[napi(object)]
#[derive(Debug, Clone)]
pub struct ResolvedColor {
    pub hex: String,
    pub alpha: Option<f64>,
}

/// Equivalent of TypeScript ColorPair
#[napi(object)]
#[derive(Debug, Clone)]
pub struct ColorPair {
    pub file: String,
    pub line: u32,
    pub bg_class: String,
    pub text_class: String,
    pub bg_hex: Option<String>,
    pub text_hex: Option<String>,
    pub bg_alpha: Option<f64>,
    pub text_alpha: Option<f64>,
    pub is_large_text: Option<bool>,
    /// "text" | "border" | "ring" | "outline"
    pub pair_type: Option<String>,
    /// "hover" | "focus-visible" | "aria-disabled"
    pub interactive_state: Option<String>,
    pub ignored: Option<bool>,
    pub ignore_reason: Option<String>,
    /// "inferred" | "annotation"
    pub context_source: Option<String>,
    /// US-05 (Phase 3, pre-wired)
    pub effective_opacity: Option<f64>,
    /// US-07: element has disabled/aria-disabled attribute
    pub is_disabled: Option<bool>,
    /// US-08: text-current/border-current that couldn't be resolved
    pub unresolved_current_color: Option<bool>,
}

/// Equivalent of TypeScript ContrastResult (flattened — NAPI doesn't support struct inheritance)
#[napi(object)]
#[derive(Debug, Clone)]
pub struct ContrastResult {
    // ColorPair fields
    pub file: String,
    pub line: u32,
    pub bg_class: String,
    pub text_class: String,
    pub bg_hex: Option<String>,
    pub text_hex: Option<String>,
    pub bg_alpha: Option<f64>,
    pub text_alpha: Option<f64>,
    pub is_large_text: Option<bool>,
    pub pair_type: Option<String>,
    pub interactive_state: Option<String>,
    pub ignored: Option<bool>,
    pub ignore_reason: Option<String>,
    pub context_source: Option<String>,
    pub effective_opacity: Option<f64>,
    pub is_disabled: Option<bool>,
    pub unresolved_current_color: Option<bool>,
    // Contrast-specific fields
    pub ratio: f64,
    pub pass_aa: bool,
    pub pass_aa_large: bool,
    pub pass_aaa: bool,
    pub pass_aaa_large: bool,
    pub apca_lc: Option<f64>,
    /// Phase 5 (pre-wired)
    pub deuteranopia_ratio: Option<f64>,
    /// Phase 5 (pre-wired)
    pub protanopia_ratio: Option<f64>,
}

/// Configuration passed from JS to Rust
#[napi(object)]
#[derive(Debug, Clone)]
pub struct ExtractOptions {
    pub file_contents: Vec<FileInput>,
    pub container_config: Vec<ContainerEntry>,
    pub default_bg: String,
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct FileInput {
    pub path: String,
    pub content: String,
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct ContainerEntry {
    pub component: String,
    pub bg_class: String,
}

/// Pre-extracted file data returned from Rust to JS
#[napi(object)]
#[derive(Debug, Clone)]
pub struct PreExtractedFile {
    pub path: String,
    pub regions: Vec<ClassRegion>,
}

/// NAPI-compatible version of CheckResult for returning to JS
#[napi(object)]
#[derive(Debug, Clone)]
pub struct CheckResultJs {
    pub violations: Vec<ContrastResult>,
    pub passed: Vec<ContrastResult>,
    pub ignored: Vec<ContrastResult>,
    pub ignored_count: u32,
    pub skipped_count: u32,
}
