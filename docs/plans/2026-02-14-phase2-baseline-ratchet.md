# Phase 2: Quality Gate (Baseline/Ratchet) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a baseline/ratchet system that lets teams adopt a11y-audit in brownfield projects by tracking known violations and only failing CI on new ones.

**Architecture:** Content-addressable hashing (SHA-256) identifies each unique violation by file path, sorted class names, pair type, and interactive state — line numbers are excluded for refactoring stability. A leaky-bucket reconciliation annotates (not filters) each violation as `isBaseline: true/false`. Exit code is based only on new violations when baseline is active. Theme mode is NOT included in the hash; the flat baseline tracks combined counts across themes, and reconciliation runs once across all themes to correctly consume counts.

**Tech Stack:** Node.js `crypto` (SHA-256 hashing), `zod` (config schema), `vitest` (TDD), existing pipeline types. No new dependencies.

---

### Task 1: Core Types Extension

**Files:**
- Modify: `src/core/types.ts:43-53`
- Modify: `src/types/public.ts`

**Step 1: Add `isBaseline` to ContrastResult and new baseline types**

In `src/core/types.ts`, add to `ContrastResult` after the `apcaLc` field (line 52):

```typescript
  /** true = known baseline violation, false = new violation, undefined = baseline not active */
  isBaseline?: boolean;
```

Then append after `FileRegions` (after line 120):

```typescript
/** Stored baseline data: maps file → hash → violation count */
export interface BaselineData {
  version: string;
  generatedAt: string;
  violations: Record<string, Record<string, number>>;
}

/** Summary of baseline reconciliation for a single audit run */
export interface BaselineSummary {
  newCount: number;
  knownCount: number;
  fixedCount: number;
  baselineTotal: number;
}
```

**Step 2: Re-export from public.ts**

In `src/types/public.ts`, add to the re-export block:

```typescript
  // Baseline types
  BaselineData,
  BaselineSummary,
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/core/types.ts src/types/public.ts
git commit -m "feat(baseline): add isBaseline to ContrastResult and baseline types"
```

---

### Task 2: Hash Generation (TDD)

**Files:**
- Create: `src/core/baseline.ts`
- Create: `src/core/__tests__/baseline.test.ts`

**Step 1: Write failing tests for generateViolationHash**

Create `src/core/__tests__/baseline.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { generateViolationHash } from '../baseline.js';
import type { ContrastResult } from '../types.js';

function makeViolation(overrides: Partial<ContrastResult> = {}): ContrastResult {
  return {
    file: 'src/components/Button.tsx',
    line: 10,
    bgClass: 'bg-white',
    textClass: 'text-gray-500',
    bgHex: '#ffffff',
    textHex: '#6b7280',
    ratio: 3.8,
    passAA: false,
    passAALarge: true,
    passAAA: false,
    passAAALarge: false,
    ...overrides,
  };
}

describe('generateViolationHash', () => {
  test('produces a 64-char hex SHA-256 hash', () => {
    const hash = generateViolationHash(makeViolation());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('same violation produces identical hash', () => {
    const v = makeViolation();
    expect(generateViolationHash(v)).toBe(generateViolationHash(v));
  });

  test('hash is stable regardless of line number', () => {
    const v1 = makeViolation({ line: 10 });
    const v2 = makeViolation({ line: 999 });
    expect(generateViolationHash(v1)).toBe(generateViolationHash(v2));
  });

  test('hash is stable regardless of ratio value', () => {
    const v1 = makeViolation({ ratio: 3.8 });
    const v2 = makeViolation({ ratio: 5.1 });
    expect(generateViolationHash(v1)).toBe(generateViolationHash(v2));
  });

  test('hash differs when file path differs', () => {
    const v1 = makeViolation({ file: 'src/A.tsx' });
    const v2 = makeViolation({ file: 'src/B.tsx' });
    expect(generateViolationHash(v1)).not.toBe(generateViolationHash(v2));
  });

  test('hash is stable when bgClass words are reordered', () => {
    const v1 = makeViolation({ bgClass: 'bg-red-500 bg-opacity-50' });
    const v2 = makeViolation({ bgClass: 'bg-opacity-50 bg-red-500' });
    expect(generateViolationHash(v1)).toBe(generateViolationHash(v2));
  });

  test('hash differs when pairType differs', () => {
    const v1 = makeViolation({ pairType: 'text' });
    const v2 = makeViolation({ pairType: 'border' });
    expect(generateViolationHash(v1)).not.toBe(generateViolationHash(v2));
  });

  test('hash differs when interactiveState differs', () => {
    const v1 = makeViolation({ interactiveState: null });
    const v2 = makeViolation({ interactiveState: 'hover' });
    expect(generateViolationHash(v1)).not.toBe(generateViolationHash(v2));
  });

  test('undefined pairType and interactiveState have stable defaults', () => {
    const v1 = makeViolation({ pairType: undefined, interactiveState: undefined });
    const v2 = makeViolation({ pairType: undefined, interactiveState: undefined });
    expect(generateViolationHash(v1)).toBe(generateViolationHash(v2));
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/__tests__/baseline.test.ts`
Expected: FAIL — module `../baseline.js` does not exist

**Step 3: Implement generateViolationHash**

Create `src/core/baseline.ts`:

```typescript
import { createHash } from 'node:crypto';
import type { ContrastResult } from './types.js';

/**
 * Generates a content-addressable hash for a violation.
 * Excludes line numbers and ratio for refactoring stability.
 * Class names are sorted alphabetically for reordering stability.
 * Theme mode is NOT included — the flat baseline tracks combined counts.
 * @internal
 */
export function generateViolationHash(violation: ContrastResult): string {
  const bgSorted = violation.bgClass.split(/\s+/).sort().join(' ');
  const fgSorted = violation.textClass.split(/\s+/).sort().join(' ');
  const pairType = violation.pairType ?? 'text';
  const state = violation.interactiveState ?? 'base';

  const identity = [violation.file, bgSorted, fgSorted, pairType, state].join('::');

  return createHash('sha256').update(identity).digest('hex');
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/__tests__/baseline.test.ts`
Expected: PASS (all 9 tests)

