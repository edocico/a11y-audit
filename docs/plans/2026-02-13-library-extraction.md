# a11y-audit Library Extraction — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the internal a11y contrast audit script (v4.0, 2352 LOC + 343 tests) from `multicoin-frontend/scripts/a11y-audit/` into a standalone, framework-agnostic NPM package with a plugin architecture.

**Architecture:** Layered Onion — pure math core at the center, plugin interfaces for color resolution and file parsing, with Tailwind+JSX as the first plugin implementations. Config-driven via `lilconfig` + `zod`. Dual CJS/ESM output via `tsup`.

**Tech Stack:** TypeScript 5.x, tsup, vitest, commander, lilconfig, zod, culori, colord, apca-w3, chalk, glob

---

## Source Project Reference

All source code lives in: `../multicoin-frontend/scripts/a11y-audit/`

**Dependency graph (bottom-up):**
```
types.ts                  ← no deps (90 LOC)
tailwind-palette.ts       ← culori (91 LOC)
contrast-checker.ts       ← colord, apca-w3, types (137 LOC)
css-parser.ts             ← tailwind-palette, types, node:fs (375 LOC)
jsx-context-config.ts     ← no deps (52 LOC)
report-generator.ts       ← types (219 LOC)
file-scanner.ts           ← css-parser, jsx-context-config, types, node:fs, glob (1258 LOC)
index.ts                  ← everything (86 LOC)
```

**Test split:**
| Category | Files | Tests | Can port verbatim? |
|----------|-------|-------|--------------------|
| Pure unit | 5 files | ~269 | Yes — zero I/O |
| I/O mocked | 3 `*.io.test.ts` | ~24 | Needs path updates |
| Integration | 1 file | 12 | Needs fixture project |
| Property-based | 1 file | 19 | Yes — zero I/O |
| Report snapshot | 1 file | 13 | Yes, update snapshots |

---

## Target Directory Structure

```
src/
├── index.ts                         # Public API (audit, defineConfig)
├── bin/cli.ts                       # CLI entry (commander)
├── core/
│   ├── types.ts                     # All shared interfaces
│   ├── contrast-checker.ts          # WCAG + APCA math (pure)
│   ├── color-utils.ts               # toHex (oklch→hex, pure)
│   ├── pair-generator.ts            # bg+fg pairing logic (extracted from file-scanner)
│   ├── report/
│   │   ├── markdown.ts              # Markdown reporter
│   │   └── json.ts                  # JSON reporter (new)
│   └── pipeline.ts                  # Orchestrator (wires plugins)
├── config/
│   ├── schema.ts                    # Zod config schema
│   ├── loader.ts                    # lilconfig integration
│   └── defaults.ts                  # Default config values
├── plugins/
│   ├── interfaces.ts                # ColorResolver, FileParser, ContainerConfig
│   ├── tailwind/
│   │   ├── palette.ts               # extractTailwindPalette (with configurable path)
│   │   ├── css-resolver.ts          # buildThemeColorMaps (with configurable CSS paths)
│   │   └── presets/
│   │       └── shadcn.ts            # 21 container entries (preset)
│   └── jsx/
│       ├── parser.ts                # State machine: className= extraction
│       ├── categorizer.ts           # stripVariants, categorizeClasses, routeClassToTarget
│       └── region-resolver.ts       # resolveFileRegions, buildEffectiveBg, generatePairs
└── types/
    ├── public.ts                    # Re-exported public API types
    ├── culori.d.ts                  # Ambient declarations
    └── apca-w3.d.ts                 # Ambient declarations
```

---

## Phase 1: Core Math (Zero Coupling)

These modules have NO I/O, NO filesystem access, NO hardcoded paths. Pure functions.

### Task 1.1: Port types.ts

**Files:**
- Create: `src/core/types.ts`
- Modify: `src/types/public.ts` (re-export)

**Step 1: Copy types from source**

Copy the full content of `../multicoin-frontend/scripts/a11y-audit/types.ts` into `src/core/types.ts`. Make one change: remove the dynamic import in `FileRegions`:

```typescript
// BEFORE (in source):
regions: import('./file-scanner.js').ClassRegion[]

// AFTER (in new package):
regions: ClassRegion[]
```

Import `ClassRegion` from a local definition (add it to the same file for now — it will be moved when we port the parser).

**Step 2: Update `src/types/public.ts`**

Re-export the public types:

```typescript
export type {
  ConformanceLevel,
  ThemeMode,
  InteractiveState,
  ResolvedColor,
  ColorMap,
  ColorPair,
  ContrastResult,
  AuditResult,
  SkippedClass,
} from '../core/types.js';
```

