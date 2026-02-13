# Phase 1: Rust Core Engine — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port the JSX parser state machine and color math engine to Rust via NAPI-RS, achieving >70% scan time reduction on 1000+ file codebases while bundling US-07 (disabled detection) and US-08 (currentColor resolution).

**Architecture:** Hybrid Node.js + Rust. File I/O and orchestration stay in TypeScript. Two "hot" phases move to Rust: (1) JSX parsing with an extensible Visitor-pattern architecture, (2) color math (WCAG contrast, APCA Lc, alpha compositing, color-blindness simulation). The Rust module exposes a single `extract_and_scan()` function via NAPI-RS. The existing TS parser is frozen as "Legacy Fallback" — no new features.

**Tech Stack:** Rust (stable), napi-rs (NAPI binding generator), rayon (parallelism), csscolorparser or palette (color parsing), cargo + npm scripts for build integration.

**Reference docs:**
- `docs/plans/2026-02-13-roadmap-v1.1-v2.0-design.md` — Phase 1 design (approved)
- `docs/LIBRARY_ARCHITECTURE.md` — Current TS architecture (Italian)
- `src/core/types.ts` — All shared types (single source of truth)
- `src/core/contrast-checker.ts` — Current math engine (160 lines)
- `src/plugins/jsx/parser.ts` — Current JSX state machine (521 lines)
- `src/plugins/jsx/categorizer.ts` — Current class categorization (653 lines)

---

## Task 1: NAPI-RS Infrastructure Setup

**Files:**
- Create: `native/Cargo.toml`
- Create: `native/src/lib.rs`
- Create: `native/build.rs` (if needed)
- Create: `native/.cargo/config.toml`
- Modify: `package.json` — add napi build scripts + optionalDependencies
- Modify: `.gitignore` — add `native/target/`, `*.node`
- Create: `src/native/index.ts` — JS binding loader with graceful fallback

**Step 1: Initialize the Rust crate**

```bash
mkdir -p native/src
```

`native/Cargo.toml`:
```toml
[package]
name = "a11y-audit-native"
version = "0.0.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { version = "2", features = ["napi8", "serde-json"] }
napi-derive = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[build-dependencies]
napi-build = "2"

[profile.release]
lto = true
strip = "symbols"
```

`native/build.rs`:
```rust
extern crate napi_build;

fn main() {
    napi_build::setup();
}
```

`native/src/lib.rs`:
```rust
#[macro_use]
extern crate napi_derive;

#[napi]
pub fn health_check() -> String {
    "a11y-audit-native ok".to_string()
}
```

**Step 2: Add npm scripts to package.json**

Add to `package.json`:
```json
{
  "scripts": {
    "build:native": "cd native && cargo build --release && napi artifacts",
    "build:native:debug": "cd native && cargo build"
  },
  "napi": {
    "binaryName": "a11y-audit-native",
    "targets": [
      "x86_64-apple-darwin",
      "aarch64-apple-darwin",
      "x86_64-unknown-linux-gnu",
      "x86_64-pc-windows-msvc"
    ]
  }
}
```

**Step 3: Build and verify**

Run: `cd native && cargo build`
Expected: Compiles successfully, produces `.node` binary in `native/target/debug/`

**Step 4: Create JS binding loader**

`src/native/index.ts`:
```typescript
let nativeModule: NativeModule | null = null;

interface NativeModule {
    healthCheck(): string;
}

try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nativeModule = require('../../native/a11y-audit-native.node') as NativeModule;
} catch {
    // Native module not available — legacy fallback
}

export function isNativeAvailable(): boolean {
    return nativeModule !== null;
}

export function getNativeModule(): NativeModule | null {
    return nativeModule;
}
```

**Step 5: Verify health check from JS**

Write a quick smoke test:
```bash
cd native && cargo build && cd .. && node -e "const m = require('./native/target/debug/a11y_audit_native.node'); console.log(m.healthCheck())"
```
Expected: `a11y-audit-native ok`

**Step 6: Update .gitignore**

Add:
```
native/target/
*.node
```

**Step 7: Commit**

```bash
git add native/Cargo.toml native/build.rs native/src/lib.rs native/.cargo/ \
  src/native/index.ts package.json .gitignore
git commit -m "feat: initialize NAPI-RS infrastructure with health check"
```

---

## Task 2: Shared Types in Rust

**Files:**
- Create: `native/src/types.rs`
- Modify: `native/src/lib.rs` — add `mod types;`

**Step 1: Define Rust equivalents of core TypeScript types**

Map types from `src/core/types.ts` to Rust structs with `#[napi(object)]`:

`native/src/types.rs`:
```rust
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
    pub pair_type: Option<String>,        // "text" | "border" | "ring" | "outline"
    pub interactive_state: Option<String>, // "hover" | "focus-visible" | "aria-disabled"
    pub ignored: Option<bool>,
    pub ignore_reason: Option<String>,
    pub context_source: Option<String>,    // "inferred" | "annotation"
    pub effective_opacity: Option<f64>,    // US-05 (Phase 3, pre-wired)
    pub is_disabled: Option<bool>,         // US-07
    pub unresolved_current_color: Option<bool>, // US-08
}

/// Equivalent of TypeScript ContrastResult
#[napi(object)]
#[derive(Debug, Clone)]
pub struct ContrastResult {
    // All ColorPair fields (flattened — NAPI doesn't support struct inheritance)
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
    pub deuteranopia_ratio: Option<f64>,  // Phase 5 (pre-wired)
    pub protanopia_ratio: Option<f64>,    // Phase 5 (pre-wired)
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
```

**Step 2: Verify types compile**

Run: `cd native && cargo build`
Expected: Clean compile

**Step 3: Commit**

```bash
git add native/src/types.rs native/src/lib.rs
git commit -m "feat: define shared Rust types for NAPI-RS bridge"
```

---

## Task 3: Math Engine — parseHexRGB + compositeOver

**Files:**
- Create: `native/src/math/mod.rs`
- Create: `native/src/math/hex.rs`
- Create: `native/src/math/composite.rs`
- Modify: `native/src/lib.rs` — add `mod math;`

Port of: `src/core/contrast-checker.ts` — `parseHexRGB()` and `compositeOver()` functions.

**Step 1: Write failing tests for parseHexRGB**

`native/src/math/hex.rs`:
```rust
/// Parse a 6-digit hex string to RGB channels (0-255).
/// Handles 8-digit hex (extracts RGB, ignores alpha bytes).
/// Returns (0, 0, 0) on malformed input.
pub fn parse_hex_rgb(hex: &str) -> (u8, u8, u8) {
    todo!()
}

/// Extract alpha from 8-digit hex (#rrggbbaa) as f64 0.0-1.0.
/// Returns None if 6-digit hex or alpha >= 0.999.
pub fn extract_hex_alpha(hex: &str) -> Option<f64> {
    todo!()
}

/// Strip alpha channel from 8-digit hex → 6-digit hex.
pub fn strip_hex_alpha(hex: &str) -> String {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_6digit_hex() {
        assert_eq!(parse_hex_rgb("#ff0000"), (255, 0, 0));
        assert_eq!(parse_hex_rgb("#00ff00"), (0, 255, 0));
        assert_eq!(parse_hex_rgb("#1e293b"), (30, 41, 59));
    }

    #[test]
    fn parse_8digit_hex_ignores_alpha() {
        assert_eq!(parse_hex_rgb("#ff000080"), (255, 0, 0));
    }

    #[test]
    fn parse_malformed_returns_black() {
        assert_eq!(parse_hex_rgb("not-a-color"), (0, 0, 0));
        assert_eq!(parse_hex_rgb("#xyz"), (0, 0, 0));
    }

    #[test]
    fn extract_alpha_8digit() {
        let a = extract_hex_alpha("#ff000080").unwrap();
        assert!((a - 0.502).abs() < 0.01); // 128/255 ≈ 0.502
    }

    #[test]
    fn extract_alpha_6digit_returns_none() {
        assert!(extract_hex_alpha("#ff0000").is_none());
    }

    #[test]
    fn extract_alpha_fully_opaque_returns_none() {
        assert!(extract_hex_alpha("#ff0000ff").is_none());
    }

    #[test]
    fn strip_alpha_8digit() {
        assert_eq!(strip_hex_alpha("#ff000080"), "#ff0000");
    }

    #[test]
    fn strip_alpha_6digit_passthrough() {
        assert_eq!(strip_hex_alpha("#ff0000"), "#ff0000");
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cd native && cargo test -- math::hex`
Expected: FAIL with `not yet implemented`

**Step 3: Implement parseHexRGB, extract_hex_alpha, strip_hex_alpha**

Replace `todo!()` with implementations:

