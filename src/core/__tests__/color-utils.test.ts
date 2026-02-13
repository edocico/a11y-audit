import { describe, test, expect } from 'vitest';
import { toHex } from '../color-utils.js';

// ── toHex: direct hex passthrough ───────────────────────────────────

describe('toHex', () => {
  describe('direct hex', () => {
    test('passes through 6-digit hex unchanged', () => {
      expect(toHex('#ff0000')).toBe('#ff0000');
      expect(toHex('#1e293b')).toBe('#1e293b');
      expect(toHex('#ffffff')).toBe('#ffffff');
    });

    test('expands 3-digit hex to 6-digit', () => {
      expect(toHex('#f00')).toBe('#ff0000');
      expect(toHex('#abc')).toBe('#aabbcc');
      expect(toHex('#000')).toBe('#000000');
    });

    test('expands 4-digit hex (#rgba) to 8-digit (#rrggbbaa)', () => {
      expect(toHex('#f008')).toBe('#ff000088');
      expect(toHex('#abcd')).toBe('#aabbccdd');
    });

    test('passes through 8-digit hex unchanged', () => {
      expect(toHex('#ff000080')).toBe('#ff000080');
      expect(toHex('#1e293bcc')).toBe('#1e293bcc');
    });
  });

  // ── toHex: oklch ──────────────────────────────────────────────────

  describe('oklch', () => {
    test('converts oklch with decimal lightness', () => {
      const hex = toHex('oklch(0.5 0.2 240)');
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(hex).not.toBeNull();
    });

    test('converts oklch with percentage lightness', () => {
      const hex = toHex('oklch(50% 0.2 240)');
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    });

    test('oklch decimal and percentage lightness produce same hex', () => {
      const decimal = toHex('oklch(0.5 0.2 240)');
      const percent = toHex('oklch(50% 0.2 240)');
      expect(decimal).toBe(percent);
    });

    test('oklch with alpha returns 8-digit hex', () => {
      const hex = toHex('oklch(0.5 0.2 240 / 0.5)');
      expect(hex).not.toBeNull();
      // Alpha 0.5 → 128 → hex 80
      expect(hex).toMatch(/^#[0-9a-f]{8}$/);
      expect(hex!.slice(7)).toBe('80');
    });

    test('oklch with alpha=1 returns 6-digit hex (no alpha suffix)', () => {
      const hex = toHex('oklch(0.5 0.2 240 / 1)');
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    });

    test('oklch with percentage lightness + alpha', () => {
      const hex = toHex('oklch(50% 0.2 240 / 0.5)');
      expect(hex).toMatch(/^#[0-9a-f]{8}$/);
    });
  });

  // ── toHex: hsl ────────────────────────────────────────────────────

  describe('hsl', () => {
    test('converts CSS4 space-separated hsl', () => {
      const hex = toHex('hsl(210 40% 98%)');
      expect(hex).toBe('#f8fafc');
    });

    test('converts traditional comma-separated hsl', () => {
      const hex = toHex('hsl(210, 40%, 98%)');
      expect(hex).toBe('#f8fafc');
    });

    test('hsl with alpha returns 8-digit hex', () => {
      const hex = toHex('hsl(210 40% 98% / 0.5)');
      expect(hex).not.toBeNull();
      expect(hex).toMatch(/^#[0-9a-f]{8}$/);
    });
  });

  // ── toHex: display-p3 (CSS Color Level 4) ─────────────────────────

  describe('display-p3', () => {
    test('converts color(display-p3 ...) to sRGB hex', () => {
      const hex = toHex('color(display-p3 1 0.5 0)');
      expect(hex).not.toBeNull();
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  // ── toHex: special values ─────────────────────────────────────────

  describe('special values', () => {
    test('returns null for transparent', () => {
      expect(toHex('transparent')).toBeNull();
    });

    test('returns null for inherit', () => {
      expect(toHex('inherit')).toBeNull();
    });

    test('returns null for currentColor', () => {
      expect(toHex('currentColor')).toBeNull();
    });

    test('returns null for empty string', () => {
      expect(toHex('')).toBeNull();
    });

    test('returns null for unparseable value', () => {
      expect(toHex('not-a-color')).toBeNull();
    });
  });

  // ── toHex: rgb ────────────────────────────────────────────────────

  describe('rgb', () => {
    test('converts rgb() function', () => {
      expect(toHex('rgb(255, 0, 0)')).toBe('#ff0000');
    });

    test('converts CSS4 space-separated rgb', () => {
      expect(toHex('rgb(255 0 128)')).toBe('#ff0080');
    });
  });

  // ── toHex: edge cases ─────────────────────────────────────────────

  describe('edge cases', () => {
    test('handles culori parse failure gracefully', () => {
      expect(toHex('notacolor(0 0 0)')).toBeNull();
    });
  });
});
