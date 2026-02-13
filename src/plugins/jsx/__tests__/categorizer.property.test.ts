import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { stripVariants } from '../categorizer.js';

// ── Generators ──────────────────────────────────────────────────────────

/** Generates a Tailwind-like class name with optional variant prefixes */
const variantPrefix = fc.constantFrom(
  '',
  'dark:',
  'hover:',
  'focus-visible:',
  'dark:hover:',
  'aria-disabled:',
);
const baseClass = fc.constantFrom(
  'bg-primary',
  'text-white',
  'border-red-500',
  'ring-blue-300',
  'outline-green-600',
  'bg-card',
  'text-muted-foreground',
  'bg-[#ff0000]',
);
const tailwindClass = fc.tuple(variantPrefix, baseClass).map(([p, b]) => p + b);

// ── stripVariants ───────────────────────────────────────────────────────

describe('stripVariants — property-based', () => {
  test('idempotency: stripping base again produces same result', () => {
    fc.assert(
      fc.property(tailwindClass, (cls) => {
        const first = stripVariants(cls);
        const second = stripVariants(first.base);
        expect(second.base).toBe(first.base);
        expect(second.isDark).toBe(false);
        expect(second.isInteractive).toBe(false);
        expect(second.interactiveState).toBeNull();
      }),
      { numRuns: 300 },
    );
  });

  test('raw field always equals original input', () => {
    fc.assert(
      fc.property(tailwindClass, (cls) => {
        const result = stripVariants(cls);
        expect(result.raw).toBe(cls);
      }),
      { numRuns: 300 },
    );
  });

  test('base never contains variant prefixes', () => {
    const knownPrefixes = [
      'dark:',
      'hover:',
      'focus-visible:',
      'focus:',
      'active:',
      'aria-disabled:',
    ];
    fc.assert(
      fc.property(tailwindClass, (cls) => {
        const result = stripVariants(cls);
        for (const prefix of knownPrefixes) {
          expect(result.base.startsWith(prefix)).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  test('dark: prefix sets isDark=true', () => {
    fc.assert(
      fc.property(baseClass, (base) => {
        const result = stripVariants(`dark:${base}`);
        expect(result.isDark).toBe(true);
        expect(result.base).toBe(base);
      }),
      { numRuns: 100 },
    );
  });

  test('hover: prefix sets isInteractive=true with state=hover', () => {
    fc.assert(
      fc.property(baseClass, (base) => {
        const result = stripVariants(`hover:${base}`);
        expect(result.isInteractive).toBe(true);
        expect(result.interactiveState).toBe('hover');
      }),
      { numRuns: 100 },
    );
  });

  test('dark:hover: compound sets both flags', () => {
    fc.assert(
      fc.property(baseClass, (base) => {
        const result = stripVariants(`dark:hover:${base}`);
        expect(result.isDark).toBe(true);
        expect(result.isInteractive).toBe(true);
        expect(result.interactiveState).toBe('hover');
        expect(result.base).toBe(base);
      }),
      { numRuns: 100 },
    );
  });
});