```rust
pub fn parse_hex_rgb(hex: &str) -> (u8, u8, u8) {
    let hex = hex.strip_prefix('#').unwrap_or(hex);
    if hex.len() < 6 {
        return (0, 0, 0);
    }
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);
    (r, g, b)
}

pub fn extract_hex_alpha(hex: &str) -> Option<f64> {
    let hex = hex.strip_prefix('#').unwrap_or(hex);
    if hex.len() == 8 {
        let a = u8::from_str_radix(&hex[6..8], 16).ok()?;
        let alpha = a as f64 / 255.0;
        if alpha >= 0.999 { None } else { Some(alpha) }
    } else {
        None
    }
}

pub fn strip_hex_alpha(hex: &str) -> String {
    let raw = hex.strip_prefix('#').unwrap_or(hex);
    if raw.len() == 8 {
        format!("#{}", &raw[0..6])
    } else {
        hex.to_string()
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd native && cargo test -- math::hex`
Expected: All PASS

**Step 5: Write failing tests for compositeOver**

`native/src/math/composite.rs`:
```rust
use super::hex::parse_hex_rgb;

/// Alpha-composite a foreground color over a background color.
/// formula per channel: result = fg * alpha + bg * (1 - alpha)
/// Returns 6-digit hex string.
///
/// Port of: src/core/contrast-checker.ts → compositeOver()
pub fn composite_over(fg_hex: &str, bg_hex: &str, alpha: f64) -> String {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_fg_returns_fg() {
        assert_eq!(composite_over("#ff0000", "#0000ff", 1.0), "#ff0000");
    }

    #[test]
    fn transparent_fg_returns_bg() {
        assert_eq!(composite_over("#ff0000", "#0000ff", 0.0), "#0000ff");
    }

    #[test]
    fn half_transparent_blends() {
        // red 50% over blue → #800080 (purple-ish)
        let result = composite_over("#ff0000", "#0000ff", 0.5);
        // R: 255*0.5 + 0*0.5 = 128, G: 0, B: 0*0.5 + 255*0.5 = 128
        assert_eq!(result, "#800080");
    }

    #[test]
    fn white_50_on_black() {
        let result = composite_over("#ffffff", "#000000", 0.5);
        assert_eq!(result, "#808080");
    }
}
```

**Step 6: Run tests to verify they fail**

Run: `cd native && cargo test -- math::composite`
Expected: FAIL

**Step 7: Implement compositeOver**

```rust
pub fn composite_over(fg_hex: &str, bg_hex: &str, alpha: f64) -> String {
    let (fr, fg, fb) = parse_hex_rgb(fg_hex);
    let (br, bg_g, bb) = parse_hex_rgb(bg_hex);

    let blend = |f: u8, b: u8| -> u8 {
        let result = f as f64 * alpha + b as f64 * (1.0 - alpha);
        result.round() as u8
    };

    let r = blend(fr, br);
    let g = blend(fg, bg_g);
    let b = blend(fb, bb);

    format!("#{:02x}{:02x}{:02x}", r, g, b)
}
```

**Step 8: Run tests to verify they pass**

Run: `cd native && cargo test -- math::composite`
Expected: All PASS

**Step 9: Commit**

```bash
git add native/src/math/
git commit -m "feat(native): implement parseHexRGB and compositeOver in Rust"
```

---

## Task 4: Math Engine — WCAG Contrast Ratio

**Files:**
- Create: `native/src/math/wcag.rs`
- Modify: `native/src/math/mod.rs`

Port of: `colord` library's contrast ratio calculation (WCAG 2.1 relative luminance formula).

**Step 1: Write failing tests**

`native/src/math/wcag.rs`:
```rust
/// Convert sRGB channel (0-255) to linear light value.
/// sRGB → linear: if V <= 0.04045: V/12.92, else ((V+0.055)/1.055)^2.4
fn srgb_to_linear(channel: u8) -> f64 {
    todo!()
}

/// Calculate relative luminance per WCAG 2.1.
/// L = 0.2126 * R + 0.7152 * G + 0.0722 * B (linear channels)
pub fn relative_luminance(hex: &str) -> f64 {
    todo!()
}

/// Calculate WCAG 2.1 contrast ratio between two colors.
/// ratio = (L1 + 0.05) / (L2 + 0.05) where L1 >= L2
pub fn contrast_ratio(hex1: &str, hex2: &str) -> f64 {
    todo!()
}

/// Determine pass/fail for all WCAG thresholds.
pub fn check_wcag_thresholds(ratio: f64, is_large_text: bool) -> WcagResult {
    todo!()
}

pub struct WcagResult {
    pub pass_aa: bool,
    pub pass_aa_large: bool,
    pub pass_aaa: bool,
    pub pass_aaa_large: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    // Cross-reference values with colord library output
    #[test]
    fn black_on_white_is_21() {
        let ratio = contrast_ratio("#000000", "#ffffff");
        assert!((ratio - 21.0).abs() < 0.01);
    }

    #[test]
    fn white_on_white_is_1() {
        let ratio = contrast_ratio("#ffffff", "#ffffff");
        assert!((ratio - 1.0).abs() < 0.01);
    }

    #[test]
    fn gray_on_white() {
        // colord: colord("#767676").contrast("#ffffff") ≈ 4.54
        let ratio = contrast_ratio("#767676", "#ffffff");
        assert!((ratio - 4.54).abs() < 0.1);
    }

    #[test]
    fn order_independent() {
        let r1 = contrast_ratio("#ff0000", "#ffffff");
        let r2 = contrast_ratio("#ffffff", "#ff0000");
        assert!((r1 - r2).abs() < 0.001);
    }

    #[test]
    fn aa_normal_requires_4_5() {
        let r = check_wcag_thresholds(4.5, false);
        assert!(r.pass_aa);
        assert!(!r.pass_aaa);
    }

    #[test]
    fn aa_large_requires_3() {
        let r = check_wcag_thresholds(3.0, true);
        assert!(r.pass_aa);   // AA large = 3:1
        assert!(!r.pass_aaa); // AAA large = 4.5:1
    }

    #[test]
    fn aaa_normal_requires_7() {
        let r = check_wcag_thresholds(7.0, false);
        assert!(r.pass_aa);
        assert!(r.pass_aaa);
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cd native && cargo test -- math::wcag`
Expected: FAIL

**Step 3: Implement WCAG calculations**

```rust
fn srgb_to_linear(channel: u8) -> f64 {
    let v = channel as f64 / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

pub fn relative_luminance(hex: &str) -> f64 {
    let (r, g, b) = super::hex::parse_hex_rgb(hex);
    0.2126 * srgb_to_linear(r) + 0.7152 * srgb_to_linear(g) + 0.0722 * srgb_to_linear(b)
}

pub fn contrast_ratio(hex1: &str, hex2: &str) -> f64 {
    let l1 = relative_luminance(hex1);
    let l2 = relative_luminance(hex2);
    let (lighter, darker) = if l1 > l2 { (l1, l2) } else { (l2, l1) };
    (lighter + 0.05) / (darker + 0.05)
}

pub fn check_wcag_thresholds(ratio: f64, is_large_text: bool) -> WcagResult {
    if is_large_text {
        WcagResult {
            pass_aa: ratio >= 3.0,
            pass_aa_large: ratio >= 3.0,
            pass_aaa: ratio >= 4.5,
            pass_aaa_large: ratio >= 4.5,
        }
    } else {
        WcagResult {
            pass_aa: ratio >= 4.5,
            pass_aa_large: ratio >= 3.0,
            pass_aaa: ratio >= 7.0,
            pass_aaa_large: ratio >= 4.5,
        }
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd native && cargo test -- math::wcag`
Expected: All PASS

**Step 5: Write cross-validation test (Rust vs colord)**

Create `native/tests/cross_validate_wcag.rs` (integration test that spawns Node to compare):

```rust
// This test is run manually — requires Node.js
// Run: cd native && cargo test --test cross_validate_wcag -- --ignored
#[test]
#[ignore]
fn cross_validate_against_colord() {
    // Generate 100 random hex pairs, compute ratio in Rust,
    // compare with colord output from a Node.js script.
    // Tolerance: ±0.01
    // Implementation: shell out to node -e "..." or use a fixture file.
}
```

A simpler approach: create a fixture file with known colord outputs:

Create `native/tests/fixtures/colord_ratios.json`:
```json
[
    { "fg": "#000000", "bg": "#ffffff", "expected": 21.0 },
    { "fg": "#767676", "bg": "#ffffff", "expected": 4.54 },
    { "fg": "#ff0000", "bg": "#ffffff", "expected": 4.0 },
    { "fg": "#1e293b", "bg": "#ffffff", "expected": 12.64 },
    { "fg": "#09090b", "bg": "#ffffff", "expected": 19.37 },
    { "fg": "#ffffff", "bg": "#09090b", "expected": 19.37 },
    { "fg": "#a1a1aa", "bg": "#09090b", "expected": 7.07 },
    { "fg": "#f4f4f5", "bg": "#18181b", "expected": 14.94 }
]
```

