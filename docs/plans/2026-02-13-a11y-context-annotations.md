# @a11y-context Annotations — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add comment-based context override annotations (`@a11y-context` and `@a11y-context-block`) so users can correct false positives/negatives caused by absolute positioning, React Portals, and currentColor.

**Architecture:** Two new annotation forms parsed by the existing JSX state machine. Single-element annotations attach to the next `ClassRegion`; block annotations push onto the existing `contextStack`. The region resolver uses overrides instead of inferred bg/fg values. Reports mark overridden pairs.

**Tech Stack:** TypeScript, vitest, regex parsing (no AST), existing `contextStack` in parser.ts.

**Design doc:** `docs/plans/2026-02-13-a11y-context-annotations-design.md`

---

### Task 1: Add ContextOverride type to core types

**Files:**
- Modify: `src/core/types.ts:88-99` (ClassRegion interface)
- Modify: `src/core/types.ts:40-51` (ContrastResult interface)

**Step 1: Add ContextOverride interface and update ClassRegion**

In `src/core/types.ts`, after the `ConformanceLevel` type (line 86) and before `ClassRegion` (line 88), add:

```typescript
/** Context override from @a11y-context or @a11y-context-block annotation */
export interface ContextOverride {
  /** Tailwind class (e.g. 'bg-slate-900') or hex literal (e.g. '#09090b') */
  bg?: string;
  /** Tailwind class (e.g. 'text-white') or hex literal (e.g. '#ffffff') */
  fg?: string;
  /** When true, children of this block do not inherit the override */
  noInherit?: boolean;
}
```

Add to `ClassRegion`:

```typescript
/** Context override from an @a11y-context annotation on the same/preceding line */
contextOverride?: ContextOverride;
```

Add to `ContrastResult`:

```typescript
/** 'inferred' = bg determined by parser stack, 'annotation' = overridden via @a11y-context */
contextSource?: 'inferred' | 'annotation';
```

**Step 2: Export ContextOverride from public types**

In `src/types/public.ts`, add `ContextOverride` to the re-export list.

In `src/index.ts`, add `ContextOverride` to the type re-export.

**Step 3: Run typecheck to verify no errors**

Run: `npm run typecheck`
Expected: PASS (no errors — new types are additive)

**Step 4: Commit**

```
git add src/core/types.ts src/types/public.ts src/index.ts
git commit -m "feat: add ContextOverride type to core types"
```

---

### Task 2: Parse @a11y-context annotations in categorizer

**Files:**
- Modify: `src/plugins/jsx/categorizer.ts:583-605` (add new function after a11y-ignore section)
- Modify: `src/plugins/jsx/__tests__/categorizer.test.ts` (append new describe block)

**Step 1: Write the failing tests**

Append to `src/plugins/jsx/__tests__/categorizer.test.ts`. Import `getContextOverrideForLine` from `../categorizer.js` and `ContextOverride` from `../../../core/types.js`:

```typescript
describe('getContextOverrideForLine', () => {
  test('returns null when no annotation present', () => {
    const lines = ['<div className="text-white">hello</div>'];
    expect(getContextOverrideForLine(lines, 1)).toBeNull();
  });

  test('parses bg: with Tailwind class on same line', () => {
    const lines = ['// @a11y-context bg:bg-slate-900'];
    const result = getContextOverrideForLine(lines, 1);
    expect(result).toEqual({ bg: 'bg-slate-900' });
  });

  test('parses bg: with hex literal', () => {
    const lines = ['// @a11y-context bg:#09090b'];
    const result = getContextOverrideForLine(lines, 1);
    expect(result).toEqual({ bg: '#09090b' });
  });

  test('parses fg: parameter', () => {
    const lines = ['{/* @a11y-context fg:text-white */}'];
    const result = getContextOverrideForLine(lines, 1);
    expect(result).toEqual({ fg: 'text-white' });
  });

  test('parses bg: + fg: together', () => {
    const lines = ['{/* @a11y-context bg:#09090b fg:text-white */}'];
    const result = getContextOverrideForLine(lines, 1);
    expect(result).toEqual({ bg: '#09090b', fg: 'text-white' });
  });

  test('parses no-inherit flag', () => {
    const lines = ['{/* @a11y-context-block bg:bg-background no-inherit */}'];
    const result = getContextOverrideForLine(lines, 1);
    expect(result).toEqual({ bg: 'bg-background', noInherit: true });
  });

  test('detects annotation on previous line', () => {
    const lines = [
      '// @a11y-context bg:bg-slate-900',
      '<span className="text-white">Badge</span>',
    ];
    const result = getContextOverrideForLine(lines, 2);
    expect(result).toEqual({ bg: 'bg-slate-900' });
  });

  test('returns null for line out of bounds', () => {
    const lines = ['hello'];
    expect(getContextOverrideForLine(lines, 0)).toBeNull();
    expect(getContextOverrideForLine(lines, 5)).toBeNull();
  });

  test('does not match a11y-ignore (separate directive)', () => {
    const lines = ['// a11y-ignore: decorative'];
    expect(getContextOverrideForLine(lines, 1)).toBeNull();
  });

  test('returns null when annotation has no bg or fg params', () => {
    const lines = ['// @a11y-context no-inherit'];
    const result = getContextOverrideForLine(lines, 1);
    expect(result).toBeNull();
  });

  test('parses JSX block comment with @a11y-context-block', () => {
    const lines = ['{/* @a11y-context-block bg:bg-card */}'];
    const result = getContextOverrideForLine(lines, 1);
    expect(result).toEqual({ bg: 'bg-card' });
  });

  test('parameters are order-independent', () => {
    const lines = ['// @a11y-context fg:text-white bg:#000000 no-inherit'];
    const result = getContextOverrideForLine(lines, 1);
    expect(result).toEqual({ bg: '#000000', fg: 'text-white', noInherit: true });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/plugins/jsx/__tests__/categorizer.test.ts -t "getContextOverrideForLine"`
Expected: FAIL — `getContextOverrideForLine` is not exported from categorizer.js

**Step 3: Implement getContextOverrideForLine**

In `src/plugins/jsx/categorizer.ts`, add import at top:

```typescript
import type { ContextOverride } from '../../core/types.js';
```

After the `getIgnoreReasonForLine` function (line 605), add:

```typescript
// ── @a11y-context annotation detection ────────────────────────────────

// Matches: // @a11y-context ..., {/* @a11y-context ... */}, // @a11y-context-block ...
const A11Y_CONTEXT_REGEX =
  /(?:\/\/|\/\*)\s*@a11y-context(?:-block)?\s+(.*?)(?:\s*\*\/\s*\}?\s*)?$/;

function parseContextParams(paramString: string): ContextOverride | null {
  const override: ContextOverride = {};
  const tokens = paramString.trim().split(/\s+/);

  for (const token of tokens) {
    if (token.startsWith('bg:')) {
      override.bg = token.slice(3);
    } else if (token.startsWith('fg:')) {
      override.fg = token.slice(3);
    } else if (token === 'no-inherit') {
      override.noInherit = true;
    }
  }

  // Must have at least bg or fg to be valid
  if (!override.bg && !override.fg) return null;

  return override;
}

function getContextOverride(lines: string[], lineIndex: number): ContextOverride | null {
  const currentMatch = A11Y_CONTEXT_REGEX.exec(lines[lineIndex]!);
  if (currentMatch) return parseContextParams(currentMatch[1]!);

  if (lineIndex > 0) {
    const prevMatch = A11Y_CONTEXT_REGEX.exec(lines[lineIndex - 1]!.trim());
    if (prevMatch) return parseContextParams(prevMatch[1]!);
  }

  return null;
}

/** @internal Exported for unit testing */
export function getContextOverrideForLine(
  lines: string[],
  line1Based: number,
): ContextOverride | null {
  const idx = line1Based - 1;
  if (idx < 0 || idx >= lines.length) return null;
  return getContextOverride(lines, idx);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/plugins/jsx/__tests__/categorizer.test.ts -t "getContextOverrideForLine"`
Expected: PASS (all 12 tests)

**Step 5: Run full test suite**

Run: `npm test`
Expected: All 353+ tests pass

**Step 6: Commit**

```
git add src/plugins/jsx/categorizer.ts src/plugins/jsx/__tests__/categorizer.test.ts
git commit -m "feat: parse @a11y-context annotations in categorizer"
```

---

### Task 3: Single-element @a11y-context in parser (attach to ClassRegion)

**Files:**
- Modify: `src/plugins/jsx/parser.ts:226-420` (extractClassRegions state machine)
- Modify: `src/plugins/jsx/__tests__/parser.test.ts` (append tests)