**Step 5: Commit**

```bash
git add src/core/baseline.ts src/core/__tests__/baseline.test.ts
git commit -m "feat(baseline): add generateViolationHash with TDD tests"
```

---

### Task 3: Baseline Load & Save (TDD)

**Files:**
- Modify: `src/core/baseline.ts`
- Create: `src/core/__tests__/baseline.io.test.ts`

**Step 1: Write failing tests for loadBaseline and saveBaseline**

Create `src/core/__tests__/baseline.io.test.ts`:

```typescript
import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { BaselineData, ContrastResult } from '../types.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadBaseline, saveBaseline } from '../baseline.js';

function makeViolation(overrides: Partial<ContrastResult> = {}): ContrastResult {
  return {
    file: 'src/components/Button.tsx',
    line: 10,
    bgClass: 'bg-white',
    textClass: 'text-gray-500',
    bgHex: '#ffffff',
    textHex: '#6b7280',
    ratio: 3.8,
    passAA: false,
    passAALarge: true,
    passAAA: false,
    passAAALarge: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadBaseline', () => {
  test('returns null when file does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(loadBaseline('/path/.a11y-baseline.json')).toBeNull();
  });

  test('returns parsed BaselineData for valid file', () => {
    const data: BaselineData = {
      version: '1.1.0',
      generatedAt: '2026-02-14T00:00:00.000Z',
      violations: { 'src/Button.tsx': { abc123: 2 } },
    };
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(data));
    expect(loadBaseline('/path/.a11y-baseline.json')).toEqual(data);
  });

  test('returns null for invalid JSON', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('not json');
    expect(loadBaseline('/path/.a11y-baseline.json')).toBeNull();
  });

  test('returns null for JSON missing violations field', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: '1.0' }));
    expect(loadBaseline('/path/.a11y-baseline.json')).toBeNull();
  });
});

describe('saveBaseline', () => {
  test('writes JSON grouped by file with sorted file keys', () => {
    const violations = [
      makeViolation({ file: 'src/Z.tsx' }),
      makeViolation({ file: 'src/A.tsx' }),
      makeViolation({ file: 'src/Z.tsx' }),
    ];
    saveBaseline('/path/.a11y-baseline.json', violations);

    expect(writeFileSync).toHaveBeenCalledOnce();
    const content = vi.mocked(writeFileSync).mock.calls[0]![1] as string;
    const parsed = JSON.parse(content) as BaselineData;
    expect(parsed.version).toBe('1.1.0');
    expect(Object.keys(parsed.violations)).toEqual(['src/A.tsx', 'src/Z.tsx']);
  });

  test('counts duplicate hashes correctly', () => {
    const v = makeViolation();
    saveBaseline('/path/.a11y-baseline.json', [v, v]);

    const content = vi.mocked(writeFileSync).mock.calls[0]![1] as string;
    const parsed = JSON.parse(content) as BaselineData;
    const fileCounts = parsed.violations['src/components/Button.tsx']!;
    const count = Object.values(fileCounts)[0];
    expect(count).toBe(2);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/__tests__/baseline.io.test.ts`
Expected: FAIL — `loadBaseline` and `saveBaseline` are not exported

**Step 3: Implement loadBaseline and saveBaseline**

Add imports at the top of `src/core/baseline.ts`:

```typescript
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { BaselineData } from './types.js';
```

Append to `src/core/baseline.ts`:

```typescript
/**
 * Loads a baseline file from disk. Returns null if missing or invalid.
 */
export function loadBaseline(baselinePath: string): BaselineData | null {
  if (!existsSync(baselinePath)) return null;

  try {
    const raw = readFileSync(baselinePath, 'utf-8');
    const data = JSON.parse(raw) as BaselineData;
    if (!data.version || !data.violations) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Saves current violations as a baseline file.
 * Groups hashes by file for diff-friendly JSON output.
 */
export function saveBaseline(
  baselinePath: string,
  violations: ContrastResult[],
): void {
  const byFile: Record<string, Record<string, number>> = {};

  for (const violation of violations) {
    const hash = generateViolationHash(violation);
    const file = violation.file;
    byFile[file] ??= {};
    byFile[file]![hash] = (byFile[file]![hash] ?? 0) + 1;
  }

  // Sort file keys for stable, diff-friendly output
  const sorted: Record<string, Record<string, number>> = {};
  for (const file of Object.keys(byFile).sort()) {
    sorted[file] = byFile[file]!;
  }

  const data: BaselineData = {
    version: '1.1.0',
    generatedAt: new Date().toISOString(),
    violations: sorted,
  };

  writeFileSync(baselinePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/__tests__/baseline.io.test.ts`
Expected: PASS (all 6 tests)

**Step 5: Commit**

```bash
git add src/core/baseline.ts src/core/__tests__/baseline.io.test.ts
git commit -m "feat(baseline): add loadBaseline and saveBaseline with I/O tests"
```

---

### Task 4: Reconciliation Logic (TDD)

**Files:**
- Modify: `src/core/baseline.ts`
- Modify: `src/core/__tests__/baseline.test.ts`

**Step 1: Write failing tests for reconcileViolations**

Append to `src/core/__tests__/baseline.test.ts` (add imports at top):

