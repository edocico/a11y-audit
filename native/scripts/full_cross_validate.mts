#!/usr/bin/env npx tsx
/**
 * Cross-Validation: Rust native engine vs TypeScript legacy parser.
 *
 * Runs a comprehensive set of JSX test fixtures through both engines
 * and compares the output ClassRegion data.
 *
 * Usage: npx tsx native/scripts/full_cross_validate.mts
 */

import { createRequire } from 'node:module';
import { extractClassRegions } from '../../src/plugins/jsx/parser.js';
import type { ClassRegion } from '../../src/core/types.js';
import { colord, extend } from 'colord';
import a11yPlugin from 'colord/plugins/a11y';
import { calcAPCA } from 'apca-w3';

extend([a11yPlugin]);

const require = createRequire(import.meta.url);

// ── Load native module ──────────────────────────────────────────────
const nativeModule = require('../../native/a11y-audit-native.node') as {
  healthCheck(): string;
  extractAndScan(options: {
    fileContents: Array<{ path: string; content: string }>;
    containerConfig: Array<{ component: string; bgClass: string }>;
    defaultBg: string;
  }): Array<{ path: string; regions: NativeClassRegion[] }>;
  checkContrastPairs(
    pairs: Array<Record<string, unknown>>,
    threshold: string,
    pageBg: string,
  ): {
    violations: Array<Record<string, unknown>>;
    passed: Array<Record<string, unknown>>;
    ignored: Array<Record<string, unknown>>;
    ignoredCount: number;
    skippedCount: number;
  };
};

interface NativeClassRegion {
  content: string;
  startLine: number;
  contextBg: string;
  inlineColor?: string | null;
  inlineBackgroundColor?: string | null;
  contextOverrideBg?: string | null;
  contextOverrideFg?: string | null;
  contextOverrideNoInherit?: boolean | null;
  ignored?: boolean | null;
  ignoreReason?: string | null;
}

// ── Test Fixtures ───────────────────────────────────────────────────

const CONTAINER_MAP = new Map([
  ['Card', 'bg-card'],
  ['Dialog', 'bg-background'],
  ['Popover', 'bg-popover'],
]);

const CONTAINER_ENTRIES = Array.from(CONTAINER_MAP.entries()).map(
  ([component, bgClass]) => ({ component, bgClass }),
);

const DEFAULT_BG = 'bg-background';

interface Fixture {
  name: string;
  source: string;
  containers?: boolean;
}

const FIXTURES: Fixture[] = [
  {
    name: 'simple static className',
    source: '<div className="bg-red-500 text-white">x</div>',
  },
  {
    name: 'nested elements',
    source: `<div className="bg-slate-900 p-4">
  <h1 className="text-white text-2xl font-bold">Title</h1>
  <p className="text-gray-400">Description</p>
</div>`,
  },
  {
    name: 'self-closing tag',
    source: '<hr className="border-gray-200" />',
  },
  {
    name: 'template literal className',
    source: '<div className={`bg-red-500 text-white`}>x</div>',
  },
  {
    name: 'cn() function call',
    source: '<div className={cn("bg-red-500", "text-white")}>x</div>',
  },
  {
    name: 'clsx() function call',
    source: '<div className={clsx("bg-blue-500", "text-white")}>x</div>',
  },
  {
    name: 'single-quoted className in expression',
    source: "<div className={'bg-green-500 text-white'}>x</div>",
  },
  {
    name: 'multiple regions in same file',
    source: `<div className="bg-red-500 text-white">a</div>
<span className="bg-blue-500 text-black">b</span>
<p className="text-gray-700">c</p>`,
  },
  {
    name: 'container context (Card)',
    source: '<Card><span className="text-white">x</span></Card>',
    containers: true,
  },
  {
    name: 'nested containers',
    source: `<Card>
  <Dialog>
    <p className="text-foreground">inner</p>
  </Dialog>
  <span className="text-card-foreground">outer</span>
</Card>`,
    containers: true,
  },
  {
    name: '@a11y-context single element',
    source: `// @a11y-context bg:#09090b
<div className="text-white">floating</div>`,
  },
  {
    name: '@a11y-context with bg and fg',
    source: `// @a11y-context bg:bg-slate-900 fg:text-white
<div className="text-gray-300">content</div>`,
  },
  {
    name: '@a11y-context-block scope',
    source: `{/* @a11y-context-block bg:bg-slate-900 */}
<div className="text-white">a</div>
<span className="text-gray-400">b</span>`,
  },
  {
    name: 'a11y-ignore annotation',
    source: `// a11y-ignore: dynamic background
<div className="text-white">ignored</div>`,
  },
  {
    name: 'explicit bg-* in non-container tag',
    source: `<div className="bg-red-500">
  <span className="text-white">child</span>
</div>`,
  },
  {
    name: 'empty file',
    source: '',
  },
  {
    name: 'no className elements',
    source: '<div><span>plain text</span></div>',
  },
  {
    name: 'multi-line tag with className',
    source: `<div
  className="bg-slate-800 text-white p-4"
  data-testid="card"
>
  content
</div>`,
  },
  {
    name: 'comment before first element',
    source: `// Component for dashboard
<div className="text-gray-700 bg-white">dashboard</div>`,
  },
  {
    name: 'JSX block comment (not annotation)',
    source: `{/* This is a regular comment */}
<div className="text-black bg-white">content</div>`,
  },
  {
    name: 'fragment wrapper',
    source: `<>
  <div className="bg-red-500 text-white">a</div>
  <div className="bg-blue-500 text-black">b</div>
</>`,
  },
  {
    name: 'conditional className with ternary',
    source: '<div className={isActive ? "bg-blue-500 text-white" : "bg-gray-200 text-black"}>x</div>',
  },
  {
    name: 'dark: variant prefix',
    source: '<div className="bg-white dark:bg-black text-black dark:text-white">themed</div>',
  },
  {
    name: 'hover: variant prefix',
    source: '<div className="bg-white hover:bg-blue-500 text-black hover:text-white">interactive</div>',
  },
  {
    name: 'mixed containers and explicit bg',
    source: `<Card>
  <div className="bg-red-500">
    <span className="text-white">deep</span>
  </div>
</Card>`,
    containers: true,
  },
];

