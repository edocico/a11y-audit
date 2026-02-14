import { describe, test, expect } from 'vitest';
import { buildEffectiveBg, generatePairs, resolveFileRegions } from '../region-resolver.js';
import type { PreExtracted } from '../region-resolver.js';
import type { TaggedClass, ForegroundGroup, PairMeta } from '../categorizer.js';
import type { ColorMap, ClassRegion } from '../../../core/types.js';

// ── Helpers ───────────────────────────────────────────────────────────

function makeTagged(base: string, overrides?: Partial<TaggedClass>): TaggedClass {
  return {
    raw: base,
    isDark: false,
    isInteractive: false,
    interactiveState: null,
    base,
    ...overrides,
  };
}

// ── buildEffectiveBg ──────────────────────────────────────────────────

describe('buildEffectiveBg', () => {
  test('returns explicit bgClasses when present', () => {
    const bg = [makeTagged('bg-primary')];
    const result = buildEffectiveBg(bg, 'bg-background');
    expect(result).toEqual(bg);
  });

  test('falls back to contextBg when no explicit bg classes', () => {
    const result = buildEffectiveBg([], 'bg-card');
    expect(result).toHaveLength(1);
    expect(result[0]!.base).toBe('bg-card');
    expect(result[0]!.raw).toBe('bg-card');
    expect(result[0]!.isDark).toBe(false);
    expect(result[0]!.isInteractive).toBe(false);
    expect(result[0]!.interactiveState).toBeNull();
  });

  test('inline backgroundColor overrides explicit bg classes', () => {
    const bg = [makeTagged('bg-primary')];
    const result = buildEffectiveBg(bg, 'bg-background', { backgroundColor: '#ff0000' });
    expect(result).toHaveLength(1);
    expect(result[0]!.base).toBe('bg-[#ff0000]');
    expect(result[0]!.raw).toContain('#ff0000');
  });

  test('inline backgroundColor overrides context fallback', () => {
    const result = buildEffectiveBg([], 'bg-card', { backgroundColor: '#abcdef' });
    expect(result).toHaveLength(1);
    expect(result[0]!.base).toBe('bg-[#abcdef]');
  });

  test('ignores invalid inline backgroundColor (too short)', () => {
    const result = buildEffectiveBg([], 'bg-card', { backgroundColor: '#ab' });
    expect(result).toHaveLength(1);
    expect(result[0]!.base).toBe('bg-card'); // fallback, not inline
  });

  test('ignores non-hex inline backgroundColor', () => {
    const result = buildEffectiveBg([], 'bg-card', { backgroundColor: 'rgb(255,0,0)' });
    expect(result).toHaveLength(1);
    expect(result[0]!.base).toBe('bg-card');
  });

  test('no inlineStyles parameter keeps bg as-is', () => {
    const bg = [makeTagged('bg-red-500'), makeTagged('bg-blue-500')];
    const result = buildEffectiveBg(bg, 'bg-background');
    expect(result).toEqual(bg);
  });

  test('empty inlineStyles object keeps bg as-is', () => {
    const bg = [makeTagged('bg-green-100')];
    const result = buildEffectiveBg(bg, 'bg-background', {});
    expect(result).toEqual(bg);
  });
});

// ── generatePairs ─────────────────────────────────────────────────────