Generate these fixture values by running:
```bash
node -e "
const { colord } = require('colord');
const pairs = [
  ['#000000','#ffffff'], ['#767676','#ffffff'], ['#ff0000','#ffffff'],
  ['#1e293b','#ffffff'], ['#09090b','#ffffff'], ['#ffffff','#09090b'],
  ['#a1a1aa','#09090b'], ['#f4f4f5','#18181b']
];
console.log(JSON.stringify(pairs.map(([fg,bg]) => ({fg, bg, expected: +colord(fg).contrast(bg).toFixed(2)}))));
"
```

**Step 6: Commit**

```bash
git add native/src/math/wcag.rs native/tests/
git commit -m "feat(native): implement WCAG 2.1 contrast ratio calculation"
```

---

## Task 5: Math Engine — APCA Lc Calculation

**Files:**
- Create: `native/src/math/apca.rs`
- Modify: `native/src/math/mod.rs`

Port of: `apca-w3` npm library. APCA uses different constants and formulas than WCAG.

**Step 1: Research APCA constants**

The `apca-w3` library uses these constants (verify in `node_modules/apca-w3/src/apca-w3.js`):
```
Exponents: normBG=0.56, normTXT=0.57, revBG=0.65, revTXT=0.62
Clamp: loClip=0.1, deltaYmin=0.0005
Scale: scaleBoW=1.14, scaleWoB=1.14
Offset: loBoWoffset=0.027, loWoBoffset=0.027
Power: mainTRC=2.4 (sRGB linearization — same as WCAG)
Coefficients: sRco=0.2126729, sGco=0.7151522, sBco=0.0721750
```

**IMPORTANT:** These constants may differ between apca-w3 versions. Always verify against the installed version in `node_modules/apca-w3/`.

**Step 2: Write failing tests**

`native/src/math/apca.rs`:
```rust
/// Calculate APCA Lightness Contrast (Lc) value.
/// Positive Lc = dark text on light bg.
/// Negative Lc = light text on dark bg.
/// |Lc| >= 60 is roughly equivalent to WCAG AA for body text.
///
/// Port of: apca-w3 npm library → calcAPCA()
pub fn calc_apca_lc(text_hex: &str, bg_hex: &str) -> f64 {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Cross-reference with: node -e "const {calcAPCA} = require('apca-w3'); console.log(calcAPCA('#000000','#ffffff'))"
    #[test]
    fn black_on_white() {
        let lc = calc_apca_lc("#000000", "#ffffff");
        // Expected: ~107.9 (positive = dark on light)
        assert!((lc - 107.9).abs() < 1.0);
    }

    #[test]
    fn white_on_black() {
        let lc = calc_apca_lc("#ffffff", "#000000");
        // Expected: ~-106.0 (negative = light on dark)
        assert!((lc - (-106.0)).abs() < 1.0);
    }

    #[test]
    fn low_contrast_pair() {
        let lc = calc_apca_lc("#767676", "#ffffff");
        // Expected: ~63.1 (borderline readable)
        assert!((lc - 63.1).abs() < 2.0);
    }

    #[test]
    fn same_color_returns_zero() {
        let lc = calc_apca_lc("#808080", "#808080");
        assert!(lc.abs() < 1.0);
    }
}
```

**Step 3: Run tests to verify they fail**

Run: `cd native && cargo test -- math::apca`
Expected: FAIL

**Step 4: Implement APCA**

```rust
pub fn calc_apca_lc(text_hex: &str, bg_hex: &str) -> f64 {
    // Constants from apca-w3 (verify against installed version!)
    const MAIN_TRC: f64 = 2.4;
    const S_RCO: f64 = 0.2126729;
    const S_GCO: f64 = 0.7151522;
    const S_BCO: f64 = 0.0721750;

    const NORM_BG: f64 = 0.56;
    const NORM_TXT: f64 = 0.57;
    const REV_BG: f64 = 0.65;
    const REV_TXT: f64 = 0.62;

    const SCALE_BOW: f64 = 1.14;
    const SCALE_WOB: f64 = 1.14;
    const LO_BOW_OFFSET: f64 = 0.027;
    const LO_WOB_OFFSET: f64 = 0.027;
    const LO_CLIP: f64 = 0.1;
    const DELTA_Y_MIN: f64 = 0.0005;

    let linearize = |c: u8| -> f64 {
        (c as f64 / 255.0).powf(MAIN_TRC)
    };

    let (tr, tg, tb) = super::hex::parse_hex_rgb(text_hex);
    let (br, bg, bb) = super::hex::parse_hex_rgb(bg_hex);

    let txt_y = S_RCO * linearize(tr) + S_GCO * linearize(tg) + S_BCO * linearize(tb);
    let bg_y = S_RCO * linearize(br) + S_GCO * linearize(bg) + S_BCO * linearize(bb);

    if (txt_y - bg_y).abs() < DELTA_Y_MIN {
        return 0.0;
    }

    let (sapc, output_scale) = if bg_y > txt_y {
        // Dark text on light bg (positive polarity)
        let sapc = (bg_y.powf(NORM_BG) - txt_y.powf(NORM_TXT)) * SCALE_BOW;
        (sapc, LO_BOW_OFFSET)
    } else {
        // Light text on dark bg (negative polarity)
        let sapc = (bg_y.powf(REV_BG) - txt_y.powf(REV_TXT)) * SCALE_WOB;
        (sapc, LO_WOB_OFFSET)
    };

    if sapc.abs() < LO_CLIP {
        0.0
    } else if sapc > 0.0 {
        (sapc - output_scale) * 100.0
    } else {
        (sapc + output_scale) * 100.0
    }
}
```

**Step 5: Generate APCA fixture values**

Run:
```bash
node -e "
const {calcAPCA} = require('apca-w3');
const pairs = [
  ['#000000','#ffffff'], ['#ffffff','#000000'], ['#767676','#ffffff'],
  ['#808080','#808080'], ['#1e293b','#ffffff'], ['#f4f4f5','#09090b']
];
console.log(JSON.stringify(pairs.map(([t,b]) => ({text:t, bg:b, lc: +calcAPCA(t,b).toFixed(1)}))));
"
```

Save output to `native/tests/fixtures/apca_values.json` and write a fixture-based test.

**Step 6: Run tests to verify they pass**

Run: `cd native && cargo test -- math::apca`
Expected: All PASS (within ±1.0 tolerance)

**Step 7: Commit**

```bash
git add native/src/math/apca.rs native/tests/fixtures/
git commit -m "feat(native): implement APCA Lc calculation with cross-validation fixtures"
```

---

## Task 6: Math Engine — Color Parsing (toHex equivalent)

**Files:**
- Create: `native/src/math/color_parse.rs`
- Modify: `native/Cargo.toml` — add `csscolorparser` dependency

Port of: `src/core/color-utils.ts` → `toHex()`. Evaluate `csscolorparser` crate first.

**Step 1: Add csscolorparser to Cargo.toml**

```toml
[dependencies]
csscolorparser = "0.7"
```

**Step 2: Write failing tests**

`native/src/math/color_parse.rs`:
```rust
/// Convert any CSS color value to 6-digit hex (or 8-digit with alpha).
/// Handles: oklch, hsl, rgb, display-p3, hex, named colors.
/// Returns None for: transparent, inherit, currentColor, unrecognized.
///
/// Port of: src/core/color-utils.ts → toHex()
pub fn to_hex(value: &str) -> Option<String> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_passthrough() {
        assert_eq!(to_hex("#ff0000"), Some("#ff0000".to_string()));
        assert_eq!(to_hex("#1e293b"), Some("#1e293b".to_string()));
    }

    #[test]
    fn hex_3digit_expansion() {
        assert_eq!(to_hex("#f00"), Some("#ff0000".to_string()));
    }

    #[test]
    fn hex_8digit_preserved() {
        assert_eq!(to_hex("#ff000080"), Some("#ff000080".to_string()));
    }

    #[test]
    fn rgb_format() {
        assert_eq!(to_hex("rgb(255, 0, 0)"), Some("#ff0000".to_string()));
        assert_eq!(to_hex("rgb(255 0 0)"), Some("#ff0000".to_string()));
    }

    #[test]
    fn hsl_format() {
        // hsl(0, 100%, 50%) = red
        let result = to_hex("hsl(0, 100%, 50%)");
        assert_eq!(result, Some("#ff0000".to_string()));
    }

    #[test]
    fn oklch_format() {
        // oklch(63.7% 0.237 25.331) ≈ red-500 in Tailwind
        // Exact value depends on conversion precision
        let result = to_hex("oklch(0.637 0.237 25.331)");
        assert!(result.is_some());
    }

    #[test]
    fn transparent_returns_none() {
        assert_eq!(to_hex("transparent"), None);
    }

    #[test]
    fn inherit_returns_none() {
        assert_eq!(to_hex("inherit"), None);
    }

    #[test]
    fn current_color_returns_none() {
        assert_eq!(to_hex("currentColor"), None);
    }
}
```

