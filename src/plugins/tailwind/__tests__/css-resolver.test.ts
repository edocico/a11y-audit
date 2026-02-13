import { describe, test, expect } from 'vitest';
import {
  resolveClassToHex,
  resolveAll,
  parseThemeInline,
  extractBalancedBraces,
  stripHexAlpha,
  extractHexAlpha,
  combineAlpha,
  extractRootFontSize
} from '../css-resolver.js';
import type { ColorMap, RawPalette } from '../../../core/types.js';

// ── Test fixture: deterministic ColorMap (no file I/O) ────────────────

function createTestColorMap(): ColorMap {
  return new Map([
    ['--color-red-500', { hex: '#ef4444' }],
    ['--color-blue-500', { hex: '#3b82f6' }],
    ['--color-green-500', { hex: '#22c55e' }],
    ['--color-white', { hex: '#ffffff' }],
    ['--color-black', { hex: '#000000' }],
    ['--color-primary', { hex: '#0369a1' }],
    ['--color-background', { hex: '#ffffff' }],
    ['--color-foreground', { hex: '#0a0a0a' }],
    ['--color-input', { hex: '#e5e5e5' }],
    // Color with pre-existing alpha (from 8-digit hex)
    ['--color-semi', { hex: '#ff0000', alpha: 0.5 }]
  ]);
}

// ── extractBalancedBraces ─────────────────────────────────────────────

describe('extractBalancedBraces', () => {
  test('extracts simple block content', () => {
    const css = '{ color: red; }';
    expect(extractBalancedBraces(css, 0)).toBe(' color: red; ');
  });

  test('handles nested braces', () => {
    const css = '{ a { b: c; } d: e; }';
    expect(extractBalancedBraces(css, 0)).toBe(' a { b: c; } d: e; ');
  });

  test('handles deeply nested braces', () => {
    const css = '{ { { inner } } }';
    expect(extractBalancedBraces(css, 0)).toBe(' { { inner } } ');
  });

  test('returns null if openPos is not {', () => {
    expect(extractBalancedBraces('hello', 0)).toBe(null);
    expect(extractBalancedBraces('( content )', 0)).toBe(null);
  });

  test('returns null for unbalanced braces', () => {
    expect(extractBalancedBraces('{ open without close', 0)).toBe(null);
  });

  test('handles empty block', () => {
    expect(extractBalancedBraces('{}', 0)).toBe('');
  });

  test('known limitation: } inside CSS comments terminates early', () => {
    const css = '{ --color-x: red; /* closing } brace */ --color-y: blue; }';
    const result = extractBalancedBraces(css, 0);
    expect(result).toContain('--color-x: red;');
    expect(result).not.toContain('--color-y: blue;');
  });
});

// ── parseThemeInline ──────────────────────────────────────────────────

describe('parseThemeInline', () => {
  test('parses @theme inline block', () => {
    const css = '@theme inline { --color-primary: #0369a1; --color-secondary: #64748b; }';
    const result = parseThemeInline(css);

    expect(result.get('--color-primary')).toBe('#0369a1');
    expect(result.get('--color-secondary')).toBe('#64748b');
  });

  test('parses @theme block (without inline keyword)', () => {
    const css = '@theme { --color-accent: #f59e0b; }';
    const result = parseThemeInline(css);

    expect(result.get('--color-accent')).toBe('#f59e0b');
  });

  test('filters non-color variables', () => {
    const css = `@theme inline {
      --color-primary: #0369a1;
      --spacing-4: 1rem;
      --font-sans: Inter;
      --color-secondary: #64748b;
    }`;
    const result = parseThemeInline(css);

    expect(result.size).toBe(2);
    expect(result.has('--color-primary')).toBe(true);
    expect(result.has('--color-secondary')).toBe(true);
    expect(result.has('--spacing-4')).toBe(false);
    expect(result.has('--font-sans')).toBe(false);
  });

  test('handles empty @theme block', () => {
    const css = '@theme inline {}';
    const result = parseThemeInline(css);
    expect(result.size).toBe(0);
  });

  test('handles multiple @theme blocks', () => {
    const css = `
      @theme inline { --color-a: #111; }
      @theme { --color-b: #222; }
    `;
    const result = parseThemeInline(css);
    expect(result.get('--color-a')).toBe('#111');
    expect(result.get('--color-b')).toBe('#222');
  });

  test('known limitation: } inside comment truncates @theme block', () => {
    const css = `@theme inline {
      --color-primary: #0369a1;
      /* This comment contains a } brace */
      --color-secondary: #64748b;
    }`;
    const result = parseThemeInline(css);

    expect(result.get('--color-primary')).toBe('#0369a1');
    expect(result.get('--color-secondary')).toBeUndefined();
  });

  test('handles var() values', () => {
    const css = '@theme inline { --color-primary: var(--color-sky-700); }';
    const result = parseThemeInline(css);
    expect(result.get('--color-primary')).toBe('var(--color-sky-700)');
  });

  test('returns empty map for CSS without @theme', () => {
    const css = ':root { --color-primary: #000; }';
    const result = parseThemeInline(css);
    expect(result.size).toBe(0);
  });
});