```typescript
// Add to existing imports:
import { generateViolationHash, reconcileViolations } from '../baseline.js';
import type { BaselineData } from '../types.js';

// Add helper after makeViolation:
function buildBaseline(violations: ContrastResult[]): BaselineData {
  const hashes: Record<string, Record<string, number>> = {};
  for (const v of violations) {
    const hash = generateViolationHash(v);
    hashes[v.file] ??= {};
    hashes[v.file]![hash] = (hashes[v.file]![hash] ?? 0) + 1;
  }
  return { version: '1.1.0', generatedAt: '2026-01-01T00:00:00Z', violations: hashes };
}

// Add describe block:
describe('reconcileViolations', () => {
  test('no baseline → all violations are new', () => {
    const violations = [makeViolation(), makeViolation({ file: 'src/Other.tsx' })];
    const result = reconcileViolations(violations, null);

    expect(result.newCount).toBe(2);
    expect(result.knownCount).toBe(0);
    expect(result.fixedCount).toBe(0);
    expect(result.baselineTotal).toBe(0);
    expect(result.annotated).toHaveLength(2);
    expect(result.annotated.every(v => v.isBaseline === false)).toBe(true);
  });

  test('all violations in baseline → all are known', () => {
    const violations = [makeViolation()];
    const baseline = buildBaseline(violations);
    const result = reconcileViolations(violations, baseline);

    expect(result.newCount).toBe(0);
    expect(result.knownCount).toBe(1);
    expect(result.fixedCount).toBe(0);
    expect(result.annotated[0]!.isBaseline).toBe(true);
  });

  test('mix of new and known violations', () => {
    const known = makeViolation({ textClass: 'text-gray-400' });
    const newV = makeViolation({ textClass: 'text-red-300' });
    const baseline = buildBaseline([known]);
    const result = reconcileViolations([known, newV], baseline);

    expect(result.newCount).toBe(1);
    expect(result.knownCount).toBe(1);
  });

  test('leaky bucket: more in baseline than current → all known, zero new', () => {
    const v = makeViolation();
    const baseline = buildBaseline([v, v, v, v, v]);
    const result = reconcileViolations([v, v, v], baseline);

    expect(result.newCount).toBe(0);
    expect(result.knownCount).toBe(3);
    expect(result.fixedCount).toBe(2);
  });

  test('leaky bucket: more current than baseline → excess are new', () => {
    const v = makeViolation();
    const baseline = buildBaseline([v, v]);
    const result = reconcileViolations([v, v, v, v, v], baseline);

    expect(result.newCount).toBe(3);
    expect(result.knownCount).toBe(2);
    expect(result.fixedCount).toBe(0);
  });

  test('fixed count: baseline hashes not in current run', () => {
    const current = makeViolation({ textClass: 'text-blue-500' });
    const fixed = makeViolation({ textClass: 'text-red-500' });
    const baseline = buildBaseline([current, fixed, fixed]);
    const result = reconcileViolations([current], baseline);

    expect(result.newCount).toBe(0);
    expect(result.knownCount).toBe(1);
    expect(result.fixedCount).toBe(2);
  });

  test('empty current with non-empty baseline → all fixed', () => {
    const baseline = buildBaseline([makeViolation(), makeViolation()]);
    const result = reconcileViolations([], baseline);

    expect(result.newCount).toBe(0);
    expect(result.knownCount).toBe(0);
    expect(result.fixedCount).toBe(2);
  });

  test('preserves input order of violations', () => {
    const v1 = makeViolation({ textClass: 'text-red-500', line: 1 });
    const v2 = makeViolation({ textClass: 'text-blue-500', line: 2 });
    const v3 = makeViolation({ textClass: 'text-green-500', line: 3 });
    const result = reconcileViolations([v1, v2, v3], null);

    expect(result.annotated[0]!.line).toBe(1);
    expect(result.annotated[1]!.line).toBe(2);
    expect(result.annotated[2]!.line).toBe(3);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/__tests__/baseline.test.ts`
Expected: FAIL — `reconcileViolations` is not exported

**Step 3: Implement reconcileViolations**

Add import at top of `src/core/baseline.ts`:

```typescript
import type { BaselineData, BaselineSummary } from './types.js';
```

Append to `src/core/baseline.ts`:

```typescript
export interface ReconciliationResult extends BaselineSummary {
  annotated: ContrastResult[];
}

/**
 * Annotates each violation as baseline (known) or new.
 * Uses leaky-bucket counting: per hash, consumes baseline count in input order.
 * Preserves input array order for downstream theme redistribution.
 */
export function reconcileViolations(
  violations: ContrastResult[],
  baseline: BaselineData | null,
): ReconciliationResult {
  if (!baseline) {
    return {
      annotated: violations.map(v => ({ ...v, isBaseline: false })),
      newCount: violations.length,
      knownCount: 0,
      fixedCount: 0,
      baselineTotal: 0,
    };
  }

  // Compute baseline total
  const baselineTotal = Object.values(baseline.violations)
    .reduce((sum, fileHashes) =>
      sum + Object.values(fileHashes).reduce((s, c) => s + c, 0), 0);

  // Flatten baseline into hash → remaining count
  const remainingCounts = new Map<string, number>();
  for (const fileHashes of Object.values(baseline.violations)) {
    for (const [hash, count] of Object.entries(fileHashes)) {
      remainingCounts.set(hash, (remainingCounts.get(hash) ?? 0) + count);
    }
  }

  let newCount = 0;
  let knownCount = 0;
  const annotated: ContrastResult[] = [];

  for (const v of violations) {
    const hash = generateViolationHash(v);
    const remaining = remainingCounts.get(hash) ?? 0;

    if (remaining > 0) {
      annotated.push({ ...v, isBaseline: true });
      remainingCounts.set(hash, remaining - 1);
      knownCount++;
    } else {
      annotated.push({ ...v, isBaseline: false });
      newCount++;
    }
  }

  // Remaining baseline entries are fixed violations
  let fixedCount = 0;
  for (const count of remainingCounts.values()) {
    fixedCount += count;
  }

  return { annotated, newCount, knownCount, fixedCount, baselineTotal };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/__tests__/baseline.test.ts`