**Step 3: Implement using csscolorparser**

```rust
use csscolorparser::Color;

pub fn to_hex(value: &str) -> Option<String> {
    let trimmed = value.trim();

    // Special values → None
    match trimmed.to_lowercase().as_str() {
        "transparent" | "inherit" | "currentcolor" | "initial" | "unset" => return None,
        _ => {}
    }

    // Direct hex passthrough (normalize 3→6, 4→8 digit)
    if trimmed.starts_with('#') {
        let raw = &trimmed[1..];
        return match raw.len() {
            3 => {
                let expanded: String = raw.chars()
                    .flat_map(|c| [c, c])
                    .collect();
                Some(format!("#{}", expanded))
            }
            4 => {
                let expanded: String = raw.chars()
                    .flat_map(|c| [c, c])
                    .collect();
                Some(format!("#{}", expanded))
            }
            6 | 8 => Some(trimmed.to_lowercase()),
            _ => None,
        };
    }

    // Normalize oklch percentage lightness: oklch(50% ...) → oklch(0.50 ...)
    let normalized = if trimmed.starts_with("oklch(") {
        normalize_oklch_lightness(trimmed)
    } else {
        trimmed.to_string()
    };

    // Use csscolorparser for everything else
    match normalized.parse::<Color>() {
        Ok(color) => {
            let [r, g, b, a] = color.to_rgba8();
            if a < 255 {
                Some(format!("#{:02x}{:02x}{:02x}{:02x}", r, g, b, a))
            } else {
                Some(format!("#{:02x}{:02x}{:02x}", r, g, b))
            }
        }
        Err(_) => None,
    }
}

/// oklch(50% 0.13 242) → oklch(0.50 0.13 242)
fn normalize_oklch_lightness(value: &str) -> String {
    // If the first number after "oklch(" ends with %, convert to 0-1 range
    // This is needed because csscolorparser may not handle % lightness
    if let Some(inner) = value.strip_prefix("oklch(") {
        let inner = inner.trim_end_matches(')').trim();
        let parts: Vec<&str> = inner.split_whitespace().collect();
        if let Some(first) = parts.first() {
            if let Some(pct) = first.strip_suffix('%') {
                if let Ok(val) = pct.parse::<f64>() {
                    let mut new_parts = vec![format!("{:.4}", val / 100.0)];
                    new_parts.extend(parts[1..].iter().map(|s| s.to_string()));
                    return format!("oklch({})", new_parts.join(" "));
                }
            }
        }
    }
    value.to_string()
}
```

**Step 4: Test against TS toHex() outputs**

Generate fixture file comparing csscolorparser output to culori output:
```bash
node -e "
const { toHex } = require('./dist/index.js');
const vals = [
  'oklch(0.637 0.237 25.331)', 'hsl(210 40% 98%)', 'rgb(255 0 128)',
  '#1e293b', '#f00', 'color(display-p3 1 0.5 0)', 'transparent'
];
console.log(JSON.stringify(vals.map(v => ({ input: v, expected: toHex(v) }))));
"
```

Save to `native/tests/fixtures/to_hex_values.json`.

**IMPORTANT:** If `csscolorparser` doesn't handle `oklch` or `display-p3` correctly, evaluate the `palette` crate as alternative. The key requirement is matching `culori`'s output within ±1 per RGB channel.

**Step 5: Run tests**

Run: `cd native && cargo test -- math::color_parse`
Expected: All PASS

**Step 6: Commit**

```bash
git add native/src/math/color_parse.rs native/Cargo.toml native/tests/fixtures/
git commit -m "feat(native): implement CSS color parsing via csscolorparser crate"
```

---

## Task 7: Math Engine — checkAllPairs (Full Contrast Pipeline)

**Files:**
- Create: `native/src/math/checker.rs`
- Modify: `native/src/math/mod.rs`

Port of: `src/core/contrast-checker.ts` → `checkContrast()` and `checkAllPairs()`.

**Step 1: Write failing tests**

`native/src/math/checker.rs`:
```rust
use crate::types::{ColorPair, ContrastResult};

/// Check contrast for a single color pair.
/// Performs alpha compositing, then WCAG ratio + APCA Lc.
///
/// Port of: src/core/contrast-checker.ts → checkContrast()
pub fn check_contrast(pair: &ColorPair, page_bg: &str) -> ContrastResult {
    todo!()
}

/// Check all pairs and categorize into violations/passed/ignored/skipped.
///
/// Port of: src/core/contrast-checker.ts → checkAllPairs()
pub fn check_all_pairs(
    pairs: &[ColorPair],
    threshold: &str,  // "AA" or "AAA"
    page_bg: &str,
) -> CheckResult {
    todo!()
}

pub struct CheckResult {
    pub violations: Vec<ContrastResult>,
    pub passed: Vec<ContrastResult>,
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

    #[test]
    fn black_on_white_passes_all() {
        let pair = make_pair("#ffffff", "#000000");
        let result = check_contrast(&pair, "#ffffff");
        assert!(result.pass_aa);
        assert!(result.pass_aaa);
        assert!((result.ratio - 21.0).abs() < 0.1);
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
    fn ignored_pair_skipped() {
        let mut pair = make_pair("#ffffff", "#000000");
        pair.ignored = Some(true);
        pair.ignore_reason = Some("test ignore".to_string());
        let result = check_all_pairs(&[pair], "AA", "#ffffff");
        assert_eq!(result.violations.len(), 0);
        assert_eq!(result.passed.len(), 0);
        assert_eq!(result.ignored_count, 1);
    }

    #[test]
    fn disabled_pair_skipped() {
        let mut pair = make_pair("#ffffff", "#cccccc");
        pair.is_disabled = Some(true);
        let result = check_all_pairs(&[pair], "AA", "#ffffff");
        assert_eq!(result.violations.len(), 0);
        assert_eq!(result.skipped_count, 1);
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cd native && cargo test -- math::checker`

**Step 3: Implement check_contrast and check_all_pairs**

The implementation combines `compositeOver`, `contrast_ratio`, `calc_apca_lc`, and `check_wcag_thresholds`:

```rust
pub fn check_contrast(pair: &ColorPair, page_bg: &str) -> ContrastResult {
    let bg_hex = match &pair.bg_hex {
        Some(h) => h.clone(),
        None => page_bg.to_string(),
    };
    let text_hex = match &pair.text_hex {
        Some(h) => h.clone(),
        None => return make_skipped_result(pair, "unresolved text color"),
    };

    // Alpha composite bg against page bg if semi-transparent
    let effective_bg = match pair.bg_alpha {
        Some(a) if a < 0.999 => super::composite::composite_over(&bg_hex, page_bg, a),
        _ => bg_hex.clone(),
    };

    // Alpha composite fg against effective bg if semi-transparent
    let effective_fg = match pair.text_alpha {
        Some(a) if a < 0.999 => super::composite::composite_over(&text_hex, &effective_bg, a),
        _ => text_hex.clone(),
    };

    let ratio = super::wcag::contrast_ratio(&effective_fg, &effective_bg);
    let is_large = pair.is_large_text.unwrap_or(false);
    let wcag = super::wcag::check_wcag_thresholds(ratio, is_large);

    let apca_lc = Some(super::apca::calc_apca_lc(&effective_fg, &effective_bg));

    ContrastResult {
        // Copy pair fields...
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
        // Contrast results
        ratio,
        pass_aa: wcag.pass_aa,
        pass_aa_large: wcag.pass_aa_large,
        pass_aaa: wcag.pass_aaa,
        pass_aaa_large: wcag.pass_aaa_large,
        apca_lc,
        deuteranopia_ratio: None,  // Phase 5
        protanopia_ratio: None,    // Phase 5
    }
}
```

**Step 4: Run tests**

Run: `cd native && cargo test -- math::checker`
Expected: All PASS

**Step 5: Cross-validate against full TS test suite**

Run: `npx vitest run src/core/__tests__/contrast-checker.test.ts`

Create a Node.js script `native/scripts/cross_validate.mjs` that:
1. Loads the same test fixtures used in `contrast-checker.test.ts`
2. Runs them through both the TS and Rust implementations
3. Compares results (tolerance ±0.01 for ratios, ±1.0 for APCA Lc)

**Step 6: Commit**

```bash
git add native/src/math/checker.rs native/scripts/
git commit -m "feat(native): implement full contrast checking pipeline (WCAG + APCA + compositing)"
```

---

## Task 8: Parser — Tokenizer + JsxVisitor Trait

**Files:**
- Create: `native/src/parser/mod.rs`
- Create: `native/src/parser/tokenizer.rs`
- Create: `native/src/parser/visitor.rs`
- Modify: `native/src/lib.rs` — add `mod parser;`

This is the extensible core of the Rust parser. The tokenizer produces events, visitors consume them.