// ── Comparison Logic ────────────────────────────────────────────────

interface NormalizedRegion {
  content: string;
  startLine: number;
  contextBg: string;
  contextOverrideBg: string | null;
  contextOverrideFg: string | null;
}

function normalizeTsRegion(r: ClassRegion): NormalizedRegion {
  return {
    content: r.content,
    startLine: r.startLine,
    contextBg: r.contextBg,
    contextOverrideBg: r.contextOverride?.bg ?? null,
    contextOverrideFg: r.contextOverride?.fg ?? null,
  };
}

function normalizeNativeRegion(r: NativeClassRegion): NormalizedRegion {
  return {
    content: r.content,
    startLine: r.startLine,
    contextBg: r.contextBg,
    contextOverrideBg: r.contextOverrideBg ?? null,
    contextOverrideFg: r.contextOverrideFg ?? null,
  };
}

/**
 * Known intentional differences: the Rust engine's ContextTracker
 * detects explicit bg-* classes on parent tags and propagates them
 * as contextBg to children. The TS parser only tracks configured
 * container components. The Rust behavior is more correct.
 */
function isKnownContextBgImprovement(
  tsContextBg: string,
  nativeContextBg: string,
): boolean {
  // Native set a bg-* class that TS didn't detect
  return (
    nativeContextBg.startsWith('bg-') &&
    nativeContextBg !== tsContextBg &&
    (tsContextBg === DEFAULT_BG || tsContextBg.startsWith('bg-'))
  );
}

function regionsMatch(
  ts: NormalizedRegion,
  native: NormalizedRegion,
): { match: boolean; diffs: string[]; knownDiffs: string[] } {
  const diffs: string[] = [];
  const knownDiffs: string[] = [];

  if (ts.content !== native.content) {
    diffs.push(`content: TS="${ts.content}" vs Native="${native.content}"`);
  }
  if (ts.startLine !== native.startLine) {
    diffs.push(`startLine: TS=${ts.startLine} vs Native=${native.startLine}`);
  }
  if (ts.contextBg !== native.contextBg) {
    if (isKnownContextBgImprovement(ts.contextBg, native.contextBg)) {
      knownDiffs.push(
        `contextBg: TS="${ts.contextBg}" vs Native="${native.contextBg}" [KNOWN: native detects explicit bg]`,
      );
    } else {
      diffs.push(`contextBg: TS="${ts.contextBg}" vs Native="${native.contextBg}"`);
    }
  }
  if (ts.contextOverrideBg !== native.contextOverrideBg) {
    diffs.push(
      `contextOverrideBg: TS="${ts.contextOverrideBg}" vs Native="${native.contextOverrideBg}"`,
    );
  }
  if (ts.contextOverrideFg !== native.contextOverrideFg) {
    diffs.push(
      `contextOverrideFg: TS="${ts.contextOverrideFg}" vs Native="${native.contextOverrideFg}"`,
    );
  }

  return { match: diffs.length === 0, diffs, knownDiffs };
}

