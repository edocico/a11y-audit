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

describe('generateReport with suggestions', () => {
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

    const results = [{ mode: 'light' as ThemeMode, result: makeResult([violation]) }];
    const report = generateReport(results);

    expect(report).toContain('text-gray-600');
    expect(report).toContain('5.91:1');
    expect(report).toContain('text-gray-700');
    expect(report).toContain('Suggestion');
  });

  test('does not render suggestion line when no suggestions', () => {
    const violation = makeViolation({ suggestions: [] });
    const results = [{ mode: 'light' as ThemeMode, result: makeResult([violation]) }];
    const report = generateReport(results);

    expect(report).not.toContain('Suggestion');
  });

  test('renders suggestion line below non-text violations', () => {
    const violation = makeViolation({
      pairType: 'border',
      textClass: 'border-gray-200',
      textHex: '#e5e7eb',
      ratio: 1.12,
      suggestions: [
        { suggestedClass: 'border-gray-400', suggestedHex: '#9ca3af', newRatio: 3.01, shadeDistance: 2 },
      ],
    });

    const results = [{ mode: 'light' as ThemeMode, result: makeResult([violation]) }];
    const report = generateReport(results);

    expect(report).toContain('border-gray-400');
    expect(report).toContain('3.01:1');
    expect(report).toContain('Suggestion');
  });

  test('does not render suggestion line when suggestions undefined', () => {
    const violation = makeViolation();
    const results = [{ mode: 'light' as ThemeMode, result: makeResult([violation]) }];
    const report = generateReport(results);

    expect(report).not.toContain('Suggestion');
  });
});