**Step 3: Update `src/index.ts`**

```typescript
export type {
  ConformanceLevel, ThemeMode, InteractiveState,
  ResolvedColor, ColorMap, ColorPair, ContrastResult,
  AuditResult, SkippedClass,
} from './core/types.js';
```

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors)

**Step 5: Commit**

```bash
git add src/core/types.ts src/types/public.ts src/index.ts
git commit -m "feat: port core types from multicoin-frontend"
```

---

### Task 1.2: Port color-utils.ts (toHex)

**Files:**
- Create: `src/core/color-utils.ts`
- Create: `tests/core/color-utils.test.ts`

**Step 1: Copy the pure `toHex` function**

From `../multicoin-frontend/scripts/a11y-audit/tailwind-palette.ts`, copy only the `toHex()` function (lines 50-91). This function has ONE dependency: `culori` (parse + formatHex). No filesystem access.

```typescript
// src/core/color-utils.ts
import { parse, formatHex } from 'culori';

/**
 * Converts any CSS color value to 6-digit or 8-digit hex.
 * Handles: oklch, hsl, rgb, display-p3, hex passthrough.
 * Returns null if the value cannot be parsed.
 */
export function toHex(value: string): string | null {
  // ... copy from source, verbatim
}
```

**Step 2: Copy tests**

Copy the full content of `../multicoin-frontend/scripts/a11y-audit/tests/tailwind-palette.test.ts` into `tests/core/color-utils.test.ts`. Update the import path:

```typescript
// BEFORE:
import { toHex } from '../tailwind-palette.js';

// AFTER:
import { toHex } from '../../src/core/color-utils.js';
```

**Step 3: Run tests**

Run: `npx vitest run tests/core/color-utils.test.ts`
Expected: 22 tests PASS

**Step 4: Commit**

```bash
git add src/core/color-utils.ts tests/core/color-utils.test.ts
git commit -m "feat: port toHex color conversion (22 tests)"
```

---

### Task 1.3: Port contrast-checker.ts

**Files:**
- Create: `src/core/contrast-checker.ts`
- Create: `tests/core/contrast-checker.test.ts`

**Step 1: Copy source**

Copy `../multicoin-frontend/scripts/a11y-audit/contrast-checker.ts` → `src/core/contrast-checker.ts`. Update the types import:

```typescript
// BEFORE:
import type { ... } from './types.js';

// AFTER:
import type { ... } from './types.js'; // same relative path since both in core/
```

External deps (`colord`, `apca-w3`) stay unchanged.

**Step 2: Copy tests**

Copy `../multicoin-frontend/scripts/a11y-audit/tests/contrast-checker.test.ts` → `tests/core/contrast-checker.test.ts`. Update import path:

```typescript
// BEFORE:
import { checkAllPairs, compositeOver, parseHexRGB } from '../contrast-checker.js';

// AFTER:
import { checkAllPairs, compositeOver, parseHexRGB } from '../../src/core/contrast-checker.js';
```

**Step 3: Copy property-based tests**

Copy `../multicoin-frontend/scripts/a11y-audit/tests/property-based.test.ts` → `tests/core/property-based.test.ts`. Update imports for `compositeOver`, `parseHexRGB`, and `combineAlpha` (the latter will come from `css-parser` — skip those tests for now with `test.skip` or split the file).

Actually — `combineAlpha` and `stripVariants` are in different modules. Split the property-based tests:
- `tests/core/contrast-checker.property.test.ts` — compositeOver (5) + parseHexRGB (3) = 8 tests
- Leave `stripVariants` (6) and `combineAlpha` (5) for later tasks

**Step 4: Run tests**

Run: `npx vitest run tests/core/contrast-checker.test.ts tests/core/contrast-checker.property.test.ts`
Expected: 31 + 8 = 39 tests PASS

**Step 5: Commit**

```bash
git add src/core/contrast-checker.ts tests/core/
git commit -m "feat: port contrast-checker with WCAG+APCA math (39 tests)"
```

---

### Task 1.4: Port report-generator.ts

**Files:**
- Create: `src/core/report/markdown.ts`
- Create: `tests/core/report/markdown.test.ts`

**Step 1: Copy source**

Copy `../multicoin-frontend/scripts/a11y-audit/report-generator.ts` → `src/core/report/markdown.ts`. Update the types import. The function `generateReport` has zero I/O — it takes data and returns a string. Pure function.

**Step 2: Copy tests + snapshots**