// ── stripHexAlpha ─────────────────────────────────────────────────────

describe('stripHexAlpha', () => {
  test('9-char hex (#rrggbbaa): strips alpha to 7-char', () => {
    expect(stripHexAlpha('#ff000080')).toBe('#ff0000');
    expect(stripHexAlpha('#1e293bcc')).toBe('#1e293b');
    expect(stripHexAlpha('#fffffffe')).toBe('#ffffff');
  });

  test('5-char hex (#rgba): expands to 6-digit #rrggbb', () => {
    expect(stripHexAlpha('#f008')).toBe('#ff0000');
    expect(stripHexAlpha('#fffa')).toBe('#ffffff');
  });

  test('4-char hex (#rgb): expands to 6-digit', () => {
    expect(stripHexAlpha('#f00')).toBe('#ff0000');
    expect(stripHexAlpha('#fff')).toBe('#ffffff');
    expect(stripHexAlpha('#000')).toBe('#000000');
    expect(stripHexAlpha('#abc')).toBe('#aabbcc');
  });

  test('7-char hex (#rrggbb): passthrough', () => {
    expect(stripHexAlpha('#ff0000')).toBe('#ff0000');
    expect(stripHexAlpha('#000000')).toBe('#000000');
  });

  test('non-standard lengths: passthrough', () => {
    expect(stripHexAlpha('#12')).toBe('#12');
    expect(stripHexAlpha('rgb(1,2,3)')).toBe('rgb(1,2,3)');
  });
});

// ── extractHexAlpha ───────────────────────────────────────────────────

describe('extractHexAlpha', () => {
  test('9-char hex: extracts alpha as 0-1', () => {
    const alpha = extractHexAlpha('#ff000080');
    expect(alpha).toBeCloseTo(128 / 255, 3);
  });

  test('9-char hex: fully transparent (#00000000)', () => {
    expect(extractHexAlpha('#00000000')).toBeCloseTo(0, 3);
  });

  test('9-char hex: fully opaque (#ffffffff) returns undefined', () => {
    expect(extractHexAlpha('#ffffffff')).toBeUndefined();
  });

  test('5-char hex: extracts alpha', () => {
    const alpha = extractHexAlpha('#f008');
    expect(alpha).toBeCloseTo(136 / 255, 3);
  });

  test('5-char hex: fully opaque (#ffff) returns undefined', () => {
    expect(extractHexAlpha('#ffff')).toBeUndefined();
  });

  test('7-char hex: no alpha channel, returns undefined', () => {
    expect(extractHexAlpha('#ff0000')).toBeUndefined();
    expect(extractHexAlpha('#000000')).toBeUndefined();
  });

  test('6-char hex (no #): returns undefined', () => {
    expect(extractHexAlpha('ff0000')).toBeUndefined();
  });
});

// ── combineAlpha ──────────────────────────────────────────────────────

