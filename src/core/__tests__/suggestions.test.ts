import { describe, test, expect } from 'vitest';
import { extractShadeFamilies } from '../suggestions.js';
import type { RawPalette } from '../types.js';

describe('extractShadeFamilies', () => {
  function makePalette(entries: [string, string][]): RawPalette {
    return new Map(entries);
  }

  test('groups numeric shades by family name', () => {
    const palette = makePalette([
      ['--color-gray-50', '#f9fafb'],
      ['--color-gray-100', '#f3f4f6'],
      ['--color-gray-500', '#6b7280'],
      ['--color-gray-900', '#111827'],
      ['--color-red-500', '#ef4444'],
      ['--color-red-600', '#dc2626'],
    ]);

    const families = extractShadeFamilies(palette);

    expect(families.size).toBe(2);

    const gray = families.get('gray');
    expect(gray).toBeDefined();
    expect(gray!.family).toBe('gray');
    expect(gray!.shades.size).toBe(4);
    expect(gray!.shades.get(500)).toBe('#6b7280');

    const red = families.get('red');
    expect(red).toBeDefined();
    expect(red!.shades.size).toBe(2);
  });

  test('ignores non-numeric entries (black, white, semantic)', () => {
    const palette = makePalette([
      ['--color-black', '#000000'],
      ['--color-white', '#ffffff'],
      ['--color-primary', '#0369a1'],
      ['--color-sky-700', '#0369a1'],
    ]);

    const families = extractShadeFamilies(palette);

    expect(families.has('black')).toBe(false);
    expect(families.has('white')).toBe(false);
    expect(families.has('primary')).toBe(false);
    expect(families.get('sky')?.shades.size).toBe(1);
  });

  test('returns empty map for empty palette', () => {
    const families = extractShadeFamilies(new Map());
    expect(families.size).toBe(0);
  });
});