Copy tests and the `__snapshots__/` directory. Update import paths.

**Step 3: Run tests**

Run: `npx vitest run tests/core/report/markdown.test.ts`
Expected: 13 tests PASS. Snapshots may need updating (`npx vitest run tests/core/report/markdown.test.ts -u`) if timestamp format changes.

**Step 4: Commit**

```bash
git add src/core/report/ tests/core/report/
git commit -m "feat: port markdown report generator (13 tests)"
```

---

**Phase 1 Checkpoint:** 22 + 39 + 13 = **74 pure tests passing**, zero I/O, zero coupling. Build should succeed. Run `npm run build && npm run typecheck` to confirm.

---

## Phase 2: Plugin Interfaces

Define the contracts that plugins must implement.

### Task 2.1: Define plugin interfaces

**Files:**
- Create: `src/plugins/interfaces.ts`

**Step 1: Write interfaces**

```typescript
// src/plugins/interfaces.ts
import type { ColorMap, ClassRegion, ThemeMode, ResolvedColor } from '../core/types.js';

/**
 * Resolves CSS utility classes to hex colors.
 * Tailwind implementation: resolves via CSS variable chains.
 * Generic implementation: could parse CSS files directly.
 */
export interface ColorResolver {
  /** Build color maps for all supported themes */
  buildColorMaps(): { light: ColorMap; dark: ColorMap; rootFontSizePx: number };

  /** Resolve a single utility class to a hex color */
  resolveClass(className: string, colorMap: ColorMap): ResolvedColor | null;
}

/**
 * Extracts class regions from source files.
 * JSX implementation: state machine for className= in .tsx/.jsx
 * Vue implementation: would parse :class= in .vue SFCs
 */
export interface FileParser {
  /** Glob patterns for files to scan */
  readonly filePatterns: string[];

  /** Extract class regions from a single file's source code */
  extractRegions(source: string, filePath: string): ClassRegion[];
}

/**
 * Maps component names to their implicit background classes.
 * shadcn preset: Card → bg-card, DialogContent → bg-background
 * Custom: user-defined mappings
 */
export interface ContainerConfig {
  /** Component name → default bg class (e.g., "Card" → "bg-card") */
  readonly containers: ReadonlyMap<string, string>;

  /** Default page background class (e.g., "bg-background") */
  readonly defaultBg: string;

  /** Page background hex per theme (for alpha compositing) */
  readonly pageBg: { light: string; dark: string };
}

/**
 * Full configuration for an audit run.
 */
export interface AuditConfig {
  /** Source file glob patterns */
  src: string[];

  /** CSS files to parse for color definitions */
  css: string[];

  /** Color resolver plugin */
  colorResolver: ColorResolver;

  /** File parser plugin */
  fileParser: FileParser;

  /** Container context config */
  containerConfig: ContainerConfig;

  /** WCAG conformance level */
  threshold: 'AA' | 'AAA';

  /** Report output directory */
  reportDir: string;

  /** Report format */
  format: 'markdown' | 'json';

  /** Whether to run dark mode analysis */
  dark: boolean;
}
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/plugins/interfaces.ts
git commit -m "feat: define ColorResolver, FileParser, ContainerConfig interfaces"
```

---

### Task 2.2: Config schema and loader

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/loader.ts`
- Create: `src/config/defaults.ts`
- Create: `tests/config/schema.test.ts`

**Step 1: Write the zod schema**

```typescript
// src/config/schema.ts
import { z } from 'zod';

export const auditConfigSchema = z.object({
  /** Source file glob patterns */
  src: z.array(z.string()).default(['src/**/*.tsx']),

  /** CSS files to parse for color definitions */
  css: z.array(z.string()).default([]),

  /** WCAG conformance level */
  threshold: z.enum(['AA', 'AAA']).default('AA'),

  /** Report output directory */
  reportDir: z.string().default('a11y-reports'),

  /** Report format */
  format: z.enum(['markdown', 'json']).default('markdown'),

  /** Run dark mode analysis */
  dark: z.boolean().default(true),

  /** Container context: component name → bg class */
  containers: z.record(z.string(), z.string()).default({}),

  /** Default page background class */
  defaultBg: z.string().default('bg-background'),

  /** Page background hex per theme (for alpha compositing) */
  pageBg: z.object({
    light: z.string().default('#ffffff'),
    dark: z.string().default('#09090b'),
  }).default({}),

  /** Preset name to load (e.g., "shadcn") */
  preset: z.string().optional(),

  /** Path to Tailwind palette CSS (auto-detected if not set) */
  tailwindPalette: z.string().optional(),
});