Expected: PASS (all 17 tests — 9 hash + 8 reconciliation)

**Step 5: Commit**

```bash
git add src/core/baseline.ts src/core/__tests__/baseline.test.ts
git commit -m "feat(baseline): add reconcileViolations with leaky-bucket algorithm"
```

---

### Task 5: Config Schema Extension (TDD)

**Files:**
- Modify: `src/config/schema.ts:38`
- Modify: `src/config/__tests__/schema.test.ts`

**Step 1: Write failing tests for baseline config**

Append to the describe block in `src/config/__tests__/schema.test.ts`:

```typescript
  it('defaults baseline to undefined when not provided', () => {
    const result = auditConfigSchema.parse({});
    expect(result.baseline).toBeUndefined();
  });

  it('accepts baseline with defaults', () => {
    const result = auditConfigSchema.parse({ baseline: {} });
    expect(result.baseline).toEqual({
      enabled: false,
      path: '.a11y-baseline.json',
    });
  });

  it('accepts baseline with overrides', () => {
    const result = auditConfigSchema.parse({
      baseline: { enabled: true, path: 'custom-baseline.json' },
    });
    expect(result.baseline!.enabled).toBe(true);
    expect(result.baseline!.path).toBe('custom-baseline.json');
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/__tests__/schema.test.ts`
Expected: FAIL — baseline field unrecognized

**Step 3: Add baseline to Zod schema**

In `src/config/schema.ts`, add before the closing `})` of `auditConfigSchema` (before line 39):

```typescript
  /** Baseline configuration for brownfield adoption */
  baseline: z.object({
    /** Enable baseline reconciliation */
    enabled: z.boolean().default(false),
    /** Path to baseline file (relative to project root) */
    path: z.string().default('.a11y-baseline.json'),
  }).optional(),
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/config/__tests__/schema.test.ts`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add src/config/schema.ts src/config/__tests__/schema.test.ts
git commit -m "feat(baseline): add baseline config to Zod schema"
```

---

### Task 6: Pipeline Integration

**Files:**
- Modify: `src/core/pipeline.ts`

**Step 1: Add imports and extend interfaces**

Add imports at the top of `src/core/pipeline.ts`:

```typescript
import { loadBaseline, saveBaseline, reconcileViolations } from './baseline.js';
import type { BaselineSummary } from './types.js';
```

Add to `PipelineOptions` (after `verbose` field, line 57):

```typescript
  /** Baseline configuration */
  baseline?: {
    enabled: boolean;
    path: string;
    updateBaseline: boolean;
    failOnImprovement: boolean;
  };
```

Add to `AuditRunResult` (after `totalViolations`, line 25):

```typescript
  /** Present when baseline reconciliation was performed */
  baselineSummary?: BaselineSummary;
  /** true when --update-baseline was used and baseline file was written */
  baselineUpdated?: boolean;
```

**Step 2: Insert baseline handling in runAudit**

After the themes `for` loop (after line 153 `results.push({ mode, result });`), before Phase 4 comment (line 155), insert:

```typescript
  // Phase 3.5: Baseline — save or reconcile
  let baselineSummary: BaselineSummary | undefined;
  let baselineUpdated = false;

  if (options.baseline) {
    const resolvedPath = resolve(cwd, options.baseline.path);

    if (options.baseline.updateBaseline) {
      log(verbose, '[a11y-audit] Updating baseline...');
      const allViolations = results.flatMap(r => r.result.violations);
      saveBaseline(resolvedPath, allViolations);
      log(verbose, `  Baseline updated: ${allViolations.length} violations across ${new Set(allViolations.map(v => v.file)).size} files`);
      log(verbose, `  Saved to: ${options.baseline.path}`);
      baselineUpdated = true;
    } else if (options.baseline.enabled) {
      log(verbose, '[a11y-audit] Loading baseline...');
      const baseline = loadBaseline(resolvedPath);

      if (baseline) {
        const allViolations = results.flatMap(r => r.result.violations);
        const reconciled = reconcileViolations(allViolations, baseline);

        // Distribute annotated violations back to their themes
        let offset = 0;
        for (const themed of results) {
          const count = themed.result.violations.length;
          themed.result.violations = reconciled.annotated.slice(offset, offset + count);
          offset += count;
        }

        baselineSummary = {
          newCount: reconciled.newCount,
          knownCount: reconciled.knownCount,
          fixedCount: reconciled.fixedCount,
          baselineTotal: reconciled.baselineTotal,
        };
        log(verbose, `  Baseline: ${reconciled.baselineTotal} total, ${reconciled.newCount} new, ${reconciled.knownCount} known, ${reconciled.fixedCount} fixed`);
      } else {
        log(verbose, '  ⚠ Baseline file not found — all violations treated as new');
      }
    }
  }
```

**Step 3: Pass baselineSummary to report generators and update return**

Modify report generation (line 157-159):

```typescript
  const report = format === 'json'
    ? generateJsonReport(results, baselineSummary)
    : generateReport(results, baselineSummary);
```

Update return statement (line 171):

```typescript
  return { results, report, totalViolations, baselineSummary, baselineUpdated };
```

> **Note:** The report functions don't accept `baselineSummary` yet — this will cause a typecheck error until Tasks 8-9 are complete. That's expected. Alternatively, temporarily cast: `generateJsonReport(results, baselineSummary as never)` and add a `// FIXME: remove cast after Task 8` comment.

**Step 4: Run typecheck (expect known errors in report calls)**

Run: `npm run typecheck`
Expected: 2 errors in report function calls (parameter count mismatch). These will be fixed in Tasks 8-9.

