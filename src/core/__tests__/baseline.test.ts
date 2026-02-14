import { describe, test, expect } from 'vitest';
import { generateViolationHash } from '../baseline.js';
import type { ContrastResult } from '../types.js';

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
