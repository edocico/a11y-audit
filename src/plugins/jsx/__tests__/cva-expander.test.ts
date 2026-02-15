import { describe, test, expect } from 'vitest';
import { extractCvaBase, parseCvaVariants, expandCvaToRegions, expandCvaInPreExtracted } from '../cva-expander.js';
import type { ClassRegion, FileRegions } from '../../../core/types.js';

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

describe('parseCvaVariants', () => {
  test('parses variant groups with string literal values', () => {
    const content = `"base", {
      variants: {
        variant: {
          default: "bg-primary text-primary-foreground",
          destructive: "bg-destructive text-destructive-foreground",
          outline: "border border-input bg-background",
        },
        size: {
          default: "h-10 px-4 py-2",
          sm: "h-9 px-3",
          lg: "h-11 px-8",
        },
      },
      defaultVariants: {
        variant: "default",
        size: "default",
      },
    }`;

    const result = parseCvaVariants(content);

    expect(result.variants).toHaveLength(2);

    const variantGroup = result.variants.find(v => v.axis === 'variant');
    expect(variantGroup).toBeDefined();
    expect(variantGroup!.options).toHaveLength(3);
    expect(variantGroup!.options[0]!.name).toBe('default');
    expect(variantGroup!.options[0]!.classes).toBe('bg-primary text-primary-foreground');

    const sizeGroup = result.variants.find(v => v.axis === 'size');
    expect(sizeGroup).toBeDefined();
    expect(sizeGroup!.options).toHaveLength(3);

    expect(result.defaultVariants.get('variant')).toBe('default');
    expect(result.defaultVariants.get('size')).toBe('default');
  });

  test('handles cva with no variants (base-only)', () => {
    const content = `"rounded-md font-semibold"`;
    const result = parseCvaVariants(content);

    expect(result.variants).toHaveLength(0);
    expect(result.defaultVariants.size).toBe(0);
  });

  test('handles single variant group', () => {
    const content = `"base", {
      variants: {
        intent: {
          primary: "bg-blue-500",
          danger: "bg-red-500",
        },
      },
    }`;

    const result = parseCvaVariants(content);
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]!.axis).toBe('intent');
    expect(result.variants[0]!.options).toHaveLength(2);
    expect(result.defaultVariants.size).toBe(0);
  });

  test('skips compoundVariants (not supported)', () => {
    const content = `"base", {
      variants: {
        variant: { primary: "bg-blue-500" },
      },
      compoundVariants: [
        { variant: "primary", class: "extra" },
      ],
    }`;

    const result = parseCvaVariants(content);
    expect(result.variants).toHaveLength(1);
    // compoundVariants is silently ignored
  });

  test('ignores non-string-literal values', () => {
    const content = `"base", {
      variants: {
        variant: {
          primary: "bg-blue-500",
          dynamic: someVariable,
        },
      },
    }`;

    const result = parseCvaVariants(content);
    expect(result.variants[0]!.options).toHaveLength(1);
    expect(result.variants[0]!.options[0]!.name).toBe('primary');
  });
});

describe('expandCvaToRegions', () => {
  const baseRegion: ClassRegion = {
    content: `"rounded-md font-semibold text-sm", {
      variants: {
        variant: {
          default: "bg-primary text-primary-foreground",
          destructive: "bg-destructive text-destructive-foreground",
        },
        size: {
          default: "h-10 px-4",
          sm: "h-9 px-3",
        },
      },
      defaultVariants: {
        variant: "default",
        size: "default",
      },
    }`,
    startLine: 5,
    contextBg: 'bg-card',
  };

  test('default mode: produces ONE region with base + defaultVariants classes', () => {
    const regions = expandCvaToRegions(baseRegion, false);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.content).toContain('rounded-md');
    expect(regions[0]!.content).toContain('font-semibold');
    expect(regions[0]!.content).toContain('bg-primary');
    expect(regions[0]!.content).toContain('text-primary-foreground');
    expect(regions[0]!.content).toContain('h-10');
    expect(regions[0]!.startLine).toBe(5);
    expect(regions[0]!.contextBg).toBe('bg-card');
  });

  test('checkAllVariants mode: produces region per non-default variant', () => {
    const regions = expandCvaToRegions(baseRegion, true);

    // 1 default combo + 1 destructive variant + 1 sm size = 3
    expect(regions.length).toBeGreaterThanOrEqual(2);

    const destructive = regions.find(r => r.content.includes('bg-destructive'));
    expect(destructive).toBeDefined();
    expect(destructive!.content).toContain('rounded-md');
  });

  test('cva with no variants returns single region with base classes', () => {
    const simpleRegion: ClassRegion = {
      content: '"rounded-md bg-primary text-white"',
      startLine: 1,
      contextBg: 'bg-background',
    };

    const regions = expandCvaToRegions(simpleRegion, false);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.content).toBe('rounded-md bg-primary text-white');
  });

  test('preserves effectiveOpacity and contextOverride', () => {
    const regionWithContext: ClassRegion = {
      ...baseRegion,
      effectiveOpacity: 0.5,
      contextOverride: { bg: '#ff0000' },
    };

    const regions = expandCvaToRegions(regionWithContext, false);

    expect(regions[0]!.effectiveOpacity).toBe(0.5);
    expect(regions[0]!.contextOverride).toEqual({ bg: '#ff0000' });
  });
});

describe('expandCvaInPreExtracted', () => {
  test('replaces cva() regions with expanded virtual regions', () => {
    const files: FileRegions[] = [{
      relPath: 'Button.tsx',
      lines: ['const buttonVariants = cva('],
      regions: [
        {
          content: '"bg-primary text-white", { variants: { size: { sm: "h-9", lg: "h-11" } }, defaultVariants: { size: "sm" } }',
          startLine: 1,
          contextBg: 'bg-background',
        },
        {
          content: 'font-bold text-lg',
          startLine: 10,
          contextBg: 'bg-background',
        },
      ],
    }];

    const result = expandCvaInPreExtracted(
      { files, readErrors: [], filesScanned: 1 },
      false,
    );

    expect(result.files[0]!.regions.length).toBe(2);
    expect(result.files[0]!.regions[0]!.content).toContain('bg-primary');
    expect(result.files[0]!.regions[0]!.content).toContain('h-9');
    expect(result.files[0]!.regions[1]!.content).toBe('font-bold text-lg');
  });

  test('leaves non-cva regions untouched', () => {
    const files: FileRegions[] = [{
      relPath: 'Card.tsx',
      lines: [],
      regions: [
        { content: 'bg-card text-card-foreground p-6', startLine: 3, contextBg: 'bg-background' },
      ],
    }];

    const result = expandCvaInPreExtracted(
      { files, readErrors: [], filesScanned: 1 },
      false,
    );

    expect(result.files[0]!.regions).toHaveLength(1);
    expect(result.files[0]!.regions[0]!.content).toBe('bg-card text-card-foreground p-6');
  });

  test('checkAllVariants=true expands to multiple regions', () => {
    const files: FileRegions[] = [{
      relPath: 'Button.tsx',
      lines: [],
      regions: [
        {
          content: '"base", { variants: { v: { a: "class-a", b: "class-b" } }, defaultVariants: { v: "a" } }',
          startLine: 1,
          contextBg: 'bg-background',
        },
      ],
    }];

    const result = expandCvaInPreExtracted(
      { files, readErrors: [], filesScanned: 1 },
      true,
    );

    // default combo (base + class-a) + non-default variant (base + class-b) = 2
    expect(result.files[0]!.regions.length).toBe(2);
  });
});