export type AuditConfigInput = z.input<typeof auditConfigSchema>;
export type AuditConfigResolved = z.output<typeof auditConfigSchema>;
```

**Step 2: Write the config loader**

```typescript
// src/config/loader.ts
import { lilconfig } from 'lilconfig';
import { auditConfigSchema, type AuditConfigResolved } from './schema.js';

const explorer = lilconfig('a11y-audit', {
  searchPlaces: [
    'a11y-audit.config.js',
    'a11y-audit.config.mjs',
    'a11y-audit.config.ts',
    '.a11y-auditrc.json',
    'package.json',
  ],
});

export async function loadConfig(
  explicitPath?: string
): Promise<AuditConfigResolved> {
  const result = explicitPath
    ? await explorer.load(explicitPath)
    : await explorer.search();

  const raw = result?.config ?? {};
  return auditConfigSchema.parse(raw);
}
```

**Step 3: Write defaults**

```typescript
// src/config/defaults.ts
import type { AuditConfigResolved } from './schema.js';

/** Resolved defaults (what you get with zero config) */
export const DEFAULT_CONFIG: AuditConfigResolved = {
  src: ['src/**/*.tsx'],
  css: [],
  threshold: 'AA',
  reportDir: 'a11y-reports',
  format: 'markdown',
  dark: true,
  containers: {},
  defaultBg: 'bg-background',
  pageBg: { light: '#ffffff', dark: '#09090b' },
  preset: undefined,
  tailwindPalette: undefined,
};
```

**Step 4: Write config schema tests**

```typescript
// tests/config/schema.test.ts
import { describe, it, expect } from 'vitest';
import { auditConfigSchema } from '../../src/config/schema.js';

describe('auditConfigSchema', () => {
  it('returns defaults for empty object', () => {
    const result = auditConfigSchema.parse({});
    expect(result.src).toEqual(['src/**/*.tsx']);
    expect(result.threshold).toBe('AA');
    expect(result.dark).toBe(true);
    expect(result.pageBg.light).toBe('#ffffff');
  });

  it('accepts valid overrides', () => {
    const result = auditConfigSchema.parse({
      src: ['app/**/*.vue'],
      threshold: 'AAA',
      dark: false,
      containers: { Card: 'bg-card' },
    });
    expect(result.src).toEqual(['app/**/*.vue']);
    expect(result.threshold).toBe('AAA');
    expect(result.dark).toBe(false);
    expect(result.containers).toEqual({ Card: 'bg-card' });
  });

  it('rejects invalid threshold', () => {
    expect(() => auditConfigSchema.parse({ threshold: 'A' })).toThrow();
  });

  it('rejects invalid format', () => {
    expect(() => auditConfigSchema.parse({ format: 'xml' })).toThrow();
  });
});
```

**Step 5: Run tests**

Run: `npx vitest run tests/config/schema.test.ts`
Expected: 4 tests PASS

**Step 6: Commit**

```bash
git add src/config/ tests/config/
git commit -m "feat: config schema (zod) + lilconfig loader (4 tests)"
```

---

**Phase 2 Checkpoint:** Plugin interfaces defined, config system ready. Run `npm run build && npm run typecheck`.

---

## Phase 3: Tailwind Plugin (Color Resolution)

Port the Tailwind-specific color resolution as the first `ColorResolver` implementation.

### Task 3.1: Port css-parser.ts (pure functions only)

**Files:**
- Create: `src/plugins/tailwind/css-resolver.ts`
- Create: `tests/plugins/tailwind/css-resolver.test.ts`

**Step 1: Copy pure functions from css-parser.ts**

These functions have zero I/O — they operate on strings:
- `extractBalancedBraces(css, openPos)` (line 86)
- `parseThemeInline(css)` (line 108)
- `parseBlock(css, selector)` (line 58 — currently private, export it)
- `resolveAll(blockVars, themeInlineVars, twPalette)` (line 139)
- `resolveClassToHex(className, colorMap)` (line 270)
- `stripHexAlpha(hex)` (line 232)
- `extractHexAlpha(hex)` (line 248)
- `combineAlpha(a1, a2)` (line 371)
- `extractRootFontSize(css)` (line 351)

Place them in `src/plugins/tailwind/css-resolver.ts`. Do NOT copy `buildThemeColorMaps()` yet — that has I/O.

**Step 2: Copy corresponding tests**

From `../multicoin-frontend/scripts/a11y-audit/tests/css-parser.test.ts`, copy all tests (72) to `tests/plugins/tailwind/css-resolver.test.ts`. Update imports.

Also copy the 5 `combineAlpha` property-based tests from the original `property-based.test.ts`.

**Step 3: Run tests**

Run: `npx vitest run tests/plugins/tailwind/css-resolver.test.ts`
Expected: 72 + 5 = 77 tests PASS

**Step 4: Commit**

```bash
git add src/plugins/tailwind/css-resolver.ts tests/plugins/tailwind/
git commit -m "feat: port Tailwind CSS resolver (pure functions, 77 tests)"
```

---

### Task 3.2: Port tailwind-palette.ts (with configurable path)

**Files:**
- Create: `src/plugins/tailwind/palette.ts`
- Create: `tests/plugins/tailwind/palette.io.test.ts`

**Step 1: Copy and parameterize**

Copy `extractTailwindPalette()` from source, but **add a `palettePath` parameter** instead of hardcoded `node_modules/tailwindcss/theme.css`:

```typescript
// src/plugins/tailwind/palette.ts
import { readFileSync } from 'node:fs';
import { toHex, type RawPalette } from '../../core/color-utils.js';

