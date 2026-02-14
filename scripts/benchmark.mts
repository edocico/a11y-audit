#!/usr/bin/env npx tsx
/**
 * Performance benchmark: Native Rust engine vs TypeScript legacy parser.
 *
 * Generates synthetic JSX files and measures parse time for both engines.
 * Target: >70% scan time reduction with native engine.
 *
 * Usage:
 *   npx tsx scripts/benchmark.mts              # Run full comparison
 *   npx tsx scripts/benchmark.mts --files=200  # Custom file count
 *   npx tsx scripts/benchmark.mts --warmup=3   # Custom warmup iterations
 */

import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { extractClassRegions } from '../src/plugins/jsx/parser.js';

const require = createRequire(import.meta.url);

// ── Parse CLI args ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const fileCount = parseInt(args.find(a => a.startsWith('--files='))?.split('=')[1] ?? '100', 10);
const warmupRuns = parseInt(args.find(a => a.startsWith('--warmup='))?.split('=')[1] ?? '3', 10);
const benchRuns = parseInt(args.find(a => a.startsWith('--runs='))?.split('=')[1] ?? '5', 10);

// ── Load native module ──────────────────────────────────────────────
let nativeModule: {
  extractAndScan(options: {
    fileContents: Array<{ path: string; content: string }>;
    containerConfig: Array<{ component: string; bgClass: string }>;
    defaultBg: string;
  }): Array<{ path: string; regions: Array<Record<string, unknown>> }>;
} | null = null;

try {
  nativeModule = require('../native/a11y-audit-native.node');
} catch {
  console.error('Native module not available. Build with `npm run build:native` first.');
  process.exit(1);
}

// ── Generate Synthetic JSX Files ────────────────────────────────────

const COMPONENTS = ['Card', 'Dialog', 'Button', 'Badge', 'Alert', 'Input', 'Select', 'Table'];
const BG_CLASSES = ['bg-background', 'bg-card', 'bg-slate-900', 'bg-red-500', 'bg-blue-600', 'bg-green-500', 'bg-white', 'bg-zinc-950'];
const TEXT_CLASSES = ['text-foreground', 'text-white', 'text-black', 'text-gray-400', 'text-muted-foreground', 'text-red-500', 'text-blue-500'];
const BORDER_CLASSES = ['border-gray-200', 'border-slate-700', 'ring-blue-500', 'outline-gray-300'];
const VARIANTS = ['hover:', 'focus:', 'dark:', 'disabled:', 'focus-visible:'];

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function generateClassName(complexity: number): string {
  const classes: string[] = [];
  classes.push(randomChoice(BG_CLASSES));
  classes.push(randomChoice(TEXT_CLASSES));

  if (complexity > 1) {
    classes.push(randomChoice(BORDER_CLASSES));
    classes.push('p-4', 'rounded-lg');
  }
  if (complexity > 2) {
    // Add variants
    classes.push(`${randomChoice(VARIANTS)}${randomChoice(BG_CLASSES)}`);
    classes.push(`${randomChoice(VARIANTS)}${randomChoice(TEXT_CLASSES)}`);
  }

  return classes.join(' ');
}

/**
 * Generate a realistic JSX component file.
 * Real-world .tsx files in a project like multicoin-frontend are typically
 * 50-500 lines with multiple nested components, hooks, and complex classNames.
 */