**Step 1: Write the failing tests**

Append to `src/plugins/jsx/__tests__/parser.test.ts`:

```typescript
describe('@a11y-context (single-element)', () => {
  test('annotation on previous line attaches contextOverride to next region', () => {
    const source = [
      '// @a11y-context bg:bg-slate-900',
      '<span className="text-white">Badge</span>',
    ].join('\n');
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.contextOverride).toEqual({ bg: 'bg-slate-900' });
  });

  test('JSX block comment annotation attaches override', () => {
    const source = [
      '{/* @a11y-context bg:#09090b fg:text-white */}',
      '<div className="text-sm">overlay</div>',
    ].join('\n');
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.contextOverride).toEqual({ bg: '#09090b', fg: 'text-white' });
  });

  test('annotation only applies to the next region, not subsequent ones', () => {
    const source = [
      '// @a11y-context bg:bg-slate-900',
      '<span className="text-white">Badge</span>',
      '<span className="text-black">Other</span>',
    ].join('\n');
    const regions = extract(source);

    expect(regions).toHaveLength(2);
    expect(regions[0]!.contextOverride).toEqual({ bg: 'bg-slate-900' });
    expect(regions[1]!.contextOverride).toBeUndefined();
  });

  test('annotation without className on next line is consumed and lost', () => {
    const source = [
      '// @a11y-context bg:bg-slate-900',
      '<div>no className here</div>',
      '<span className="text-white">Later</span>',
    ].join('\n');
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.contextOverride).toBeUndefined();
  });

  test('regular comment does not attach override', () => {
    const source = [
      '// This is a regular comment',
      '<span className="text-white">Badge</span>',
    ].join('\n');
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.contextOverride).toBeUndefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/plugins/jsx/__tests__/parser.test.ts -t "@a11y-context"`
Expected: FAIL — contextOverride is undefined on all regions

**Step 3: Implement single-element annotation detection in parser**

In `src/plugins/jsx/parser.ts`, add import:

```typescript
import type { ContextOverride } from '../../core/types.js';
```

Add regex + parser near top (after imports):

```typescript
/** Matches @a11y-context (NOT @a11y-context-block) in a comment */
const A11Y_CONTEXT_SINGLE_REGEX =
  /(?:\/\/|\/\*)\s*@a11y-context(?!-block)\s+(.*?)(?:\s*\*\/)?$/;

function parseAnnotationParams(body: string): ContextOverride | null {
  const override: ContextOverride = {};
  for (const token of body.trim().split(/\s+/)) {
    if (token.startsWith('bg:')) override.bg = token.slice(3);
    else if (token.startsWith('fg:')) override.fg = token.slice(3);
    else if (token === 'no-inherit') override.noInherit = true;
  }
  return override.bg || override.fg ? override : null;
}
```

Inside `extractClassRegions()`, after `contextStack` declaration (~line 242), add:

```typescript
let pendingOverride: ContextOverride | null = null;
let currentTagOverride: ContextOverride | null = null;
```

Modify single-line comment skip (lines 264-268):

```typescript
if (source[i] === '/' && i + 1 < len && source[i + 1] === '/') {
  const commentStart = i;
  while (i < len && source[i] !== '\n') i++;
  const commentText = source.slice(commentStart, i);
  if (/@a11y-context\s/.test(commentText) && !/@a11y-context-block/.test(commentText)) {
    const match = A11Y_CONTEXT_SINGLE_REGEX.exec(commentText);
    if (match) pendingOverride = parseAnnotationParams(match[1]!);
  }
  continue;
}
```

Modify block comment skip (lines 271-276):

```typescript
if (source[i] === '/' && i + 1 < len && source[i + 1] === '*') {
  const commentStart = i;
  i += 2;
  while (i < len - 1 && !(source[i] === '*' && source[i + 1] === '/')) i++;
  i += 2;
  const commentText = source.slice(commentStart, i);
  if (/@a11y-context\s/.test(commentText) && !/@a11y-context-block/.test(commentText)) {
    const match = A11Y_CONTEXT_SINGLE_REGEX.exec(commentText);
    if (match) pendingOverride = parseAnnotationParams(match[1]!);
  }
  continue;
}
```

At the start of the `<` tag detection block (line 279), for non-closing, non-comment tags, consume the pending override:

```typescript
if (source[i] === '<' && i + 1 < len) {
  const next = source[i + 1]!;

  // Non-closing tag: consume pending single-element override
  if (next !== '/' && next !== '!') {
    currentTagOverride = pendingOverride;
    pendingOverride = null;
  }
```

After every `regions.push(...)` call (5 locations), add:

```typescript
if (currentTagOverride) {
  regions[regions.length - 1]!.contextOverride = currentTagOverride;
  currentTagOverride = null;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/plugins/jsx/__tests__/parser.test.ts -t "@a11y-context"`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```
git add src/plugins/jsx/parser.ts src/plugins/jsx/__tests__/parser.test.ts
git commit -m "feat: single-element @a11y-context attaches override to ClassRegion"
```

---

### Task 4: Block-scoped @a11y-context-block in parser (context stack)

**Files:**
- Modify: `src/plugins/jsx/parser.ts` (comment parsing + context stack logic)
- Modify: `src/plugins/jsx/__tests__/parser.test.ts` (append tests)

**Step 1: Write the failing tests**

Append to `src/plugins/jsx/__tests__/parser.test.ts`:

```typescript
describe('@a11y-context-block (block scope)', () => {
  test('block annotation overrides contextBg for children', () => {
    const source = [
      '{/* @a11y-context-block bg:bg-slate-900 */}',
      '<div>',
      '  <span className="text-white">Badge</span>',
      '</div>',
    ].join('\n');
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.contextBg).toBe('bg-slate-900');
  });

  test('block annotation applies to multiple children', () => {
    const source = [
      '{/* @a11y-context-block bg:bg-background */}',
      '<div>',
      '  <h2 className="text-foreground">Title</h2>',
      '  <p className="text-muted-foreground">Body</p>',
      '</div>',
    ].join('\n');
    const regions = extract(source);

    expect(regions).toHaveLength(2);
    expect(regions[0]!.contextBg).toBe('bg-background');
    expect(regions[1]!.contextBg).toBe('bg-background');
  });

  test('block annotation does not leak past closing tag', () => {
    const source = [
      '{/* @a11y-context-block bg:bg-slate-900 */}',
      '<div>',
      '  <span className="text-white">Inside</span>',
      '</div>',
      '<span className="text-black">Outside</span>',
    ].join('\n');
    const regions = extract(source);

    expect(regions).toHaveLength(2);
    expect(regions[0]!.contextBg).toBe('bg-slate-900');
    expect(regions[1]!.contextBg).toBe(defaultBg);
  });

  test('no-inherit: container inside block uses own bg, not annotation bg', () => {
    const source = [
      '{/* @a11y-context-block bg:bg-background no-inherit */}',
      '<div>',
      '  <span className="text-white">Direct child</span>',
      '  <Card>',
      '    <span className="text-foreground">Inside Card</span>',
      '  </Card>',
      '</div>',
    ].join('\n');
    const regions = extract(source);

    expect(regions).toHaveLength(2);
    expect(regions[0]!.contextBg).toBe('bg-background');
    expect(regions[1]!.contextBg).toBe('bg-card');
  });

  test('block annotation with hex value', () => {
    const source = [
      '// @a11y-context-block bg:#09090b',
      '<div>',
      '  <span className="text-white">Dark bg</span>',
      '</div>',
    ].join('\n');
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.contextBg).toBe('#09090b');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/plugins/jsx/__tests__/parser.test.ts -t "@a11y-context-block"`
Expected: FAIL

**Step 3: Implement block annotation detection**

Add regex in `parser.ts`:

```typescript
const A11Y_CONTEXT_BLOCK_REGEX =
  /(?:\/\/|\/\*)\s*@a11y-context-block\s+(.*?)(?:\s*\*\/)?$/;
```

Extend the `contextStack` type:

```typescript
const contextStack: Array<{
  component: string;
  bg: string;
  isAnnotation?: boolean;
  noInherit?: boolean;
}> = [{ component: '_root', bg: defaultBg }];
```

Add `pendingBlockOverride` after `pendingOverride`:

```typescript
let pendingBlockOverride: ContextOverride | null = null;
```

In both comment-skip sections, add block detection:

```typescript
if (/@a11y-context-block/.test(commentText)) {
  const match = A11Y_CONTEXT_BLOCK_REGEX.exec(commentText);
  if (match) pendingBlockOverride = parseAnnotationParams(match[1]!);
}
```