/**
 * Extracts Tailwind v4 color palette from theme.css.
 * @param palettePath - Absolute path to tailwindcss/theme.css
 */
export function extractTailwindPalette(palettePath: string): RawPalette {
  const css = readFileSync(palettePath, 'utf-8');
  // ... rest of logic verbatim
}
```

Also add a **`findTailwindPalette(cwd: string): string`** helper that auto-discovers the palette path using `require.resolve` or traversal:

```typescript
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export function findTailwindPalette(cwd: string): string {
  // Try standard flat node_modules first
  const flat = resolve(cwd, 'node_modules/tailwindcss/theme.css');
  if (existsSync(flat)) return flat;

  // Try require.resolve for pnpm/yarn berry
  try {
    const twDir = resolve(cwd, 'node_modules/tailwindcss');
    return resolve(twDir, 'theme.css');
  } catch {
    throw new Error(
      `Cannot find tailwindcss/theme.css. ` +
      `Ensure tailwindcss is installed, or set "tailwindPalette" in config.`
    );
  }
}
```

**Step 2: Copy I/O tests**

Port `tailwind-palette.io.test.ts` (7 tests). Update mock paths to be generic (not hardcoded to multicoin-frontend paths).

**Step 3: Run tests**

Run: `npx vitest run tests/plugins/tailwind/palette.io.test.ts`
Expected: 7 tests PASS

**Step 4: Commit**

```bash
git add src/plugins/tailwind/palette.ts tests/plugins/tailwind/palette.io.test.ts
git commit -m "feat: port Tailwind palette extractor with configurable path (7 tests)"
```

---

### Task 3.3: Port buildThemeColorMaps with configurable CSS paths

**Files:**
- Modify: `src/plugins/tailwind/css-resolver.ts`
- Create: `tests/plugins/tailwind/css-resolver.io.test.ts`

**Step 1: Add `buildThemeColorMaps` with params**

```typescript
export interface TailwindResolverOptions {
  /** Paths to CSS files containing :root/.dark variable definitions */
  cssPaths: string[];
  /** Path to tailwindcss/theme.css (or auto-detected) */
  palettePath: string;
}

export function buildThemeColorMaps(options: TailwindResolverOptions): ThemeColorMaps {
  const twPalette = extractTailwindPalette(options.palettePath);

  const fullCss = options.cssPaths
    .map(p => readFileSync(p, 'utf-8'))
    .join('\n');

  // ... rest of logic identical to source
}
```

**Step 2: Port I/O tests**

From `css-parser.io.test.ts` (7 tests). Update to use the new `options` parameter.

**Step 3: Run tests**

Run: `npx vitest run tests/plugins/tailwind/css-resolver.io.test.ts`
Expected: 7 tests PASS

**Step 4: Commit**

```bash
git add src/plugins/tailwind/css-resolver.ts tests/plugins/tailwind/css-resolver.io.test.ts
git commit -m "feat: buildThemeColorMaps with configurable CSS paths (7 tests)"
```

---

### Task 3.4: Port shadcn preset

**Files:**
- Create: `src/plugins/tailwind/presets/shadcn.ts`

**Step 1: Copy jsx-context-config.ts content as a preset**

```typescript
// src/plugins/tailwind/presets/shadcn.ts
import type { ContainerConfig } from '../../interfaces.js';

