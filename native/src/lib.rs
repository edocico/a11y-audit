#[macro_use]
extern crate napi_derive;

pub mod types;
pub mod math;
pub mod parser;
pub mod engine;

use types::{CheckResultJs, ColorPair, ExtractOptions, PreExtractedFile};

#[napi]
pub fn health_check() -> String {
    "a11y-audit-native ok".to_string()
}

/// Parse multiple JSX files in parallel and return extracted ClassRegion data.
/// Main entry point for the parsing phase.
#[napi]
pub fn extract_and_scan(options: ExtractOptions) -> Vec<PreExtractedFile> {
    engine::extract_and_scan(&options)
}

/// Check contrast for all color pairs against WCAG/APCA thresholds.
/// Returns violations, passed, ignored, and skip counts.
#[napi]
pub fn check_contrast_pairs(
    pairs: Vec<ColorPair>,
    threshold: String,
    page_bg: String,
) -> CheckResultJs {
    let result = math::checker::check_all_pairs(&pairs, &threshold, &page_bg);
    CheckResultJs {
        violations: result.violations,
        passed: result.passed,
        ignored: result.ignored,
        ignored_count: result.ignored_count,
        skipped_count: result.skipped_count,
    }
}
