import { describe, test, expect } from 'vitest';
import {
  extractClassRegions,
  isSelfClosingTag,
  findExplicitBgInTag,
  extractInlineStyleColors,
} from '../parser.js';
import { shadcnPreset } from '../../tailwind/presets/shadcn.js';

// Use shadcn preset for container context in tests
const containerMap = shadcnPreset.containers;
const defaultBg = shadcnPreset.defaultBg;

/** Helper: extract regions using shadcn preset defaults */
function extract(source: string) {
  return extractClassRegions(source, containerMap, defaultBg);
}

// ── extractClassRegions (state machine, without file I/O) ─────────────

describe('extractClassRegions', () => {
  test('extracts className="..." static classes', () => {
    const source = '<div className="bg-red-500 text-white">hello</div>';
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.content).toBe('bg-red-500 text-white');
    expect(regions[0]!.startLine).toBe(1);
  });

  test('extracts className={cn(...)} calls', () => {
    const source = `<div className={cn('bg-blue-500', 'text-white')}>hello</div>`;
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.content).toContain('bg-blue-500');
  });

  test('extracts className={clsx(...)} calls', () => {
    const source = `<div className={clsx('bg-green-500')}>hello</div>`;
    const regions = extract(source);

    expect(regions).toHaveLength(1);
  });

  test('extracts standalone cn() not inside className=', () => {
    const source = `const cls = cn('bg-red-500', 'text-white');`;
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.content).toContain('bg-red-500');
  });

  test('extracts standalone cva() calls', () => {
    const source = `const variants = cva('base-class', { variants: {} });`;
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.content).toContain('base-class');
  });

  test("handles className={'...'}", () => {
    const source = `<div className={'bg-red-500'}>hello</div>`;
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.content).toBe('bg-red-500');
  });

  test('handles className={"..."}', () => {
    const source = `<div className={"bg-red-500"}>hello</div>`;
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.content).toBe('bg-red-500');
  });

  test('handles className={`...`} template literal', () => {
    const source = '<div className={`bg-red-500 text-white`}>hello</div>';
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.content).toContain('bg-red-500');
  });

  test('multiline cn() is captured', () => {
    const source = `<div className={cn(
      'bg-red-500',
      'text-white',
      isActive && 'border-blue-500'
    )}>hello</div>`;
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.content).toContain('bg-red-500');
    expect(regions[0]!.content).toContain('text-white');
    expect(regions[0]!.content).toContain('border-blue-500');
  });

  test('multiple regions in same file', () => {
    const source = `
      <div className="bg-red-500">
        <span className="text-white">hello</span>
      </div>
    `;
    const regions = extract(source);
    expect(regions).toHaveLength(2);
  });

  test('skips // single-line comments', () => {
    const source = `
      // className="should-not-match"
      <div className="bg-red-500">hello</div>
    `;
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.content).toBe('bg-red-500');
  });

  test('skips /* block comments */', () => {
    const source = `
      /* className="should-not-match" */
      <div className="bg-red-500">hello</div>
    `;
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.content).toBe('bg-red-500');
  });

  test('correct startLine for multiline source', () => {
    const source = `line1
line2
<div className="bg-red-500">hello</div>`;
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.startLine).toBe(3);
  });

  test('default contextBg is bg-background for root-level elements', () => {
    const source = '<div className="text-white">hello</div>';
    const regions = extract(source);

    expect(regions[0]!.contextBg).toBe('bg-background');
  });

  test('empty source → no regions', () => {
    expect(extract('')).toHaveLength(0);
  });

  test('source with no className → no regions', () => {
    expect(extract('<div>hello</div>')).toHaveLength(0);
  });

  // ── Inline style extraction ────────────────────────────────────────
  test('style={{ color: "#ff0000" }} on same tag as className is captured', () => {
    const source = '<p style={{ color: "#ff0000" }} className="bg-white">text</p>';
    const regions = extract(source);
    expect(regions.length).toBeGreaterThanOrEqual(1);
    const region = regions.find((r) => r.content.includes('bg-white'));
    expect(region).toBeDefined();
    expect(region!.inlineStyles).toBeDefined();
    expect(region!.inlineStyles!.color).toBe('#ff0000');
  });

  test('style={{ backgroundColor: "#0000ff" }} on same tag as className is captured', () => {
    const source =
      '<div style={{ backgroundColor: "#0000ff" }} className="text-white">hi</div>';
    const regions = extract(source);
    const region = regions.find((r) => r.content.includes('text-white'));
    expect(region).toBeDefined();
    expect(region!.inlineStyles).toBeDefined();
    expect(region!.inlineStyles!.backgroundColor).toBe('#0000ff');
  });

  test('no inline style → inlineStyles is undefined', () => {
    const source = '<p className="bg-white text-black">text</p>';
    const regions = extract(source);
    expect(regions[0]!.inlineStyles).toBeUndefined();
  });

  // Guard: standalone cn() preceded by identifier char should not match
  test('does not match xcn() or mycn()', () => {
    const source = `const x = mycn('bg-red-500');`;
    const regions = extract(source);
    expect(regions).toHaveLength(0);
  });
});