const SHADCN_CONTAINERS = new Map<string, string>([
  // ... all 21 entries from jsx-context-config.ts
  ['Card', 'bg-card'],
  ['CardHeader', 'bg-card'],
  // ... etc
]);

export const shadcnPreset: ContainerConfig = {
  containers: SHADCN_CONTAINERS,
  defaultBg: 'bg-background',
  pageBg: { light: '#ffffff', dark: '#09090b' },
};
```

**Step 2: Commit**

```bash
git add src/plugins/tailwind/presets/shadcn.ts
git commit -m "feat: shadcn container preset (21 entries)"
```

---

**Phase 3 Checkpoint:** Tailwind color resolution fully ported. ~91 tests. Run `npm run build && npm run typecheck && npx vitest run`.

---

## Phase 4: JSX Parser Plugin

This is the largest module (1258 LOC). Split into 3 files by responsibility.

### Task 4.1: Port categorizer (pure functions)

**Files:**
- Create: `src/plugins/jsx/categorizer.ts`
- Create: `tests/plugins/jsx/categorizer.test.ts`

**Step 1: Extract from file-scanner.ts**

Copy these pure functions (zero I/O):
- `stripVariants(cls)` (line 748) + `VARIANT_PREFIXES`, `INTERACTIVE_PREFIX_MAP`
- `routeClassToTarget(tagged, bucket)` (line 831)
- `categorizeClasses(classes, themeMode)` (line 876) + all `*_NON_COLOR` sets
- `determineIsLargeText(fontSize, isBold)` (line 982) + `ALWAYS_LARGE`, `LARGE_IF_BOLD`, `BOLD_CLASSES`
- `extractStringLiterals(body)` (line 696)
- `extractBalancedParens(source, startIdx)` (line 642)
- Interfaces: `TaggedClass`, `ClassBuckets`, `CategorizedClasses`, `ForegroundGroup`

Import types from `../../core/types.js`.

**Step 2: Port tests**

From `file-scanner.test.ts`, extract the test blocks for:
- `stripVariants` (~30 tests)
- `routeClassToTarget` (~15 tests)
- `categorizeClasses` (~35 tests)
- `determineIsLargeText` (~8 tests)
- `extractStringLiterals` (~5 tests)
- `extractBalancedParens` (~5 tests)

Also port the 6 `stripVariants` property-based tests.

**Step 3: Run tests**

Run: `npx vitest run tests/plugins/jsx/categorizer.test.ts`
Expected: ~104 tests PASS

**Step 4: Commit**

```bash
git add src/plugins/jsx/categorizer.ts tests/plugins/jsx/
git commit -m "feat: port JSX class categorizer (104 tests)"
```

---

### Task 4.2: Port state machine parser

**Files:**
- Create: `src/plugins/jsx/parser.ts`
- Create: `tests/plugins/jsx/parser.test.ts`

**Step 1: Extract from file-scanner.ts**

Copy these functions:
- `extractClassRegions(source)` (line 434) — the state machine
- `isSelfClosingTag(source, fromPos)` (line 274)
- `findExplicitBgInTag(source, fromPos)` (line 322)
- `extractInlineStyleColors(source, fromPos)` (line 385)

**Critical change:** The `extractClassRegions` function currently imports `CONTAINER_CONTEXT_MAP` from `jsx-context-config.ts`. Make it a **parameter**:

```typescript
export function extractClassRegions(
  source: string,
  containerMap: ReadonlyMap<string, string>,
  defaultBg: string = 'bg-background'
): ClassRegion[] {
  // ... replace CONTAINER_CONTEXT_MAP references with containerMap
  // ... replace hardcoded 'bg-background' with defaultBg
}
```

**Step 2: Port tests**

From `file-scanner.test.ts`, extract:
- `extractClassRegions` tests (~15 tests including malformed JSX M10)
- `isSelfClosingTag` tests (~5 tests M20)
- `findExplicitBgInTag` tests (~5 tests)
- `extractInlineStyleColors` tests (~5 tests M19)

Update all calls to `extractClassRegions` to pass the container map:

```typescript
import { shadcnPreset } from '../../../src/plugins/tailwind/presets/shadcn.js';

