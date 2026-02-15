import { describe, test, expect } from 'vitest';
import { extractCvaBase } from '../cva-expander.js';

describe('extractCvaBase', () => {
  test('extracts first double-quoted string as base classes', () => {
    const content = `"rounded-md font-semibold text-sm", { variants: {} }`;
    expect(extractCvaBase(content)).toBe('rounded-md font-semibold text-sm');
  });

  test('extracts first single-quoted string', () => {
    const content = `'bg-primary text-white', {}`;
    expect(extractCvaBase(content)).toBe('bg-primary text-white');
  });

  test('extracts backtick-quoted string', () => {
    const content = '`inline-flex items-center`, {}';
    expect(extractCvaBase(content)).toBe('inline-flex items-center');
  });

  test('trims whitespace', () => {
    const content = `  "  bg-primary text-white  "  , {}`;
    expect(extractCvaBase(content)).toBe('bg-primary text-white');
  });

  test('returns empty string when no string literal found', () => {
    expect(extractCvaBase('{ variants: {} }')).toBe('');
    expect(extractCvaBase('')).toBe('');
  });
});
