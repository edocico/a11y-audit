# Phase 4: Intelligence — US-03 Suggestions + US-06 CVA

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transition a11y-audit from "tells you what's wrong" to "tells you how to fix it" by adding a luminosity-directed suggestion engine for failing contrast pairs, and support for `cva()` variant-aware class extraction.

**Architecture:** Two independent TS-side features layered onto the existing pipeline. US-03 (Suggestions) runs as a post-check enrichment step between contrast checking (Phase 3) and baseline reconciliation (Phase 3.5). US-06 (CVA) runs as a post-extraction expansion step between file extraction (Phase 1) and color resolution (Phase 2). Both features work with both native Rust and legacy TS parser paths — no parser changes needed. Both are opt-in via config/CLI flags.

**Tech Stack:** TypeScript, vitest, colord (contrast computation), existing `extractTailwindPalette()` for shade families, existing `compositeOver()` for alpha handling.

---

## Part A: US-03 — Suggestion Engine (Tasks 1–10)

### Task 1: Add ColorSuggestion type and extend ContrastResult

**Files:**
- Modify: `src/core/types.ts`
- Test: `src/config/__tests__/schema.test.ts` (verify existing tests still pass)

**Step 1: Add types to `src/core/types.ts`**

After the `BaselineSummary` interface (line 141), add:

```typescript
/** A shade family from the Tailwind palette (e.g., gray-50..gray-950) */
export interface ShadeFamily {
  /** Family name (e.g., "gray", "red", "sky") */
  family: string;
  /** Shade number -> hex value (e.g., 500 -> "#6b7280") */
  shades: Map<number, string>;
}

/** A suggested fix for a contrast violation */
export interface ColorSuggestion {
  /** The suggested Tailwind class (e.g., "text-gray-600") */
  suggestedClass: string;
  /** Resolved hex of the suggested class */
  suggestedHex: string;
  /** WCAG contrast ratio with the suggested color */
  newRatio: number;
  /** How many shade steps from the original (e.g., 500->600 = 1) */
  shadeDistance: number;
}
```

Extend `ContrastResult` — add after `isBaseline` (line 56):

```typescript
  /** Auto-generated suggestions for fixing this violation (empty if none available) */
  suggestions?: ColorSuggestion[];
```

**Step 2: Run existing tests to verify no breakage**

