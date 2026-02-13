/**
 * Property-based tests for contrast-checker using fast-check.
 * Validates mathematical invariants across randomly generated inputs.
 */
import { describe, test, expect, vi } from 'vitest';
import fc from 'fast-check';
import { compositeOver, parseHexRGB } from '../contrast-checker.js';

// ── Generators ──────────────────────────────────────────────────────────

/** Generates a valid 7-char hex color string: #rrggbb */
const hexColor = fc
  .tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
  )
  .map(
    ([r, g, b]) =>
      `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
  );

/** Generates alpha in [0, 1] */
const alpha01 = fc.double({ min: 0, max: 1, noNaN: true });

// ── compositeOver ───────────────────────────────────────────────────────

describe('compositeOver — property-based', () => {
  test('always returns a valid 7-char hex string', () => {
    fc.assert(
      fc.property(hexColor, hexColor, alpha01, (fg, bg, a) => {
        const result = compositeOver(fg, bg, a);
        expect(result).toMatch(/^#[0-9a-f]{6}$/);
      }),
      { numRuns: 500 },
    );
  });

  test('alpha=0 returns bg unchanged', () => {
    fc.assert(
      fc.property(hexColor, hexColor, (fg, bg) => {
        expect(compositeOver(fg, bg, 0)).toBe(bg);
      }),
      { numRuns: 200 },
    );
  });

  test('alpha=1 returns fg unchanged', () => {
    fc.assert(
      fc.property(hexColor, hexColor, (fg, bg) => {
        expect(compositeOver(fg, bg, 1)).toBe(fg);
      }),
      { numRuns: 200 },
    );
  });

  test('compositing identical fg and bg returns that color for any alpha', () => {
    fc.assert(
      fc.property(hexColor, alpha01, (color, a) => {
        expect(compositeOver(color, color, a)).toBe(color);
      }),
      { numRuns: 200 },
    );
  });

  test('each RGB channel stays in [0, 255] range', () => {
    fc.assert(
      fc.property(hexColor, hexColor, alpha01, (fg, bg, a) => {
        const result = compositeOver(fg, bg, a);
        const parsed = parseHexRGB(result);
        expect(parsed.r).toBeGreaterThanOrEqual(0);
        expect(parsed.r).toBeLessThanOrEqual(255);
        expect(parsed.g).toBeGreaterThanOrEqual(0);
        expect(parsed.g).toBeLessThanOrEqual(255);
        expect(parsed.b).toBeGreaterThanOrEqual(0);
        expect(parsed.b).toBeLessThanOrEqual(255);
      }),
      { numRuns: 500 },
    );
  });
});

// ── parseHexRGB ─────────────────────────────────────────────────────────

describe('parseHexRGB — property-based', () => {
  test('round-trip: parse → reconstruct → equals original', () => {
    fc.assert(
      fc.property(hexColor, (hex) => {
        const { r, g, b } = parseHexRGB(hex);
        const reconstructed = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        expect(reconstructed).toBe(hex);
      }),
      { numRuns: 500 },
    );
  });

  test('all channels in [0, 255]', () => {
    fc.assert(
      fc.property(hexColor, (hex) => {
        const { r, g, b } = parseHexRGB(hex);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(255);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(255);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(255);
      }),
      { numRuns: 500 },
    );
  });

  test('malformed input defaults to black (0,0,0)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/^#[0-9a-fA-F]{6}/.test(s)),
        (malformed) => {
          const result = parseHexRGB(malformed);
          expect(result).toEqual({ r: 0, g: 0, b: 0 });
        },
      ),
      { numRuns: 200 },
    );
    warn.mockRestore();
  });
});
