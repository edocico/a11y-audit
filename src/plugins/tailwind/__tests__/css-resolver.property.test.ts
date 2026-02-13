import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { combineAlpha } from '../css-resolver.js';

// ── combineAlpha — property-based ────────────────────────────────────────

describe('combineAlpha — property-based', () => {
  /** Alpha in (0, 0.998] — avoids the >= 0.999 → undefined opaque cutoff */
  const strictAlpha = fc.double({
    min: 0.001, max: 0.998, noNaN: true
  });

  test('result is always in [0, 1) when both are sub-opaque', () => {
    fc.assert(
      fc.property(strictAlpha, strictAlpha, (a1, a2) => {
        const result = combineAlpha(a1, a2);
        expect(result).toBeDefined();
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThan(1);
      }),
      { numRuns: 500 }
    );
  });

  test('undefined * undefined = undefined (fully opaque)', () => {
    expect(combineAlpha(undefined, undefined)).toBeUndefined();
  });

  test('alpha * 1.0 = alpha (identity)', () => {
    fc.assert(
      fc.property(strictAlpha, (a) => {
        const result = combineAlpha(a, undefined);
        expect(result).toBeCloseTo(a, 5);
      }),
      { numRuns: 200 }
    );
  });

  test('commutativity: combineAlpha(a, b) === combineAlpha(b, a)', () => {
    fc.assert(
      fc.property(strictAlpha, strictAlpha, (a1, a2) => {
        const r1 = combineAlpha(a1, a2);
        const r2 = combineAlpha(a2, a1);
        if (r1 === undefined || r2 === undefined) {
          expect(r1).toEqual(r2);
        } else {
          expect(r1).toBeCloseTo(r2, 10);
        }
      }),
      { numRuns: 300 }
    );
  });

  test('values >= 0.999 product collapse to undefined (opaque)', () => {
    expect(combineAlpha(1.0, 1.0)).toBeUndefined();
    expect(combineAlpha(0.9999, 1.0)).toBeUndefined();
    expect(combineAlpha(0.9995, 0.9995)).toBeUndefined();
  });
});
