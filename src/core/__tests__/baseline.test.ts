import { describe, test, expect } from 'vitest';
import { generateViolationHash, reconcileViolations } from '../baseline.js';
import type { BaselineData, ContrastResult } from '../types.js';

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

function buildBaseline(violations: ContrastResult[]): BaselineData {
  const hashes: Record<string, Record<string, number>> = {};
  for (const v of violations) {
    const hash = generateViolationHash(v);
    hashes[v.file] ??= {};
    hashes[v.file]![hash] = (hashes[v.file]![hash] ?? 0) + 1;
  }
  return { version: '1.1.0', generatedAt: '2026-01-01T00:00:00Z', violations: hashes };
}

describe('generateViolationHash', () => {
  test('produces a 64-char hex SHA-256 hash', () => {
    const hash = generateViolationHash(makeViolation());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('same violation produces identical hash', () => {
    const v = makeViolation();
    expect(generateViolationHash(v)).toBe(generateViolationHash(v));
  });

  test('hash is stable regardless of line number', () => {
    const v1 = makeViolation({ line: 10 });
    const v2 = makeViolation({ line: 999 });
    expect(generateViolationHash(v1)).toBe(generateViolationHash(v2));
  });

  test('hash is stable regardless of ratio value', () => {
    const v1 = makeViolation({ ratio: 3.8 });
    const v2 = makeViolation({ ratio: 5.1 });
    expect(generateViolationHash(v1)).toBe(generateViolationHash(v2));
  });

  test('hash differs when file path differs', () => {
    const v1 = makeViolation({ file: 'src/A.tsx' });
    const v2 = makeViolation({ file: 'src/B.tsx' });
    expect(generateViolationHash(v1)).not.toBe(generateViolationHash(v2));
  });

  test('hash is stable when bgClass words are reordered', () => {
    const v1 = makeViolation({ bgClass: 'bg-red-500 bg-opacity-50' });
    const v2 = makeViolation({ bgClass: 'bg-opacity-50 bg-red-500' });
    expect(generateViolationHash(v1)).toBe(generateViolationHash(v2));
  });

  test('hash differs when pairType differs', () => {
    const v1 = makeViolation({ pairType: 'text' });
    const v2 = makeViolation({ pairType: 'border' });
    expect(generateViolationHash(v1)).not.toBe(generateViolationHash(v2));
  });

  test('hash differs when interactiveState differs', () => {
    const v1 = makeViolation({ interactiveState: null });
    const v2 = makeViolation({ interactiveState: 'hover' });
    expect(generateViolationHash(v1)).not.toBe(generateViolationHash(v2));
  });

  test('undefined pairType and interactiveState have stable defaults', () => {
    const v1 = makeViolation({ pairType: undefined, interactiveState: undefined });
    const v2 = makeViolation({ pairType: undefined, interactiveState: undefined });
    expect(generateViolationHash(v1)).toBe(generateViolationHash(v2));
  });
});

describe('reconcileViolations', () => {
  test('no baseline → all violations are new', () => {
    const violations = [makeViolation(), makeViolation({ file: 'src/Other.tsx' })];
    const result = reconcileViolations(violations, null);

    expect(result.newCount).toBe(2);
    expect(result.knownCount).toBe(0);
    expect(result.fixedCount).toBe(0);
    expect(result.baselineTotal).toBe(0);
    expect(result.annotated).toHaveLength(2);
    expect(result.annotated.every(v => v.isBaseline === false)).toBe(true);
  });

  test('all violations in baseline → all are known', () => {
    const violations = [makeViolation()];
    const baseline = buildBaseline(violations);
    const result = reconcileViolations(violations, baseline);

    expect(result.newCount).toBe(0);
    expect(result.knownCount).toBe(1);
    expect(result.fixedCount).toBe(0);
    expect(result.annotated[0]!.isBaseline).toBe(true);
  });

  test('mix of new and known violations', () => {
    const known = makeViolation({ textClass: 'text-gray-400' });
    const newV = makeViolation({ textClass: 'text-red-300' });
    const baseline = buildBaseline([known]);
    const result = reconcileViolations([known, newV], baseline);

    expect(result.newCount).toBe(1);
    expect(result.knownCount).toBe(1);
  });

  test('leaky bucket: more in baseline than current → all known, zero new', () => {
    const v = makeViolation();
    const baseline = buildBaseline([v, v, v, v, v]);
    const result = reconcileViolations([v, v, v], baseline);

    expect(result.newCount).toBe(0);
    expect(result.knownCount).toBe(3);
    expect(result.fixedCount).toBe(2);
  });

  test('leaky bucket: more current than baseline → excess are new', () => {
    const v = makeViolation();
    const baseline = buildBaseline([v, v]);
    const result = reconcileViolations([v, v, v, v, v], baseline);

    expect(result.newCount).toBe(3);
    expect(result.knownCount).toBe(2);
    expect(result.fixedCount).toBe(0);
  });

  test('fixed count: baseline hashes not in current run', () => {
    const current = makeViolation({ textClass: 'text-blue-500' });
    const fixed = makeViolation({ textClass: 'text-red-500' });
    const baseline = buildBaseline([current, fixed, fixed]);
    const result = reconcileViolations([current], baseline);

    expect(result.newCount).toBe(0);
    expect(result.knownCount).toBe(1);
    expect(result.fixedCount).toBe(2);
  });

  test('empty current with non-empty baseline → all fixed', () => {
    const baseline = buildBaseline([makeViolation(), makeViolation()]);
    const result = reconcileViolations([], baseline);

    expect(result.newCount).toBe(0);
    expect(result.knownCount).toBe(0);
    expect(result.fixedCount).toBe(2);
  });

  test('preserves input order of violations', () => {
    const v1 = makeViolation({ textClass: 'text-red-500', line: 1 });
    const v2 = makeViolation({ textClass: 'text-blue-500', line: 2 });
    const v3 = makeViolation({ textClass: 'text-green-500', line: 3 });
    const result = reconcileViolations([v1, v2, v3], null);

    expect(result.annotated[0]!.line).toBe(1);
    expect(result.annotated[1]!.line).toBe(2);
    expect(result.annotated[2]!.line).toBe(3);
  });
});