function generateJSXFile(index: number): string {
  const componentName = `Component${index}`;
  const lines: string[] = [];

  // Imports section (realistic)
  lines.push(`'use client';`);
  lines.push('');
  lines.push(`import React, { useState, useCallback, useMemo } from 'react';`);
  lines.push(`import { cn } from '@/lib/utils';`);
  lines.push(`import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';`);
  lines.push(`import { Button } from '@/components/ui/button';`);
  lines.push(`import { Badge } from '@/components/ui/badge';`);
  lines.push(`import { Input } from '@/components/ui/input';`);
  lines.push('');

  // Type definitions
  lines.push(`interface ${componentName}Props {`);
  lines.push(`  title: string;`);
  lines.push(`  description?: string;`);
  lines.push(`  variant?: 'default' | 'destructive' | 'outline';`);
  lines.push(`  items: Array<{ id: string; name: string; status: string }>;`);
  lines.push(`  onAction?: (id: string) => void;`);
  lines.push(`}`);
  lines.push('');

  // Component function
  lines.push(`export function ${componentName}({ title, description, variant = 'default', items, onAction }: ${componentName}Props) {`);
  lines.push(`  const [search, setSearch] = useState('');`);
  lines.push(`  const [selected, setSelected] = useState<string | null>(null);`);
  lines.push('');
  lines.push(`  const filteredItems = useMemo(() =>`);
  lines.push(`    items.filter(item => item.name.toLowerCase().includes(search.toLowerCase())),`);
  lines.push(`    [items, search]`);
  lines.push(`  );`);
  lines.push('');
  lines.push(`  const handleSelect = useCallback((id: string) => {`);
  lines.push(`    setSelected(id);`);
  lines.push(`    onAction?.(id);`);
  lines.push(`  }, [onAction]);`);
  lines.push('');

  // JSX return — this is the part that matters for parsing
  lines.push('  return (');

  // Sometimes add a context annotation
  if (Math.random() > 0.7) {
    lines.push(`    // @a11y-context bg:#09090b`);
  }

  // Main wrapper
  const wrapperBg = randomChoice(BG_CLASSES);
  lines.push(`    <div className="${wrapperBg} min-h-screen p-6">`);

  // Header section
  lines.push(`      <div className="max-w-4xl mx-auto">`);
  lines.push(`        <div className="flex items-center justify-between mb-8">`);
  lines.push(`          <h1 className={cn("text-3xl font-bold tracking-tight", "${randomChoice(TEXT_CLASSES)}")}>{\`\${title}\`}</h1>`);
  lines.push(`          <Badge className="${randomChoice(BG_CLASSES)} ${randomChoice(TEXT_CLASSES)} px-3 py-1 rounded-full">{variant}</Badge>`);
  lines.push(`        </div>`);

  if (Math.random() > 0.5) {
    lines.push(`        {description && (`);
    lines.push(`          <p className="${randomChoice(TEXT_CLASSES)} text-lg mb-6">{description}</p>`);
    lines.push(`        )}`);
  }

  // Search input
  lines.push(`        <div className="mb-6">`);
  lines.push(`          <Input`);
  lines.push(`            className="bg-white dark:bg-zinc-900 ${randomChoice(TEXT_CLASSES)} border-${['gray-200', 'slate-700', 'zinc-600'][Math.floor(Math.random() * 3)]} placeholder:text-gray-400"`);
  lines.push(`            placeholder="Search items..."`);
  lines.push(`            value={search}`);
  lines.push(`            onChange={(e) => setSearch(e.target.value)}`);
  lines.push(`          />`);
  lines.push(`        </div>`);

  // Generate multiple card items (this creates realistic nesting depth)
  const itemCount = 3 + Math.floor(Math.random() * 5); // 3-7 items
  lines.push(`        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">`);

  for (let i = 0; i < itemCount; i++) {
    const cardBg = randomChoice(BG_CLASSES);
    const borderClass = randomChoice(BORDER_CLASSES);

    lines.push(`          <Card className={cn("${cardBg} ${borderClass} shadow-sm hover:shadow-md transition-shadow", selected === filteredItems[${i}]?.id && "ring-2 ring-blue-500")}>`);
    lines.push(`            <CardHeader className="pb-3">`);
    lines.push(`              <CardTitle className="${randomChoice(TEXT_CLASSES)} text-lg font-semibold">`);
    lines.push(`                {filteredItems[${i}]?.name ?? 'Unnamed'}`);
    lines.push(`              </CardTitle>`);

    // Status badge
    const badgeBg = randomChoice(BG_CLASSES);
    const badgeText = randomChoice(TEXT_CLASSES);
    lines.push(`              <Badge className="${badgeBg} ${badgeText} text-xs">{filteredItems[${i}]?.status}</Badge>`);
    lines.push(`            </CardHeader>`);

    lines.push(`            <CardContent>`);

    // Content area with multiple text elements
    lines.push(`              <p className="${randomChoice(TEXT_CLASSES)} text-sm leading-relaxed">`);
    lines.push(`                This is item ${i} content with detailed description.`);
    lines.push(`              </p>`);

    // Sometimes add interactive elements
    if (Math.random() > 0.4) {
      const btnBg = randomChoice(BG_CLASSES);
      const btnText = randomChoice(TEXT_CLASSES);
      const hoverBg = randomChoice(BG_CLASSES).replace('bg-', 'hover:bg-');
      lines.push(`              <div className="flex gap-2 mt-4">`);
      lines.push(`                <Button`);
      lines.push(`                  className="${btnBg} ${btnText} ${hoverBg} px-4 py-2 rounded-md font-medium"`);
      lines.push(`                  onClick={() => handleSelect(filteredItems[${i}]?.id ?? '')}`);
      lines.push(`                >`);
      lines.push(`                  Select`);
      lines.push(`                </Button>`);

      // Sometimes add a disabled button
      if (Math.random() > 0.5) {
        lines.push(`                <Button disabled className="bg-gray-200 text-gray-400 cursor-not-allowed px-4 py-2 rounded-md">`);
        lines.push(`                  Disabled`);
        lines.push(`                </Button>`);
      }

      lines.push(`              </div>`);
    }

    // Sometimes add a11y-ignore annotation
    if (Math.random() > 0.85) {
      lines.push(`              {/* a11y-ignore: dynamic theming */}`);
      lines.push(`              <div className="${randomChoice(TEXT_CLASSES)}">Dynamic content</div>`);
    }

    lines.push(`            </CardContent>`);
    lines.push(`          </Card>`);
  }

  lines.push(`        </div>`);

  // Footer section
  lines.push(`        <div className="mt-8 flex items-center justify-between ${randomChoice(TEXT_CLASSES)}">`);
  lines.push(`          <span className="text-sm">{filteredItems.length} items</span>`);
  lines.push(`          <button className="${randomChoice(BG_CLASSES)} ${randomChoice(TEXT_CLASSES)} hover:${randomChoice(BG_CLASSES).replace('bg-', 'bg-')} px-4 py-2 rounded-lg transition-colors">`);
  lines.push(`            Load More`);
  lines.push(`          </button>`);
  lines.push(`        </div>`);

  // Close wrappers
  lines.push(`      </div>`);
  lines.push(`    </div>`);
  lines.push('  );');
  lines.push('}');
  lines.push('');

  // Sometimes add a sub-component
  if (Math.random() > 0.6) {
    lines.push(`function ${componentName}Skeleton() {`);
    lines.push('  return (');
    lines.push(`    <div className="${randomChoice(BG_CLASSES)} animate-pulse rounded-lg p-4">`);
    lines.push(`      <div className="h-4 ${randomChoice(BG_CLASSES)} rounded w-3/4 mb-2" />`);
    lines.push(`      <div className="h-3 ${randomChoice(BG_CLASSES)} rounded w-1/2" />`);
    lines.push(`    </div>`);
    lines.push('  );');
    lines.push('}');
  }

  return lines.join('\n');
}

