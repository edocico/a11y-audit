# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A framework-agnostic static contrast audit library for WCAG 2.1 AA/AAA and APCA. Ported from an internal `multicoin-frontend` audit script (2352 LOC + 343 tests) into a standalone npm package with a plugin architecture. Both a programmatic API (`src/index.ts`) and a CLI (`src/bin/cli.ts`) are functional.

### Reference documents

- `docs/plans/2026-02-13-library-extraction.md` — The implementation plan (6 phases, 23 tasks). Completed. Useful as reference for design decisions.
- `docs/LIBRARY_ARCHITECTURE.md` — Comprehensive architecture doc (in Italian) covering the current package structure, algorithms, types, and config system. **This is the canonical technical reference.**
- `oldDoc/A11Y_AUDIT_TECHNICAL_ARCHITECTURE.md` — Architecture of the **original embedded script** (in Italian). Use as reference when porting source code from `../multicoin-frontend/scripts/a11y-audit/`. This does NOT describe the current package's architecture.
- `docs/plans/2026-02-13-phase1-rust-core-engine.md` — Phase 1 Rust engine plan (20 tasks). **All 20 tasks complete.** Covers NAPI-RS setup, math engine, JSX parser, pipeline integration, rayon parallelization, NAPI bridge, cross-validation, and benchmarking.
- `docs/plans/2026-02-14-phase2-baseline-ratchet.md` — Phase 2 Baseline/Ratchet plan (10 tasks). **All 10 tasks complete.** Covers hash generation, load/save, reconciliation, config, pipeline integration, CLI flags, report extensions, E2E tests.
- `docs/plans/2026-02-14-phase3-portals-opacity.md` — Phase 3 Parser Precision plan (12 tasks). **All 12 tasks complete.** Covers opacity stack tracking, visibility threshold, portal context reset, config/preset updates, cross-validation, E2E tests, documentation.
- `docs/plans/2026-02-15-phase4-suggestions-cva.md` — Phase 4 Suggestions + CVA plan. **All tasks complete.** Covers suggestion engine (US-03), CVA variant expansion (US-06), pipeline integration, CLI flags, config schema, E2E tests, documentation.

## Commands

```bash
npm run build          # tsup → dist/ (CJS + ESM + .d.ts)
npm run build:native   # cargo build --release → native/target/
npm run build:native:debug  # cargo build (debug)
npm run dev            # tsup --watch
npm test               # vitest run (all tests)
npm run test:watch     # vitest in watch mode
npx vitest run src/core/__tests__/contrast-checker.test.ts   # single test file
npx vitest run -t "compositeOver"                            # single test by name
npm run typecheck      # tsc --noEmit (strict mode)
cd native && cargo test                        # all Rust tests (~287 tests)
cd native && cargo test -- math::wcag          # single Rust module
npx tsx native/scripts/full_cross_validate.mts # cross-validate Rust vs TS
npx tsx scripts/benchmark.mts --files=500      # benchmark native vs legacy
```

## Architecture

**Ported from multicoin-frontend.** All 6 phases complete. ~470 tests passing across 26 test files (TS) + 287 Rust tests. Hybrid Rust+JS pipeline connected end-to-end with legacy fallback. Phase 2 (Baseline/Ratchet) complete. Phase 3 (Parser Precision: US-04 Portals + US-05 Opacity) complete. Phase 4 (Suggestions + CVA expansion) complete.

**Target architecture (Layered Onion):** pure math core → plugin interfaces (`ColorResolver`, `FileParser`, `ContainerConfig`) → config (`zod` + `lilconfig`) → CLI (`commander`). Tailwind + JSX are the first plugin implementations.

### Module layout

