import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn()
}));

import { extractTailwindPalette } from '../palette.js';

// ── Fixture: minimal Tailwind v4 theme.css ──────────────────────────────

const FIXTURE_TAILWIND_CSS = `
@theme {
  --color-red-500: oklch(63.7% 0.237 25.331);
  --color-blue-500: #3b82f6;
  --color-sky-700: #0369a1;
  --color-white: #ffffff;
  --color-black: #000000;
  --spacing-4: 1rem;
  --font-sans: Inter, system-ui, sans-serif;
}
`;

const PALETTE_PATH = '/mock/node_modules/tailwindcss/theme.css';

// ── Tests ────────────────────────────────────────────────────────────────

describe('extractTailwindPalette (mocked I/O)', () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockReturnValue(FIXTURE_TAILWIND_CSS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('reads from given path with utf-8', () => {
    extractTailwindPalette(PALETTE_PATH);
    expect(readFileSync).toHaveBeenCalledOnce();
    expect(readFileSync).toHaveBeenCalledWith(PALETTE_PATH, 'utf-8');
  });

  test('extracts only --color-* variables', () => {
    const palette = extractTailwindPalette(PALETTE_PATH);
    expect(palette.has('--color-red-500')).toBe(true);
    expect(palette.has('--color-blue-500')).toBe(true);
    expect(palette.has('--color-sky-700')).toBe(true);
    expect(palette.has('--color-white')).toBe(true);
    expect(palette.has('--color-black')).toBe(true);
    // Non-color vars must be excluded
    expect(palette.has('--spacing-4')).toBe(false);
    expect(palette.has('--font-sans')).toBe(false);
  });

  test('converts oklch to 6-digit hex', () => {
    const palette = extractTailwindPalette(PALETTE_PATH);
    const red = palette.get('--color-red-500');
    expect(red).toMatch(/^#[0-9a-f]{6}$/);
  });

  test('passes hex values through unchanged', () => {
    const palette = extractTailwindPalette(PALETTE_PATH);
    expect(palette.get('--color-blue-500')).toBe('#3b82f6');
    expect(palette.get('--color-white')).toBe('#ffffff');
    expect(palette.get('--color-black')).toBe('#000000');
  });

  test('returns palette with correct size', () => {
    const palette = extractTailwindPalette(PALETTE_PATH);
    // 5 color vars: red-500, blue-500, sky-700, white, black
    expect(palette.size).toBe(5);
  });

  test('logs warning for unconvertible values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(readFileSync).mockReturnValue(
      '--color-weird-500: notacolor(1 2 3);'
    );
    const palette = extractTailwindPalette(PALETTE_PATH);
    expect(palette.has('--color-weird-500')).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not convert')
    );
    warn.mockRestore();
  });

  test('returns empty map for empty CSS', () => {
    vi.mocked(readFileSync).mockReturnValue('');
    const palette = extractTailwindPalette(PALETTE_PATH);
    expect(palette.size).toBe(0);
  });
});