// ── extractClassRegions — malformed JSX edge cases (M10) ──────────────

describe('extractClassRegions — malformed JSX', () => {
  test('M10: unclosed className string does not infinite loop', () => {
    const src = '<div className="bg-red-500 text-white';
    const regions = extract(src);
    expect(Array.isArray(regions)).toBe(true);
  });

  test('M10: unclosed className expression does not infinite loop', () => {
    const src = '<div className={cn("bg-red-500 text-white"';
    const regions = extract(src);
    expect(Array.isArray(regions)).toBe(true);
  });

  test('M10: unclosed cn() parens does not infinite loop', () => {
    const src = '<div className={cn("bg-white"';
    const regions = extract(src);
    expect(Array.isArray(regions)).toBe(true);
  });

  test('empty className produces empty content', () => {
    const src = '<div className="">';
    const regions = extract(src);
    expect(regions.length).toBeLessThanOrEqual(1);
  });
});

// ── isSelfClosingTag ──────────────────────────────────────────────────

describe('isSelfClosingTag', () => {
  test('detects simple self-closing tag', () => {
    const src = '<img src="x" />';
    expect(isSelfClosingTag(src, 4)).toBe(true);
  });

  test('detects non-self-closing tag', () => {
    const src = '<div className="foo">';
    expect(isSelfClosingTag(src, 4)).toBe(false);
  });

  test('M20: slash inside string attribute does not false-match', () => {
    const src = `<Card className="bg-[url('/img.png')]" />`;
    expect(isSelfClosingTag(src, 5)).toBe(true);
  });

  test('M20: slash inside JSX expression does not false-match', () => {
    const src = '<Icon icon={path/to/icon} />';
    expect(isSelfClosingTag(src, 5)).toBe(true);
  });

  test('slash inside brace expression ignored until depth 0', () => {
    const src = '<Comp prop={a > b ? "/" : "x"} />';
    expect(isSelfClosingTag(src, 5)).toBe(true);
  });

  test('returns false for malformed tag (no closing >)', () => {
    const src = '<div className="foo"';
    expect(isSelfClosingTag(src, 4)).toBe(false);
  });
});

// ── findExplicitBgInTag ───────────────────────────────────────────────

