import { describe, it, expect, vi } from 'vitest';
import { generateJsonReport } from '../json.js';
import type { AuditResult, ThemeMode } from '../../types.js';

function makeResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    filesScanned: 3,
    pairsChecked: 10,
    violations: [],
    passed: [],
    skipped: [],
    ignored: [],
    ...overrides,
  };
}

describe('generateJsonReport', () => {
  it('returns valid JSON', () => {
    const result = generateJsonReport([{ mode: 'light', result: makeResult() }]);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('has summary with correct totals for empty results', () => {
    const result = generateJsonReport([{ mode: 'light', result: makeResult() }]);
    const parsed = JSON.parse(result);
    expect(parsed.summary).toEqual({
      filesScanned: 3,
      totalPairs: 10,
      totalViolations: 0,
      textViolations: 0,
      nonTextViolations: 0,
      totalSkipped: 0,
      totalIgnored: 0,
    });
  });

  it('counts text vs non-text violations correctly', () => {
    const violations = [
      { pairType: undefined, file: 'a.tsx', line: 1, bgClass: 'bg-white', textClass: 'text-gray-400', bgHex: '#fff', textHex: '#9ca3af', ratio: 2.5, passAA: false, passAALarge: false, passAAA: false, passAAALarge: false },
      { pairType: 'border' as const, file: 'a.tsx', line: 2, bgClass: 'bg-white', textClass: 'border-gray-400', bgHex: '#fff', textHex: '#9ca3af', ratio: 2.5, passAA: false, passAALarge: false, passAAA: false, passAAALarge: false },
    ];
    const result = generateJsonReport([
      { mode: 'light', result: makeResult({ violations, pairsChecked: 2 }) },
    ]);
    const parsed = JSON.parse(result);
    expect(parsed.summary.textViolations).toBe(1);
    expect(parsed.summary.nonTextViolations).toBe(1);
  });

  it('includes per-theme data', () => {
    const result = generateJsonReport([
      { mode: 'light', result: makeResult({ pairsChecked: 5 }) },
      { mode: 'dark', result: makeResult({ pairsChecked: 7 }) },
    ]);
    const parsed = JSON.parse(result);
    expect(parsed.themes).toHaveLength(2);
    expect(parsed.themes[0].mode).toBe('light');
    expect(parsed.themes[0].pairsChecked).toBe(5);
    expect(parsed.themes[1].mode).toBe('dark');
    expect(parsed.themes[1].pairsChecked).toBe(7);
  });

  it('includes timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-13T12:00:00Z'));

    const result = generateJsonReport([{ mode: 'light', result: makeResult() }]);
    const parsed = JSON.parse(result);
    expect(parsed.timestamp).toBe('2026-02-13T12:00:00.000Z');

    vi.useRealTimers();
  });

  it('sums violations across themes', () => {
    const violation = {
      file: 'a.tsx', line: 1, bgClass: 'bg-white', textClass: 'text-gray-400',
      bgHex: '#fff', textHex: '#9ca3af', ratio: 2.5,
      passAA: false, passAALarge: false, passAAA: false, passAAALarge: false,
    };
    const result = generateJsonReport([
      { mode: 'light', result: makeResult({ violations: [violation], pairsChecked: 1 }) },
      { mode: 'dark', result: makeResult({ violations: [violation, violation], pairsChecked: 2 }) },
    ]);
    const parsed = JSON.parse(result);
    expect(parsed.summary.totalViolations).toBe(3);
  });
});