describe('generatePairs', () => {
  // Minimal ColorMap — enough to resolve classes used in tests
  const colorMap: ColorMap = new Map([
    ['--color-primary', { hex: '#0369a1' }],
    ['--color-background', { hex: '#ffffff' }],
    ['--color-card', { hex: '#ffffff' }],
    ['--color-foreground', { hex: '#0a0a0a' }],
    ['--color-red-500', { hex: '#ef4444' }],
    ['--color-input', { hex: '#e5e5e5' }],
    ['--color-semi', { hex: '#ff0000', alpha: 0.5 }],
  ]);

  const baseMeta: PairMeta = {
    file: 'test.tsx',
    line: 10,
    ignoreReason: null,
    isLargeText: false,
  };

  // ── Basic text pair generation ──

  test('generates text/bg pair for resolvable classes', () => {
    const fgGroups: ForegroundGroup[] = [{ classes: [makeTagged('text-foreground')] }];
    const bg = [makeTagged('bg-primary')];
    const result = generatePairs(fgGroups, bg, baseMeta, colorMap, true, 'bg-background');
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.bgClass).toBe('bg-primary');
    expect(result.pairs[0]!.textClass).toBe('text-foreground');
    expect(result.pairs[0]!.bgHex).toBe('#0369a1');
    expect(result.pairs[0]!.textHex).toBe('#0a0a0a');
  });

  test('implicit bg shows (implicit) label', () => {
    const fgGroups: ForegroundGroup[] = [{ classes: [makeTagged('text-foreground')] }];
    const bg = [makeTagged('bg-background')];
    const result = generatePairs(fgGroups, bg, baseMeta, colorMap, false, 'bg-background');
    expect(result.pairs[0]!.bgClass).toBe('(implicit) bg-background');
  });

  test('explicit bg shows raw class name', () => {
    const fgGroups: ForegroundGroup[] = [{ classes: [makeTagged('text-foreground')] }];
    const bg = [makeTagged('bg-primary')];
    const result = generatePairs(fgGroups, bg, baseMeta, colorMap, true, 'bg-background');
    expect(result.pairs[0]!.bgClass).toBe('bg-primary');
  });

  // ── Non-text pair generation ──

  test('generates non-text pair with pairType', () => {
    const fgGroups: ForegroundGroup[] = [
      { classes: [makeTagged('border-input')], pairType: 'border' },
    ];
    const bg = [makeTagged('bg-background')];
    const result = generatePairs(fgGroups, bg, baseMeta, colorMap, true, 'bg-background');
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.pairType).toBe('border');
    expect(result.pairs[0]!.textHex).toBe('#e5e5e5');
    expect(result.pairs[0]!.isLargeText).toBeUndefined();
  });

  // ── Skip behavior ──

  test('skips unresolvable text with reason (base)', () => {
    const fgGroups: ForegroundGroup[] = [{ classes: [makeTagged('text-mystery')] }];
    const bg = [makeTagged('bg-primary')];
    const result = generatePairs(fgGroups, bg, baseMeta, colorMap, true, 'bg-background');
    expect(result.pairs).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain('Unresolvable text color');
  });

  test('skips unresolvable explicit bg for text pairs with reason', () => {
    const fgGroups: ForegroundGroup[] = [{ classes: [makeTagged('text-foreground')] }];
    const bg = [makeTagged('bg-mystery')];
    const result = generatePairs(fgGroups, bg, baseMeta, colorMap, true, 'bg-background');
    expect(result.pairs).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain('Unresolvable background');
  });

  test('creates pair with null bgHex for unresolvable implicit bg (text)', () => {
    const fgGroups: ForegroundGroup[] = [{ classes: [makeTagged('text-foreground')] }];
    const bg = [makeTagged('bg-mystery')];
    const result = generatePairs(fgGroups, bg, baseMeta, colorMap, false, 'bg-mystery');
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.bgHex).toBeNull();
    expect(result.skipped).toHaveLength(0);
  });

  test('silently skips unresolvable bg for non-text pairs', () => {
    const fgGroups: ForegroundGroup[] = [
      { classes: [makeTagged('border-input')], pairType: 'border' },
    ];
    const bg = [makeTagged('bg-mystery')];
    const result = generatePairs(fgGroups, bg, baseMeta, colorMap, true, 'bg-background');
    expect(result.pairs).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  test('skips unresolvable non-text fg with reason (base)', () => {
    const fgGroups: ForegroundGroup[] = [
      { classes: [makeTagged('border-mystery')], pairType: 'border' },
    ];
    const bg = [makeTagged('bg-background')];
    const result = generatePairs(fgGroups, bg, baseMeta, colorMap, true, 'bg-background');
    expect(result.pairs).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain('Unresolvable border color');
  });

  // ── Interactive state: silent skips ──

  test('interactive text pair skips unresolvable fg silently', () => {
    const meta: PairMeta = { ...baseMeta, interactiveState: 'hover' };
    const fgGroups: ForegroundGroup[] = [{ classes: [makeTagged('text-mystery')] }];
    const bg = [makeTagged('bg-primary')];
    const result = generatePairs(fgGroups, bg, meta, colorMap, true, 'bg-background');
    expect(result.pairs).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  test('interactive pair skips unresolvable bg silently', () => {
    const meta: PairMeta = { ...baseMeta, interactiveState: 'focus-visible' };
    const fgGroups: ForegroundGroup[] = [{ classes: [makeTagged('text-foreground')] }];
    const bg = [makeTagged('bg-mystery')];
    const result = generatePairs(fgGroups, bg, meta, colorMap, true, 'bg-background');
    expect(result.pairs).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  test('interactive pairs use raw bgClass (no implicit prefix)', () => {
    const meta: PairMeta = { ...baseMeta, interactiveState: 'hover' };
    const fgGroups: ForegroundGroup[] = [{ classes: [makeTagged('text-foreground')] }];
    const bg = [makeTagged('bg-card')];
    const result = generatePairs(fgGroups, bg, meta, colorMap, false, 'bg-card');
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.bgClass).toBe('bg-card'); // NOT "(implicit) bg-card"
  });

  // ── Metadata propagation ──

  test('propagates isLargeText on text pairs', () => {
    const meta: PairMeta = { ...baseMeta, isLargeText: true };
    const fgGroups: ForegroundGroup[] = [{ classes: [makeTagged('text-foreground')] }];
    const bg = [makeTagged('bg-primary')];
    const result = generatePairs(fgGroups, bg, meta, colorMap, true, 'bg-background');
    expect(result.pairs[0]!.isLargeText).toBe(true);
  });

  test('propagates interactiveState on pairs', () => {
    const meta: PairMeta = { ...baseMeta, interactiveState: 'hover' };
    const fgGroups: ForegroundGroup[] = [{ classes: [makeTagged('text-foreground')] }];
    const bg = [makeTagged('bg-primary')];
    const result = generatePairs(fgGroups, bg, meta, colorMap, true, 'bg-background');
    expect(result.pairs[0]!.interactiveState).toBe('hover');
  });

  test('base pairs have no interactiveState field', () => {
    const fgGroups: ForegroundGroup[] = [{ classes: [makeTagged('text-foreground')] }];
    const bg = [makeTagged('bg-primary')];
    const result = generatePairs(fgGroups, bg, baseMeta, colorMap, true, 'bg-background');
    expect(result.pairs[0]!.interactiveState).toBeUndefined();
  });

  test('propagates ignore reason and sets ignored=true', () => {
    const meta: PairMeta = { ...baseMeta, ignoreReason: 'decorative border' };
    const fgGroups: ForegroundGroup[] = [{ classes: [makeTagged('text-foreground')] }];
    const bg = [makeTagged('bg-primary')];
    const result = generatePairs(fgGroups, bg, meta, colorMap, true, 'bg-background');
    expect(result.pairs[0]!.ignored).toBe(true);
    expect(result.pairs[0]!.ignoreReason).toBe('decorative border');
  });

  test('null ignoreReason sets ignored=false and ignoreReason=undefined', () => {
    const fgGroups: ForegroundGroup[] = [{ classes: [makeTagged('text-foreground')] }];
    const bg = [makeTagged('bg-primary')];
    const result = generatePairs(fgGroups, bg, baseMeta, colorMap, true, 'bg-background');
    expect(result.pairs[0]!.ignored).toBe(false);
    expect(result.pairs[0]!.ignoreReason).toBeUndefined();
  });

  // ── Alpha preservation ──

  test('preserves alpha from colorMap resolution', () => {
    const fgGroups: ForegroundGroup[] = [{ classes: [makeTagged('text-semi')] }];
    const bg = [makeTagged('bg-background')];
    const result = generatePairs(fgGroups, bg, baseMeta, colorMap, true, 'bg-background');
    expect(result.pairs[0]!.textAlpha).toBe(0.5);
    expect(result.pairs[0]!.textHex).toBe('#ff0000');
  });

  // ── Mixed and empty groups ──

  test('handles mixed text and non-text groups', () => {
    const fgGroups: ForegroundGroup[] = [
      { classes: [makeTagged('text-foreground')] },
      { classes: [makeTagged('border-input')], pairType: 'border' },
    ];
    const bg = [makeTagged('bg-background')];
    const result = generatePairs(fgGroups, bg, baseMeta, colorMap, true, 'bg-background');
    expect(result.pairs).toHaveLength(2);
    expect(result.pairs[0]!.pairType).toBeUndefined();
    expect(result.pairs[1]!.pairType).toBe('border');
  });

  test('empty foreground groups produce no pairs', () => {
    const fgGroups: ForegroundGroup[] = [
      { classes: [] },
      { classes: [], pairType: 'border' },
    ];
    const bg = [makeTagged('bg-primary')];
    const result = generatePairs(fgGroups, bg, baseMeta, colorMap, true, 'bg-background');
    expect(result.pairs).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  test('multiple bg × multiple text produces cartesian product', () => {
    const fgGroups: ForegroundGroup[] = [
      { classes: [makeTagged('text-foreground'), makeTagged('text-red-500')] },
    ];
    const bg = [makeTagged('bg-primary'), makeTagged('bg-background')];
    const result = generatePairs(fgGroups, bg, baseMeta, colorMap, true, 'bg-background');
    expect(result.pairs).toHaveLength(4); // 2 bg × 2 text
  });

  // ── M11: Region with ONLY inline styles, no Tailwind classes ──

  test('M11: inline-only bg+text produces valid pair via bracket notation', () => {
    const inlineBg = [makeTagged('bg-[#ff0000]', { raw: '(inline) #ff0000' })];
    const inlineText = [makeTagged('text-[#0000ff]', { raw: '(inline) #0000ff' })];
    const fgGroups: ForegroundGroup[] = [{ classes: inlineText }];
    const result = generatePairs(fgGroups, inlineBg, baseMeta, colorMap, true, 'bg-background');
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.bgHex).toBe('#ff0000');
    expect(result.pairs[0]!.textHex).toBe('#0000ff');
    expect(result.pairs[0]!.bgClass).toBe('(inline) #ff0000');
    expect(result.pairs[0]!.textClass).toBe('(inline) #0000ff');
  });

  // ── M12: Same contextBg as text color → 1:1 contrast ──

  test('M12: context bg and text resolving to same hex produces 1:1 pair', () => {
    const bg = [makeTagged('bg-background')];
    const fgGroups: ForegroundGroup[] = [{ classes: [makeTagged('text-background')] }];
    const result = generatePairs(fgGroups, bg, baseMeta, colorMap, false, 'bg-background');
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.bgHex).toBe('#ffffff');
    expect(result.pairs[0]!.textHex).toBe('#ffffff');
  });

  // ── US-05: Opacity propagation ──

  describe('opacity propagation', () => {
    const opacityColorMap: ColorMap = new Map([
      ['--color-background', { hex: '#ffffff' }],
      ['--color-white', { hex: '#ffffff' }],
      ['--color-black', { hex: '#000000' }],
    ]);

    test('effectiveOpacity is propagated to pair', () => {
      const bg = [makeTagged('bg-background')];
      const fgGroups: ForegroundGroup[] = [
        { classes: [makeTagged('text-black')] },
      ];
      const meta: PairMeta = {
        file: 'test.tsx',
        line: 1,
        ignoreReason: null,
        isLargeText: false,
        effectiveOpacity: 0.5,
      };
      const { pairs } = generatePairs(fgGroups, bg, meta, opacityColorMap, false, 'bg-background');
      expect(pairs).toHaveLength(1);
      expect(pairs[0]!.effectiveOpacity).toBe(0.5);
    });

    test('effectiveOpacity reduces alpha on both bg and text', () => {
      const bg = [makeTagged('bg-background')];
      const fgGroups: ForegroundGroup[] = [
        { classes: [makeTagged('text-black')] },
      ];
      const meta: PairMeta = {
        file: 'test.tsx',
        line: 1,
        ignoreReason: null,
        isLargeText: false,
        effectiveOpacity: 0.5,
      };
      const { pairs } = generatePairs(fgGroups, bg, meta, opacityColorMap, false, 'bg-background');
      expect(pairs[0]!.bgAlpha).toBe(0.5);
      expect(pairs[0]!.textAlpha).toBe(0.5);
    });

    test('no effectiveOpacity means no alpha reduction', () => {
      const bg = [makeTagged('bg-background')];
      const fgGroups: ForegroundGroup[] = [
        { classes: [makeTagged('text-black')] },
      ];
      const meta: PairMeta = {
        file: 'test.tsx',
        line: 1,
        ignoreReason: null,
        isLargeText: false,
      };
      const { pairs } = generatePairs(fgGroups, bg, meta, opacityColorMap, false, 'bg-background');
      expect(pairs[0]!.effectiveOpacity).toBeUndefined();
      expect(pairs[0]!.bgAlpha).toBeUndefined();
      expect(pairs[0]!.textAlpha).toBeUndefined();
    });

    test('effectiveOpacity 1.0 does not reduce alpha', () => {
      const bg = [makeTagged('bg-background')];
      const fgGroups: ForegroundGroup[] = [
        { classes: [makeTagged('text-black')] },
      ];
      const meta: PairMeta = {
        file: 'test.tsx',
        line: 1,
        ignoreReason: null,
        isLargeText: false,
        effectiveOpacity: 1,
      };
      const { pairs } = generatePairs(fgGroups, bg, meta, opacityColorMap, false, 'bg-background');
      expect(pairs[0]!.effectiveOpacity).toBeUndefined();
      expect(pairs[0]!.bgAlpha).toBeUndefined();
      expect(pairs[0]!.textAlpha).toBeUndefined();
    });

    test('effectiveOpacity multiplies with existing alpha', () => {
      const alphaColorMap: ColorMap = new Map([
        ['--color-background', { hex: '#ffffff', alpha: 0.8 }],
        ['--color-black', { hex: '#000000', alpha: 0.9 }],
      ]);
      const bg = [makeTagged('bg-background')];
      const fgGroups: ForegroundGroup[] = [
        { classes: [makeTagged('text-black')] },
      ];
      const meta: PairMeta = {
        file: 'test.tsx',
        line: 1,
        ignoreReason: null,
        isLargeText: false,
        effectiveOpacity: 0.5,
      };
      const { pairs } = generatePairs(fgGroups, bg, meta, alphaColorMap, false, 'bg-background');
      expect(pairs[0]!.bgAlpha).toBeCloseTo(0.4); // 0.8 * 0.5
      expect(pairs[0]!.textAlpha).toBeCloseTo(0.45); // 0.9 * 0.5
    });
  });
});

// ── contextOverride in resolveFileRegions ──────────────────────────────

describe('contextOverride in resolveFileRegions', () => {
  const colorMap: ColorMap = new Map([
    ['--color-white', { hex: '#ffffff' }],
    ['--color-black', { hex: '#000000' }],
    ['--color-slate-900', { hex: '#0f172a' }],
    ['--color-background', { hex: '#ffffff' }],
  ]);

  function makePreExtracted(regions: ClassRegion[]): PreExtracted {
    return {
      files: [{
        relPath: 'test.tsx',
        lines: ['<span className="text-white">Badge</span>'],
        regions,
      }],
      readErrors: [],
      filesScanned: 1,
    };
  }

  test('bg override replaces contextBg in pair generation', () => {
    const pre = makePreExtracted([{
      content: 'text-white',
      startLine: 1,
      contextBg: 'bg-background',
      contextOverride: { bg: 'bg-slate-900' },
    }]);
    const result = resolveFileRegions(pre, colorMap);

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.bgHex).toBe('#0f172a');
    expect(result.pairs[0]!.contextSource).toBe('annotation');
  });

  test('fg override replaces resolved text color', () => {
    const pre = makePreExtracted([{
      content: 'text-white',
      startLine: 1,
      contextBg: 'bg-background',
      contextOverride: { fg: '#000000' },
    }]);
    const result = resolveFileRegions(pre, colorMap);

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.textHex).toBe('#000000');
    expect(result.pairs[0]!.contextSource).toBe('annotation');
  });

  test('without contextOverride, contextSource is not set', () => {
    const pre = makePreExtracted([{
      content: 'text-white',
      startLine: 1,
      contextBg: 'bg-background',
    }]);
    const result = resolveFileRegions(pre, colorMap);

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.contextSource).toBeUndefined();
  });

  test('effectiveOpacity flows from region to pair', () => {
    const opacityColorMap: ColorMap = new Map([
      ['--color-background', { hex: '#ffffff' }],
      ['--color-black', { hex: '#000000' }],
    ]);
    const preExtracted: PreExtracted = {
      files: [{
        relPath: 'test.tsx',
        lines: ['<div className="text-black">x</div>'],
        regions: [{
          content: 'text-black',
          startLine: 1,
          contextBg: 'bg-background',
          effectiveOpacity: 0.5,
        }],
      }],
      readErrors: [],
      filesScanned: 1,
    };
    const { pairs } = resolveFileRegions(preExtracted, opacityColorMap, 'light');
    expect(pairs[0]!.effectiveOpacity).toBe(0.5);
    expect(pairs[0]!.bgAlpha).toBe(0.5);
    expect(pairs[0]!.textAlpha).toBe(0.5);
  });
});