**Step 1: Define the JsxVisitor trait**

`native/src/parser/visitor.rs`:
```rust
use std::collections::HashMap;

/// Events emitted by the tokenizer for visitor consumption.
pub trait JsxVisitor {
    /// Called when a JSX opening tag is encountered.
    /// `tag_name`: e.g. "Card", "div", "Button"
    /// `attributes`: raw attribute string (unparsed — visitors parse what they need)
    fn on_tag_open(&mut self, tag_name: &str, is_self_closing: bool, raw_tag: &str) {}

    /// Called when a JSX closing tag is encountered.
    fn on_tag_close(&mut self, tag_name: &str) {}

    /// Called when a comment is found (single-line or block).
    /// `content`: the text inside the comment (excluding /* */ or // markers)
    /// `line`: 1-based line number
    fn on_comment(&mut self, content: &str, line: u32) {}

    /// Called when a className or class attribute value is found.
    /// `value`: the extracted class string content
    /// `line`: 1-based line number
    /// `raw_tag`: the full raw tag string for context
    fn on_class_attribute(&mut self, value: &str, line: u32, raw_tag: &str) {}

    /// Called when the scan of a file is complete.
    fn on_file_end(&mut self) {}
}
```

**Step 2: Implement the tokenizer (lossy JSX scanner)**

`native/src/parser/tokenizer.rs`:
```rust
use super::visitor::JsxVisitor;

/// Scan JSX source and emit events to all registered visitors.
/// This is a "lossy" lexer — it recognizes tags, attributes, comments, and strings,
/// but ignores everything else.
///
/// Port of: src/plugins/jsx/parser.ts → extractClassRegions() (state machine core)
pub fn scan_jsx(source: &str, visitors: &mut [&mut dyn JsxVisitor]) {
    todo!()
}

/// Pre-compute line break offsets for binary search line numbering.
fn build_line_offsets(source: &str) -> Vec<usize> {
    let mut offsets = vec![0]; // Line 1 starts at offset 0
    for (i, ch) in source.char_indices() {
        if ch == '\n' {
            offsets.push(i + 1);
        }
    }
    offsets
}

/// Binary search for line number at given byte offset.
fn line_at_offset(offsets: &[usize], offset: usize) -> u32 {
    match offsets.binary_search(&offset) {
        Ok(i) => (i + 1) as u32,
        Err(i) => i as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_offsets_simple() {
        let offsets = build_line_offsets("abc\ndef\nghi");
        assert_eq!(offsets, vec![0, 4, 8]);
        assert_eq!(line_at_offset(&offsets, 0), 1);
        assert_eq!(line_at_offset(&offsets, 4), 2);
        assert_eq!(line_at_offset(&offsets, 8), 3);
    }

    // Tokenizer tests use a recording visitor
    struct RecordingVisitor {
        events: Vec<String>,
    }

    impl RecordingVisitor {
        fn new() -> Self { Self { events: vec![] } }
    }

    impl JsxVisitor for RecordingVisitor {
        fn on_tag_open(&mut self, tag: &str, self_closing: bool, _raw: &str) {
            self.events.push(format!("OPEN:{}{}", tag, if self_closing { "/" } else { "" }));
        }
        fn on_tag_close(&mut self, tag: &str) {
            self.events.push(format!("CLOSE:{}", tag));
        }
        fn on_comment(&mut self, content: &str, line: u32) {
            self.events.push(format!("COMMENT:L{}:{}", line, content.trim()));
        }
        fn on_class_attribute(&mut self, value: &str, line: u32, _raw: &str) {
            self.events.push(format!("CLASS:L{}:{}", line, value));
        }
    }

    #[test]
    fn simple_tag_pair() {
        let mut v = RecordingVisitor::new();
        scan_jsx("<div>hello</div>", &mut [&mut v as &mut dyn JsxVisitor]);
        assert_eq!(v.events, vec!["OPEN:div", "CLOSE:div"]);
    }

    #[test]
    fn self_closing_tag() {
        let mut v = RecordingVisitor::new();
        scan_jsx("<br />", &mut [&mut v as &mut dyn JsxVisitor]);
        assert_eq!(v.events, vec!["OPEN:br/"]);
    }

    #[test]
    fn class_name_static() {
        let mut v = RecordingVisitor::new();
        scan_jsx(r#"<div className="bg-red-500 text-white">x</div>"#, &mut [&mut v as &mut dyn JsxVisitor]);
        assert!(v.events.contains(&"CLASS:L1:bg-red-500 text-white".to_string()));
    }

    #[test]
    fn comment_single_line() {
        let mut v = RecordingVisitor::new();
        scan_jsx("// @a11y-context bg:#09090b\n<div />", &mut [&mut v as &mut dyn JsxVisitor]);
        assert!(v.events.iter().any(|e| e.contains("COMMENT") && e.contains("@a11y-context")));
    }

    #[test]
    fn nested_tags() {
        let mut v = RecordingVisitor::new();
        scan_jsx("<Card><div>x</div></Card>", &mut [&mut v as &mut dyn JsxVisitor]);
        assert_eq!(v.events, vec!["OPEN:Card", "OPEN:div", "CLOSE:div", "CLOSE:Card"]);
    }
}
```

**Step 3: Implement scan_jsx**

The tokenizer is a character-by-character state machine mirroring `parser.ts`. States:
- `Normal` — scanning for `<` or `//` or `/*`
- `InTag` — inside `<tagName ...>`, scanning for `className=` or `/>`
- `InString` — inside `"..."` or `'...'` or `` `...` ``
- `InComment` — inside `//...\n` or `/*...*/`
- `InBrace` — inside `{...}` (JSX expression), tracking depth

This is the most complex function in the entire Rust codebase. Reference `src/plugins/jsx/parser.ts:extractClassRegions()` (521 lines) for the exact state transitions.

**Implementation guidance:**
- Use `&str` slices for zero-copy scanning
- Track `brace_depth` for balanced extraction
- Handle template literals (`` `${expr}` ``) by stripping expressions
- Handle `cn(...)`, `clsx(...)` with balanced paren extraction
- Use the `line_offsets` + `line_at_offset` for line numbering

**Step 4: Run tests**

Run: `cd native && cargo test -- parser::tokenizer`

**Step 5: Commit**

```bash
git add native/src/parser/
git commit -m "feat(native): implement JSX tokenizer with Visitor trait architecture"
```

---

## Task 9: Parser — ContextTracker Visitor

**Files:**
- Create: `native/src/parser/context_tracker.rs`

Port of: the context stack logic in `src/plugins/jsx/parser.ts` (container matching, @a11y-context-block handling).

**Step 1: Write failing tests**

```rust
use std::collections::HashMap;
use super::visitor::JsxVisitor;

pub struct ContextTracker {
    /// Component → bg class mapping (from config, injected)
    container_config: HashMap<String, String>,
    /// Default background class (e.g. "bg-background")
    default_bg: String,
    /// LIFO stack: (tag_name, bg_class, is_annotation)
    stack: Vec<StackEntry>,
}

struct StackEntry {
    tag: String,
    bg_class: String,
    is_annotation: bool,
}

impl ContextTracker {
    pub fn new(container_config: HashMap<String, String>, default_bg: String) -> Self { ... }

    /// Get the current effective background class (top of stack or default).
    pub fn current_bg(&self) -> &str { ... }
}

impl JsxVisitor for ContextTracker {
    fn on_tag_open(&mut self, tag_name: &str, is_self_closing: bool, raw_tag: &str) { ... }
    fn on_tag_close(&mut self, tag_name: &str) { ... }
    fn on_comment(&mut self, content: &str, line: u32) { ... }
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
        tracker.on_comment("@a11y-context-block bg:bg-slate-900", 1);
        tracker.on_tag_open("div", false, "<div>");
        assert_eq!(tracker.current_bg(), "bg-slate-900");
        tracker.on_tag_close("div");
        assert_eq!(tracker.current_bg(), "bg-background");
    }

    #[test]
    fn explicit_bg_in_tag_overrides() {
        let mut tracker = ContextTracker::new(make_config(), "bg-background".to_string());
        // A non-container tag with an explicit bg class
        tracker.on_tag_open("div", false, r#"<div className="bg-red-500">"#);
        // ContextTracker should detect bg-red-500 and push it
        assert_eq!(tracker.current_bg(), "bg-red-500");
    }
}
```

**Step 2: Implement ContextTracker**

Key behaviors (from `parser.ts`):
- On tag open: if tag is in `container_config` → push configured bg
- On tag open: if tag has explicit `bg-*` class (scan `raw_tag` for `bg-` pattern) → push that bg
- On tag close: pop matching entry
- On comment with `@a11y-context-block bg:X`: set pending annotation, push on next tag open
- Self-closing tags: no push/pop
- Explicit bg detection: use `findExplicitBgInTag` logic (skip `bg-linear-`, `bg-gradient-`, etc.)

