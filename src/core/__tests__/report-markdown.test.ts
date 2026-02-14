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