// ── Benchmark Runner ────────────────────────────────────────────────

console.log('=== Performance Benchmark: Native Rust vs TypeScript Legacy ===\n');
console.log(`Config: ${fileCount} files, ${warmupRuns} warmup runs, ${benchRuns} measured runs\n`);

// Generate files
console.log('Generating synthetic JSX files...');
const files: Array<{ path: string; content: string }> = [];
let totalLines = 0;
let totalChars = 0;

for (let i = 0; i < fileCount; i++) {
  const content = generateJSXFile(i);
  files.push({ path: `src/components/Component${i}.tsx`, content });
  totalLines += content.split('\n').length;
  totalChars += content.length;
}

console.log(`  ${fileCount} files, ${totalLines} total lines, ${(totalChars / 1024).toFixed(1)} KB\n`);

const CONTAINER_MAP = new Map([
  ['Card', 'bg-card'],
  ['Dialog', 'bg-background'],
  ['Button', 'bg-primary'],
  ['Badge', 'bg-secondary'],
  ['Alert', 'bg-destructive'],
]);
const CONTAINER_ENTRIES = Array.from(CONTAINER_MAP.entries()).map(
  ([component, bgClass]) => ({ component, bgClass }),
);
const DEFAULT_BG = 'bg-background';

// ── TypeScript Benchmark ────────────────────────────────────────────