**Step 5: Commit**

```bash
git add src/core/pipeline.ts
git commit -m "feat(baseline): integrate baseline reconciliation into pipeline"
```

---

### Task 7: CLI Flags + Exit Code

**Files:**
- Modify: `src/bin/cli.ts`

**Step 1: Add CLI flags**

After line 24 (`--verbose` option), before `.action`, add:

```typescript
  .option('--update-baseline', 'Generate or update the baseline file')
  .option('--baseline-path <path>', 'Override baseline file path')
  .option('--fail-on-improvement', 'Fail CI if fewer violations than baseline (forces baseline update)')
```

**Step 2: Build baseline config and pass to pipeline**

In the action handler, after the `verbose` variable (line 40), add:

```typescript
      const updateBaseline: boolean = opts.updateBaseline === true;
      const failOnImprovement: boolean = opts.failOnImprovement === true;
      const baselinePath: string =
        (opts.baselinePath as string | undefined) ?? fileConfig.baseline?.path ?? '.a11y-baseline.json';
      const baselineEnabled: boolean = fileConfig.baseline?.enabled ?? false;
```

In the `pipelineOpts` object (add before the closing `}`):

```typescript
        baseline: (baselineEnabled || updateBaseline) ? {
          enabled: baselineEnabled,
          path: baselinePath,
          updateBaseline,
          failOnImprovement,
        } : undefined,
```

**Step 3: Replace exit code logic**

Replace lines 67-74 (the current exit code block) with:

```typescript
      const { totalViolations, baselineSummary, baselineUpdated } = runAudit(pipelineOpts);

      if (baselineUpdated) {
        console.log(`[a11y-audit] Baseline updated: ${totalViolations} violations baselined.`);
        process.exit(0);
      }

      if (baselineSummary) {
        if (failOnImprovement && totalViolations < baselineSummary.baselineTotal) {
          console.log(
            `[a11y-audit] Baseline is stale: ${totalViolations} current vs ${baselineSummary.baselineTotal} baselined.`,
          );
          console.log('[a11y-audit] Run with --update-baseline to refresh.');
          process.exit(1);
        }
        if (baselineSummary.newCount > 0) {
          console.log(
            `[a11y-audit] ${baselineSummary.newCount} NEW violations (${baselineSummary.knownCount} baselined, ${baselineSummary.fixedCount} fixed).`,
          );
          process.exit(1);
        }
        console.log(
          `[a11y-audit] No new violations. ${baselineSummary.knownCount} baselined, ${baselineSummary.fixedCount} fixed.`,
        );
      } else {
        if (totalViolations > 0) {
          console.log(`[a11y-audit] ${totalViolations} total violations found.`);
          process.exit(1);
        }
        console.log('[a11y-audit] All checks passed!');
      }
```

**Step 4: Commit**

```bash
git add src/bin/cli.ts
git commit -m "feat(baseline): add CLI flags and baseline-aware exit code logic"
```

---

### Task 8: JSON Report Extension (TDD)

**Files:**
- Modify: `src/core/report/json.ts`
- Create: `src/core/__tests__/report-json.test.ts`

**Step 1: Write failing tests**

Create `src/core/__tests__/report-json.test.ts`:

```typescript
import { describe, test, expect, vi } from 'vitest';
import { generateJsonReport } from '../report/json.js';
import type { AuditResult, BaselineSummary, ContrastResult, ThemeMode } from '../types.js';

function makeViolation(overrides: Partial<ContrastResult> = {}): ContrastResult {
  return {
    file: 'src/Button.tsx',
    line: 10,
    bgClass: 'bg-white',
    textClass: 'text-gray-500',
    bgHex: '#ffffff',
    textHex: '#6b7280',
    ratio: 3.8,
    passAA: false,
    passAALarge: true,
    passAAA: false,
    passAAALarge: false,
    ...overrides,
  };
}

function makeResult(violations: ContrastResult[] = []): AuditResult {
  return {
    filesScanned: 1,
    pairsChecked: violations.length,
    violations,
    passed: [],
    skipped: [],
    ignored: [],
  };
}

describe('generateJsonReport with baseline', () => {
  test('includes baseline summary when provided', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-14T12:00:00Z'));

    const results = [{
      mode: 'light' as ThemeMode,
      result: makeResult([
        makeViolation({ isBaseline: true }),
        makeViolation({ isBaseline: false, textClass: 'text-red-500' }),
      ]),
    }];
    const summary: BaselineSummary = { newCount: 1, knownCount: 1, fixedCount: 3, baselineTotal: 4 };

    const json = JSON.parse(generateJsonReport(results, summary));
    expect(json.summary.newViolations).toBe(1);
    expect(json.summary.baselineViolations).toBe(1);
    expect(json.summary.fixedViolations).toBe(3);

    vi.useRealTimers();
  });

  test('omits baseline fields when no summary provided', () => {
    const results = [{ mode: 'light' as ThemeMode, result: makeResult([makeViolation()]) }];
    const json = JSON.parse(generateJsonReport(results));
    expect(json.summary.newViolations).toBeUndefined();
  });

  test('preserves isBaseline on violation objects in output', () => {
    const results = [{
      mode: 'light' as ThemeMode,
      result: makeResult([makeViolation({ isBaseline: true })]),
    }];
    const summary: BaselineSummary = { newCount: 0, knownCount: 1, fixedCount: 0, baselineTotal: 1 };
    const json = JSON.parse(generateJsonReport(results, summary));
    expect(json.themes[0].violations[0].isBaseline).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/report-json.test.ts`
Expected: FAIL — `generateJsonReport` doesn't accept second argument

**Step 3: Modify generateJsonReport**

In `src/core/report/json.ts`, update the import:

```typescript
import type { AuditResult, BaselineSummary, ThemeMode } from '../types.js';
```

