import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { BaselineData, ContrastResult } from './types.js';

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