In the opening tag handler (non-closing tags), when `pendingBlockOverride` is set:

```typescript
if (pendingBlockOverride) {
  const blockTag = readTagName(source, i + 1);
  if (blockTag.name && !isSelfClosingTag(source, blockTag.end)) {
    contextStack.push({
      component: `_annotation_${blockTag.name}`,
      bg: pendingBlockOverride.bg || currentContext(),
      isAnnotation: true,
      noInherit: pendingBlockOverride.noInherit,
    });
  }
  pendingBlockOverride = null;
}
```

In the closing tag handler, add after the existing container pop:

```typescript
const annotationKey = `_annotation_${tag.name}`;
if (
  contextStack.length > 1 &&
  contextStack[contextStack.length - 1]!.component === annotationKey
) {
  contextStack.pop();
}
```

**Step 4: Run tests**

Run: `npx vitest run src/plugins/jsx/__tests__/parser.test.ts -t "@a11y-context-block"`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```
git add src/plugins/jsx/parser.ts src/plugins/jsx/__tests__/parser.test.ts
git commit -m "feat: @a11y-context-block pushes onto parser context stack"
```

---

### Task 5: Region resolver uses contextOverride for pair generation

**Files:**
- Modify: `src/plugins/jsx/region-resolver.ts:180-251` (resolveFileRegions)
- Modify: `src/plugins/jsx/__tests__/region-resolver.test.ts` (append tests)

**Step 1: Write the failing tests**

Append to `src/plugins/jsx/__tests__/region-resolver.test.ts`. Import `resolveFileRegions` and `PreExtracted`:

```typescript
describe('contextOverride in resolveFileRegions', () => {
  const colorMap: ColorMap = new Map([
    ['--color-white', { hex: '#ffffff' }],
    ['--color-black', { hex: '#000000' }],
    ['--color-slate-900', { hex: '#0f172a' }],
    ['--color-background', { hex: '#ffffff' }],
  ]);

  function makePreExtracted(regions: ClassRegion[]): PreExtracted {
    return {
      files: [{
        relPath: 'test.tsx',
        lines: ['<span className="text-white">Badge</span>'],
        regions,
      }],
      readErrors: [],
      filesScanned: 1,
    };
  }

  test('bg override replaces contextBg in pair generation', () => {
    const pre = makePreExtracted([{
      content: 'text-white',
      startLine: 1,
      contextBg: 'bg-background',
      contextOverride: { bg: 'bg-slate-900' },
    }]);
    const result = resolveFileRegions(pre, colorMap);

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.bgHex).toBe('#0f172a');
    expect(result.pairs[0]!.contextSource).toBe('annotation');
  });

  test('fg override replaces resolved text color', () => {
    const pre = makePreExtracted([{
      content: 'text-white',
      startLine: 1,
      contextBg: 'bg-background',
      contextOverride: { fg: '#000000' },
    }]);
    const result = resolveFileRegions(pre, colorMap);

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.textHex).toBe('#000000');
    expect(result.pairs[0]!.contextSource).toBe('annotation');
  });

  test('without contextOverride, contextSource is not set', () => {
    const pre = makePreExtracted([{
      content: 'text-white',
      startLine: 1,
      contextBg: 'bg-background',
    }]);
    const result = resolveFileRegions(pre, colorMap);

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.contextSource).toBeUndefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/plugins/jsx/__tests__/region-resolver.test.ts -t "contextOverride"`
Expected: FAIL

**Step 3: Implement contextOverride handling**

In `resolveFileRegions()` in `region-resolver.ts`, modify the context resolution (~line 206):

Replace:
```typescript
const contextBg = region.contextBg;
```
With:
```typescript
const contextBg = region.contextOverride?.bg || region.contextBg;
const hasAnnotation = region.contextOverride != null;
```

For `fg` override, after the inline text color block (after ~line 227), add:

```typescript
if (region.contextOverride?.fg) {
  const fgOverride = region.contextOverride.fg;
  const isHex = fgOverride.startsWith('#') && fgOverride.length >= 4;
  textClasses.length = 0;
  textClasses.push({
    raw: `(@a11y-context) ${fgOverride}`,
    isDark: false,
    isInteractive: false,
    interactiveState: null,
    base: isHex ? `text-[${fgOverride}]` : fgOverride,
  });
}
```