**Step 3: Run tests**

Run: `cd native && cargo test -- parser::context_tracker`

**Step 4: Commit**

```bash
git add native/src/parser/context_tracker.rs
git commit -m "feat(native): implement ContextTracker visitor with container stack"
```

---

## Task 10: Parser — AnnotationParser Visitor

**Files:**
- Create: `native/src/parser/annotation_parser.rs`

Port of: annotation parsing in `src/plugins/jsx/categorizer.ts` (`getIgnoreReasonForLine`, `getContextOverrideForLine`) and `parser.ts` (pending annotation state).

**Step 1: Write failing tests**

```rust
pub struct AnnotationParser {
    /// Pending @a11y-context for next element (consumed on next on_class_attribute)
    pending_context: Option<ContextOverride>,
    /// Pending @a11y-ignore for next element
    pending_ignore: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ContextOverride {
    pub bg: Option<String>,
    pub fg: Option<String>,
    pub no_inherit: bool,
}

impl AnnotationParser {
    pub fn new() -> Self { ... }
    pub fn take_pending_context(&mut self) -> Option<ContextOverride> { ... }
    pub fn take_pending_ignore(&mut self) -> Option<String> { ... }
}

impl JsxVisitor for AnnotationParser {
    fn on_comment(&mut self, content: &str, line: u32) { ... }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_a11y_context_bg() {
        let mut ap = AnnotationParser::new();
        ap.on_comment("@a11y-context bg:#09090b", 1);
        let ctx = ap.take_pending_context().unwrap();
        assert_eq!(ctx.bg, Some("#09090b".to_string()));
    }

    #[test]
    fn parse_a11y_context_bg_and_fg() {
        let mut ap = AnnotationParser::new();
        ap.on_comment("@a11y-context bg:bg-slate-900 fg:text-white", 1);
        let ctx = ap.take_pending_context().unwrap();
        assert_eq!(ctx.bg, Some("bg-slate-900".to_string()));
        assert_eq!(ctx.fg, Some("text-white".to_string()));
    }

    #[test]
    fn parse_a11y_context_no_inherit() {
        let mut ap = AnnotationParser::new();
        ap.on_comment("@a11y-context bg:#fff no-inherit", 1);
        let ctx = ap.take_pending_context().unwrap();
        assert!(ctx.no_inherit);
    }

    #[test]
    fn parse_a11y_ignore() {
        let mut ap = AnnotationParser::new();
        ap.on_comment("a11y-ignore: dynamic background", 1);
        let reason = ap.take_pending_ignore().unwrap();
        assert_eq!(reason, "dynamic background");
    }

    #[test]
    fn parse_a11y_ignore_no_reason() {
        let mut ap = AnnotationParser::new();
        ap.on_comment("a11y-ignore", 1);
        let reason = ap.take_pending_ignore().unwrap();
        assert_eq!(reason, "");
    }

    #[test]
    fn pending_consumed_once() {
        let mut ap = AnnotationParser::new();
        ap.on_comment("@a11y-context bg:#fff", 1);
        assert!(ap.take_pending_context().is_some());
        assert!(ap.take_pending_context().is_none()); // consumed
    }

    #[test]
    fn block_comment_not_captured() {
        let mut ap = AnnotationParser::new();
        ap.on_comment("@a11y-context-block bg:bg-slate-900", 1);
        // Block annotations go to ContextTracker, not AnnotationParser
        assert!(ap.take_pending_context().is_none());
    }
}
```

**Step 2: Implement**

Parse comment content using string matching:
- `@a11y-context` (not `@a11y-context-block`) → parse `bg:`, `fg:`, `no-inherit` tokens
- `a11y-ignore` → extract optional reason after `:`

**Step 3: Run tests + commit**

```bash
cd native && cargo test -- parser::annotation_parser
git add native/src/parser/annotation_parser.rs
git commit -m "feat(native): implement AnnotationParser visitor for @a11y-context and a11y-ignore"
```

---

## Task 11: Parser — ClassExtractor Visitor

**Files:**
- Create: `native/src/parser/class_extractor.rs`

Port of: className extraction logic from `parser.ts` + class categorization from `categorizer.ts`.

This visitor produces `ClassRegion` objects — the main output of the parser.

**Step 1: Write failing tests**

```rust
pub struct ClassExtractor {
    regions: Vec<ClassRegion>,
    // References to other visitors (via shared state or passed in)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_classname_string() {
        let regions = extract_from(r#"<div className="bg-red-500 text-white">x</div>"#);
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].content, "bg-red-500 text-white");
    }

    #[test]
    fn single_quoted_string() {
        let regions = extract_from(r#"<div className={'bg-red-500 text-white'}>x</div>"#);
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].content, "bg-red-500 text-white");
    }

    #[test]
    fn template_literal() {
        let regions = extract_from(r#"<div className={`bg-red-500 ${expr} text-white`}>x</div>"#);
        assert_eq!(regions.len(), 1);
        // Template expressions stripped, classes preserved
        assert!(regions[0].content.contains("bg-red-500"));
        assert!(regions[0].content.contains("text-white"));
    }

    #[test]
    fn cn_function_call() {
        let regions = extract_from(r#"<div className={cn("bg-red-500", "text-white")}>x</div>"#);
        assert_eq!(regions.len(), 1);
        assert!(regions[0].content.contains("bg-red-500"));
    }

    #[test]
    fn line_number_tracking() {
        let regions = extract_from("line1\n<div className=\"bg-red\">\nx\n</div>");
        assert_eq!(regions[0].start_line, 2);
    }

    #[test]
    fn context_bg_from_container() {
        // When inside a Card container, context_bg should be "bg-card"
        let regions = extract_with_config(
            r#"<Card><span className="text-white">x</span></Card>"#,
            &[("Card", "bg-card")],
            "bg-background",
        );
        assert_eq!(regions[0].context_bg, "bg-card");
    }

    #[test]
    fn annotation_override_attached() {
        let regions = extract_from(
            "// @a11y-context bg:#09090b\n<div className=\"text-white\">x</div>"
        );
        assert_eq!(regions[0].context_override_bg, Some("#09090b".to_string()));
    }
}
```

**Step 2: Implement ClassExtractor**

The ClassExtractor:
1. Receives `on_class_attribute` events from the tokenizer
2. Queries `ContextTracker` for `current_bg()`
3. Queries `AnnotationParser` for pending overrides/ignores
4. Extracts string literals from `cn()`/`clsx()` calls
5. Strips template literal expressions
6. Produces `ClassRegion` with all metadata

**Important:** The interaction between visitors requires shared mutable state. Options:
- **Option A:** Pass references between visitors in the scan loop (complex lifetime management)
- **Option B:** Use `RefCell` for interior mutability
- **Option C:** Run visitors sequentially (tokenizer → ContextTracker → AnnotationParser → ClassExtractor), passing accumulated state. Each visitor adds to a shared `ScanState` struct.

**Recommended: Option C** — simplest lifetime management, matches the TS implementation where state flows linearly.

**Step 3: Run tests + commit**

```bash
cd native && cargo test -- parser::class_extractor
git add native/src/parser/class_extractor.rs
git commit -m "feat(native): implement ClassExtractor visitor producing ClassRegion objects"
```

---

## Task 12: Parser — DisabledDetector Visitor (US-07)

**Files:**
- Create: `native/src/parser/disabled_detector.rs`

New feature (not a port — native-only).

**Step 1: Write failing tests**

```rust
pub struct DisabledDetector {
    /// Line numbers where disabled elements were found
    disabled_lines: HashSet<u32>,
}

impl DisabledDetector {
    pub fn is_disabled_at(&self, line: u32) -> bool { ... }
}

impl JsxVisitor for DisabledDetector {
    fn on_tag_open(&mut self, tag_name: &str, _is_self_closing: bool, raw_tag: &str) {
        // Check for: disabled attribute, aria-disabled="true"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_disabled_attribute() {
        let mut dd = DisabledDetector::new();
        dd.on_tag_open("button", false, r#"<button disabled className="text-gray-400">"#);
        // Line detection is based on the tokenizer providing line info
    }

    #[test]
    fn detect_aria_disabled() {
        let mut dd = DisabledDetector::new();
        dd.on_tag_open("div", false, r#"<div aria-disabled="true" className="text-gray-400">"#);
    }

    #[test]
    fn disabled_variant_in_classname() {
        // disabled: prefix in Tailwind → indicates disabled styling
        // The class itself suggests the element can be disabled
    }

    #[test]
    fn not_disabled_without_attribute() {
        let mut dd = DisabledDetector::new();
        dd.on_tag_open("button", false, r#"<button className="text-gray-400">"#);
        // Should NOT mark as disabled
    }
}
```

**Step 2: Implement**

Simple pattern matching on `raw_tag`:
- Contains `disabled` as a standalone attribute (not `aria-disabled`)
- Contains `aria-disabled="true"` or `aria-disabled={true}`

