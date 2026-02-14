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