console.log('--- TypeScript Legacy Parser ---');

// Warmup
for (let w = 0; w < warmupRuns; w++) {
  for (const file of files) {
    extractClassRegions(file.content, CONTAINER_MAP, DEFAULT_BG);
  }
}

const tsTimes: number[] = [];
let tsRegionCount = 0;

for (let r = 0; r < benchRuns; r++) {
  const start = performance.now();
  for (const file of files) {
    const regions = extractClassRegions(file.content, CONTAINER_MAP, DEFAULT_BG);
    if (r === 0) tsRegionCount += regions.length;
  }
  const elapsed = performance.now() - start;
  tsTimes.push(elapsed);
  console.log(`  Run ${r + 1}: ${elapsed.toFixed(1)}ms`);
}

const tsMedian = tsTimes.sort((a, b) => a - b)[Math.floor(tsTimes.length / 2)]!;
const tsAvg = tsTimes.reduce((s, t) => s + t, 0) / tsTimes.length;

console.log(`  Median: ${tsMedian.toFixed(1)}ms, Avg: ${tsAvg.toFixed(1)}ms, Regions: ${tsRegionCount}\n`);

// ── Native Benchmark ────────────────────────────────────────────────

console.log('--- Native Rust Engine ---');

// Warmup
for (let w = 0; w < warmupRuns; w++) {
  nativeModule!.extractAndScan({
    fileContents: files,
    containerConfig: CONTAINER_ENTRIES,
    defaultBg: DEFAULT_BG,
  });
}

const nativeTimes: number[] = [];
let nativeRegionCount = 0;

for (let r = 0; r < benchRuns; r++) {
  const start = performance.now();
  const result = nativeModule!.extractAndScan({
    fileContents: files,
    containerConfig: CONTAINER_ENTRIES,
    defaultBg: DEFAULT_BG,
  });
  const elapsed = performance.now() - start;
  nativeTimes.push(elapsed);
  if (r === 0) {
    nativeRegionCount = result.reduce((s, f) => s + f.regions.length, 0);
  }
  console.log(`  Run ${r + 1}: ${elapsed.toFixed(1)}ms`);
}

const nativeMedian = nativeTimes.sort((a, b) => a - b)[Math.floor(nativeTimes.length / 2)]!;
const nativeAvg = nativeTimes.reduce((s, t) => s + t, 0) / nativeTimes.length;

console.log(`  Median: ${nativeMedian.toFixed(1)}ms, Avg: ${nativeAvg.toFixed(1)}ms, Regions: ${nativeRegionCount}\n`);

// ── Comparison ──────────────────────────────────────────────────────

console.log('=== Results ===');
console.log(`TypeScript:  ${tsMedian.toFixed(1)}ms median (${tsRegionCount} regions)`);
console.log(`Native:      ${nativeMedian.toFixed(1)}ms median (${nativeRegionCount} regions)`);

const speedup = ((tsMedian - nativeMedian) / tsMedian * 100);
const ratio = tsMedian / nativeMedian;

console.log(`Speedup:     ${speedup.toFixed(1)}% (${ratio.toFixed(1)}x faster)`);

console.log('');
console.log('Analysis:');
if (speedup >= 70) {
  console.log(`  Target met: >70% scan time reduction`);
} else if (speedup >= 30) {
  console.log(`  Parser-only speedup: ${speedup.toFixed(1)}% (${ratio.toFixed(1)}x faster)`);
  console.log(`  The Rust parser is significantly faster, but NAPI-RS serialization`);
  console.log(`  of ${nativeRegionCount} ClassRegion objects adds overhead at the boundary.`);
  console.log(`  Full pipeline savings will be higher when contrast checking also`);
  console.log(`  moves to Rust (Phase 2), reducing total JS↔Rust round-trips.`);
} else {
  console.log(`  Minimal speedup — investigate rayon thread pool and NAPI overhead.`);
}
