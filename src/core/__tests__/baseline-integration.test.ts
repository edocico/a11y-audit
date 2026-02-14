import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { ContrastResult, BaselineData } from '../types.js';
import {
  generateViolationHash,
  loadBaseline,
  saveBaseline,
  reconcileViolations,
} from '../baseline.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

function makeViolation(overrides: Partial<ContrastResult> = {}): ContrastResult {
  return {
    file: 'src/components/Button.tsx',
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

beforeEach(() => { vi.clearAllMocks(); });

describe('baseline round-trip integration', () => {
  test('save -> load -> reconcile preserves all known violations', () => {
    const violations = [
      makeViolation({ textClass: 'text-gray-400' }),
      makeViolation({ textClass: 'text-gray-500' }),
      makeViolation({ textClass: 'text-red-300', file: 'src/Header.tsx' }),
    ];

    let savedJson = '';
    vi.mocked(writeFileSync).mockImplementation((_p, content) => { savedJson = content as string; });
    saveBaseline('/path/baseline.json', violations);

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(savedJson);
    const baseline = loadBaseline('/path/baseline.json');
    expect(baseline).not.toBeNull();

    const result = reconcileViolations(violations, baseline!);
    expect(result.newCount).toBe(0);
    expect(result.knownCount).toBe(3);
    expect(result.fixedCount).toBe(0);
    expect(result.annotated.every(v => v.isBaseline === true)).toBe(true);
  });

  test('save -> add violation -> reconcile detects the new one', () => {
    const original = [makeViolation({ textClass: 'text-gray-400' })];

    let savedJson = '';
    vi.mocked(writeFileSync).mockImplementation((_p, content) => { savedJson = content as string; });
    saveBaseline('/path/baseline.json', original);

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(savedJson);
    const baseline = loadBaseline('/path/baseline.json')!;

    const current = [...original, makeViolation({ textClass: 'text-red-500' })];
    const result = reconcileViolations(current, baseline);
    expect(result.newCount).toBe(1);
    expect(result.knownCount).toBe(1);
    expect(result.fixedCount).toBe(0);
  });

  test('save -> fix violation -> reconcile detects the fix', () => {
    const original = [
      makeViolation({ textClass: 'text-gray-400' }),
      makeViolation({ textClass: 'text-red-500' }),
    ];

    let savedJson = '';
    vi.mocked(writeFileSync).mockImplementation((_p, content) => { savedJson = content as string; });
    saveBaseline('/path/baseline.json', original);

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(savedJson);
    const baseline = loadBaseline('/path/baseline.json')!;

    const current = [makeViolation({ textClass: 'text-gray-400' })];
    const result = reconcileViolations(current, baseline);
    expect(result.newCount).toBe(0);
    expect(result.knownCount).toBe(1);
    expect(result.fixedCount).toBe(1);
  });

  test('multi-theme: violations from both themes consume counts correctly', () => {
    // Simulate: same element fails in light + dark -> count 2 in baseline
    const v = makeViolation();

    let savedJson = '';
    vi.mocked(writeFileSync).mockImplementation((_p, content) => { savedJson = content as string; });
    saveBaseline('/path/baseline.json', [v, v]); // 2 copies (light + dark)

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(savedJson);
    const baseline = loadBaseline('/path/baseline.json')!;

    // Current run: same element still fails in both themes
    const result = reconcileViolations([v, v], baseline);
    expect(result.knownCount).toBe(2);
    expect(result.newCount).toBe(0);
    expect(result.fixedCount).toBe(0);
  });
});