- `src/core/types.ts` — All shared types. Single source of truth; re-exported via `src/types/public.ts` → `src/index.ts`.
- `src/core/color-utils.ts` — `toHex()`: normalizes any CSS color (oklch, hsl, rgb, display-p3, hex) to 6- or 8-digit hex. Uses `culori` for parsing.
- `src/core/contrast-checker.ts` — `checkAllPairs()`: WCAG contrast checking with alpha compositing, APCA Lc calculation, AA/AAA level selection, and `// a11y-ignore` suppression. Uses `colord` for contrast ratios and `apca-w3` for APCA.
- `src/bin/cli.ts` — Commander-based CLI: loads config via `lilconfig`, merges CLI flags, runs pipeline.
- `src/core/baseline.ts` — Baseline/ratchet system: `generateViolationHash()` (SHA-256 content-addressable), `loadBaseline()`, `saveBaseline()`, `reconcileViolations()` (leaky-bucket algorithm). No line numbers or theme mode in hash for refactoring stability.
- `src/core/pipeline.ts` — `runAudit()`: orchestrates extract-once/resolve-twice flow, CVA expansion (Phase 1a), baseline reconciliation (Phase 3.5), suggestion enrichment (Phase 3a), writes reports to disk.
- `src/core/suggestions.ts` — Suggestion engine: `extractShadeFamilies()`, `parseFamilyAndShade()`, `generateSuggestions()` (luminosity-directed shade walk). Post-check enrichment step between Phase 3 (contrast check) and Phase 3.5 (baseline). Opt-in via `--suggest` CLI flag or `suggestions.enabled` config.
- `src/core/report/json.ts` — `generateJsonReport()`: structured JSON output with summary + per-theme data. Optional `baselineSummary` parameter adds new/known/fixed counts.
- `src/core/report/markdown.ts` — `generateReport()`: Markdown audit reports grouped by file, SC 1.4.3/1.4.11 separation, APCA support. With baseline: splits violations into "New" vs collapsible "Baseline" sections.
- `src/plugins/interfaces.ts` — Plugin contracts: `ColorResolver`, `FileParser`, `ContainerConfig` (containers + portals), `AuditConfig`.
- `src/config/schema.ts` — Zod schema `auditConfigSchema` with defaults; `loader.ts` uses `lilconfig`. Includes `portals` field for portal component configuration, `suggestions` for suggestion engine config, `cva` for CVA expansion config.
- `src/plugins/tailwind/css-resolver.ts` — CSS variable resolution: `buildThemeColorMaps()`, `resolveClassToHex()`, balanced-brace parsing, alpha compositing helpers.
- `src/plugins/tailwind/palette.ts` — `extractTailwindPalette()` + `findTailwindPalette()` for Tailwind v4 color palette extraction.
- `src/plugins/tailwind/presets/shadcn.ts` — shadcn/ui preset: 7 container→bg mappings + 15 portal→bg/reset mappings. Implements `ContainerConfig`.
- `src/plugins/jsx/categorizer.ts` — Pure classification functions: `stripVariants()`, `routeClassToTarget()`, `categorizeClasses()`, `determineIsLargeText()`, `extractBalancedParens()`, `extractStringLiterals()`, `getIgnoreReasonForLine()`, `getContextOverrideForLine()`. Exports `TaggedClass`, `ClassBuckets`, `ForegroundGroup`, `PairMeta` interfaces.
- `src/plugins/jsx/parser.ts` — JSX state machine: `extractClassRegions(source, containerMap, defaultBg)`, `isSelfClosingTag()`, `findExplicitBgInTag()`, `extractInlineStyleColors()`. Handles `@a11y-context` (single-element) and `@a11y-context-block` (block scope) annotations via context stack. The container map is injected (not imported globally).
- `src/plugins/jsx/region-resolver.ts` — Bg/fg pairing logic: `buildEffectiveBg()`, `generatePairs()`, `resolveFileRegions()`, `extractAllFileRegions(srcPatterns, cwd, containerMap, defaultBg)`. Cross-plugin dependency: imports `resolveClassToHex` from `tailwind/css-resolver.ts`.
- `src/plugins/jsx/cva-expander.ts` — CVA expansion: `extractCvaBase()`, `parseCvaVariants()`, `expandCvaToRegions()`, `expandCvaInPreExtracted()`. Post-extraction step between Phase 1 (extraction) and Phase 2 (resolution). Opt-in via `--cva` CLI flag or `cva.enabled` config.
- `native/` — Rust core engine (NAPI-RS). Phase 1 complete (20/20 tasks). Phase 3 complete (12/12 tasks).
  - `native/src/types.rs` — Rust equivalents of `core/types.ts` with `#[napi(object)]` for JS interop. Includes `ExtractOptions` with `portal_config`.
  - `native/src/math/` — Color math: `hex.rs` (parseHexRGB), `composite.rs` (compositeOver), `wcag.rs` (WCAG 2.1 contrast), `apca.rs` (APCA Lc), `color_parse.rs` (toHex via csscolorparser).
  - `native/src/math/checker.rs` — `check_contrast()` + `check_all_pairs()`: full WCAG + APCA + compositing pipeline with AA/AAA threshold selection.
  - `native/src/parser/` — JSX parser with Visitor pattern architecture.
    - `visitor.rs` — `JsxVisitor` trait (on_tag_open, on_tag_close, on_comment, on_class_attribute, on_file_end).
    - `tokenizer.rs` — `scan_jsx()`: lossy JSX lexer emitting events to visitors. Handles className="...", className={...}, cn()/clsx()/cva().
    - `context_tracker.rs` — `ContextTracker`: LIFO stack for container bg context, @a11y-context-block, explicit bg-* detection, cumulative opacity tracking (US-05), portal context reset (US-04).
    - `annotation_parser.rs` — `AnnotationParser`: per-element @a11y-context and a11y-ignore annotation parsing with pending/consume pattern.
    - `class_extractor.rs` — `ClassExtractor`: builder (not a visitor) that produces ClassRegion objects. Needs cross-visitor state → uses `record()` method.
    - `disabled_detector.rs` — `DisabledDetector`: US-07 native-only feature. Detects `disabled`, `aria-disabled="true"`, `disabled:` Tailwind variant.
    - `current_color_resolver.rs` — `CurrentColorResolver`: US-08 currentColor inheritance tracker. LIFO stack of text-color classes across JSX nesting.
    - `opacity.rs` — `parse_opacity_class()`: extracts opacity from `opacity-50`, `opacity-[0.3]`, `opacity-[30%]`.
    - `mod.rs` — `ScanOrchestrator`: combined JsxVisitor that owns all sub-components (ContextTracker, AnnotationParser, ClassExtractor, DisabledDetector, CurrentColorResolver). `scan_file(source, container_config, portal_config, default_bg)` public entry point.
  - `native/src/engine.rs` — `extract_and_scan()`: rayon-parallel multi-file parsing entry point. Maps file contents to `PreExtractedFile` via `par_iter()`.
  - `native/src/lib.rs` — NAPI-RS exports: `extract_and_scan()`, `check_contrast_pairs()`, `health_check()`.