Change function signature:

```typescript
export function generateJsonReport(
  results: ThemedAuditResult[],
  baselineSummary?: BaselineSummary,
): string {
```

In the `summary` object inside `JSON.stringify`, add after `totalIgnored`:

```typescript
        ...(baselineSummary ? {
          newViolations: baselineSummary.newCount,
          baselineViolations: baselineSummary.knownCount,
          fixedViolations: baselineSummary.fixedCount,
        } : {}),
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/__tests__/report-json.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/core/report/json.ts src/core/__tests__/report-json.test.ts
git commit -m "feat(baseline): extend JSON report with baseline summary fields"
```

---

### Task 9: Markdown Report Extension (TDD)

**Files:**
- Modify: `src/core/report/markdown.ts`
- Create: `src/core/__tests__/report-markdown.test.ts`

**Step 1: Write failing tests**

Create `src/core/__tests__/report-markdown.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { generateReport } from '../report/markdown.js';
import type { AuditResult, BaselineSummary, ContrastResult, ThemeMode } from '../types.js';

function makeViolation(overrides: Partial<ContrastResult> = {}): ContrastResult {
  return {
    file: 'src/Button.tsx',
    line: 10,
    bgClass: 'bg-white',
    textClass: 'text-gray-500',
    bgHex: '#ffffff',
    textHex: '#6b7280',
    ratio: 3.8,
    passAA: false,
    passAALarge: true,
    passAAA: false,
    passAAALarge: false,
    ...overrides,
  };
}

function makeResult(violations: ContrastResult[] = []): AuditResult {
  return {
    filesScanned: 1,
    pairsChecked: violations.length,
    violations,
    passed: [],
    skipped: [],
    ignored: [],
  };
}

describe('generateReport with baseline', () => {
  test('shows baseline summary rows when baselineSummary provided', () => {
    const summary: BaselineSummary = { newCount: 2, knownCount: 5, fixedCount: 1, baselineTotal: 6 };
    const results = [{
      mode: 'light' as ThemeMode,
      result: makeResult([
        makeViolation({ isBaseline: false }),
        makeViolation({ isBaseline: false, textClass: 'text-red-500' }),
        makeViolation({ isBaseline: true, textClass: 'text-blue-300' }),
      ]),
    }];
    const report = generateReport(results, summary);
    expect(report).toContain('**New violations**');
    expect(report).toContain('Baseline violations');
    expect(report).toContain('Fixed since baseline');
  });

  test('separates new and baseline violations into distinct sections', () => {
    const summary: BaselineSummary = { newCount: 1, knownCount: 1, fixedCount: 0, baselineTotal: 1 };
    const results = [{
      mode: 'light' as ThemeMode,
      result: makeResult([
        makeViolation({ isBaseline: false, textClass: 'text-red-500' }),
        makeViolation({ isBaseline: true, textClass: 'text-blue-300' }),
      ]),
    }];
    const report = generateReport(results, summary);
    expect(report).toContain('New Violations');
    expect(report).toContain('Baseline Violations');
  });

  test('uses collapsible details for baseline violations', () => {
    const summary: BaselineSummary = { newCount: 0, knownCount: 1, fixedCount: 0, baselineTotal: 1 };
    const results = [{
      mode: 'light' as ThemeMode,
      result: makeResult([makeViolation({ isBaseline: true })]),
    }];
    const report = generateReport(results, summary);
    expect(report).toContain('<details>');
    expect(report).toContain('</details>');
  });

  test('omits baseline sections when no summary provided (backward compatible)', () => {
    const results = [{
      mode: 'light' as ThemeMode,
      result: makeResult([makeViolation()]),
    }];
    const report = generateReport(results);
    expect(report).not.toContain('New Violations');
    expect(report).not.toContain('Baseline Violations');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/report-markdown.test.ts`
Expected: FAIL

**Step 3: Modify generateReport**

In `src/core/report/markdown.ts`:

Update import:

```typescript
import type { AuditResult, BaselineSummary, ContrastResult, IgnoredViolation, ThemeMode } from '../types.js';
```

Change function signature:

```typescript
export function generateReport(
  results: ThemedAuditResult[],
  baselineSummary?: BaselineSummary,
): string {
```

**3a.** In the summary table (after line 58), add baseline rows:

```typescript
  if (baselineSummary) {
    lines.push(`| **New violations** | **${baselineSummary.newCount}** |`);
    lines.push(`| Baseline violations | ${baselineSummary.knownCount} |`);
    lines.push(`| Fixed since baseline | ${baselineSummary.fixedCount} |`);
  }
```

**3b.** Extract the existing text-violation and non-text-violation table rendering into helper functions to avoid duplication. Add before `generateReport`:

```typescript
function renderTextViolationTable(
  violations: ContrastResult[],
  lines: string[],
  trackAnnotations: { value: boolean },
): void {
  const grouped = groupByFile(violations);
  for (const [file, fileViolations] of grouped) {
    lines.push(`### \`${file}\``);
    lines.push('');
    lines.push('| Line | State | Background | Foreground | Size | Ratio | AA | AAA | AA Large | APCA Lc |');
    lines.push('|------|:-----:|-----------|------------|:----:|------:|:---:|:---:|:--------:|--------:|');
    for (const v of fileViolations) {
      const stateLabel = v.interactiveState ?? 'base';
      const annotationMark = v.contextSource === 'annotation' ? '†' : '';
      if (annotationMark) trackAnnotations.value = true;
      const bgLabel = `${v.bgClass}${annotationMark} (${v.bgHex})`;
      const fgLabel = `${v.textClass} (${v.textHex})`;
      const sizeLabel = v.isLargeText ? 'LARGE' : 'normal';
      const aaIcon = v.passAA ? 'PASS' : '**FAIL**';
      const aaaIcon = v.passAAA ? 'PASS' : '**FAIL**';
      const aaLargeIcon = v.passAALarge ? 'PASS' : '**FAIL**';
      const apcaLabel = v.apcaLc != null ? `${v.apcaLc}` : '—';
      lines.push(
        `| ${v.line} | ${stateLabel} | ${bgLabel} | ${fgLabel} | ${sizeLabel} | ${v.ratio}:1 | ${aaIcon} | ${aaaIcon} | ${aaLargeIcon} | ${apcaLabel} |`
      );
    }
    lines.push('');
  }
}