describe('combineAlpha', () => {
  test('both undefined → undefined (fully opaque)', () => {
    expect(combineAlpha(undefined, undefined)).toBeUndefined();
  });

  test('one undefined, one value → that value', () => {
    expect(combineAlpha(0.5, undefined)).toBeCloseTo(0.5, 5);
    expect(combineAlpha(undefined, 0.3)).toBeCloseTo(0.3, 5);
  });

  test('two alphas → multiplied', () => {
    expect(combineAlpha(0.5, 0.5)).toBeCloseTo(0.25, 5);
    expect(combineAlpha(0.8, 0.6)).toBeCloseTo(0.48, 5);
  });

  test('result >= 0.999 → undefined (treated as opaque)', () => {
    expect(combineAlpha(1.0, 1.0)).toBeUndefined();
    expect(combineAlpha(0.9999, 1.0)).toBeUndefined();
  });

  test('very small alphas multiply correctly', () => {
    expect(combineAlpha(0.1, 0.1)).toBeCloseTo(0.01, 5);
  });
});

// ── resolveClassToHex ─────────────────────────────────────────────────

describe('resolveClassToHex', () => {
  const colorMap = createTestColorMap();

  describe('standard colors', () => {
    test('bg-red-500 resolves to known hex', () => {
      const result = resolveClassToHex('bg-red-500', colorMap);
      expect(result).toEqual({ hex: '#ef4444' });
    });

    test('text-primary resolves to known hex', () => {
      const result = resolveClassToHex('text-primary', colorMap);
      expect(result).toEqual({ hex: '#0369a1' });
    });

    test('bg-background resolves to white', () => {
      const result = resolveClassToHex('bg-background', colorMap);
      expect(result).toEqual({ hex: '#ffffff' });
    });

    test('text-foreground resolves', () => {
      const result = resolveClassToHex('text-foreground', colorMap);
      expect(result).toEqual({ hex: '#0a0a0a' });
    });
  });

  describe('opacity slash notation (/N)', () => {
    test('bg-red-500/50 → 50% alpha', () => {
      const result = resolveClassToHex('bg-red-500/50', colorMap);
      expect(result).not.toBeNull();
      expect(result!.hex).toBe('#ef4444');
      expect(result!.alpha).toBeCloseTo(0.5, 5);
    });

    test('bg-red-500/100 → no alpha (fully opaque)', () => {
      const result = resolveClassToHex('bg-red-500/100', colorMap);
      expect(result).not.toBeNull();
      expect(result!.hex).toBe('#ef4444');
      expect(result!.alpha).toBeUndefined();
    });

    test('text-black/10 → 10% alpha', () => {
      const result = resolveClassToHex('text-black/10', colorMap);
      expect(result).not.toBeNull();
      expect(result!.hex).toBe('#000000');
      expect(result!.alpha).toBeCloseTo(0.1, 5);
    });
  });

  describe('arbitrary opacity /[value]', () => {
    test('bg-red-500/[0.5] → 50% alpha', () => {
      const result = resolveClassToHex('bg-red-500/[0.5]', colorMap);
      expect(result).not.toBeNull();
      expect(result!.hex).toBe('#ef4444');
      expect(result!.alpha).toBeCloseTo(0.5, 5);
    });

    test('bg-red-500/[.3] → 30% alpha (no leading zero)', () => {
      const result = resolveClassToHex('bg-red-500/[.3]', colorMap);
      expect(result).not.toBeNull();
      expect(result!.hex).toBe('#ef4444');
      expect(result!.alpha).toBeCloseTo(0.3, 5);
    });

    test('bg-red-500/[50%] → 50% alpha (percentage notation)', () => {
      const result = resolveClassToHex('bg-red-500/[50%]', colorMap);
      expect(result).not.toBeNull();
      expect(result!.hex).toBe('#ef4444');
      expect(result!.alpha).toBeCloseTo(0.5, 5);
    });

    test('bg-blue-500/[0.15] → 15% alpha', () => {
      const result = resolveClassToHex('bg-blue-500/[0.15]', colorMap);
      expect(result).not.toBeNull();
      expect(result!.hex).toBe('#3b82f6');
      expect(result!.alpha).toBeCloseTo(0.15, 5);
    });

    test('bg-red-500/[invalid] → alpha is NaN → treated as undefined', () => {
      const result = resolveClassToHex('bg-red-500/[invalid]', colorMap);
      expect(result).not.toBeNull();
      expect(result!.hex).toBe('#ef4444');
      expect(result!.alpha).toBeUndefined();
    });
  });

  describe('arbitrary value bracket notation', () => {
    test('bg-[#ff0000] resolves to red', () => {
      const result = resolveClassToHex('bg-[#ff0000]', colorMap);
      expect(result).not.toBeNull();
      expect(result!.hex).toBe('#ff0000');
      expect(result!.alpha).toBeUndefined();
    });

    test('bg-[#f00] (3-digit) resolves via toHex expansion', () => {
      const result = resolveClassToHex('bg-[#f00]', colorMap);
      expect(result).not.toBeNull();
      expect(result!.hex).toBe('#ff0000');
    });

    test('bg-[#ff000080] (8-digit with alpha) extracts alpha', () => {
      const result = resolveClassToHex('bg-[#ff000080]', colorMap);
      expect(result).not.toBeNull();
      expect(result!.hex).toBe('#ff0000');
      expect(result!.alpha).toBeCloseTo(128 / 255, 2);
    });
  });

  describe('directional border prefixes', () => {
    test('border-t-red-500 strips border-t- prefix', () => {
      const result = resolveClassToHex('border-t-red-500', colorMap);
      expect(result).not.toBeNull();
      expect(result!.hex).toBe('#ef4444');
    });

    test('border-l-blue-500 strips border-l- prefix', () => {
      const result = resolveClassToHex('border-l-blue-500', colorMap);
      expect(result).not.toBeNull();
      expect(result!.hex).toBe('#3b82f6');
    });

    test('border-red-500 strips border- prefix', () => {
      const result = resolveClassToHex('border-red-500', colorMap);
      expect(result).not.toBeNull();
      expect(result!.hex).toBe('#ef4444');
    });
  });

  describe('returns null for unresolvable classes', () => {
    test('transparent → null', () => {
      expect(resolveClassToHex('bg-transparent', colorMap)).toBeNull();
    });

    test('current → null', () => {
      expect(resolveClassToHex('text-current', colorMap)).toBeNull();
    });

    test('inherit → null', () => {
      expect(resolveClassToHex('text-inherit', colorMap)).toBeNull();
    });

    test('unknown color not in map → null', () => {
      expect(resolveClassToHex('bg-unicorn-500', colorMap)).toBeNull();
    });

    test('empty colorName after prefix strip → null', () => {
      expect(resolveClassToHex('bg-', colorMap)).toBeNull();
    });
  });

  describe('combined alpha (CSS var alpha + slash opacity)', () => {
    test('color with pre-existing alpha + /50 → both multiplied', () => {
      const result = resolveClassToHex('bg-semi/50', colorMap);
      expect(result).not.toBeNull();
      expect(result!.hex).toBe('#ff0000');
      expect(result!.alpha).toBeCloseTo(0.25, 5);
    });
  });

  describe('ring and outline prefixes', () => {
    test('ring-red-500 resolves color', () => {
      const result = resolveClassToHex('ring-red-500', colorMap);
      expect(result).not.toBeNull();
      expect(result!.hex).toBe('#ef4444');
    });

    test('outline-blue-500 resolves color', () => {
      const result = resolveClassToHex('outline-blue-500', colorMap);
      expect(result).not.toBeNull();
      expect(result!.hex).toBe('#3b82f6');
    });
  });
});

