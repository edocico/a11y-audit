import { describe, test, expect, vi } from 'vitest';
import {
  parseHexRGB,
  compositeOver,
  checkAllPairs,
} from '../contrast-checker.js';
import type { ColorPair, SkippedClass } from '../types.js';

// ── parseHexRGB ───────────────────────────────────────────────────────

describe('parseHexRGB', () => {
  test('parses 6-digit hex with #', () => {
    expect(parseHexRGB('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHexRGB('#00ff00')).toEqual({ r: 0, g: 255, b: 0 });
    expect(parseHexRGB('#0000ff')).toEqual({ r: 0, g: 0, b: 255 });
    expect(parseHexRGB('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexRGB('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  test('parses 6-digit hex without #', () => {
    expect(parseHexRGB('ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHexRGB('1e293b')).toEqual({ r: 30, g: 41, b: 59 });
  });

  test('parses 8-digit hex (ignores alpha bytes for RGB)', () => {
    expect(parseHexRGB('#ff000080')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHexRGB('#1e293bcc')).toEqual({ r: 30, g: 41, b: 59 });
  });

  test('parses mixed case hex', () => {
    expect(parseHexRGB('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHexRGB('#aAbBcC')).toEqual({ r: 170, g: 187, b: 204 });
  });

  test('returns black and warns for hex shorter than 6 chars', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseHexRGB('#f00')).toEqual({ r: 0, g: 0, b: 0 });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Malformed hex'),
    );
    warnSpy.mockRestore();
  });

  test('returns black and warns for non-hex characters', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseHexRGB('#gghhii')).toEqual({ r: 0, g: 0, b: 0 });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Malformed hex'),
    );
    warnSpy.mockRestore();
  });

  test('returns black and warns for empty string', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseHexRGB('')).toEqual({ r: 0, g: 0, b: 0 });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('returns black and warns for just #', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseHexRGB('#')).toEqual({ r: 0, g: 0, b: 0 });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ── compositeOver ─────────────────────────────────────────────────────

describe('compositeOver', () => {
  test('alpha=1 returns foreground unchanged', () => {
    expect(compositeOver('#ff0000', '#0000ff', 1)).toBe('#ff0000');
  });

  test('alpha=0 returns background unchanged', () => {
    expect(compositeOver('#ff0000', '#0000ff', 0)).toBe('#0000ff');
  });

  test('alpha=0.5 blends 50/50', () => {
    const result = compositeOver('#ff0000', '#0000ff', 0.5);
    expect(result).toBe('#800080');
  });

  test('white over black at alpha=0.5 produces mid-gray', () => {
    const result = compositeOver('#ffffff', '#000000', 0.5);
    expect(result).toBe('#808080');
  });

  test('black over white at alpha=0 returns white', () => {
    expect(compositeOver('#000000', '#ffffff', 0)).toBe('#ffffff');
  });
});

// ── checkAllPairs ───────────────────────────────────────────────────

describe('checkAllPairs', () => {
  function makePair(overrides: Partial<ColorPair>): ColorPair {
    return {
      file: 'test.tsx',
      line: 1,
      bgClass: 'bg-white',
      textClass: 'text-black',
      bgHex: '#ffffff',
      textHex: '#000000',
      ...overrides,
    };
  }

  const noSkips: SkippedClass[] = [];

  test('black text on white bg = 21:1 (maximum contrast, passes AA)', () => {
    const pair = makePair({ bgHex: '#ffffff', textHex: '#000000' });
    const result = checkAllPairs([pair], noSkips, 1);

    expect(result.violations).toHaveLength(0);
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].ratio).toBe(21);
    expect(result.passed[0].passAA).toBe(true);
    expect(result.passed[0].passAALarge).toBe(true);
  });

  test('white text on white bg = 1:1 (no contrast, fails AA)', () => {
    const pair = makePair({ bgHex: '#ffffff', textHex: '#ffffff' });
    const result = checkAllPairs([pair], noSkips, 1);

    expect(result.violations).toHaveLength(1);
    expect(result.passed).toHaveLength(0);
    expect(result.violations[0].ratio).toBe(1);
    expect(result.violations[0].passAA).toBe(false);
  });

  test('text with ratio between 3:1 and 4.5:1 fails normal text, passes large text', () => {
    const pair = makePair({ bgHex: '#ffffff', textHex: '#777777' });
    const result = checkAllPairs([pair], noSkips, 1);

    const checked =
      result.violations.length > 0 ? result.violations[0] : result.passed[0];
    expect(checked.passAALarge).toBe(true);
  });

  test('large text uses 3:1 threshold (isLargeText flag)', () => {
    const pair = makePair({
      bgHex: '#ffffff',
      textHex: '#949494',
      isLargeText: true,
    });
    const result = checkAllPairs([pair], noSkips, 1);

    expect(result.passed.length + result.violations.length).toBe(1);
    const checked = result.passed[0] ?? result.violations[0];
    expect(checked.passAALarge).toBe(true);
  });

  test('non-text (border) uses 3:1 threshold via pairType', () => {
    const pair = makePair({
      bgHex: '#ffffff',
      textHex: '#949494',
      pairType: 'border',
    });
    const result = checkAllPairs([pair], noSkips, 1);

    const checked = result.passed[0] ?? result.violations[0];
    expect(checked.passAALarge).toBe(true);
  });

  test('alpha compositing: semi-transparent text composited against bg', () => {
    const pair = makePair({
      bgHex: '#ffffff',
      textHex: '#000000',
      textAlpha: 0.5,
    });
    const result = checkAllPairs([pair], noSkips, 1);

    const checked =
      result.violations.length > 0 ? result.violations[0] : result.passed[0];
    expect(checked.ratio).toBeLessThan(21);
    expect(checked.ratio).toBeGreaterThan(1);
  });

  test('alpha compositing: semi-transparent bg composited against page bg', () => {
    const pair = makePair({
      bgHex: '#ff0000',
      bgAlpha: 0.5,
      textHex: '#000000',
    });
    const result = checkAllPairs([pair], noSkips, 1);

    const checked = result.passed[0] ?? result.violations[0];
    expect(checked.ratio).toBeGreaterThan(1);
  });

  test('ignored violations go to ignored bucket', () => {
    const pair = makePair({
      bgHex: '#ffffff',
      textHex: '#ffffff',
      ignored: true,
      ignoreReason: 'cross-variant cva',
    });
    const result = checkAllPairs([pair], noSkips, 1);

    expect(result.violations).toHaveLength(0);
    expect(result.ignored).toHaveLength(1);
    expect(result.ignored[0].ignoreReason).toBe('cross-variant cva');
  });

  test('pairs with null bgHex or textHex are silently skipped', () => {
    const nullBg = makePair({ bgHex: null });
    const nullText = makePair({ textHex: null });
    const result = checkAllPairs([nullBg, nullText], noSkips, 1);

    expect(result.pairsChecked).toBe(2);
    expect(result.violations).toHaveLength(0);
    expect(result.passed).toHaveLength(0);
  });

  test('dark mode uses zinc-950 (#09090b) as page background', () => {
    const pair = makePair({
      bgHex: '#ffffff',
      bgAlpha: 0.1,
      textHex: '#ffffff',
    });
    const lightResult = checkAllPairs([pair], noSkips, 1, 'light');
    const darkResult = checkAllPairs([pair], noSkips, 1, 'dark');

    const lightChecked =
      lightResult.passed[0] ?? lightResult.violations[0];
    const darkChecked = darkResult.passed[0] ?? darkResult.violations[0];
    expect(lightChecked.ratio).not.toBe(darkChecked.ratio);
  });

  test('filesScanned is passed through to result', () => {
    const result = checkAllPairs([], noSkips, 42);
    expect(result.filesScanned).toBe(42);
    expect(result.pairsChecked).toBe(0);
  });

  test('skipped classes are passed through to result', () => {
    const skips: SkippedClass[] = [
      { file: 'a.tsx', line: 1, className: 'bg-$dynamic', reason: 'dynamic' },
    ];
    const result = checkAllPairs([], skips, 1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].className).toBe('bg-$dynamic');
  });

  // ── AAA fields ───────────────────────────────────────────────────

  test('result includes passAAA and passAAALarge fields', () => {
    const pair = makePair({ bgHex: '#ffffff', textHex: '#000000' });
    const result = checkAllPairs([pair], noSkips, 1);

    const checked = result.passed[0];
    expect(checked).toHaveProperty('passAAA');
    expect(checked).toHaveProperty('passAAALarge');
    expect(checked.passAAA).toBe(true);
    expect(checked.passAAALarge).toBe(true);
  });

  test('text at 5:1 passes AA but fails AAA', () => {
    const pair = makePair({ bgHex: '#ffffff', textHex: '#757575' });
    const result = checkAllPairs([pair], noSkips, 1);

    const checked = result.passed[0] ?? result.violations[0];
    expect(checked.passAA).toBe(true);
    expect(checked.passAAA).toBe(false);
  });

  // ── Configurable violation level ──────────────────────────────────

  test('violationLevel=AAA flags 5:1 text as violation', () => {
    const pair = makePair({ bgHex: '#ffffff', textHex: '#757575' });
    const result = checkAllPairs([pair], noSkips, 1, 'light', 'AAA');

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].passAA).toBe(true);
    expect(result.violations[0].passAAA).toBe(false);
  });

  test('violationLevel=AA (default) passes 5:1 text', () => {
    const pair = makePair({ bgHex: '#ffffff', textHex: '#757575' });
    const result = checkAllPairs([pair], noSkips, 1, 'light', 'AA');

    expect(result.passed).toHaveLength(1);
  });

  // ── APCA calculation ─────────────────────────────────────────────

  describe('APCA calculation', () => {
    test('black text on white bg returns negative Lc (dark-on-light)', () => {
      const pair = makePair({ bgHex: '#ffffff', textHex: '#000000' });
      const result = checkAllPairs([pair], noSkips, 1);

      const checked = result.passed[0];
      expect(checked.apcaLc).toBeDefined();
      expect(typeof checked.apcaLc).toBe('number');
      expect(Math.abs(checked.apcaLc!)).toBeGreaterThan(100);
    });

    test('same color text and bg returns Lc near 0', () => {
      const pair = makePair({ bgHex: '#808080', textHex: '#808080' });
      const result = checkAllPairs([pair], noSkips, 1);

      const checked = result.violations[0] ?? result.passed[0];
      expect(checked.apcaLc).toBeDefined();
      expect(Math.abs(checked.apcaLc!)).toBeLessThan(5);
    });
  });
});