**Step 3: Run tests + commit**

```bash
cd native && cargo test -- parser::disabled_detector
git add native/src/parser/disabled_detector.rs
git commit -m "feat(native): implement DisabledDetector visitor (US-07)"
```

---

## Task 13: Parser — CurrentColorResolver Visitor (US-08)

**Files:**
- Create: `native/src/parser/current_color_resolver.rs`

New feature (native-only). Tracks `contextColor` in the stack for resolving `text-current`/`border-current`.

**Step 1: Write failing tests**

```rust
pub struct CurrentColorResolver {
    /// Stack of text color classes: (tag, color_class)
    color_stack: Vec<(String, String)>,
}

impl CurrentColorResolver {
    /// Get the current inherited text color, if any.
    /// Returns None if no ancestor defines a text color in this file.
    pub fn current_color(&self) -> Option<&str> { ... }
}

impl JsxVisitor for CurrentColorResolver {
    fn on_tag_open(&mut self, tag_name: &str, is_self_closing: bool, raw_tag: &str) {
        // If raw_tag contains text-{color} class, push onto stack
    }
    fn on_tag_close(&mut self, tag_name: &str) {
        // Pop matching entry
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_color_returns_none() {
        let resolver = CurrentColorResolver::new();
        assert!(resolver.current_color().is_none());
    }

    #[test]
    fn inherits_parent_text_color() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r#"<div className="text-red-500">"#);
        assert_eq!(resolver.current_color(), Some("text-red-500"));
    }

    #[test]
    fn nested_color_overrides() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("div", false, r#"<div className="text-red-500">"#);
        resolver.on_tag_open("span", false, r#"<span className="text-blue-500">"#);
        assert_eq!(resolver.current_color(), Some("text-blue-500"));
        resolver.on_tag_close("span");
        assert_eq!(resolver.current_color(), Some("text-red-500"));
    }

    #[test]
    fn self_closing_no_push() {
        let mut resolver = CurrentColorResolver::new();
        resolver.on_tag_open("hr", true, r#"<hr className="text-red-500" />"#);
        assert!(resolver.current_color().is_none());
    }
}
```

**Step 2: Implement**

Scan `raw_tag` for `text-{word}` patterns (excluding `text-sm`, `text-lg`, `text-wrap`, etc. — non-color text utilities).

**Step 3: Run tests + commit**

```bash
cd native && cargo test -- parser::current_color_resolver
git add native/src/parser/current_color_resolver.rs
git commit -m "feat(native): implement CurrentColorResolver visitor (US-08)"
```

---

## Task 14: Parser — Full Integration + scan_file()

**Files:**
- Modify: `native/src/parser/mod.rs` — add `pub fn scan_file()` combining all visitors
- Create: `native/src/parser/integration_tests.rs`

Wire all visitors together into a single `scan_file()` function that produces `Vec<ClassRegion>`.

**Step 1: Write integration tests**

Use the same test fixtures from `src/plugins/jsx/__tests__/parser.test.ts`:

```rust
#[cfg(test)]
mod integration_tests {
    use super::*;

    #[test]
    fn full_pipeline_simple_component() {
        let source = r#"
export function Card() {
    return (
        <div className="bg-card p-4">
            <h1 className="text-card-foreground text-2xl font-bold">Title</h1>
            <p className="text-muted-foreground">Description</p>
        </div>
    );
}
"#;
        let config = vec![("Card", "bg-card")];
        let regions = scan_file(source, &config, "bg-background");

        assert_eq!(regions.len(), 3);
        assert_eq!(regions[0].content, "bg-card p-4");
        assert_eq!(regions[1].context_bg, "bg-card"); // inherited from parent div
    }

    #[test]
    fn annotation_context_override() {
        let source = r#"
// @a11y-context bg:#09090b
<div className="text-white">Floating element</div>
"#;
        let regions = scan_file(source, &[], "bg-background");
        assert_eq!(regions[0].context_override_bg, Some("#09090b".to_string()));
    }

    #[test]
    fn disabled_element_flagged() {
        let source = r#"<button disabled className="text-gray-400 bg-gray-100">Disabled</button>"#;
        let regions = scan_file(source, &[], "bg-background");
        assert_eq!(regions[0].ignored, Some(true));
        assert!(regions[0].ignore_reason.as_ref().unwrap().contains("disabled"));
    }
}
```

**Step 2: Implement scan_file()**

```rust
pub fn scan_file(
    source: &str,
    container_config: &[(&str, &str)],
    default_bg: &str,
) -> Vec<ClassRegion> {
    let config: HashMap<String, String> = container_config.iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

    let mut context_tracker = ContextTracker::new(config, default_bg.to_string());
    let mut annotation_parser = AnnotationParser::new();
    let mut class_extractor = ClassExtractor::new();
    let mut disabled_detector = DisabledDetector::new();
    let mut current_color = CurrentColorResolver::new();

    // Run tokenizer with all visitors
    scan_jsx(source, &mut [
        &mut context_tracker,
        &mut annotation_parser,
        &mut class_extractor,
        &mut disabled_detector,
        &mut current_color,
    ]);

    class_extractor.into_regions()
}
```

**Step 3: Cross-validate against TS parser**

Create a script that runs the same source files through both parsers and compares ClassRegion output:

```bash
node -e "
const { extractClassRegions } = require('./dist/plugins/jsx/parser.js');
// ... compare with Rust scan_file output
"
```

**Step 4: Run tests + commit**

```bash
cd native && cargo test -- parser::integration_tests
git add native/src/parser/
git commit -m "feat(native): wire all parser visitors into scan_file() with integration tests"
```

---

## Task 15: Parallelization with Rayon

**Files:**
- Modify: `native/Cargo.toml` — add `rayon` dependency
- Create: `native/src/engine.rs` — main entry point combining parser + math
- Modify: `native/src/lib.rs` — expose `extract_and_scan()` via NAPI

**Step 1: Add rayon**

```toml
[dependencies]
rayon = "1.10"
```

**Step 2: Implement extract_and_scan()**

```rust
use rayon::prelude::*;

#[napi]
pub fn extract_and_scan(options: ExtractOptions) -> Vec<PreExtractedFile> {
    let container_config: HashMap<String, String> = options.container_config
        .into_iter()
        .map(|e| (e.component, e.bg_class))
        .collect();

    options.file_contents
        .par_iter()  // Parallel iteration via rayon
        .map(|file_input| {
            let regions = parser::scan_file(
                &file_input.content,
                &container_config,
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

**Step 3: Write benchmark test**

Create `native/benches/parse_benchmark.rs`:
```rust
// Generate 100 synthetic JSX files, measure parse time
// Compare single-threaded vs rayon parallel
```

**Step 4: Run + verify**

Run: `cd native && cargo test && cargo bench`

**Step 5: Commit**

```bash
git add native/src/engine.rs native/Cargo.toml native/benches/
git commit -m "feat(native): add rayon parallelization for multi-file parsing"
```

---

## Task 16: NAPI-RS Bridge — Expose Full API to Node.js

**Files:**
- Modify: `native/src/lib.rs` — expose all public functions via `#[napi]`
- Modify: `src/native/index.ts` — typed wrapper with fallback logic
- Create: `src/native/__tests__/native-bridge.test.ts`

**Step 1: Expose functions via NAPI**

`native/src/lib.rs`:
```rust
#[napi]
pub fn extract_and_scan(options: ExtractOptions) -> Vec<PreExtractedFile> {
    engine::extract_and_scan(options)
}

#[napi]
pub fn check_contrast_pairs(
    pairs: Vec<ColorPair>,
    threshold: String,
    page_bg: String,
) -> CheckResultJs {
    let result = math::checker::check_all_pairs(&pairs, &threshold, &page_bg);
    // Convert to NAPI-compatible struct
    CheckResultJs::from(result)
}

#[napi]
pub fn health_check() -> String {
    "a11y-audit-native ok".to_string()
}
```

**Step 2: Build native module**

```bash
cd native && cargo build --release
# Copy .node file to project root
cp target/release/liba11y_audit_native.dylib ../a11y-audit-native.node
```

Note: The exact output filename depends on platform and napi-rs configuration. Check napi-rs docs for the correct build command.

**Step 3: Update src/native/index.ts with typed API**

```typescript
import type { ClassRegion } from '../core/types.js';

interface NativeModule {
    healthCheck(): string;
    extractAndScan(options: {
        fileContents: Array<{ path: string; content: string }>;
        containerConfig: Array<{ component: string; bgClass: string }>;
        defaultBg: string;
    }): Array<{ path: string; regions: ClassRegion[] }>;
    checkContrastPairs(
        pairs: ColorPair[],
        threshold: string,
        pageBg: string
    ): { violations: ContrastResult[]; passed: ContrastResult[]; ignoredCount: number; skippedCount: number };
}

let nativeModule: NativeModule | null = null;

try {
    nativeModule = require('../../native/a11y-audit-native.node') as NativeModule;
} catch {
    // Native module not available
}

export function isNativeAvailable(): boolean {
    return nativeModule !== null;
}

export function getNativeModule(): NativeModule {
    if (!nativeModule) {
        throw new Error('Native module not available. Running in legacy mode.');
    }
    return nativeModule;
}
```