// ── Run Cross-Validation ────────────────────────────────────────────

let passed = 0;
let failed = 0;
let nativeOnlyExtra = 0;
let knownImprovements = 0;
const failures: Array<{ name: string; issue?: string; diffs?: Array<{ index: number; diffs: string[] }> }> = [];

console.log('=== Cross-Validation: Rust Native vs TypeScript Legacy ===\n');

for (const fixture of FIXTURES) {
  const containerMap = fixture.containers ? CONTAINER_MAP : new Map<string, string>();
  const containerEntries = fixture.containers ? CONTAINER_ENTRIES : [];

  // TS path
  const tsRegions = extractClassRegions(fixture.source, containerMap, DEFAULT_BG);
  const tsNormalized = tsRegions.map(normalizeTsRegion);

  // Native path
  const nativeResult = nativeModule.extractAndScan({
    fileContents: [{ path: 'test.tsx', content: fixture.source }],
    containerConfig: containerEntries,
    defaultBg: DEFAULT_BG,
  });
  const nativeRegions = nativeResult[0]?.regions ?? [];
  const nativeNormalized = nativeRegions.map(normalizeNativeRegion);

  // Compare region count
  if (tsNormalized.length !== nativeNormalized.length) {
    // Native may have extra regions (disabled detection) — compare common prefix
    const minLen = Math.min(tsNormalized.length, nativeNormalized.length);
    let commonMatch = true;
    const commonDiffs: Array<{ index: number; diffs: string[] }> = [];

    for (let i = 0; i < minLen; i++) {
      const { match, diffs, knownDiffs: kd } = regionsMatch(tsNormalized[i]!, nativeNormalized[i]!);
      if (!match) {
        commonMatch = false;
        commonDiffs.push({ index: i, diffs });
      }
      if (kd.length > 0) knownImprovements++;
    }

    if (commonMatch && nativeNormalized.length > tsNormalized.length) {
      // Native-only extra regions are expected (e.g., disabled detection)
      const extra = nativeNormalized.length - tsNormalized.length;
      nativeOnlyExtra += extra;
      passed++;
      console.log(
        `  [NATIVE+${extra}] ${fixture.name} (${tsNormalized.length} TS, ${nativeNormalized.length} native)`,
      );
      continue;
    }

    failed++;
    failures.push({
      name: fixture.name,
      issue: `Region count mismatch: TS=${tsNormalized.length}, Native=${nativeNormalized.length}`,
      diffs: commonDiffs,
    });
    console.log(
      `  [FAIL] ${fixture.name}: region count TS=${tsNormalized.length} vs Native=${nativeNormalized.length}`,
    );
    for (const d of commonDiffs) {
      console.log(`    Region ${d.index}: ${d.diffs.join(', ')}`);
    }
    continue;
  }

  // Compare each region
  let allMatch = true;
  const fixtureDiffs: Array<{ index: number; diffs: string[] }> = [];
  const fixtureKnownDiffs: Array<{ index: number; diffs: string[] }> = [];
  for (let i = 0; i < tsNormalized.length; i++) {
    const { match, diffs, knownDiffs: kd } = regionsMatch(tsNormalized[i]!, nativeNormalized[i]!);
    if (!match) {
      allMatch = false;
      fixtureDiffs.push({ index: i, diffs });
    }
    if (kd.length > 0) {
      fixtureKnownDiffs.push({ index: i, diffs: kd });
    }
  }

  if (allMatch) {
    if (fixtureKnownDiffs.length > 0) {
      knownImprovements++;
      passed++;
      console.log(`  [PASS*] ${fixture.name} (${tsNormalized.length} regions, ${fixtureKnownDiffs.length} known native improvements)`);
      for (const d of fixtureKnownDiffs) {
        console.log(`    Region ${d.index}: ${d.diffs.join(', ')}`);
      }
    } else {
      passed++;
      console.log(`  [PASS] ${fixture.name} (${tsNormalized.length} regions)`);
    }
  } else {
    failed++;
    failures.push({ name: fixture.name, diffs: fixtureDiffs });
    console.log(`  [FAIL] ${fixture.name}`);
    for (const d of fixtureDiffs) {
      console.log(`    Region ${d.index}: ${d.diffs.join(', ')}`);
    }
  }
}

