import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { BaselineData, BaselineSummary, ContrastResult } from './types.js';

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