- `src/native/index.ts` — JS binding loader with full typed API (`NativeClassRegion`, `NativePreExtractedFile`, `NativeCheckResult`). Graceful legacy fallback when `.node` not built.
- `src/native/converter.ts` — `convertNativeResult()`: bridges flat Rust `NativeClassRegion` → nested TS `ClassRegion` (contextOverride, inlineStyles). Required because NAPI-RS flattens nested structs.
- `native/scripts/full_cross_validate.mts` — Cross-validation script: compares Rust vs TS parser outputs and math engine results across 31 parser fixtures (25 base + 3 opacity + 3 portal native-only) + 8 math fixtures.
- `scripts/benchmark.mts` — Performance benchmark: measures native vs legacy parser speed with synthetic JSX files.

### Key design decisions

- **Three color libraries**: `culori` for CSS color parsing (better oklch/display-p3 support), `colord` + a11y plugin for WCAG contrast ratios, `apca-w3` for APCA Lightness Contrast (Lc). `culori` and `apca-w3` lack bundled TypeScript declarations → custom `.d.ts` files in `src/types/`.
- **Alpha compositing**: Semi-transparent colors are composited against the page background before contrast calculation. Light mode uses `#ffffff`, dark mode uses `#09090b` (zinc-950).
- **`@a11y-context` annotations**: Comment-based overrides (`// @a11y-context bg:#hex` for single element, `{/* @a11y-context-block bg:class */}` for block scope) let users correct false positives from absolute positioning, React Portals, and currentColor. Parsed in `categorizer.ts`, consumed by `parser.ts` (context stack) and `region-resolver.ts` (bg/fg override). `ContextOverride` type in `core/types.ts`; `contextSource` field on `ColorPair` tracks annotation provenance.
- **Dual output**: tsup builds both CJS and ESM with declarations. The package uses `verbatimModuleSyntax` — always use `import type` for type-only imports.
- **Hybrid Rust+JS pipeline**: File I/O stays in JS (glob + readFileSync); parsing moves to Rust. `pipeline.ts` auto-detects native module via `isNativeAvailable()` and falls back to TS parser. Source lines are preserved in JS for `getIgnoreReasonForLine()`.
- **NAPI-RS flat struct bridging**: Rust `ClassRegion` has flat fields (`context_override_bg`, `inline_color`), TS nests them (`contextOverride.bg`, `inlineStyles.color`). `converter.ts` reconstructs the nested shape. NAPI-RS auto-converts snake_case → camelCase.
- **Performance**: Native parser is ~1.7x faster than TS legacy (40-43% scan time reduction on 500-1000 file codebases). The bottleneck is NAPI-RS serialization overhead when converting ClassRegion objects across the boundary, not parsing speed. Moving contrast checking to Rust (Phase 2) would reduce round-trips and increase total pipeline savings.
- **Native-only features**: US-07 (disabled detection), US-08 (currentColor resolution), US-04 (portal context reset), and US-05 (opacity stack) only run in the Rust engine. The TS legacy parser doesn't detect these.
- **Opacity stack (US-05)**: `ContextTracker` tracks `cumulative_opacity` on `StackEntry`. Each nested tag with `opacity-*` multiplies the parent's opacity. Elements with cumulative opacity < 10% are ignored. In TS resolution, `effectiveOpacity` reduces `bgAlpha` and `textAlpha` for accurate contrast calculation.
- **Portal context reset (US-04)**: Portal components (Dialog, Popover, etc.) reset the context stack bg to `defaultBg` and opacity to 1.0. Portal check happens BEFORE container check in `on_tag_open`. The value `"reset"` in `portalConfig` maps to `defaultBg`. This is a native-only feature; TS legacy parser uses `@a11y-context` annotations as workaround.
- **Container/portal split in shadcn preset**: The 21-component shadcn preset is split into 7 containers (Card, Accordion, TabsContent, Alert) and 15 portals (Dialog, Sheet, Popover, Dropdown, etc.). Portals reset context; containers inherit.
- **Suggestion engine (US-03)**: Luminosity-directed shade walk. Parses violating fg class to find its Tailwind shade family, then walks toward higher-contrast shades (darker on light bg, lighter on dark bg). Uses `colord` for contrast + `compositeOver` for alpha. Suggestions sorted by shade distance (minimal visual change). Respects AA/AAA thresholds and non-text/large-text rules.
- **CVA variant expansion (US-06)**: Lightweight heuristic parsing of `cva()` calls. Extracts base classes and variant groups via regex + balanced brace matching (no AST). Default mode checks only the defaultVariants combination. `--check-all-variants` mode adds one region per non-default variant option. `compoundVariants` and non-string-literal values are ignored.