**Step 4: Write bridge tests**

`src/native/__tests__/native-bridge.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { isNativeAvailable, getNativeModule } from '../index.js';

describe('native bridge', () => {
    it('health check returns expected string', () => {
        if (!isNativeAvailable()) return; // skip if not built
        expect(getNativeModule().healthCheck()).toBe('a11y-audit-native ok');
    });

    it('extractAndScan returns regions for simple JSX', () => {
        if (!isNativeAvailable()) return;
        const result = getNativeModule().extractAndScan({
            fileContents: [{
                path: 'test.tsx',
                content: '<div className="bg-red-500 text-white">x</div>',
            }],
            containerConfig: [],
            defaultBg: 'bg-background',
        });
        expect(result).toHaveLength(1);
        expect(result[0]!.regions).toHaveLength(1);
        expect(result[0]!.regions[0]!.content).toBe('bg-red-500 text-white');
    });
});
```

**Step 5: Run bridge tests**

Run: `npx vitest run src/native/__tests__/native-bridge.test.ts`

**Step 6: Commit**

```bash
git add native/src/lib.rs src/native/
git commit -m "feat(native): expose extract_and_scan and check_contrast_pairs via NAPI bridge"
```

---

## Task 17: Pipeline Integration — Native vs Legacy Fallback

**Files:**
- Modify: `src/core/pipeline.ts` — add native path selection
- Modify: `src/plugins/jsx/region-resolver.ts` — add native extraction path
- Create: `src/core/__tests__/pipeline-native.test.ts`

**Step 1: Add native path to pipeline.ts**

In `runAudit()`, before `extractAllFileRegions()`:

```typescript
import { isNativeAvailable, getNativeModule } from '../native/index.js';

// In runAudit():
let preExtracted: PreExtracted;

if (isNativeAvailable()) {
    // Native path: read files in JS, parse in Rust
    const fileContents = await readAllFiles(srcPatterns, cwd);
    const nativeResult = getNativeModule().extractAndScan({
        fileContents,
        containerConfig: Object.entries(containerMap).map(([k, v]) => ({ component: k, bgClass: v })),
        defaultBg,
    });
    preExtracted = convertNativeResult(nativeResult);
} else {
    // Legacy fallback (frozen at v1.0)
    console.error('⚠ Running in legacy mode (native module unavailable). Disabled detection and currentColor resolution will be skipped.');
    preExtracted = await extractAllFileRegions(srcPatterns, cwd, containerMap, defaultBg);
}
```

**Step 2: Write test**

```typescript
describe('pipeline native integration', () => {
    it('produces equivalent results for simple component', async () => {
        // Run same input through both paths, compare output
        // Tolerance for minor differences in line numbers or ordering
    });
});
```

**Step 3: Run tests**

Run: `npx vitest run src/core/__tests__/pipeline-native.test.ts`

**Step 4: Commit**

```bash
git add src/core/pipeline.ts src/plugins/jsx/region-resolver.ts src/core/__tests__/
git commit -m "feat: integrate native Rust module into pipeline with legacy fallback"
```

---

## Task 18: Cross-Validation — Full Test Suite Comparison

**Files:**
- Create: `native/scripts/full_cross_validate.mjs`

Run the complete existing test suite (384 tests) and verify the Rust module produces identical results.

**Step 1: Create cross-validation script**

The script:
1. Reads all test fixture files
2. Runs them through the TS pipeline
3. Runs them through the native pipeline
4. Compares:
   - Same number of ClassRegions per file
   - Same content in each ClassRegion
   - Contrast ratios within ±0.01
   - APCA Lc within ±1.0
   - Same pass/fail determination

**Step 2: Run existing test suite with native module**

```bash
# Build native module first
cd native && cargo build --release && cd ..

# Run all tests in batches (per CLAUDE.md rules)
npx vitest run src/core/__tests__/contrast-checker.test.ts
npx vitest run src/plugins/jsx/__tests__/parser.test.ts
npx vitest run src/plugins/jsx/__tests__/categorizer.test.ts
npx vitest run src/plugins/jsx/__tests__/region-resolver.test.ts
npx vitest run src/plugins/tailwind/__tests__/css-resolver.test.ts
```

**Step 3: Fix any discrepancies**

Common issues:
- Floating point precision: Rust `f64` vs JS `number` → use ±0.01 tolerance
- String normalization: lowercase hex (#FF0000 vs #ff0000)
- Edge cases in regex vs manual string matching

**Step 4: Commit**

```bash
git add native/scripts/
git commit -m "test: add full cross-validation suite (Rust vs TypeScript)"
```

---

## Task 19: Performance Benchmarking

**Files:**
- Create: `native/benches/real_world.rs`
- Create: `scripts/benchmark.mjs`

**Step 1: Create a realistic benchmark**

Generate or collect ~100 representative .tsx files (or use the multicoin-frontend codebase if available):

```bash
# Benchmark: TS path vs Native path
node scripts/benchmark.mjs --mode ts
node scripts/benchmark.mjs --mode native
node scripts/benchmark.mjs --mode compare
```

**Step 2: Measure and verify >70% improvement**

Expected output:
```
TypeScript path: 4200ms (100 files)
Native path:     1100ms (100 files)
Speedup: 73.8% ✓
```

If speedup is <70%, investigate:
- Is rayon parallelization working? (check thread count)
- Is NAPI serialization overhead significant? (profile the boundary)
- Are there unexpected allocations in the Rust parser?

**Step 3: Commit**

```bash
git add scripts/benchmark.mjs native/benches/
git commit -m "perf: add benchmarks comparing native vs TypeScript paths"
```

---

## Task 20: Documentation Update

**Files:**
- Modify: `CLAUDE.md` — update module layout, add native/ section
- Modify: `docs/LIBRARY_ARCHITECTURE.md` — add native engine section (Italian)

**Step 1: Update CLAUDE.md**

Add to module layout:
```
- `native/` — Rust core engine (NAPI-RS)
  - `native/src/math/` — Color math: compositeOver, WCAG, APCA, color parsing
  - `native/src/parser/` — JSX parser: tokenizer, visitors (ContextTracker, AnnotationParser, ClassExtractor, DisabledDetector, CurrentColorResolver)
  - `native/src/engine.rs` — Main entry: extract_and_scan() with rayon parallelization
- `src/native/index.ts` — JS binding loader with graceful legacy fallback
```

Add to key design decisions:
```
- **Hybrid Rust + Node.js**: Parser and math engine run in Rust via NAPI-RS. File I/O and orchestration stay in TypeScript. The TS parser is frozen at v1.0 ("Legacy Fallback") — no new features added.
- **US-07 (disabled detection) and US-08 (currentColor) are native-only features.
```

**Step 2: Update docs/LIBRARY_ARCHITECTURE.md**

Add a new section (in Italian) describing:
- Native engine architecture
- Visitor pattern design
- NAPI bridge
- Legacy fallback behavior
- Performance characteristics

**Step 3: Commit**

```bash
git add CLAUDE.md docs/LIBRARY_ARCHITECTURE.md
git commit -m "docs: update architecture docs with native Rust engine (Phase 1)"
```

---

## Summary: Task Dependency Graph

```
Task 1 (NAPI Setup)
  └── Task 2 (Shared Types)
        ├── Task 3 (parseHexRGB + compositeOver)
        │     └── Task 4 (WCAG Ratio)
        │           └── Task 5 (APCA Lc)
        │                 └── Task 6 (Color Parsing)
        │                       └── Task 7 (checkAllPairs)
        └── Task 8 (Tokenizer + Visitor Trait)
              ├── Task 9 (ContextTracker)
              ├── Task 10 (AnnotationParser)
              ├── Task 11 (ClassExtractor)
              ├── Task 12 (DisabledDetector US-07)
              └── Task 13 (CurrentColorResolver US-08)
                    └── Task 14 (Full Integration)
                          └── Task 15 (Rayon Parallelization)
                                └── Task 16 (NAPI Bridge)
                                      └── Task 17 (Pipeline Integration)
                                            └── Task 18 (Cross-Validation)
                                                  └── Task 19 (Benchmarks)
                                                        └── Task 20 (Docs)
```

**Note:** Tasks 3-7 (Math Engine) and Tasks 8-13 (Parser) are independent tracks that can be developed in parallel by different engineers. They converge at Task 14.

**Total estimated tasks:** 20
**Parallelizable tracks:** 2 (Math: Tasks 3-7, Parser: Tasks 8-13)
