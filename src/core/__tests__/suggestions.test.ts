import { describe, test, expect } from 'vitest';
import { extractShadeFamilies, parseFamilyAndShade } from '../suggestions.js';
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

describe('parseFamilyAndShade', () => {
  test('parses standard text-family-shade classes', () => {
    expect(parseFamilyAndShade('text-gray-500')).toEqual({ prefix: 'text-', family: 'gray', shade: 500 });
    expect(parseFamilyAndShade('text-red-600')).toEqual({ prefix: 'text-', family: 'red', shade: 600 });
    expect(parseFamilyAndShade('text-sky-700')).toEqual({ prefix: 'text-', family: 'sky', shade: 700 });
  });

  test('parses bg-family-shade classes', () => {
    expect(parseFamilyAndShade('bg-slate-900')).toEqual({ prefix: 'bg-', family: 'slate', shade: 900 });
    expect(parseFamilyAndShade('bg-red-50')).toEqual({ prefix: 'bg-', family: 'red', shade: 50 });
  });

  test('parses non-text prefixes (border, ring, outline)', () => {
    expect(parseFamilyAndShade('border-gray-300')).toEqual({ prefix: 'border-', family: 'gray', shade: 300 });
    expect(parseFamilyAndShade('ring-blue-500')).toEqual({ prefix: 'ring-', family: 'blue', shade: 500 });
    expect(parseFamilyAndShade('outline-red-400')).toEqual({ prefix: 'outline-', family: 'red', shade: 400 });
  });

  test('returns null for semantic colors (no numeric shade)', () => {
    expect(parseFamilyAndShade('text-primary')).toBeNull();
    expect(parseFamilyAndShade('bg-background')).toBeNull();
    expect(parseFamilyAndShade('text-primary-foreground')).toBeNull();
    expect(parseFamilyAndShade('bg-card')).toBeNull();
  });

  test('returns null for arbitrary/custom colors', () => {
    expect(parseFamilyAndShade('text-[#7a7a7a]')).toBeNull();
    expect(parseFamilyAndShade('bg-[oklch(0.5_0.2_180)]')).toBeNull();
  });

  test('returns null for non-color utilities', () => {
    expect(parseFamilyAndShade('text-2xl')).toBeNull();
    expect(parseFamilyAndShade('bg-gradient-to-r')).toBeNull();
  });

  test('strips alpha modifier before parsing', () => {
    expect(parseFamilyAndShade('text-gray-500/70')).toEqual({ prefix: 'text-', family: 'gray', shade: 500 });
    expect(parseFamilyAndShade('bg-red-500/[0.3]')).toEqual({ prefix: 'bg-', family: 'red', shade: 500 });
  });

  test('handles implicit bg prefix from context', () => {
    expect(parseFamilyAndShade('(implicit) bg-card')).toBeNull();
    expect(parseFamilyAndShade('(@a11y-context) #ffffff')).toBeNull();
  });
});