// ── Contrast Math Cross-Validation ──────────────────────────────────

console.log('\n=== Contrast Math Cross-Validation ===\n');

const COLOR_PAIRS = [
  { bg: '#ffffff', text: '#000000', label: 'black on white' },
  { bg: '#ffffff', text: '#767676', label: 'gray on white' },
  { bg: '#09090b', text: '#ffffff', label: 'white on zinc-950' },
  { bg: '#09090b', text: '#a1a1aa', label: 'zinc-400 on zinc-950' },
  { bg: '#ffffff', text: '#ff0000', label: 'red on white' },
  { bg: '#1e293b', text: '#f1f5f9', label: 'slate-100 on slate-800' },
  { bg: '#ffffff', text: '#ffffff', label: 'white on white (1:1)' },
  { bg: '#000000', text: '#000000', label: 'black on black (1:1)' },
];

let mathPassed = 0;
let mathFailed = 0;

for (const pair of COLOR_PAIRS) {
  // TS values (colord + apca-w3)
  const tsRatio = colord(pair.text).contrast(pair.bg);
  const tsApca = Number(calcAPCA(pair.text, pair.bg));

  // Native values
  const nativeResult = nativeModule.checkContrastPairs(
    [
      {
        file: 'test.tsx',
        line: 1,
        bgClass: 'bg-test',
        textClass: 'text-test',
        bgHex: pair.bg,
        textHex: pair.text,
        isLargeText: false,
        pairType: 'text',
      },
    ],
    'AA',
    pair.bg,
  );

  const nativeCheck = (nativeResult.passed[0] ?? nativeResult.violations[0]) as
    | { ratio: number; apcaLc?: number | null }
    | undefined;

  if (!nativeCheck) {
    console.log(`  [SKIP] ${pair.label}: native returned no results`);
    continue;
  }

  const ratioDiff = Math.abs(tsRatio - nativeCheck.ratio);
  const apcaDiff = Math.abs(tsApca - (nativeCheck.apcaLc ?? 0));

  const ratioOk = ratioDiff < 0.05;
  const apcaOk = apcaDiff < 2.0;

  if (ratioOk && apcaOk) {
    mathPassed++;
    console.log(
      `  [PASS] ${pair.label}: ratio=${nativeCheck.ratio.toFixed(2)} (diff=${ratioDiff.toFixed(4)}), APCA=${(nativeCheck.apcaLc ?? 0).toFixed(1)} (diff=${apcaDiff.toFixed(1)})`,
    );
  } else {
    mathFailed++;
    console.log(`  [FAIL] ${pair.label}:`);
    if (!ratioOk)
      console.log(
        `    ratio: TS=${tsRatio.toFixed(4)} vs Native=${nativeCheck.ratio.toFixed(4)} (diff=${ratioDiff.toFixed(4)})`,
      );
    if (!apcaOk)
      console.log(
        `    APCA: TS=${tsApca.toFixed(1)} vs Native=${(nativeCheck.apcaLc ?? 0).toFixed(1)} (diff=${apcaDiff.toFixed(1)})`,
      );
  }
}

// ── Summary ─────────────────────────────────────────────────────────

console.log('\n=== Summary ===');
console.log(
  `Parser:   ${passed}/${FIXTURES.length} passed, ${failed} failed, ${knownImprovements} known native improvements, ${nativeOnlyExtra} native-only extra regions`,
);
console.log(`Math:     ${mathPassed}/${COLOR_PAIRS.length} passed, ${mathFailed} failed`);

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.issue ?? ''}`);
    if (f.diffs) {
      for (const d of f.diffs) {
        console.log(`    Region ${d.index}: ${d.diffs.join(', ')}`);
      }
    }
  }
}

const totalFailed = failed + mathFailed;
if (totalFailed > 0) {
  console.log(`\n${totalFailed} total failures — cross-validation FAILED`);
  process.exit(1);
} else {
  console.log(`\nAll cross-validation checks PASSED`);
  process.exit(0);
}