// ── extractRootFontSize ───────────────────────────────────────────────

describe('extractRootFontSize', () => {
  test('extracts font-size from html { font-size: 14px }', () => {
    const css = 'html { font-size: 14px; }';
    expect(extractRootFontSize(css)).toBe(14);
  });

  test('extracts font-size from :root { font-size: 18px }', () => {
    const css = ':root { font-size: 18px; }';
    expect(extractRootFontSize(css)).toBe(18);
  });

  test('returns 16 (default) when no font-size set', () => {
    const css = ':root { --color-primary: #000; }';
    expect(extractRootFontSize(css)).toBe(16);
  });

  test('handles percentage-based font-size (62.5% = 10px)', () => {
    const css = 'html { font-size: 62.5%; }';
    expect(extractRootFontSize(css)).toBe(10);
  });

  test('handles rem-based font-size (1.125rem = 18px)', () => {
    const css = 'html { font-size: 1.125rem; }';
    expect(extractRootFontSize(css)).toBe(18);
  });
});

// ── resolveAll — var() depth, chains, and circularity ─────────────────

describe('resolveAll — var() resolution edge cases', () => {
  const emptyPalette: RawPalette = new Map();

  test('M4: resolves 3-level deep var() chain', () => {
    const blockVars = new Map([
      ['--color-primary', 'var(--color-sky-700)'],
      ['--color-sky-700', 'var(--color-blue-500)'],
      ['--color-blue-500', '#3b82f6']
    ]);
    const result = resolveAll(blockVars, new Map(), emptyPalette);
    expect(result.get('--color-primary')).toEqual({ hex: '#3b82f6' });
    expect(result.get('--color-sky-700')).toEqual({ hex: '#3b82f6' });
    expect(result.get('--color-blue-500')).toEqual({ hex: '#3b82f6' });
  });

  test('M4: resolves 5-level deep var() chain', () => {
    const blockVars = new Map([
      ['--a', 'var(--b)'],
      ['--b', 'var(--c)'],
      ['--c', 'var(--d)'],
      ['--d', 'var(--e)'],
      ['--e', '#ff0000']
    ]);
    const result = resolveAll(blockVars, new Map(), emptyPalette);
    expect(result.get('--a')).toEqual({ hex: '#ff0000' });
  });

  test('M5: returns null for chains exceeding MAX_RESOLVE_DEPTH (>10)', () => {
    const blockVars = new Map<string, string>();
    for (let i = 0; i < 12; i++) {
      blockVars.set(`--v${i}`, `var(--v${i + 1})`);
    }
    blockVars.set('--v12', '#abcdef');
    const result = resolveAll(blockVars, new Map(), emptyPalette);
    expect(result.get('--v12')).toEqual({ hex: '#abcdef' });
    expect(result.get('--v10')).toEqual({ hex: '#abcdef' });
    expect(result.has('--v0')).toBe(false);
  });

  test('M6: self-referencing var() returns null (no infinite loop)', () => {
    const blockVars = new Map([['--color-a', 'var(--color-a)']]);
    const result = resolveAll(blockVars, new Map(), emptyPalette);
    expect(result.has('--color-a')).toBe(false);
  });

  test('M6: mutual circular reference returns null', () => {
    const blockVars = new Map([
      ['--color-a', 'var(--color-b)'],
      ['--color-b', 'var(--color-a)']
    ]);
    const result = resolveAll(blockVars, new Map(), emptyPalette);
    expect(result.has('--color-a')).toBe(false);
    expect(result.has('--color-b')).toBe(false);
  });

  test('M6: circular with fallback resolves to fallback', () => {
    const blockVars = new Map([
      ['--color-a', 'var(--color-b, #ff00ff)'],
      ['--color-b', 'var(--color-a)']
    ]);
    const result = resolveAll(blockVars, new Map(), emptyPalette);
    expect(result.get('--color-a')).toEqual({ hex: '#ff00ff' });
  });

  test('themeInlineVars override blockVars in resolution order', () => {
    const blockVars = new Map([['--color-primary', '#111111']]);
    const themeInline = new Map([['--color-primary', '#222222']]);
    const result = resolveAll(blockVars, themeInline, emptyPalette);
    expect(result.get('--color-primary')).toEqual({ hex: '#222222' });
  });

  test('twPalette serves as fallback when not in blockVars', () => {
    const twPalette: RawPalette = new Map([['--color-sky-500', '#0ea5e9']]);
    const blockVars = new Map([['--color-primary', 'var(--color-sky-500)']]);
    const result = resolveAll(blockVars, new Map(), twPalette);
    expect(result.get('--color-primary')).toEqual({ hex: '#0ea5e9' });
  });

  test('preserves alpha through var() chain', () => {
    const blockVars = new Map([
      ['--color-muted', 'var(--color-semi-transparent)'],
      ['--color-semi-transparent', '#ff000080']
    ]);
    const result = resolveAll(blockVars, new Map(), emptyPalette);
    expect(result.get('--color-muted')).toEqual({ hex: '#ff0000', alpha: expect.closeTo(0.502, 2) });
  });
});