Run: `npx vitest run src/core/__tests__/contrast-checker.test.ts`
Expected: All existing tests PASS (optional field doesn't break anything)

**Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(types): add ColorSuggestion and ShadeFamily types for US-03"
```

---

### Task 2: Extract shade families from Tailwind palette

**Files:**
- Create: `src/core/suggestions.ts`
- Create: `src/core/__tests__/suggestions.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'vitest';
import { extractShadeFamilies } from '../suggestions.js';
import type { RawPalette } from '../types.js';

describe('extractShadeFamilies', () => {
  function makePalette(entries: [string, string][]): RawPalette {
    return new Map(entries);
  }

  test('groups numeric shades by family name', () => {
    const palette = makePalette([
      ['--color-gray-50', '#f9fafb'],
      ['--color-gray-100', '#f3f4f6'],
      ['--color-gray-500', '#6b7280'],
      ['--color-gray-900', '#111827'],
      ['--color-red-500', '#ef4444'],
      ['--color-red-600', '#dc2626'],
    ]);

    const families = extractShadeFamilies(palette);

    expect(families.size).toBe(2);

    const gray = families.get('gray');
    expect(gray).toBeDefined();
    expect(gray!.family).toBe('gray');
    expect(gray!.shades.size).toBe(4);
    expect(gray!.shades.get(500)).toBe('#6b7280');

    const red = families.get('red');
    expect(red).toBeDefined();
    expect(red!.shades.size).toBe(2);
  });

  test('ignores non-numeric entries (black, white, semantic)', () => {
    const palette = makePalette([
      ['--color-black', '#000000'],
      ['--color-white', '#ffffff'],
      ['--color-primary', '#0369a1'],
      ['--color-sky-700', '#0369a1'],
    ]);

    const families = extractShadeFamilies(palette);

    expect(families.has('black')).toBe(false);
    expect(families.has('white')).toBe(false);
    expect(families.has('primary')).toBe(false);
    expect(families.get('sky')?.shades.size).toBe(1);
  });

  test('returns empty map for empty palette', () => {
    const families = extractShadeFamilies(new Map());
    expect(families.size).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/suggestions.test.ts`
Expected: FAIL — `extractShadeFamilies` not found

**Step 3: Write minimal implementation**

Create `src/core/suggestions.ts`:

```typescript
import type { RawPalette, ShadeFamily } from './types.js';

/**
 * Groups Tailwind palette colors into shade families.
 * Matches entries like --color-gray-500 -> family "gray", shade 500.
 * Ignores non-numeric entries (black, white, semantic colors).
 */
export function extractShadeFamilies(palette: RawPalette): Map<string, ShadeFamily> {
  const families = new Map<string, ShadeFamily>();

  for (const [varName, hex] of palette) {
    const match = varName.match(/^--color-([a-z]+)-(\d+)$/);
    if (!match) continue;

    const family = match[1]!;
    const shade = parseInt(match[2]!, 10);

    let entry = families.get(family);
    if (!entry) {
      entry = { family, shades: new Map() };
      families.set(family, entry);
    }
    entry.shades.set(shade, hex);
  }

  return families;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/__tests__/suggestions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/suggestions.ts src/core/__tests__/suggestions.test.ts
git commit -m "feat(suggestions): extractShadeFamilies groups palette by color family"
```

---

### Task 3: Parse class names into family + shade

**Files:**
- Modify: `src/core/suggestions.ts`
- Modify: `src/core/__tests__/suggestions.test.ts`

**Step 1: Write the failing test**

Add to `suggestions.test.ts`:

```typescript
import { extractShadeFamilies, parseFamilyAndShade } from '../suggestions.js';

describe('parseFamilyAndShade', () => {
  test('parses standard text-family-shade classes', () => {
    expect(parseFamilyAndShade('text-gray-500')).toEqual({ prefix: 'text-', family: 'gray', shade: 500 });
    expect(parseFamilyAndShade('text-red-600')).toEqual({ prefix: 'text-', family: 'red', shade: 600 });
    expect(parseFamilyAndShade('text-sky-700')).toEqual({ prefix: 'text-', family: 'sky', shade: 700 });
  });

  test('parses bg-family-shade classes', () => {
    expect(parseFamilyAndShade('bg-slate-900')).toEqual({ prefix: 'bg-', family: 'slate', shade: 900 });
    expect(parseFamilyAndShade('bg-red-50')).toEqual({ prefix: 'bg-', family: 'red', shade: 50 });
  });

  test('parses non-text prefixes (border, ring, outline)', () => {
    expect(parseFamilyAndShade('border-gray-300')).toEqual({ prefix: 'border-', family: 'gray', shade: 300 });
    expect(parseFamilyAndShade('ring-blue-500')).toEqual({ prefix: 'ring-', family: 'blue', shade: 500 });
    expect(parseFamilyAndShade('outline-red-400')).toEqual({ prefix: 'outline-', family: 'red', shade: 400 });
  });

  test('returns null for semantic colors (no numeric shade)', () => {
    expect(parseFamilyAndShade('text-primary')).toBeNull();
    expect(parseFamilyAndShade('bg-background')).toBeNull();
    expect(parseFamilyAndShade('text-primary-foreground')).toBeNull();
    expect(parseFamilyAndShade('bg-card')).toBeNull();
  });

  test('returns null for arbitrary/custom colors', () => {
    expect(parseFamilyAndShade('text-[#7a7a7a]')).toBeNull();
    expect(parseFamilyAndShade('bg-[oklch(0.5_0.2_180)]')).toBeNull();
  });

  test('returns null for non-color utilities', () => {
    expect(parseFamilyAndShade('text-2xl')).toBeNull();
    expect(parseFamilyAndShade('bg-gradient-to-r')).toBeNull();
  });

  test('strips alpha modifier before parsing', () => {
    expect(parseFamilyAndShade('text-gray-500/70')).toEqual({ prefix: 'text-', family: 'gray', shade: 500 });
    expect(parseFamilyAndShade('bg-red-500/[0.3]')).toEqual({ prefix: 'bg-', family: 'red', shade: 500 });
  });

  test('handles implicit bg prefix from context', () => {
    expect(parseFamilyAndShade('(implicit) bg-card')).toBeNull();
    expect(parseFamilyAndShade('(@a11y-context) #ffffff')).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/suggestions.test.ts -t "parseFamilyAndShade"`
Expected: FAIL

**Step 3: Write implementation**

Add to `src/core/suggestions.ts`:

```typescript
export interface ParsedClass {
  prefix: string;   // "text-", "bg-", "border-", "ring-", "outline-"
  family: string;   // "gray", "red", "sky"
  shade: number;    // 500, 600, 700
}

const STANDARD_SHADES = new Set([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]);

/**
 * Parses a Tailwind class into its prefix, color family, and shade number.
 * Returns null for semantic colors, arbitrary values, non-color utilities,
 * and context annotations.
 */
export function parseFamilyAndShade(className: string): ParsedClass | null {
  // Skip context annotations
  if (className.startsWith('(') || className.startsWith('@')) return null;

  // Match: prefix + family + shade, optionally followed by /alpha
  const match = className.match(
    /^(bg-|text-|border-|ring-|outline-)([a-z]+)-(\d+)(?:\/.*)?$/
  );
  if (!match) return null;

  const prefix = match[1]!;
  const family = match[2]!;
  const shade = parseInt(match[3]!, 10);

  // Filter out non-color utilities (gradient, 2xl, etc.)
  if (!STANDARD_SHADES.has(shade)) return null;

  return { prefix, family, shade };
}
```

**Step 4: Run tests**

Run: `npx vitest run src/core/__tests__/suggestions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/suggestions.ts src/core/__tests__/suggestions.test.ts
git commit -m "feat(suggestions): parseFamilyAndShade extracts family/shade from class names"
```

---

### Task 4: Core suggestion algorithm — luminosity-directed shade walk

**Files:**
- Modify: `src/core/suggestions.ts`
- Modify: `src/core/__tests__/suggestions.test.ts`

**Step 1: Write the failing tests**

Add to `suggestions.test.ts`:

```typescript
import {
  extractShadeFamilies,
  parseFamilyAndShade,
  generateSuggestions,
} from '../suggestions.js';
import type { ContrastResult, RawPalette } from '../types.js';

function makeViolation(overrides: Partial<ContrastResult>): ContrastResult {
  return {
    file: 'test.tsx',
    line: 1,
    bgClass: 'bg-white',
    textClass: 'text-gray-400',
    bgHex: '#ffffff',
    textHex: '#9ca3af',
    ratio: 2.97,
    passAA: false,
    passAALarge: false,
    passAAA: false,
    passAAALarge: false,
    ...overrides,
  };
}

// Real Tailwind v4 gray shades (approximate)
function makeGrayPalette(): RawPalette {
  return new Map([
    ['--color-gray-50', '#f9fafb'],
    ['--color-gray-100', '#f3f4f6'],
    ['--color-gray-200', '#e5e7eb'],
    ['--color-gray-300', '#d1d5db'],
    ['--color-gray-400', '#9ca3af'],
    ['--color-gray-500', '#6b7280'],
    ['--color-gray-600', '#4b5563'],
    ['--color-gray-700', '#374151'],
    ['--color-gray-800', '#1f2937'],
    ['--color-gray-900', '#111827'],
    ['--color-gray-950', '#030712'],
  ]);
}

describe('generateSuggestions', () => {
  const palette = makeGrayPalette();
  const families = extractShadeFamilies(palette);

  test('suggests darker shades for text on light background', () => {
    const violation = makeViolation({
      bgHex: '#ffffff',
      textClass: 'text-gray-400',
      textHex: '#9ca3af',
    });

    const suggestions = generateSuggestions(violation, families, 'AA', 'light');

    expect(suggestions.length).toBeGreaterThan(0);
    // First suggestion should be closest passing shade
    expect(suggestions[0]!.suggestedClass).toMatch(/^text-gray-\d+$/);
    expect(suggestions[0]!.newRatio).toBeGreaterThanOrEqual(4.5);
    // Ordered by shade distance (closest first)
    for (let i = 1; i < suggestions.length; i++) {
      expect(suggestions[i]!.shadeDistance).toBeGreaterThanOrEqual(suggestions[i - 1]!.shadeDistance);
    }
  });

  test('suggests lighter shades for text on dark background', () => {
    const violation = makeViolation({
      bgClass: 'bg-gray-900',
      bgHex: '#111827',
      textClass: 'text-gray-600',
      textHex: '#4b5563',
    });

    const suggestions = generateSuggestions(violation, families, 'AA', 'light');

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]!.suggestedClass).toMatch(/^text-gray-\d+$/);
    expect(suggestions[0]!.newRatio).toBeGreaterThanOrEqual(4.5);
    // Should suggest lighter shades (lower numbers)
    const suggestedShade = parseInt(suggestions[0]!.suggestedClass.match(/(\d+)$/)![1]!, 10);
    expect(suggestedShade).toBeLessThan(600);
  });

  test('returns empty array for semantic colors (no shade family)', () => {
    const violation = makeViolation({
      textClass: 'text-primary',
      textHex: '#0369a1',
    });

    const suggestions = generateSuggestions(violation, families, 'AA', 'light');
    expect(suggestions).toEqual([]);
  });

  test('returns empty array for arbitrary/custom colors', () => {
    const violation = makeViolation({
      textClass: 'text-[#7a7a7a]',
      textHex: '#7a7a7a',
    });

    const suggestions = generateSuggestions(violation, families, 'AA', 'light');
    expect(suggestions).toEqual([]);
  });

  test('respects AAA threshold when requested', () => {
    const violation = makeViolation({
      bgHex: '#ffffff',
      textClass: 'text-gray-500',
      textHex: '#6b7280',
    });

    const suggestions = generateSuggestions(violation, families, 'AAA', 'light');

    if (suggestions.length > 0) {
      expect(suggestions[0]!.newRatio).toBeGreaterThanOrEqual(7.0);
    }
  });

  test('handles bg with alpha (composites against page bg)', () => {
    const violation = makeViolation({
      bgHex: '#1f2937',
      bgAlpha: 0.8,
      textClass: 'text-gray-500',
      textHex: '#6b7280',
    });

    const suggestionsLight = generateSuggestions(violation, families, 'AA', 'light');
    const suggestionsDark = generateSuggestions(violation, families, 'AA', 'dark');

    // Different page bg can produce different effective bg and thus different suggestions
    expect(Array.isArray(suggestionsLight)).toBe(true);
    expect(Array.isArray(suggestionsDark)).toBe(true);
  });

  test('caps suggestions at maxSuggestions', () => {
    const violation = makeViolation({
      bgHex: '#ffffff',
      textClass: 'text-gray-300',
      textHex: '#d1d5db',
    });

    const suggestions = generateSuggestions(violation, families, 'AA', 'light', 2);
    expect(suggestions.length).toBeLessThanOrEqual(2);
  });

  test('handles non-text pair types (border uses 3:1)', () => {
    const violation = makeViolation({
      bgHex: '#ffffff',
      textClass: 'border-gray-200',
      textHex: '#e5e7eb',
      pairType: 'border',
    });

    const suggestions = generateSuggestions(violation, families, 'AA', 'light');

    if (suggestions.length > 0) {
      expect(suggestions[0]!.suggestedClass).toMatch(/^border-gray-\d+$/);
      // Non-text uses 3:1 threshold
      expect(suggestions[0]!.newRatio).toBeGreaterThanOrEqual(3.0);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/suggestions.test.ts -t "generateSuggestions"`
Expected: FAIL

**Step 3: Write implementation**

Add to `src/core/suggestions.ts`:

```typescript
import { colord, extend } from 'colord';
import a11yPlugin from 'colord/plugins/a11y';
import type {
  ShadeFamily,
  ColorSuggestion,
  ContrastResult,
  ConformanceLevel,
  ThemeMode,
} from './types.js';
import { compositeOver } from './contrast-checker.js';

extend([a11yPlugin]);

const PAGE_BG_LIGHT = '#ffffff';
const PAGE_BG_DARK = '#09090b';

const DEFAULT_MAX_SUGGESTIONS = 3;

/**
 * Generates shade-family suggestions for a contrast violation.
 *
 * Algorithm (luminosity-directed walk):
 * 1. Parse the violating fg class to find its shade family
 * 2. Compute effective bg (with alpha compositing)
 * 3. Determine search direction based on bg luminance
 * 4. Walk shade family, filtering candidates by luminosity direction + threshold
 * 5. Return closest passing shades (sorted by distance from original)
 */
export function generateSuggestions(
  violation: ContrastResult,
  families: Map<string, ShadeFamily>,
  threshold: ConformanceLevel,
  themeMode: ThemeMode,
  maxSuggestions: number = DEFAULT_MAX_SUGGESTIONS,
): ColorSuggestion[] {
  // 1. Parse the foreground class
  const parsed = parseFamilyAndShade(violation.textClass);
  if (!parsed) return [];

  const family = families.get(parsed.family);
  if (!family) return [];

  // 2. Compute effective background (same logic as contrast-checker)
  if (!violation.bgHex) return [];
  const pageBg = themeMode === 'light' ? PAGE_BG_LIGHT : PAGE_BG_DARK;
  const effectiveBg = violation.bgAlpha !== undefined
    ? compositeOver(violation.bgHex, pageBg, violation.bgAlpha)
    : violation.bgHex;

  // 3. Determine required threshold ratio
  const isNonText = violation.pairType && violation.pairType !== 'text';
  let requiredRatio: number;
  if (threshold === 'AAA') {
    requiredRatio = (isNonText || violation.isLargeText) ? 4.5 : 7.0;
  } else {
    requiredRatio = (isNonText || violation.isLargeText) ? 3.0 : 4.5;
  }

  // 4. Compute bg luminance for direction hint
  const bgLuminance = colord(effectiveBg).luminance();
  const bgColor = colord(effectiveBg);

  // 5. Walk all shades, collect passing candidates
  const candidates: ColorSuggestion[] = [];

  for (const [shade, hex] of family.shades) {
    if (shade === parsed.shade) continue; // skip current shade

    // Verify luminosity direction: on light bg, want darker fg (lower luminance)
    const candidateLuminance = colord(hex).luminance();
    if (bgLuminance > 0.5 && candidateLuminance >= bgLuminance) continue;
    if (bgLuminance <= 0.5 && candidateLuminance <= bgLuminance) continue;

    const ratio = Math.round(bgColor.contrast(colord(hex)) * 100) / 100;
    if (ratio < requiredRatio) continue;

    candidates.push({
      suggestedClass: `${parsed.prefix}${parsed.family}-${shade}`,
      suggestedHex: hex,
      newRatio: ratio,
      shadeDistance: Math.abs(shade - parsed.shade),
    });
  }

  // 6. Sort by shade distance (closest first), then by ratio (lower = minimal visual change)
  candidates.sort((a, b) => a.shadeDistance - b.shadeDistance || a.newRatio - b.newRatio);

  return candidates.slice(0, maxSuggestions);
}
```

**Step 4: Run tests**

Run: `npx vitest run src/core/__tests__/suggestions.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/core/suggestions.ts src/core/__tests__/suggestions.test.ts
git commit -m "feat(suggestions): luminosity-directed shade walk algorithm"
```

---

### Task 5: Wire suggestions into pipeline

**Files:**
- Modify: `src/core/pipeline.ts`

**Step 1: Add suggestions option to PipelineOptions**

In `src/core/pipeline.ts`, add to the `PipelineOptions` interface (after `baseline?`):

```typescript
  /** Suggestion engine configuration */
  suggestions?: {
    enabled: boolean;
    maxSuggestions: number;
  };
```

**Step 2: Add imports at the top of pipeline.ts**

```typescript
import { extractShadeFamilies, generateSuggestions } from './suggestions.js';
import { extractTailwindPalette } from '../plugins/tailwind/palette.js';
```

Note: `extractTailwindPalette` may already be imported indirectly. We need a direct import for shade family extraction.

**Step 3: Add suggestion enrichment in runAudit()**

After the theme loop ends (after line 167), before Phase 3.5 baseline section, add:

```typescript
  // Phase 3a: Enrich violations with suggestions (optional)
  if (options.suggestions?.enabled) {
    log(verbose, '[a11y-audit] Generating suggestions...');
    const rawPalette = extractTailwindPalette(palettePath);
    const shadeFamilies = extractShadeFamilies(rawPalette);
    const maxSuggestions = options.suggestions.maxSuggestions;

    for (const { mode, result } of results) {
      for (const violation of result.violations) {
        violation.suggestions = generateSuggestions(
          violation, shadeFamilies, threshold, mode, maxSuggestions,
        );
      }
    }

    const totalSuggested = results.reduce(
      (s, r) => s + r.result.violations.filter(v => v.suggestions && v.suggestions.length > 0).length, 0,
    );
    log(verbose, `  ${totalSuggested} violations with suggestions`);
  }
```

**Step 4: Run existing pipeline tests to verify no breakage**

Run: `npx vitest run src/core/__tests__/integration.test.ts`
Expected: PASS (suggestions disabled by default)

**Step 5: Commit**

```bash
git add src/core/pipeline.ts
git commit -m "feat(pipeline): wire suggestion engine between contrast check and baseline"
```

---

### Task 6: Add config schema and CLI flag

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/bin/cli.ts`
- Modify: `src/config/__tests__/schema.test.ts`

**Step 1: Write the failing test**

Add to `src/config/__tests__/schema.test.ts`:

```typescript
describe('suggestions config', () => {
  test('defaults to disabled with maxSuggestions=3', () => {
    const result = auditConfigSchema.parse({
      suggestions: {},
    });
    expect(result.suggestions).toEqual({
      enabled: false,
      maxSuggestions: 3,
    });
  });

  test('accepts enabled with custom maxSuggestions', () => {
    const result = auditConfigSchema.parse({
      suggestions: { enabled: true, maxSuggestions: 5 },
    });
    expect(result.suggestions).toEqual({
      enabled: true,
      maxSuggestions: 5,
    });
  });

  test('suggestions field is optional', () => {
    const result = auditConfigSchema.parse({});
    expect(result.suggestions).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/__tests__/schema.test.ts -t "suggestions config"`
Expected: FAIL

**Step 3: Add schema field**

In `src/config/schema.ts`, add after the `baseline` field (line 49):

```typescript
  /** Suggestion engine for auto-fix hints */
  suggestions: z.object({
    /** Enable suggestion generation */
    enabled: z.boolean().default(false),
    /** Maximum suggestions per violation */
    maxSuggestions: z.number().min(1).max(10).default(3),
  }).optional(),
```

**Step 4: Add CLI flag**

In `src/bin/cli.ts`, add after `--fail-on-improvement` (line 27):

```typescript
  .option('--suggest', 'Generate auto-fix suggestions for contrast violations')
  .option('--max-suggestions <n>', 'Maximum suggestions per violation (default: 3)')
```

In the `action()` handler, after `baselineEnabled` (line 48):

```typescript
      const suggestEnabled: boolean =
        opts.suggest === true || (fileConfig.suggestions?.enabled ?? false);
      const maxSuggestions: number =
        opts.maxSuggestions != null
          ? parseInt(opts.maxSuggestions as string, 10)
          : (fileConfig.suggestions?.maxSuggestions ?? 3);
```

In the `pipelineOpts` object (after `baseline`):

```typescript
        suggestions: suggestEnabled ? {
          enabled: true,
          maxSuggestions,
        } : undefined,
```

**Step 5: Run tests**

Run: `npx vitest run src/config/__tests__/schema.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/config/schema.ts src/bin/cli.ts src/config/__tests__/schema.test.ts
git commit -m "feat(config): add suggestions schema + --suggest CLI flag"
```

---

### Task 7: Add suggestions to JSON report

**Files:**
- Modify: `src/core/__tests__/report-json.test.ts`

**Step 1: Write the test**

Add to `src/core/__tests__/report-json.test.ts`:

```typescript
test('includes suggestions in violation output when present', () => {
  const violation = makeViolation({
    suggestions: [
      {
        suggestedClass: 'text-gray-600',
        suggestedHex: '#4b5563',
        newRatio: 5.91,
        shadeDistance: 1,
      },
    ],
  });

  const results = [{ mode: 'light' as const, result: makeResult({ violations: [violation] }) }];
  const json = JSON.parse(generateJsonReport(results));

  expect(json.themes[0].violations[0].suggestions).toBeDefined();
  expect(json.themes[0].violations[0].suggestions).toHaveLength(1);
  expect(json.themes[0].violations[0].suggestions[0].suggestedClass).toBe('text-gray-600');
});

test('omits suggestions field when not present', () => {
  const violation = makeViolation({});
  const results = [{ mode: 'light' as const, result: makeResult({ violations: [violation] }) }];
  const json = JSON.parse(generateJsonReport(results));

  expect(json.themes[0].violations[0].suggestions).toBeUndefined();
});
```

Note: `makeViolation` and `makeResult` use existing test helpers. Adapt to match the file's existing pattern.

**Step 2: Run test**

The JSON report uses `JSON.stringify(result.violations)`. Since `suggestions` is optional on `ContrastResult`, it passes through automatically. No code changes needed — this test documents the behavior.

Run: `npx vitest run src/core/__tests__/report-json.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/core/__tests__/report-json.test.ts
git commit -m "test(report): verify suggestions appear in JSON report output"
```

---

### Task 8: Add suggestions to Markdown report

**Files:**
- Modify: `src/core/report/markdown.ts`
- Modify: `src/core/__tests__/report-markdown.test.ts`

**Step 1: Write the failing test**

Add to `src/core/__tests__/report-markdown.test.ts`:

```typescript
test('renders suggestion line below text violations', () => {
  const violation = makeViolation({
    textClass: 'text-gray-400',
    textHex: '#9ca3af',
    ratio: 2.97,
    suggestions: [
      { suggestedClass: 'text-gray-600', suggestedHex: '#4b5563', newRatio: 5.91, shadeDistance: 2 },
      { suggestedClass: 'text-gray-700', suggestedHex: '#374151', newRatio: 8.59, shadeDistance: 3 },
    ],
  });

  const results = [{ mode: 'light' as const, result: makeResult({ violations: [violation] }) }];
  const report = generateReport(results);

  expect(report).toContain('text-gray-600');
  expect(report).toContain('5.91:1');
  expect(report).toContain('text-gray-700');
  expect(report).toContain('Suggestion');
});

test('does not render suggestion line when no suggestions', () => {
  const violation = makeViolation({ suggestions: [] });
  const results = [{ mode: 'light' as const, result: makeResult({ violations: [violation] }) }];
  const report = generateReport(results);

  expect(report).not.toContain('Suggestion');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/report-markdown.test.ts -t "suggestion"`
Expected: FAIL

**Step 3: Write implementation**

In `src/core/report/markdown.ts`, modify `renderTextViolationTable()` (line 30-33 area). After pushing the violation row, add:

```typescript
      // Suggestion row
      if (v.suggestions && v.suggestions.length > 0) {
        const hints = v.suggestions
          .map(s => `\`${s.suggestedClass}\` (${s.newRatio}:1)`)
          .join(' or ');
        lines.push(`| | | | **Suggestion:** use ${hints} | | | | | | |`);
      }
```

Similarly in `renderNonTextViolationTable()`, after the violation row:

```typescript
      if (v.suggestions && v.suggestions.length > 0) {
        const hints = v.suggestions
          .map(s => `\`${s.suggestedClass}\` (${s.newRatio}:1)`)
          .join(' or ');
        lines.push(`| | | | **Suggestion:** use ${hints} | | | |`);
      }
```

**Step 4: Run tests**

Run: `npx vitest run src/core/__tests__/report-markdown.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/report/markdown.ts src/core/__tests__/report-markdown.test.ts
git commit -m "feat(report): render suggestion hints in Markdown violation tables"
```

---

### Task 9: Console output for suggestions

**Files:**
- Modify: `src/bin/cli.ts`

**Step 1: Add suggestion count to console output**

In `src/bin/cli.ts`, destructure `results` from `runAudit`:

```typescript
const { totalViolations, baselineSummary, baselineUpdated, results } = runAudit(pipelineOpts);
```

After the violation count log (around line 107), add:

```typescript
      if (suggestEnabled && totalViolations > 0) {
        const totalWithSuggestions = results.reduce(
          (s, { result }) => s + result.violations.filter(
            v => v.suggestions && v.suggestions.length > 0
          ).length,
          0,
        );
        if (totalWithSuggestions > 0) {
          console.log(`[a11y-audit] ${totalWithSuggestions} violations have auto-fix suggestions. See report.`);
        }
      }
```

**Step 2: Verify build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/bin/cli.ts
git commit -m "feat(cli): print suggestion count summary when --suggest is active"
```

---

### Task 10: E2E integration test for suggestions

**Files:**
- Modify: `src/core/__tests__/integration.test.ts`

**Step 1: Write the integration test**

```typescript
import { extractShadeFamilies, generateSuggestions } from '../suggestions.js';

describe('suggestion engine integration', () => {
  test('produces correct results for real gray palette', () => {
    const palette: RawPalette = new Map([
      ['--color-gray-50', '#f9fafb'],
      ['--color-gray-100', '#f3f4f6'],
      ['--color-gray-200', '#e5e7eb'],
      ['--color-gray-300', '#d1d5db'],
      ['--color-gray-400', '#9ca3af'],
      ['--color-gray-500', '#6b7280'],
      ['--color-gray-600', '#4b5563'],
      ['--color-gray-700', '#374151'],
      ['--color-gray-800', '#1f2937'],
      ['--color-gray-900', '#111827'],
      ['--color-gray-950', '#030712'],
    ]);

    const families = extractShadeFamilies(palette);
    const violation: ContrastResult = {
      file: 'Button.tsx',
      line: 10,
      bgClass: 'bg-white',
      textClass: 'text-gray-400',
      bgHex: '#ffffff',
      textHex: '#9ca3af',
      ratio: 2.97,
      passAA: false,
      passAALarge: false,
      passAAA: false,
      passAAALarge: false,
    };

    const suggestions = generateSuggestions(violation, families, 'AA', 'light');

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]!.newRatio).toBeGreaterThanOrEqual(4.5);
    expect(suggestions[0]!.shadeDistance).toBeLessThanOrEqual(
      suggestions[suggestions.length - 1]!.shadeDistance,
    );
  });
});
```

**Step 2: Run the test**

Run: `npx vitest run src/core/__tests__/integration.test.ts -t "suggestion engine"`
Expected: PASS

**Step 3: Commit**

```bash
git add src/core/__tests__/integration.test.ts
git commit -m "test(integration): E2E test for suggestion engine with real palette data"
```

---

## Part B: US-06 — CVA Variant Expansion (Tasks 11–18)

### Task 11: Add CvaDefinition type

**Files:**
- Modify: `src/core/types.ts`

**Step 1: Add types**

Add after `ColorSuggestion` in `src/core/types.ts`:

```typescript
/** A parsed variant option within a CVA definition */
export interface CvaVariantOption {
  /** Option name (e.g., "destructive", "sm") */
  name: string;
  /** Tailwind classes for this option */
  classes: string;
}

/** A parsed variant group within a CVA definition */
export interface CvaVariantGroup {
  /** Variant axis name (e.g., "variant", "size") */
  axis: string;
  /** Available options */
  options: CvaVariantOption[];
}

/** A parsed cva() definition extracted from source code */
export interface CvaDefinition {
  /** Base classes (always applied) */
  baseClasses: string;
  /** Variant groups */
  variants: CvaVariantGroup[];
  /** Default variant selections (axis -> option name) */
  defaultVariants: Map<string, string>;
}
```

**Step 2: Run existing tests**

Run: `npx vitest run src/core/__tests__/contrast-checker.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(types): add CvaDefinition, CvaVariantGroup, CvaVariantOption for US-06"
```

---

### Task 12: Parse base classes from cva() content

**Files:**
- Create: `src/plugins/jsx/cva-expander.ts`
- Create: `src/plugins/jsx/__tests__/cva-expander.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, test, expect } from 'vitest';
import { extractCvaBase } from '../cva-expander.js';

describe('extractCvaBase', () => {
  test('extracts first double-quoted string as base classes', () => {
    const content = `"rounded-md font-semibold text-sm", { variants: {} }`;
    expect(extractCvaBase(content)).toBe('rounded-md font-semibold text-sm');
  });

  test('extracts first single-quoted string', () => {
    const content = `'bg-primary text-white', {}`;
    expect(extractCvaBase(content)).toBe('bg-primary text-white');
  });

  test('extracts backtick-quoted string', () => {
    const content = '`inline-flex items-center`, {}';
    expect(extractCvaBase(content)).toBe('inline-flex items-center');
  });

  test('trims whitespace', () => {
    const content = `  "  bg-primary text-white  "  , {}`;
    expect(extractCvaBase(content)).toBe('bg-primary text-white');
  });

  test('returns empty string when no string literal found', () => {
    expect(extractCvaBase('{ variants: {} }')).toBe('');
    expect(extractCvaBase('')).toBe('');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/plugins/jsx/__tests__/cva-expander.test.ts -t "extractCvaBase"`
Expected: FAIL

**Step 3: Write implementation**

Create `src/plugins/jsx/cva-expander.ts`:

```typescript
import type {
  ClassRegion,
  CvaVariantGroup,
  CvaVariantOption,
  FileRegions,
  SkippedClass,
} from '../../core/types.js';

/**
 * Extracts the base classes (first string argument) from raw cva() content.
 * The content is everything between cva( and the matching ).
 */
export function extractCvaBase(content: string): string {
  const match = content.match(/^\s*["'`]([^"'`]*)["'`]/);
  return match ? match[1]!.trim() : '';
}
```

**Step 4: Run test**

Run: `npx vitest run src/plugins/jsx/__tests__/cva-expander.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plugins/jsx/cva-expander.ts src/plugins/jsx/__tests__/cva-expander.test.ts
git commit -m "feat(cva): extractCvaBase parses first string argument from cva() calls"
```

---

### Task 13: Parse variant groups from cva() content

**Files:**
- Modify: `src/plugins/jsx/cva-expander.ts`
- Modify: `src/plugins/jsx/__tests__/cva-expander.test.ts`

**Step 1: Write the failing test**

```typescript
import { extractCvaBase, parseCvaVariants } from '../cva-expander.js';

describe('parseCvaVariants', () => {
  test('parses variant groups with string literal values', () => {
    const content = `"base", {
      variants: {
        variant: {
          default: "bg-primary text-primary-foreground",
          destructive: "bg-destructive text-destructive-foreground",
          outline: "border border-input bg-background",
        },
        size: {
          default: "h-10 px-4 py-2",
          sm: "h-9 px-3",
          lg: "h-11 px-8",
        },
      },
      defaultVariants: {
        variant: "default",
        size: "default",
      },
    }`;

    const result = parseCvaVariants(content);

    expect(result.variants).toHaveLength(2);

    const variantGroup = result.variants.find(v => v.axis === 'variant');
    expect(variantGroup).toBeDefined();
    expect(variantGroup!.options).toHaveLength(3);
    expect(variantGroup!.options[0]!.name).toBe('default');
    expect(variantGroup!.options[0]!.classes).toBe('bg-primary text-primary-foreground');

    const sizeGroup = result.variants.find(v => v.axis === 'size');
    expect(sizeGroup).toBeDefined();
    expect(sizeGroup!.options).toHaveLength(3);

    expect(result.defaultVariants.get('variant')).toBe('default');
    expect(result.defaultVariants.get('size')).toBe('default');
  });

  test('handles cva with no variants (base-only)', () => {
    const content = `"rounded-md font-semibold"`;
    const result = parseCvaVariants(content);

    expect(result.variants).toHaveLength(0);
    expect(result.defaultVariants.size).toBe(0);
  });

  test('handles single variant group', () => {
    const content = `"base", {
      variants: {
        intent: {
          primary: "bg-blue-500",
          danger: "bg-red-500",
        },
      },
    }`;

    const result = parseCvaVariants(content);
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]!.axis).toBe('intent');
    expect(result.variants[0]!.options).toHaveLength(2);
    expect(result.defaultVariants.size).toBe(0);
  });

  test('skips compoundVariants (not supported)', () => {
    const content = `"base", {
      variants: {
        variant: { primary: "bg-blue-500" },
      },
      compoundVariants: [
        { variant: "primary", class: "extra" },
      ],
    }`;

    const result = parseCvaVariants(content);
    expect(result.variants).toHaveLength(1);
    // compoundVariants is silently ignored
  });

  test('ignores non-string-literal values', () => {
    const content = `"base", {
      variants: {
        variant: {
          primary: "bg-blue-500",
          dynamic: someVariable,
        },
      },
    }`;

    const result = parseCvaVariants(content);
    expect(result.variants[0]!.options).toHaveLength(1);
    expect(result.variants[0]!.options[0]!.name).toBe('primary');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/plugins/jsx/__tests__/cva-expander.test.ts -t "parseCvaVariants"`
Expected: FAIL

**Step 3: Write implementation**

Add to `src/plugins/jsx/cva-expander.ts`:

```typescript
interface ParsedCvaConfig {
  variants: CvaVariantGroup[];
  defaultVariants: Map<string, string>;
}

/**
 * Finds the matching closing brace for an opening brace at `openPos`.
 * Returns the index of the closing brace, or -1 if not found.
 * @internal Exported for unit testing
 */
export function findClosingBrace(content: string, openPos: number): number {
  let depth = 0;
  let inString: string | null = null;

  for (let i = openPos; i < content.length; i++) {
    const ch = content[i]!;

    if (inString) {
      if (ch === inString && content[i - 1] !== '\\') inString = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * Parses variant groups and defaultVariants from raw cva() content.
 * Uses textual pattern matching with balanced brace parsing.
 * Skips compoundVariants and non-string-literal values.
 */
export function parseCvaVariants(content: string): ParsedCvaConfig {
  const variants: CvaVariantGroup[] = [];
  const defaultVariants = new Map<string, string>();

  // Find the "variants:" block
  const variantsIdx = content.indexOf('variants:');
  if (variantsIdx === -1) return { variants, defaultVariants };

  // Find the opening brace of the variants object
  const variantsObjStart = content.indexOf('{', variantsIdx + 'variants:'.length);
  if (variantsObjStart === -1) return { variants, defaultVariants };

  const variantsObjEnd = findClosingBrace(content, variantsObjStart);
  if (variantsObjEnd === -1) return { variants, defaultVariants };

  const variantsBlock = content.slice(variantsObjStart + 1, variantsObjEnd);

  // Parse each variant axis (e.g., "variant: { ... }", "size: { ... }")
  const axisRegex = /(\w+)\s*:\s*\{/g;
  let axisMatch: RegExpExecArray | null;

  while ((axisMatch = axisRegex.exec(variantsBlock)) !== null) {
    const axisName = axisMatch[1]!;
    const axisObjStart = axisMatch.index + axisMatch[0].length - 1;
    const axisObjEnd = findClosingBrace(variantsBlock, axisObjStart);
    if (axisObjEnd === -1) continue;

    const axisBlock = variantsBlock.slice(axisObjStart + 1, axisObjEnd);

    // Parse each option: name: "classes"
    const optionRegex = /(\w+)\s*:\s*["'`]([^"'`]*)["'`]/g;
    const options: CvaVariantOption[] = [];
    let optionMatch: RegExpExecArray | null;

    while ((optionMatch = optionRegex.exec(axisBlock)) !== null) {
      options.push({
        name: optionMatch[1]!,
        classes: optionMatch[2]!,
      });
    }

    if (options.length > 0) {
      variants.push({ axis: axisName, options });
    }

    // Advance past this axis block to avoid re-matching nested braces
    axisRegex.lastIndex = axisObjStart + (axisObjEnd - axisObjStart) + 1;
  }

  // Parse defaultVariants
  const defaultIdx = content.indexOf('defaultVariants:');
  if (defaultIdx !== -1) {
    const defaultObjStart = content.indexOf('{', defaultIdx + 'defaultVariants:'.length);
    if (defaultObjStart !== -1) {
      const defaultObjEnd = findClosingBrace(content, defaultObjStart);
      if (defaultObjEnd !== -1) {
        const defaultBlock = content.slice(defaultObjStart + 1, defaultObjEnd);
        const defaultRegex = /(\w+)\s*:\s*["'`]([^"'`]*)["'`]/g;
        let defaultMatch: RegExpExecArray | null;

        while ((defaultMatch = defaultRegex.exec(defaultBlock)) !== null) {
          defaultVariants.set(defaultMatch[1]!, defaultMatch[2]!);
        }
      }
    }
  }

  return { variants, defaultVariants };
}
```

**Step 4: Run tests**

Run: `npx vitest run src/plugins/jsx/__tests__/cva-expander.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plugins/jsx/cva-expander.ts src/plugins/jsx/__tests__/cva-expander.test.ts
git commit -m "feat(cva): parseCvaVariants extracts variant groups with balanced brace parsing"
```

---

### Task 14: Build default combination and expand CVA regions

**Files:**
- Modify: `src/plugins/jsx/cva-expander.ts`
- Modify: `src/plugins/jsx/__tests__/cva-expander.test.ts`

**Step 1: Write the failing test**

```typescript
import { expandCvaToRegions } from '../cva-expander.js';
import type { ClassRegion } from '../../core/types.js';

describe('expandCvaToRegions', () => {
  const baseRegion: ClassRegion = {
    content: `"rounded-md font-semibold text-sm", {
      variants: {
        variant: {
          default: "bg-primary text-primary-foreground",
          destructive: "bg-destructive text-destructive-foreground",
        },
        size: {
          default: "h-10 px-4",
          sm: "h-9 px-3",
        },
      },
      defaultVariants: {
        variant: "default",
        size: "default",
      },
    }`,
    startLine: 5,
    contextBg: 'bg-card',
  };

  test('default mode: produces ONE region with base + defaultVariants classes', () => {
    const regions = expandCvaToRegions(baseRegion, false);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.content).toContain('rounded-md');
    expect(regions[0]!.content).toContain('font-semibold');
    expect(regions[0]!.content).toContain('bg-primary');
    expect(regions[0]!.content).toContain('text-primary-foreground');
    expect(regions[0]!.content).toContain('h-10');
    expect(regions[0]!.startLine).toBe(5);
    expect(regions[0]!.contextBg).toBe('bg-card');
  });

  test('checkAllVariants mode: produces region per non-default variant', () => {
    const regions = expandCvaToRegions(baseRegion, true);

    // 1 default combo + 1 destructive variant + 1 sm size = 3
    expect(regions.length).toBeGreaterThanOrEqual(2);

    const destructive = regions.find(r => r.content.includes('bg-destructive'));
    expect(destructive).toBeDefined();
    expect(destructive!.content).toContain('rounded-md');
  });

  test('cva with no variants returns single region with base classes', () => {
    const simpleRegion: ClassRegion = {
      content: '"rounded-md bg-primary text-white"',
      startLine: 1,
      contextBg: 'bg-background',
    };

    const regions = expandCvaToRegions(simpleRegion, false);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.content).toBe('rounded-md bg-primary text-white');
  });

  test('preserves effectiveOpacity and contextOverride', () => {
    const regionWithContext: ClassRegion = {
      ...baseRegion,
      effectiveOpacity: 0.5,
      contextOverride: { bg: '#ff0000' },
    };

    const regions = expandCvaToRegions(regionWithContext, false);

    expect(regions[0]!.effectiveOpacity).toBe(0.5);
    expect(regions[0]!.contextOverride).toEqual({ bg: '#ff0000' });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/plugins/jsx/__tests__/cva-expander.test.ts -t "expandCvaToRegions"`
Expected: FAIL

**Step 3: Write implementation**

Add to `src/plugins/jsx/cva-expander.ts`:

```typescript
/**
 * Expands a raw cva() ClassRegion into virtual ClassRegions.
 *
 * - Default mode (checkAllVariants=false): ONE region with base + defaultVariants
 * - All-variants mode (checkAllVariants=true): default combo + ONE per
 *   non-default individual variant option (base + that variant's classes)
 */
export function expandCvaToRegions(
  region: ClassRegion,
  checkAllVariants: boolean,
): ClassRegion[] {
  const base = extractCvaBase(region.content);
  const { variants, defaultVariants } = parseCvaVariants(region.content);

  // Build default combination: base + classes from each defaultVariant
  const defaultClasses = [base];
  for (const group of variants) {
    const defaultOptionName = defaultVariants.get(group.axis);
    if (defaultOptionName) {
      const option = group.options.find(o => o.name === defaultOptionName);
      if (option) defaultClasses.push(option.classes);
    }
  }

  const makeRegion = (classes: string): ClassRegion => ({
    content: classes,
    startLine: region.startLine,
    contextBg: region.contextBg,
    inlineStyles: region.inlineStyles,
    contextOverride: region.contextOverride,
    effectiveOpacity: region.effectiveOpacity,
  });

  const results: ClassRegion[] = [];

  // Always include the default combination
  results.push(makeRegion(defaultClasses.join(' ')));

  if (checkAllVariants) {
    for (const group of variants) {
      const defaultOptionName = defaultVariants.get(group.axis);
      for (const option of group.options) {
        if (option.name === defaultOptionName) continue;
        results.push(makeRegion(`${base} ${option.classes}`));
      }
    }
  }

  return results;
}
```

**Step 4: Run tests**

Run: `npx vitest run src/plugins/jsx/__tests__/cva-expander.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plugins/jsx/cva-expander.ts src/plugins/jsx/__tests__/cva-expander.test.ts
git commit -m "feat(cva): expandCvaToRegions produces virtual ClassRegions from cva() definitions"
```

---

### Task 15: Post-processing step to expand CVA in PreExtracted data

**Files:**
- Modify: `src/plugins/jsx/cva-expander.ts`
- Modify: `src/plugins/jsx/__tests__/cva-expander.test.ts`

**Step 1: Write the failing test**

```typescript
import { expandCvaInPreExtracted } from '../cva-expander.js';
import type { ClassRegion, FileRegions, SkippedClass } from '../../core/types.js';

describe('expandCvaInPreExtracted', () => {
  test('replaces cva() regions with expanded virtual regions', () => {
    const files: FileRegions[] = [{
      relPath: 'Button.tsx',
      lines: ['const buttonVariants = cva('],
      regions: [
        {
          content: '"bg-primary text-white", { variants: { size: { sm: "h-9", lg: "h-11" } }, defaultVariants: { size: "sm" } }',
          startLine: 1,
          contextBg: 'bg-background',
        },
        {
          content: 'font-bold text-lg',
          startLine: 10,
          contextBg: 'bg-background',
        },
      ],
    }];

    const result = expandCvaInPreExtracted(
      { files, readErrors: [], filesScanned: 1 },
      false,
    );

    expect(result.files[0]!.regions.length).toBe(2);
    expect(result.files[0]!.regions[0]!.content).toContain('bg-primary');
    expect(result.files[0]!.regions[0]!.content).toContain('h-9');
    expect(result.files[0]!.regions[1]!.content).toBe('font-bold text-lg');
  });

  test('leaves non-cva regions untouched', () => {
    const files: FileRegions[] = [{
      relPath: 'Card.tsx',
      lines: [],
      regions: [
        { content: 'bg-card text-card-foreground p-6', startLine: 3, contextBg: 'bg-background' },
      ],
    }];

    const result = expandCvaInPreExtracted(
      { files, readErrors: [], filesScanned: 1 },
      false,
    );

    expect(result.files[0]!.regions).toHaveLength(1);
    expect(result.files[0]!.regions[0]!.content).toBe('bg-card text-card-foreground p-6');
  });

  test('checkAllVariants=true expands to multiple regions', () => {
    const files: FileRegions[] = [{
      relPath: 'Button.tsx',
      lines: [],
      regions: [
        {
          content: '"base", { variants: { v: { a: "class-a", b: "class-b" } }, defaultVariants: { v: "a" } }',
          startLine: 1,
          contextBg: 'bg-background',
        },
      ],
    }];

    const result = expandCvaInPreExtracted(
      { files, readErrors: [], filesScanned: 1 },
      true,
    );

    // default combo (base + class-a) + non-default variant (base + class-b) = 2
    expect(result.files[0]!.regions.length).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/plugins/jsx/__tests__/cva-expander.test.ts -t "expandCvaInPreExtracted"`
Expected: FAIL

**Step 3: Write implementation**

Add to `src/plugins/jsx/cva-expander.ts`:

```typescript
interface PreExtracted {
  files: FileRegions[];
  readErrors: SkippedClass[];
  filesScanned: number;
}

/**
 * Detects whether a ClassRegion's content looks like a cva() call
 * (starts with a quoted string and contains "variants:" keyword).
 */
function isCvaContent(content: string): boolean {
  return /^\s*["'`]/.test(content) && content.includes('variants:');
}

/**
 * Post-processing step that expands cva() ClassRegions into virtual regions.
 * Runs on PreExtracted data between extraction (Phase 1) and resolution (Phase 2).
 * Non-cva regions pass through unchanged.
 */
export function expandCvaInPreExtracted(
  preExtracted: PreExtracted,
  checkAllVariants: boolean,
): PreExtracted {
  const expandedFiles: FileRegions[] = preExtracted.files.map(file => {
    const expandedRegions: ClassRegion[] = [];

    for (const region of file.regions) {
      if (isCvaContent(region.content)) {
        expandedRegions.push(...expandCvaToRegions(region, checkAllVariants));
      } else {
        expandedRegions.push(region);
      }
    }

    return { ...file, regions: expandedRegions };
  });

  return {
    files: expandedFiles,
    readErrors: preExtracted.readErrors,
    filesScanned: preExtracted.filesScanned,
  };
}
```

**Step 4: Run tests**

Run: `npx vitest run src/plugins/jsx/__tests__/cva-expander.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plugins/jsx/cva-expander.ts src/plugins/jsx/__tests__/cva-expander.test.ts
git commit -m "feat(cva): expandCvaInPreExtracted post-processes PreExtracted data"
```

---

### Task 16: Wire CVA expansion into pipeline

**Files:**
- Modify: `src/core/pipeline.ts`

**Step 1: Add CVA option to PipelineOptions**

In `src/core/pipeline.ts`, add to `PipelineOptions` (after `suggestions?`):

```typescript
  /** CVA variant expansion configuration */
  cva?: {
    enabled: boolean;
    checkAllVariants: boolean;
  };
```

**Step 2: Add import and pipeline step**

Add import:

```typescript
import { expandCvaInPreExtracted } from '../plugins/jsx/cva-expander.js';
```

In `runAudit()`, after the extraction phase (after `log(verbose, ... filesScanned ...)`) and before the theme resolution loop, add:

```typescript
  // Phase 1a: CVA variant expansion (optional, post-extraction)
  if (options.cva?.enabled) {
    log(verbose, '[a11y-audit] Expanding CVA variant definitions...');
    const regionsBefore = preExtracted.files.reduce((s, f) => s + f.regions.length, 0);
    preExtracted = expandCvaInPreExtracted(preExtracted, options.cva.checkAllVariants);
    const regionsAfter = preExtracted.files.reduce((s, f) => s + f.regions.length, 0);
    log(verbose, `  ${regionsAfter - regionsBefore} virtual regions added from CVA expansion`);
  }
```

**Step 3: Run existing tests**

Run: `npx vitest run src/core/__tests__/integration.test.ts`
Expected: PASS (cva disabled by default)

**Step 4: Commit**

```bash
git add src/core/pipeline.ts
git commit -m "feat(pipeline): wire CVA expansion between extraction and resolution phases"
```

---

### Task 17: Add CVA config schema and CLI flags

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/bin/cli.ts`
- Modify: `src/config/__tests__/schema.test.ts`

**Step 1: Write the failing test**

Add to `src/config/__tests__/schema.test.ts`:

```typescript
describe('cva config', () => {
  test('defaults to disabled with checkAllVariants=false', () => {
    const result = auditConfigSchema.parse({
      cva: {},
    });
    expect(result.cva).toEqual({
      enabled: false,
      checkAllVariants: false,
    });
  });

  test('accepts enabled with checkAllVariants', () => {
    const result = auditConfigSchema.parse({
      cva: { enabled: true, checkAllVariants: true },
    });
    expect(result.cva).toEqual({
      enabled: true,
      checkAllVariants: true,
    });
  });

  test('cva field is optional', () => {
    const result = auditConfigSchema.parse({});
    expect(result.cva).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/__tests__/schema.test.ts -t "cva config"`
Expected: FAIL

**Step 3: Add schema field**

In `src/config/schema.ts`, add after the `suggestions` field:

```typescript
  /** CVA variant expansion for static analysis */
  cva: z.object({
    /** Enable CVA variant extraction */
    enabled: z.boolean().default(false),
    /** Check all individual variants (not just default combination) */
    checkAllVariants: z.boolean().default(false),
  }).optional(),
```

**Step 4: Add CLI flags**

In `src/bin/cli.ts`, add after `--max-suggestions`:

```typescript
  .option('--cva', 'Enable CVA variant expansion for static analysis')
  .option('--check-all-variants', 'Check all CVA variant combinations (not just defaults)')
```

In the `action()` handler, after `maxSuggestions`:

```typescript
      const cvaEnabled: boolean =
        opts.cva === true || (fileConfig.cva?.enabled ?? false);
      const checkAllVariants: boolean =
        opts.checkAllVariants === true || (fileConfig.cva?.checkAllVariants ?? false);
```

In the `pipelineOpts` object:

```typescript
        cva: cvaEnabled ? {
          enabled: true,
          checkAllVariants,
        } : undefined,
```

**Step 5: Run tests**

Run: `npx vitest run src/config/__tests__/schema.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/config/schema.ts src/bin/cli.ts src/config/__tests__/schema.test.ts
git commit -m "feat(config): add cva schema + --cva/--check-all-variants CLI flags"
```

---

### Task 18: E2E integration test for CVA expansion

**Files:**
- Modify: `src/core/__tests__/integration.test.ts`

**Step 1: Write the integration test**

```typescript
import { expandCvaInPreExtracted } from '../../plugins/jsx/cva-expander.js';

describe('CVA expansion integration', () => {
  test('shadcn-style cva() expands to default combination', () => {
    const cvaRegion: ClassRegion = {
      content: `"inline-flex items-center rounded-md font-semibold", {
        variants: {
          variant: {
            default: "bg-primary text-primary-foreground",
            destructive: "bg-destructive text-destructive-foreground",
            outline: "border border-input bg-background text-foreground",
          },
          size: {
            default: "h-10 px-4 py-2 text-sm",
            sm: "h-9 px-3 text-xs",
            lg: "h-11 px-8 text-base",
          },
        },
        defaultVariants: {
          variant: "default",
          size: "default",
        },
      }`,
      startLine: 3,
      contextBg: 'bg-background',
    };

    const preExtracted = {
      files: [{ relPath: 'Button.tsx', lines: [], regions: [cvaRegion] }],
      readErrors: [],
      filesScanned: 1,
    };

    // Default mode
    const defaultResult = expandCvaInPreExtracted(preExtracted, false);
    expect(defaultResult.files[0]!.regions).toHaveLength(1);
    const defaultCombo = defaultResult.files[0]!.regions[0]!.content;
    expect(defaultCombo).toContain('inline-flex');
    expect(defaultCombo).toContain('bg-primary');
    expect(defaultCombo).toContain('text-primary-foreground');
    expect(defaultCombo).toContain('h-10');

    // All-variants mode
    const allResult = expandCvaInPreExtracted(preExtracted, true);
    expect(allResult.files[0]!.regions.length).toBeGreaterThan(1);

    const hasDestructive = allResult.files[0]!.regions.some(
      r => r.content.includes('bg-destructive'),
    );
    expect(hasDestructive).toBe(true);

    const hasOutline = allResult.files[0]!.regions.some(
      r => r.content.includes('border-input'),
    );
    expect(hasOutline).toBe(true);
  });
});
```

**Step 2: Run the test**

Run: `npx vitest run src/core/__tests__/integration.test.ts -t "CVA expansion"`
Expected: PASS

**Step 3: Commit**

```bash
git add src/core/__tests__/integration.test.ts
git commit -m "test(integration): E2E test for CVA variant expansion pipeline"
```

---

## Part C: Cross-Cutting (Tasks 19–20)

### Task 19: Update documentation

**Files:**
- Modify: `docs/LIBRARY_ARCHITECTURE.md`
- Modify: `CLAUDE.md`

**Step 1: Update CLAUDE.md**

Add to the module layout section:

- `src/core/suggestions.ts` — Suggestion engine: `extractShadeFamilies()`, `parseFamilyAndShade()`, `generateSuggestions()` (luminosity-directed walk). Post-check enrichment step.
- `src/plugins/jsx/cva-expander.ts` — CVA expansion: `extractCvaBase()`, `parseCvaVariants()`, `expandCvaToRegions()`, `expandCvaInPreExtracted()`. Post-extraction step.

Add to key design decisions the suggestion algorithm and CVA parsing approach. Update test counts.

**Step 2: Update LIBRARY_ARCHITECTURE.md**

Add sections for the new modules with their function signatures and data flow.

**Step 3: Commit**

```bash
git add docs/LIBRARY_ARCHITECTURE.md CLAUDE.md
git commit -m "docs: update architecture for Phase 4 (suggestions + CVA)"
```

---

### Task 20: Final verification — run all tests in batches

**Step 1: Run test batches**

```bash
npx vitest run src/core/__tests__/suggestions.test.ts
npx vitest run src/core/__tests__/contrast-checker.test.ts
npx vitest run src/core/__tests__/contrast-checker.property.test.ts
npx vitest run src/core/__tests__/integration.test.ts
npx vitest run src/core/__tests__/report-json.test.ts
npx vitest run src/core/__tests__/report-markdown.test.ts
npx vitest run src/config/__tests__/schema.test.ts
npx vitest run src/plugins/jsx/__tests__/cva-expander.test.ts
npx vitest run src/plugins/jsx/__tests__/categorizer.test.ts
npx vitest run src/plugins/jsx/__tests__/parser.test.ts
npx vitest run src/plugins/jsx/__tests__/region-resolver.test.ts
npm run typecheck
```

Expected: ALL PASS, typecheck clean.

**Step 2: Run Rust tests (no changes expected, verify no regression)**

```bash
cd native && cargo test
```

Expected: ~287 tests PASS (no Rust changes in Phase 4).

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address test/typecheck issues from Phase 4 integration"
```

---

## Summary

| Part | Tasks | New Files | Modified Files |
|------|-------|-----------|----------------|
| A: US-03 Suggestions | 1-10 | `suggestions.ts`, `suggestions.test.ts` | `types.ts`, `pipeline.ts`, `schema.ts`, `cli.ts`, `markdown.ts`, `report-json.test.ts`, `report-markdown.test.ts`, `integration.test.ts` |
| B: US-06 CVA | 11-18 | `cva-expander.ts`, `cva-expander.test.ts` | `types.ts`, `pipeline.ts`, `schema.ts`, `cli.ts`, `integration.test.ts` |
| C: Cross-cutting | 19-20 | none | `CLAUDE.md`, `LIBRARY_ARCHITECTURE.md` |

**Total:** 20 tasks, 4 new files, ~10 modified files. ~500 lines of new code + ~300 lines of tests.

**No Rust changes.** Both features are pure TypeScript, layered on top of the existing hybrid pipeline.

**No parser changes.** Both features operate on data already produced by the existing extraction phase. CVA expansion is a post-processing step; suggestions are a post-checking enrichment step.