## Testing Conventions

- Co-located tests in `__tests__/` directories next to their module.
- Property-based tests (`fast-check`) for mathematical invariants — see `contrast-checker.property.test.ts`.
- I/O tests use `*.io.test.ts` naming and `vi.mock()` for filesystem isolation — kept separate from pure unit tests.
- Test files use `makePair()` helpers to create test fixtures with sensible defaults + overrides.
- Internal functions are exported with `@internal` JSDoc tag for testability (e.g., `compositeOver`, `parseHexRGB`).

## TypeScript Strictness

The project uses a strict tsconfig: `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`. All imports from `.ts` files must use `.js` extensions (ESM resolution with bundler module resolution).

- `noUncheckedIndexedAccess` means regex capture groups (`match[1]`) and string indexing (`hex[1]`) need `!` non-null assertions when certain the match exists.

## CLI Usage

```bash
# Smoke test against multicoin-frontend (745 violations expected)
cd ../multicoin-frontend && node ../a11y-audit/dist/bin/cli.js \
  --src 'src/**/*.tsx' --css src/main.theme.css src/main.css \
  --preset shadcn --report-dir /tmp/a11y-test-report --verbose

# Generate baseline from current violations
node dist/bin/cli.js --update-baseline --verbose

# Run audit with baseline (only new violations fail CI)
node dist/bin/cli.js --verbose  # uses baseline.enabled from config

# Fail CI if violations improved (forces baseline refresh)
node dist/bin/cli.js --fail-on-improvement --verbose

# Custom baseline path
node dist/bin/cli.js --baseline-path custom-baseline.json --verbose

# Generate suggestions for violations
node dist/bin/cli.js --suggest --verbose

# Custom max suggestions
node dist/bin/cli.js --suggest --max-suggestions 5 --verbose

# Enable CVA expansion (default variants only)
node dist/bin/cli.js --cva --verbose

# Enable CVA with all variant checking
node dist/bin/cli.js --cva --check-all-variants --verbose
```