After `allPairs.push(...baseResult.pairs);` (~line 251), add:

```typescript
if (hasAnnotation) {
  for (const pair of baseResult.pairs) {
    pair.contextSource = 'annotation';
  }
}
```

Same after `allPairs.push(...stateResult.pairs);` (~line 276):

```typescript
if (hasAnnotation) {
  for (const pair of stateResult.pairs) {
    pair.contextSource = 'annotation';
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run src/plugins/jsx/__tests__/region-resolver.test.ts -t "contextOverride"`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```
git add src/plugins/jsx/region-resolver.ts src/plugins/jsx/__tests__/region-resolver.test.ts
git commit -m "feat: region resolver uses contextOverride for pair generation"
```

---

### Task 6: Report output marks annotated pairs

**Files:**
- Modify: `src/core/report/markdown.ts` (footnote for annotated pairs)
- Modify: `src/core/report/__tests__/markdown.test.ts` (test for footnote)

**Step 1: Write the failing test**

In `src/core/report/__tests__/markdown.test.ts`, add a test for annotated pair footnote. Create an `AuditResult` with a violation that has `contextSource: 'annotation'` and verify the report contains `†` and `@a11y-context`.

**Step 2: Run test to verify failure**

Run: `npx vitest run src/core/report/__tests__/markdown.test.ts -t "annotated"`
Expected: FAIL

**Step 3: Implement footnote**

In `generateReport()` in `markdown.ts`:
- Track whether any pairs have `contextSource === 'annotation'` across all results.
- When rendering rows for violations/passed, append `†` to the bgClass if `contextSource === 'annotation'`.
- At the end of the report, if annotated pairs exist, add: `† Context overridden via \`@a11y-context\` annotation`.

The JSON report already serializes all `ContrastResult` fields, so `contextSource` is included automatically.

**Step 4: Run report tests**

Run: `npx vitest run src/core/report/__tests__/`
Expected: PASS (may need snapshot update with `-u` flag)

**Step 5: Commit**

```
git add src/core/report/markdown.ts src/core/report/__tests__/
git commit -m "feat: markdown report shows footnote for annotated pairs"
```

---

### Task 7: Integration test with annotation fixture

**Files:**
- Modify: `src/core/__tests__/integration.test.ts` (add fixture + tests)

**Step 1: Add annotation fixture and tests**

Add a new entry to `FIXTURE_FILES`:

```typescript
'components/Overlay.tsx': [
  '// @a11y-context bg:#09090b',
  '<span className="text-white absolute top-0">Badge</span>',
  '{/* @a11y-context-block bg:bg-background */}',
  '<div>',
  '  <p className="text-foreground">Dialog body</p>',
  '</div>',
  '<p className="text-black">Normal paragraph</p>',
].join('\n'),
```

Add tests:

```typescript
test('@a11y-context overrides bg for floating badge', () => {
  const result = runPipeline();
  const allResults = [...result.violations, ...result.passed, ...result.ignored];
  const badge = allResults.find(
    (v) => v.file === 'components/Overlay.tsx'
      && v.textClass === 'text-white'
      && v.contextSource === 'annotation',
  );
  expect(badge).toBeDefined();
  expect(badge!.bgHex).not.toBe('#ffffff');
});

test('@a11y-context-block applies to children, not siblings', () => {
  const result = runPipeline();
  const allResults = [...result.violations, ...result.passed, ...result.ignored];
  const normalP = allResults.find(
    (v) => v.file === 'components/Overlay.tsx' && v.textClass === 'text-black',
  );
  expect(normalP).toBeDefined();
  expect(normalP!.contextSource).toBeUndefined();
});
```

**Step 2: Run integration tests**

Run: `npx vitest run src/core/__tests__/integration.test.ts`
Expected: PASS (update snapshots with `-u` if needed)

**Step 3: Commit**

```
git add src/core/__tests__/integration.test.ts src/core/__tests__/__snapshots__/
git commit -m "test: integration tests for @a11y-context annotations"
```

---

### Task 8: Final verification

**Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 2: Full test suite**

Run: `npm test`
Expected: All tests pass (365+ tests)

**Step 3: Build**

Run: `npm run build`
Expected: PASS — dist/ has updated CJS + ESM bundles

**Step 4: Commit any remaining changes**

```
git add -A
git commit -m "chore: final cleanup for @a11y-context annotations"
```