function renderNonTextViolationTable(
  violations: ContrastResult[],
  lines: string[],
  trackAnnotations: { value: boolean },
): void {
  const grouped = groupByFile(violations);
  for (const [file, fileViolations] of grouped) {
    lines.push(`### \`${file}\``);
    lines.push('');
    lines.push('| Line | State | Type | Element | Against | Ratio | 3:1 |');
    lines.push('|------|:-----:|:----:|---------|---------|------:|:---:|');
    for (const v of fileViolations) {
      const stateLabel = v.interactiveState ?? 'base';
      const typeLabel = v.pairType ?? 'border';
      const annotationMark = v.contextSource === 'annotation' ? '†' : '';
      if (annotationMark) trackAnnotations.value = true;
      const elementLabel = `${v.textClass} (${v.textHex})`;
      const againstLabel = `${v.bgClass}${annotationMark} (${v.bgHex})`;
      const passIcon = v.passAALarge ? 'PASS' : '**FAIL**';
      lines.push(
        `| ${v.line} | ${stateLabel} | ${typeLabel} | ${elementLabel} | ${againstLabel} | ${v.ratio}:1 | ${passIcon} |`
      );
    }
    lines.push('');
  }
}
```

**3c.** Replace the per-theme rendering section (lines 62-140) with baseline-aware logic. Use a ref object to track annotation marks across calls:

```typescript
  const trackAnnotations = { value: false };

  for (const { mode, result } of results) {
    const modeLabel = mode === 'light' ? 'Light Mode' : 'Dark Mode';
    const icon = mode === 'light' ? '☀️' : '🌙';

    const textViolations = result.violations.filter((v) => !v.pairType || v.pairType === 'text');
    const nonTextViolations = result.violations.filter((v) => v.pairType && v.pairType !== 'text');

    if (baselineSummary) {
      // ── TEXT: New Violations ──
      const newText = textViolations.filter(v => v.isBaseline !== true);
      lines.push(`## ${icon} ${modeLabel} — New Violations — Text Contrast (SC 1.4.3)`);
      lines.push('');
      if (newText.length === 0) {
        lines.push('No new text contrast violations.');
        lines.push('');
      } else {
        renderTextViolationTable(newText, lines, trackAnnotations);
      }

      // ── TEXT: Baseline Violations (collapsible) ──
      const baselineText = textViolations.filter(v => v.isBaseline === true);
      if (baselineText.length > 0) {
        lines.push(`<details>`);
        lines.push(`<summary>${icon} ${modeLabel} — Baseline Violations — Text Contrast (SC 1.4.3) (${baselineText.length})</summary>`);
        lines.push('');
        renderTextViolationTable(baselineText, lines, trackAnnotations);
        lines.push(`</details>`);
        lines.push('');
      }

      // ── NON-TEXT: New Violations ──
      const newNonText = nonTextViolations.filter(v => v.isBaseline !== true);
      lines.push(`## ${icon} ${modeLabel} — New Violations — Non-Text Contrast (SC 1.4.11)`);
      lines.push('');
      if (newNonText.length === 0) {
        lines.push('No new non-text contrast violations.');
        lines.push('');
      } else {
        renderNonTextViolationTable(newNonText, lines, trackAnnotations);
      }

      // ── NON-TEXT: Baseline Violations (collapsible) ──
      const baselineNonText = nonTextViolations.filter(v => v.isBaseline === true);
      if (baselineNonText.length > 0) {
        lines.push(`<details>`);
        lines.push(`<summary>${icon} ${modeLabel} — Baseline Violations — Non-Text Contrast (SC 1.4.11) (${baselineNonText.length})</summary>`);
        lines.push('');
        renderNonTextViolationTable(baselineNonText, lines, trackAnnotations);
        lines.push(`</details>`);
        lines.push('');
      }
    } else {
      // ── Original rendering (no baseline) ──
      lines.push(`## ${icon} ${modeLabel} — Text Contrast (SC 1.4.3)`);
      lines.push('');
      if (textViolations.length === 0) {
        lines.push('No text contrast violations found.');
        lines.push('');
      } else {
        renderTextViolationTable(textViolations, lines, trackAnnotations);
      }

      lines.push(`## ${icon} ${modeLabel} — Non-Text Contrast (SC 1.4.11)`);
      lines.push('');
      if (nonTextViolations.length === 0) {
        lines.push('No non-text contrast violations found.');
        lines.push('');
      } else {
        renderNonTextViolationTable(nonTextViolations, lines, trackAnnotations);
      }
    }
  }

  // Replace `hasAnnotatedPairs` references below with `trackAnnotations.value`
```

Update the annotation footnote (line 196) to use `trackAnnotations.value` instead of `hasAnnotatedPairs`.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/__tests__/report-markdown.test.ts`
Expected: PASS (4 tests)

**Step 5: Run existing integration tests for regression**

Run: `npx vitest run src/core/__tests__/integration.test.ts`
Expected: PASS (backward compatible — no baselineSummary passed)

**Step 6: Commit**

```bash
git add src/core/report/markdown.ts src/core/__tests__/report-markdown.test.ts
git commit -m "feat(baseline): split markdown report into new vs baseline sections"
```

---