// In tests:
extractClassRegions(source, shadcnPreset.containers, shadcnPreset.defaultBg)
```

**Step 3: Run tests**

Run: `npx vitest run tests/plugins/jsx/parser.test.ts`
Expected: ~30 tests PASS

**Step 4: Commit**

```bash
git add src/plugins/jsx/parser.ts tests/plugins/jsx/parser.test.ts
git commit -m "feat: port JSX state machine parser with injectable container config (30 tests)"
```

---

### Task 4.3: Port region resolver (pairing logic)

**Files:**
- Create: `src/plugins/jsx/region-resolver.ts`
- Create: `tests/plugins/jsx/region-resolver.test.ts`

**Step 1: Extract from file-scanner.ts**

Copy:
- `buildEffectiveBg(bgClasses, contextBg, inlineStyles?)` (line 998)
- `generatePairs(fgGroups, effectiveBg, meta, colorMap, hasExplicitBg, contextBg)` (line 1036)
- `resolveFileRegions(preExtracted, colorMap, themeMode)` (line 1173)
- `extractAllFileRegions()` (line 1131) — **parameterize** to accept `srcPatterns: string[]` and `cwd: string`

**Critical change to `extractAllFileRegions`:**

```typescript
// BEFORE:
export function extractAllFileRegions(): PreExtracted {
  const filePaths = globSync('**/*.tsx', { cwd: SRC_DIR, absolute: true });

// AFTER:
export function extractAllFileRegions(
  srcPatterns: string[],
  cwd: string,
  containerMap: ReadonlyMap<string, string>,
  defaultBg: string
): PreExtracted {
  const filePaths = srcPatterns.flatMap(pattern =>
    globSync(pattern, { cwd, absolute: true })
  );
```

**Critical change to `resolveFileRegions`:** Replace the `CONTAINER_CONTEXT_MAP` import with parameters already passed through `PreExtracted`.

**Step 2: Port tests**

- `buildEffectiveBg` tests (8 from file-scanner.test.ts)
- `generatePairs` tests (21 from file-scanner.test.ts)
- `resolveFileRegions` tests (if any remain — most are covered by the above)

Port `file-scanner.io.test.ts` (10 tests) → `tests/plugins/jsx/region-resolver.io.test.ts`. Update glob mock and path expectations.

**Step 3: Run tests**

Run: `npx vitest run tests/plugins/jsx/region-resolver.test.ts tests/plugins/jsx/region-resolver.io.test.ts`
Expected: ~39 tests PASS

**Step 4: Commit**

```bash
git add src/plugins/jsx/region-resolver.ts tests/plugins/jsx/
git commit -m "feat: port region resolver with parameterized paths (39 tests)"
```

---

**Phase 4 Checkpoint:** JSX parser fully ported. ~173 tests from Phase 4 alone. Run full suite.

---

## Phase 5: Pipeline + CLI Wiring

### Task 5.1: Pipeline orchestrator

**Files:**
- Create: `src/core/pipeline.ts`

**Step 1: Write the orchestrator**

Port `index.ts`'s `main()` function but make it config-driven:

```typescript
// src/core/pipeline.ts
import type { AuditResult, ThemeMode } from './types.js';
import type { AuditConfig } from '../plugins/interfaces.js';
import { checkAllPairs } from './contrast-checker.js';
import { generateReport } from './report/markdown.js';

export interface AuditRunResult {
  results: { mode: ThemeMode; result: AuditResult }[];
  report: string;
  totalViolations: number;
}

export async function runAudit(config: AuditConfig): Promise<AuditRunResult> {
  // Phase 0: Build color maps
  const { light, dark, rootFontSizePx } = config.colorResolver.buildColorMaps();

  // Phase 1: Extract (once)
  // ... use config.fileParser

  // Phase 2: Resolve per theme
  // ... use config.colorResolver.resolveClass

  // Phase 3: Check contrast
  // ... use checkAllPairs with config.threshold

  // Phase 4: Generate report
  // ... use config.format to pick reporter
}
```

**Step 2: Commit**

```bash
git add src/core/pipeline.ts
git commit -m "feat: pipeline orchestrator (config-driven)"
```

---

### Task 5.2: Wire CLI to pipeline

**Files:**
- Modify: `src/bin/cli.ts`

**Step 1: Wire commander to config loader + pipeline**

Update the existing CLI stub to:
1. Load config via `lilconfig`
2. Merge CLI flags (overrides config file)
3. Instantiate Tailwind resolver + JSX parser (default plugins)
4. Run pipeline
5. Write report to disk
6. Exit with code based on violations

**Step 2: Manual smoke test**

Run from the multicoin-frontend directory to test against the real project:

```bash
node ../a11y-audit/dist/bin/cli.js --src 'src/**/*.tsx' --css src/main.theme.css src/main.css
```

**Step 3: Commit**

```bash
git add src/bin/cli.ts
git commit -m "feat: wire CLI to pipeline with config loading"
```

---

### Task 5.3: Port integration tests

**Files:**
- Create: `tests/integration/`
- Create: `tests/integration/fixtures/` (3 fixture .tsx files)
- Create: `tests/integration/pipeline.test.ts`

**Step 1: Create fixture files**

Copy the 3 fixture files from the original `integration.test.ts` (they're inline fixtures). Place as real `.tsx` files in `tests/integration/fixtures/`.

**Step 2: Port the 12 integration tests**

Adapt to use the new config-driven pipeline API.

**Step 3: Run tests**

Run: `npx vitest run tests/integration/`
Expected: 12 tests PASS

**Step 4: Commit**

```bash
git add tests/integration/
git commit -m "feat: port integration tests with fixture project (12 tests)"
```

---

### Task 5.4: JSON report format (new feature)

**Files:**
- Create: `src/core/report/json.ts`
- Create: `tests/core/report/json.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { generateJsonReport } from '../../../src/core/report/json.js';

describe('generateJsonReport', () => {
  it('returns valid JSON with violations array', () => {
    const result = generateJsonReport([/* mock results */]);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('summary');
    expect(parsed).toHaveProperty('violations');
    expect(parsed.summary.totalViolations).toBe(0);
  });
});
```

**Step 2: Implement**

```typescript
export function generateJsonReport(results: ThemedAuditResult[]): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: { /* ... */ },
    violations: { /* ... */ },
    passed: { /* ... */ },
    skipped: { /* ... */ },
  }, null, 2);
}
```

**Step 3: Run tests**

Run: `npx vitest run tests/core/report/json.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/core/report/json.ts tests/core/report/json.test.ts
git commit -m "feat: add JSON report format"
```

---

### Task 5.5: Public API exports

**Files:**
- Modify: `src/index.ts`

**Step 1: Export everything**

```typescript
// src/index.ts

