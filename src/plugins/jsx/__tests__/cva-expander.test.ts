import { describe, test, expect } from 'vitest';
import { extractCvaBase, parseCvaVariants } from '../cva-expander.js';

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
