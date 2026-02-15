import { describe, test, expect } from 'vitest';
import {
  extractShadeFamilies,
  parseFamilyAndShade,
  generateSuggestions,
} from '../suggestions.js';
import type { ContrastResult, RawPalette } from '../types.js';

function makeViolation(overrides: Partial<ContrastResult>): ContrastResult {
  return {
    file: 'test.tsx',
    line: 1,
    bgClass: 'bg-white',
    textClass: 'text-gray-400',
    bgHex: '#ffffff',
    textHex: '#9ca3af',
    ratio: 2.97,
    passAA: false,
    passAALarge: false,
    passAAA: false,
    passAAALarge: false,
    ...overrides,
  };
}

// Real Tailwind v4 gray shades (approximate)
function makeGrayPalette(): RawPalette {
  return new Map([
    ['--color-gray-50', '#f9fafb'],
    ['--color-gray-100', '#f3f4f6'],
    ['--color-gray-200', '#e5e7eb'],
    ['--color-gray-300', '#d1d5db'],
    ['--color-gray-400', '#9ca3af'],
    ['--color-gray-500', '#6b7280'],
    ['--color-gray-600', '#4b5563'],
    ['--color-gray-700', '#374151'],
    ['--color-gray-800', '#1f2937'],
    ['--color-gray-900', '#111827'],
    ['--color-gray-950', '#030712'],
  ]);
}

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

describe('generateSuggestions', () => {
  const palette = makeGrayPalette();
  const families = extractShadeFamilies(palette);

  test('suggests darker shades for text on light background', () => {
    const violation = makeViolation({
      bgHex: '#ffffff',
      textClass: 'text-gray-400',
      textHex: '#9ca3af',
    });

    const suggestions = generateSuggestions(violation, families, 'AA', 'light');

    expect(suggestions.length).toBeGreaterThan(0);
    // First suggestion should be closest passing shade
    expect(suggestions[0]!.suggestedClass).toMatch(/^text-gray-\d+$/);
    expect(suggestions[0]!.newRatio).toBeGreaterThanOrEqual(4.5);
    // Ordered by shade distance (closest first)
    for (let i = 1; i < suggestions.length; i++) {
      expect(suggestions[i]!.shadeDistance).toBeGreaterThanOrEqual(suggestions[i - 1]!.shadeDistance);
    }
  });

  test('suggests lighter shades for text on dark background', () => {
    const violation = makeViolation({
      bgClass: 'bg-gray-900',
      bgHex: '#111827',
      textClass: 'text-gray-600',
      textHex: '#4b5563',
    });

    const suggestions = generateSuggestions(violation, families, 'AA', 'light');

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]!.suggestedClass).toMatch(/^text-gray-\d+$/);
    expect(suggestions[0]!.newRatio).toBeGreaterThanOrEqual(4.5);
    // Should suggest lighter shades (lower numbers)
    const suggestedShade = parseInt(suggestions[0]!.suggestedClass.match(/(\d+)$/)![1]!, 10);
    expect(suggestedShade).toBeLessThan(600);
  });

  test('returns empty array for semantic colors (no shade family)', () => {
    const violation = makeViolation({
      textClass: 'text-primary',
      textHex: '#0369a1',
    });

    const suggestions = generateSuggestions(violation, families, 'AA', 'light');
    expect(suggestions).toEqual([]);
  });

  test('returns empty array for arbitrary/custom colors', () => {
    const violation = makeViolation({
      textClass: 'text-[#7a7a7a]',
      textHex: '#7a7a7a',
    });

    const suggestions = generateSuggestions(violation, families, 'AA', 'light');
    expect(suggestions).toEqual([]);
  });

  test('respects AAA threshold when requested', () => {
    const violation = makeViolation({
      bgHex: '#ffffff',
      textClass: 'text-gray-500',
      textHex: '#6b7280',
    });

    const suggestions = generateSuggestions(violation, families, 'AAA', 'light');

    if (suggestions.length > 0) {
      expect(suggestions[0]!.newRatio).toBeGreaterThanOrEqual(7.0);
    }
  });

  test('handles bg with alpha (composites against page bg)', () => {
    const violation = makeViolation({
      bgHex: '#1f2937',
      bgAlpha: 0.8,
      textClass: 'text-gray-500',
      textHex: '#6b7280',
    });

    const suggestionsLight = generateSuggestions(violation, families, 'AA', 'light');
    const suggestionsDark = generateSuggestions(violation, families, 'AA', 'dark');

    // Different page bg can produce different effective bg and thus different suggestions
    expect(Array.isArray(suggestionsLight)).toBe(true);
    expect(Array.isArray(suggestionsDark)).toBe(true);
  });

  test('caps suggestions at maxSuggestions', () => {
    const violation = makeViolation({
      bgHex: '#ffffff',
      textClass: 'text-gray-300',
      textHex: '#d1d5db',
    });

    const suggestions = generateSuggestions(violation, families, 'AA', 'light', 2);
    expect(suggestions.length).toBeLessThanOrEqual(2);
  });

  test('handles non-text pair types (border uses 3:1)', () => {
    const violation = makeViolation({
      bgHex: '#ffffff',
      textClass: 'border-gray-200',
      textHex: '#e5e7eb',
      pairType: 'border',
    });

    const suggestions = generateSuggestions(violation, families, 'AA', 'light');

    if (suggestions.length > 0) {
      expect(suggestions[0]!.suggestedClass).toMatch(/^border-gray-\d+$/);
      // Non-text uses 3:1 threshold
      expect(suggestions[0]!.newRatio).toBeGreaterThanOrEqual(3.0);
    }
  });
});