// Core types
export type { ConformanceLevel, ThemeMode, InteractiveState, ... } from './core/types.js';

// Plugin interfaces
export type { ColorResolver, FileParser, ContainerConfig, AuditConfig } from './plugins/interfaces.js';

// Config
export { auditConfigSchema, type AuditConfigInput } from './config/schema.js';
export { loadConfig } from './config/loader.js';

// Pipeline
export { runAudit, type AuditRunResult } from './core/pipeline.js';

// Built-in plugins (for programmatic use)
export { shadcnPreset } from './plugins/tailwind/presets/shadcn.js';

// Utilities
export { toHex } from './core/color-utils.js';
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: All exports resolve, DTS generated

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: public API exports"
```

---

## Phase 6: Final Verification

### Task 6.1: Full test suite

Run: `npx vitest run`
Expected: All tests pass (target: ~340+ tests)

### Task 6.2: Build verification

Run: `npm run build && npm run typecheck`
Expected: Clean build, clean types

### Task 6.3: Smoke test against multicoin-frontend

```bash
cd ../multicoin-frontend
node ../a11y-audit/dist/bin/cli.js \
  --src 'src/**/*.tsx' \
  --css src/main.theme.css src/main.css \
  --report-dir /tmp/a11y-test-report
```

Expected: Report generated, violation count matches original tool (~745)

### Task 6.4: npm pack dry-run

Run: `npm pack --dry-run`
Expected: Only `dist/` files included, reasonable package size

### Task 6.5: Final commit + tag

```bash
git add -A
git commit -m "chore: final verification — all tests passing"
git tag v0.1.0
```

---

## Summary

| Phase | Tasks | Tests Added | LOC Ported |
|-------|-------|-------------|------------|
| 1: Core Math | 4 | ~74 | ~537 |
| 2: Plugin Interfaces + Config | 2 | ~4 | ~150 |
| 3: Tailwind Plugin | 4 | ~91 | ~518 |
| 4: JSX Parser Plugin | 3 | ~173 | ~1258 |
| 5: Pipeline + CLI | 5 | ~15+ | ~305 |
| 6: Verification | 5 | 0 | 0 |
| **Total** | **23 tasks** | **~357+** | **~2768** |

**Estimated commit count:** ~20 focused commits

**Key risks during execution:**
1. `ClassRegion` type has a circular import path in the original — must break it in Task 1.1
2. `file-scanner.ts` test extraction (Task 4.1-4.3) is the hardest — 1198 LOC of tests need careful splitting
3. Snapshot tests may need regeneration after path changes
4. `resolveClassToHex` lives in css-parser but is used by file-scanner — decide which module owns it (recommendation: keep in tailwind css-resolver since it's Tailwind-specific)