## Mandatory Workflow Rules

- **MUST: Run tests in small batches, NEVER all at once.** Use `npx vitest run src/<module>/__tests__/<file>.test.ts` to run individual test files, or target a specific directory like `npx vitest run src/plugins/jsx/__tests__/`. Running the full suite (`npm test`) overloads RAM. Batch by module or by test file.
- **MUST: Update technical documentation after every work session.** At the end of any implementation, always update `docs/LIBRARY_ARCHITECTURE.md` (and `CLAUDE.md` if architecture/module layout changed) to reflect the current state: test counts, new types, new functions, new sections. The documentation must always be in sync with the code.

## Gotchas

- **Zod nested defaults**: `z.object({ field: z.string().default('x') }).default({})` produces `{}`, not `{ field: 'x' }`. Use `.default({ field: 'x' })` with explicit values on the outer default.
- **vitest in worktrees**: If using worktrees, run vitest from the worktree root, not the main project root.
- **file-scanner.ts split**: The original 1258-LOC `file-scanner.ts` is split into 3 modules: `categorizer.ts` (pure classification), `parser.ts` (state machine), `region-resolver.ts` (pairing). `extractBalancedParens` lives in categorizer and is imported by parser.
- **Plan vs actual test paths**: The plan references `tests/core/...` paths, but the actual convention is co-located `src/<module>/__tests__/`. Always follow the co-located pattern.
- **lilconfig + .ts configs**: `lilconfig` has no built-in `.ts` loader. Adding `a11y-audit.config.ts` to `searchPlaces` crashes at runtime. Use `.js`/`.mjs`/`.json` only, or add `jiti` as a custom loader.
- **APCA linearization differs from WCAG**: APCA uses `pow(c/255, 2.4)` (simple power curve), NOT the WCAG piecewise sRGB function. APCA also has a black soft clamp (`blkThrs=0.022`, `blkClmp=1.414`). Always verify constants against `node_modules/apca-w3/src/apca-w3.js`.
- **colord requires a11y plugin**: `colord(x).contrast(y)` requires `extend([a11yPlugin])` first. Import from `colord/plugins/a11y`.
- **Native .node loading**: `cargo build` produces a `.so`/`.dylib` file. Copy to `native/a11y-audit-native.node` for Node.js to load it. Use absolute paths in smoke tests.
- **git commands from project root**: Always run `git add`/`git commit` from the project root, not from `native/`.
- **Pre-staged git artifacts**: If `native/target/` or `*.node` files are in git's staging area, `.gitignore` won't protect them. Use `git rm -r --cached native/target/` to remove from tracking. Always verify `git status` before committing to avoid including build artifacts.
- **Rust raw strings with hex colors**: `r#"..."#` breaks when content contains `"#` (e.g. hex color values in test JSX). Use `r##"..."##` for test strings containing hex colors.
- **ClassExtractor is NOT a JsxVisitor**: Unlike other parser visitors, ClassExtractor needs cross-visitor state (ContextTracker.current_bg + AnnotationParser.take_pending_*). It's a builder with a `record()` method. Solved by `ScanOrchestrator` in `parser/mod.rs` which owns all sub-components and coordinates state flow.
- **ScanOrchestrator pre_tag_open_bg**: The orchestrator captures `context_tracker.current_bg()` BEFORE calling `on_tag_open` (which may push a new bg). This ensures a tag's className region gets the *parent's* bg, not its own.
