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

describe('generateJsonReport with suggestions', () => {
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

    const results = [{ mode: 'light' as ThemeMode, result: makeResult([violation]) }];
    const json = JSON.parse(generateJsonReport(results));

    expect(json.themes[0].violations[0].suggestions).toBeDefined();
    expect(json.themes[0].violations[0].suggestions).toHaveLength(1);
    expect(json.themes[0].violations[0].suggestions[0].suggestedClass).toBe('text-gray-600');
    expect(json.themes[0].violations[0].suggestions[0].suggestedHex).toBe('#4b5563');
    expect(json.themes[0].violations[0].suggestions[0].newRatio).toBe(5.91);
    expect(json.themes[0].violations[0].suggestions[0].shadeDistance).toBe(1);
  });

  test('omits suggestions field when not present', () => {
    const violation = makeViolation({});
    const results = [{ mode: 'light' as ThemeMode, result: makeResult([violation]) }];
    const json = JSON.parse(generateJsonReport(results));

    expect(json.themes[0].violations[0].suggestions).toBeUndefined();
  });
});