### Task 10: End-to-End Integration Test + Documentation

**Files:**
- Create: `src/core/__tests__/baseline-integration.test.ts`
- Modify: `docs/LIBRARY_ARCHITECTURE.md`
- Modify: `CLAUDE.md`

**Step 1: Write round-trip integration test**

Create `src/core/__tests__/baseline-integration.test.ts`:

```typescript
import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { ContrastResult, BaselineData } from '../types.js';
import {
  generateViolationHash,
  loadBaseline,
  saveBaseline,
  reconcileViolations,
} from '../baseline.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

function makeViolation(overrides: Partial<ContrastResult> = {}): ContrastResult {
  return {
    file: 'src/components/Button.tsx',
    line: 10,
    bgClass: 'bg-white',
    textClass: 'text-gray-500',
    bgHex: '#ffffff',
    textHex: '#6b7280',
    ratio: 3.8,
    passAA: false,
    passAALarge: true,
    passAAA: false,
    passAAALarge: false,
    ...overrides,
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('baseline round-trip integration', () => {
  test('save → load → reconcile preserves all known violations', () => {
    const violations = [
      makeViolation({ textClass: 'text-gray-400' }),
      makeViolation({ textClass: 'text-gray-500' }),
      makeViolation({ textClass: 'text-red-300', file: 'src/Header.tsx' }),
    ];

    let savedJson = '';
    vi.mocked(writeFileSync).mockImplementation((_p, content) => { savedJson = content as string; });
    saveBaseline('/path/baseline.json', violations);

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(savedJson);
    const baseline = loadBaseline('/path/baseline.json');
    expect(baseline).not.toBeNull();

    const result = reconcileViolations(violations, baseline!);
    expect(result.newCount).toBe(0);
    expect(result.knownCount).toBe(3);
    expect(result.fixedCount).toBe(0);
    expect(result.annotated.every(v => v.isBaseline === true)).toBe(true);
  });

  test('save → add violation → reconcile detects the new one', () => {
    const original = [makeViolation({ textClass: 'text-gray-400' })];

    let savedJson = '';
    vi.mocked(writeFileSync).mockImplementation((_p, content) => { savedJson = content as string; });
    saveBaseline('/path/baseline.json', original);

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(savedJson);
    const baseline = loadBaseline('/path/baseline.json')!;

    const current = [...original, makeViolation({ textClass: 'text-red-500' })];
    const result = reconcileViolations(current, baseline);
    expect(result.newCount).toBe(1);
    expect(result.knownCount).toBe(1);
    expect(result.fixedCount).toBe(0);
  });

  test('save → fix violation → reconcile detects the fix', () => {
    const original = [
      makeViolation({ textClass: 'text-gray-400' }),
      makeViolation({ textClass: 'text-red-500' }),
    ];

    let savedJson = '';
    vi.mocked(writeFileSync).mockImplementation((_p, content) => { savedJson = content as string; });
    saveBaseline('/path/baseline.json', original);

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(savedJson);
    const baseline = loadBaseline('/path/baseline.json')!;

    const current = [makeViolation({ textClass: 'text-gray-400' })];
    const result = reconcileViolations(current, baseline);
    expect(result.newCount).toBe(0);
    expect(result.knownCount).toBe(1);
    expect(result.fixedCount).toBe(1);
  });

  test('multi-theme: violations from both themes consume counts correctly', () => {
    // Simulate: same element fails in light + dark → count 2 in baseline
    const v = makeViolation();

    let savedJson = '';
    vi.mocked(writeFileSync).mockImplementation((_p, content) => { savedJson = content as string; });
    saveBaseline('/path/baseline.json', [v, v]); // 2 copies (light + dark)

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(savedJson);
    const baseline = loadBaseline('/path/baseline.json')!;

    // Current run: same element still fails in both themes
    const result = reconcileViolations([v, v], baseline);
    expect(result.knownCount).toBe(2);
    expect(result.newCount).toBe(0);
    expect(result.fixedCount).toBe(0);
  });
});
```

**Step 2: Run all baseline tests**

Run: `npx vitest run src/core/__tests__/baseline.test.ts src/core/__tests__/baseline.io.test.ts src/core/__tests__/baseline-integration.test.ts`
Expected: PASS

**Step 3: Run full typecheck**

Run: `npm run typecheck`
Expected: PASS (all report functions now accept baselineSummary)

**Step 4: Run broader test suites for regression**

Run: `npx vitest run src/core/__tests__/`
Expected: PASS

Run: `npx vitest run src/config/__tests__/`
Expected: PASS

**Step 5: Update documentation**

In `docs/LIBRARY_ARCHITECTURE.md`, add a new section for the baseline system covering:
- `src/core/baseline.ts` module: `generateViolationHash()`, `loadBaseline()`, `saveBaseline()`, `reconcileViolations()`
- Hash strategy (SHA-256, no line numbers, sorted classes, no theme mode)
- Leaky-bucket reconciliation algorithm
- BaselineData JSON structure (per-file grouping, diff-friendly)
- Config: `baseline.enabled`, `baseline.path`
- CLI: `--update-baseline`, `--baseline-path`, `--fail-on-improvement`
- Exit code logic (new violations only when baseline active)

In `CLAUDE.md`, update:
- Add `src/core/baseline.ts` to module layout section
- Update test count to include new baseline tests
- Add baseline CLI usage example to CLI Usage section
- Add `baseline-integration.test.ts`, `baseline.io.test.ts`, `report-json.test.ts`, `report-markdown.test.ts` to testing info

**Step 6: Final commit**

```bash
git add src/core/__tests__/baseline-integration.test.ts docs/LIBRARY_ARCHITECTURE.md CLAUDE.md
git commit -m "feat(baseline): Phase 2 complete — end-to-end tests and documentation"
```