describe('findExplicitBgInTag', () => {
  test('finds bg-white in simple tag', () => {
    const src = '<Card className="bg-white text-black">';
    expect(findExplicitBgInTag(src, 5)).toBe('bg-white');
  });

  test('finds bg-slate-100 in expression', () => {
    const src = '<Card className={cn("bg-slate-100 text-black")}>';
    expect(findExplicitBgInTag(src, 5)).toBe('bg-slate-100');
  });

  test('skips variant-prefixed bg classes (dark:bg-*)', () => {
    const src = '<Card className="dark:bg-gray-900 text-white">';
    expect(findExplicitBgInTag(src, 5)).toBeNull();
  });

  test('skips bg-linear-* (gradient, not color)', () => {
    const src = '<Card className="bg-linear-to-r text-white">';
    expect(findExplicitBgInTag(src, 5)).toBeNull();
  });

  test('returns null when no bg class present', () => {
    const src = '<Card className="text-black p-4">';
    expect(findExplicitBgInTag(src, 5)).toBeNull();
  });

  test('handles self-closing tag', () => {
    const src = '<Card className="bg-red-500" />';
    expect(findExplicitBgInTag(src, 5)).toBe('bg-red-500');
  });
});

// ── extractInlineStyleColors ──────────────────────────────────────────

describe('extractInlineStyleColors', () => {
  test('extracts backgroundColor from inline style', () => {
    const src = `<div style={{ backgroundColor: '#ff0000' }} className="text-white">`;
    const pos = src.indexOf('className');
    const result = extractInlineStyleColors(src, pos);
    expect(result).toBeDefined();
    expect(result!.backgroundColor).toBe('#ff0000');
  });

  test('extracts color from inline style', () => {
    const src = `<div style={{ color: '#00ff00' }} className="bg-white">`;
    const pos = src.indexOf('className');
    const result = extractInlineStyleColors(src, pos);
    expect(result).toBeDefined();
    expect(result!.color).toBe('#00ff00');
  });

  test('extracts both color and backgroundColor', () => {
    const src = `<div style={{ color: '#111', backgroundColor: '#222' }} className="p-4">`;
    const pos = src.indexOf('className');
    const result = extractInlineStyleColors(src, pos);
    expect(result).toBeDefined();
    expect(result!.color).toBe('#111');
    expect(result!.backgroundColor).toBe('#222');
  });

  test('M19: non-literal value (JS variable) returns undefined', () => {
    const src = `<div style={{ backgroundColor: someVar }} className="text-white">`;
    const pos = src.indexOf('className');
    const result = extractInlineStyleColors(src, pos);
    expect(result).toBeUndefined();
  });

  test('returns undefined when no style prop', () => {
    const src = '<div className="bg-white text-black">';
    const pos = src.indexOf('className');
    const result = extractInlineStyleColors(src, pos);
    expect(result).toBeUndefined();
  });
});

// ── @a11y-context single-element annotations ───────────────────────────

describe('@a11y-context (single-element)', () => {
  test('annotation on previous line attaches contextOverride to next region', () => {
    const source = [
      '// @a11y-context bg:bg-slate-900',
      '<span className="text-white">Badge</span>',
    ].join('\n');
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.contextOverride).toEqual({ bg: 'bg-slate-900' });
  });

  test('JSX block comment annotation attaches override', () => {
    const source = [
      '{/* @a11y-context bg:#09090b fg:text-white */}',
      '<div className="text-sm">overlay</div>',
    ].join('\n');
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.contextOverride).toEqual({ bg: '#09090b', fg: 'text-white' });
  });

  test('annotation only applies to the next region, not subsequent ones', () => {
    const source = [
      '// @a11y-context bg:bg-slate-900',
      '<span className="text-white">Badge</span>',
      '<span className="text-black">Other</span>',
    ].join('\n');
    const regions = extract(source);

    expect(regions).toHaveLength(2);
    expect(regions[0]!.contextOverride).toEqual({ bg: 'bg-slate-900' });
    expect(regions[1]!.contextOverride).toBeUndefined();
  });

  test('annotation without className on next line is consumed and lost', () => {
    const source = [
      '// @a11y-context bg:bg-slate-900',
      '<div>no className here</div>',
      '<span className="text-white">Later</span>',
    ].join('\n');
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.contextOverride).toBeUndefined();
  });

  test('regular comment does not attach override', () => {
    const source = [
      '// This is a regular comment',
      '<span className="text-white">Badge</span>',
    ].join('\n');
    const regions = extract(source);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.contextOverride).toBeUndefined();
  });
});
