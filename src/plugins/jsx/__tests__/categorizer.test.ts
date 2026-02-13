import { describe, test, expect } from 'vitest';
import {
  stripVariants,
  routeClassToTarget,
  categorizeClasses,
  determineIsLargeText,
  extractStringLiterals,
  extractBalancedParens,
} from '../categorizer.js';
import type { ClassBuckets, TaggedClass } from '../categorizer.js';

// ── Helper: creates a TaggedClass for routeClassToTarget tests ────────

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

function emptyBuckets(): ClassBuckets {
  return {
    bgClasses: [],
    textClasses: [],
    borderClasses: [],
    ringClasses: [],
    outlineClasses: [],
  };
}

// ── stripVariants ─────────────────────────────────────────────────────

describe('stripVariants', () => {
  test('no prefix → base unchanged, no flags', () => {
    const result = stripVariants('bg-red-500');
    expect(result.base).toBe('bg-red-500');
    expect(result.isDark).toBe(false);
    expect(result.isInteractive).toBe(false);
    expect(result.interactiveState).toBeNull();
    expect(result.raw).toBe('bg-red-500');
  });

  test('hover: → isInteractive=true, interactiveState=hover', () => {
    const result = stripVariants('hover:bg-red-500');
    expect(result.base).toBe('bg-red-500');
    expect(result.isDark).toBe(false);
    expect(result.isInteractive).toBe(true);
    expect(result.interactiveState).toBe('hover');
  });

  test('focus-visible: → isInteractive=true, interactiveState=focus-visible', () => {
    const result = stripVariants('focus-visible:ring-blue-500');
    expect(result.base).toBe('ring-blue-500');
    expect(result.isInteractive).toBe(true);
    expect(result.interactiveState).toBe('focus-visible');
  });

  test('dark: → isDark=true, not interactive', () => {
    const result = stripVariants('dark:bg-slate-900');
    expect(result.base).toBe('bg-slate-900');
    expect(result.isDark).toBe(true);
    expect(result.isInteractive).toBe(false);
    expect(result.interactiveState).toBeNull();
  });

  test('dark:hover: → isDark=true AND isInteractive=true (compound)', () => {
    const result = stripVariants('dark:hover:bg-red-600');
    expect(result.base).toBe('bg-red-600');
    expect(result.isDark).toBe(true);
    expect(result.isInteractive).toBe(true);
    expect(result.interactiveState).toBe('hover');
  });

  test('sm: → isInteractive=true, but interactiveState=null (untracked)', () => {
    const result = stripVariants('sm:bg-blue-500');
    expect(result.base).toBe('bg-blue-500');
    expect(result.isInteractive).toBe(true);
    expect(result.interactiveState).toBeNull();
  });

  test('stacked: sm:dark:hover:bg-red-500 → all flags set', () => {
    const result = stripVariants('sm:dark:hover:bg-red-500');
    expect(result.base).toBe('bg-red-500');
    expect(result.isDark).toBe(true);
    expect(result.isInteractive).toBe(true);
    expect(result.interactiveState).toBe('hover');
  });

  test('active: → isInteractive=true, interactiveState=null (untracked)', () => {
    const result = stripVariants('active:bg-red-700');
    expect(result.base).toBe('bg-red-700');
    expect(result.isInteractive).toBe(true);
    expect(result.interactiveState).toBeNull();
  });

  test('group-hover: → isInteractive=true, interactiveState=null (untracked)', () => {
    const result = stripVariants('group-hover:text-white');
    expect(result.base).toBe('text-white');
    expect(result.isInteractive).toBe(true);
    expect(result.interactiveState).toBeNull();
  });

  test('preserves raw original class', () => {
    const result = stripVariants('dark:hover:bg-red-600');
    expect(result.raw).toBe('dark:hover:bg-red-600');
  });

  test('aria-selected: prefix is stripped', () => {
    const result = stripVariants('aria-selected:bg-accent');
    expect(result.base).toBe('bg-accent');
    expect(result.isInteractive).toBe(true);
  });

  test('aria-disabled: → isInteractive=true, interactiveState=aria-disabled', () => {
    const result = stripVariants('aria-disabled:bg-gray-100');
    expect(result.base).toBe('bg-gray-100');
    expect(result.isInteractive).toBe(true);
    expect(result.interactiveState).toBe('aria-disabled');
  });

  test('dark:aria-disabled: → isDark + interactiveState=aria-disabled', () => {
    const result = stripVariants('dark:aria-disabled:text-gray-400');
    expect(result.base).toBe('text-gray-400');
    expect(result.isDark).toBe(true);
    expect(result.isInteractive).toBe(true);
    expect(result.interactiveState).toBe('aria-disabled');
  });
});

// ── routeClassToTarget ────────────────────────────────────────────────

describe('routeClassToTarget', () => {
  test('bg-red-500 → bgClasses', () => {
    const target = emptyBuckets();
    const routed = routeClassToTarget(makeTagged('bg-red-500'), target);
    expect(routed).toBe(true);
    expect(target.bgClasses).toHaveLength(1);
    expect(target.bgClasses[0]!.base).toBe('bg-red-500');
  });

  test('text-white → textClasses', () => {
    const target = emptyBuckets();
    const routed = routeClassToTarget(makeTagged('text-white'), target);
    expect(routed).toBe(true);
    expect(target.textClasses).toHaveLength(1);
  });

  test('border-red-500 → borderClasses', () => {
    const target = emptyBuckets();
    const routed = routeClassToTarget(makeTagged('border-red-500'), target);
    expect(routed).toBe(true);
    expect(target.borderClasses).toHaveLength(1);
  });

  test('border-t-red-500 (directional) → borderClasses', () => {
    const target = emptyBuckets();
    const routed = routeClassToTarget(makeTagged('border-t-red-500'), target);
    expect(routed).toBe(true);
    expect(target.borderClasses).toHaveLength(1);
  });

  test('divide-red-500 → borderClasses', () => {
    const target = emptyBuckets();
    const routed = routeClassToTarget(makeTagged('divide-red-500'), target);
    expect(routed).toBe(true);
    expect(target.borderClasses).toHaveLength(1);
  });

  test('ring-blue-500 → ringClasses', () => {
    const target = emptyBuckets();
    const routed = routeClassToTarget(makeTagged('ring-blue-500'), target);
    expect(routed).toBe(true);
    expect(target.ringClasses).toHaveLength(1);
  });

  test('outline-red-500 → outlineClasses', () => {
    const target = emptyBuckets();
    const routed = routeClassToTarget(makeTagged('outline-red-500'), target);
    expect(routed).toBe(true);
    expect(target.outlineClasses).toHaveLength(1);
  });

  // Skipped classes (non-color utilities)
  test('bg-gradient-to-r → returns false (gradient, not color)', () => {
    const target = emptyBuckets();
    expect(routeClassToTarget(makeTagged('bg-gradient-to-r'), target)).toBe(false);
    expect(target.bgClasses).toHaveLength(0);
  });

  test('bg-linear-to-br → returns false (gradient)', () => {
    const target = emptyBuckets();
    expect(routeClassToTarget(makeTagged('bg-linear-to-br'), target)).toBe(false);
  });

  test('bg-no-repeat → returns false (non-color bg utility)', () => {
    const target = emptyBuckets();
    expect(routeClassToTarget(makeTagged('bg-no-repeat'), target)).toBe(false);
  });

  test('bg-clip-text → returns false (non-color bg utility)', () => {
    const target = emptyBuckets();
    expect(routeClassToTarget(makeTagged('bg-clip-text'), target)).toBe(false);
  });

  test('text-xs → returns false (non-color text utility)', () => {
    const target = emptyBuckets();
    expect(routeClassToTarget(makeTagged('text-xs'), target)).toBe(false);
  });

  test('text-center → returns false (non-color text utility)', () => {
    const target = emptyBuckets();
    expect(routeClassToTarget(makeTagged('text-center'), target)).toBe(false);
  });

  test('text-ellipsis → returns false (non-color text utility)', () => {
    const target = emptyBuckets();
    expect(routeClassToTarget(makeTagged('text-ellipsis'), target)).toBe(false);
  });

  test('text-[14px] (arbitrary size) → returns false', () => {
    const target = emptyBuckets();
    expect(routeClassToTarget(makeTagged('text-[14px]'), target)).toBe(false);
  });

  test('border-0 → returns false (non-color border)', () => {
    const target = emptyBuckets();
    expect(routeClassToTarget(makeTagged('border-0'), target)).toBe(false);
  });

  test('border-solid → returns false (non-color border)', () => {
    const target = emptyBuckets();
    expect(routeClassToTarget(makeTagged('border-solid'), target)).toBe(false);
  });

  test('ring-0 → returns false (non-color ring)', () => {
    const target = emptyBuckets();
    expect(routeClassToTarget(makeTagged('ring-0'), target)).toBe(false);
  });

  test('ring-offset-2 → returns false (offset, not ring color)', () => {
    const target = emptyBuckets();
    expect(routeClassToTarget(makeTagged('ring-offset-2'), target)).toBe(false);
  });

  test('ring-inset → returns false (non-color ring)', () => {
    const target = emptyBuckets();
    expect(routeClassToTarget(makeTagged('ring-inset'), target)).toBe(false);
  });

  test('outline-none → returns false (non-color outline)', () => {
    const target = emptyBuckets();
    expect(routeClassToTarget(makeTagged('outline-none'), target)).toBe(false);
  });

  test('outline-hidden → returns false (non-color outline)', () => {
    const target = emptyBuckets();
    expect(routeClassToTarget(makeTagged('outline-hidden'), target)).toBe(false);
  });

  test('unrelated class (p-4) → returns false', () => {
    const target = emptyBuckets();
    expect(routeClassToTarget(makeTagged('p-4'), target)).toBe(false);
  });

  test('font-bold → returns false (not a color category)', () => {
    const target = emptyBuckets();
    expect(routeClassToTarget(makeTagged('font-bold'), target)).toBe(false);
  });
});

// ── categorizeClasses ─────────────────────────────────────────────────

describe('categorizeClasses', () => {
  test('light mode: skips dark: prefixed classes', () => {
    const classes = ['bg-white', 'dark:bg-slate-900', 'text-black'];
    const result = categorizeClasses(classes, 'light');

    expect(result.bgClasses).toHaveLength(1);
    expect(result.bgClasses[0]!.base).toBe('bg-white');
    expect(result.textClasses).toHaveLength(1);
    expect(result.textClasses[0]!.base).toBe('text-black');
  });

  test('dark mode: dark: overrides base bg when dark:bg-* present', () => {
    const classes = ['bg-white', 'dark:bg-slate-900', 'text-black'];
    const result = categorizeClasses(classes, 'dark');

    expect(result.bgClasses).toHaveLength(1);
    expect(result.bgClasses[0]!.base).toBe('bg-slate-900');
    expect(result.bgClasses[0]!.isDark).toBe(true);
  });

  test('dark mode: keeps base bg when no dark:bg-* override exists', () => {
    const classes = ['bg-white', 'text-black', 'dark:text-white'];
    const result = categorizeClasses(classes, 'dark');

    expect(result.bgClasses).toHaveLength(1);
    expect(result.bgClasses[0]!.base).toBe('bg-white');
    expect(result.textClasses).toHaveLength(1);
    expect(result.textClasses[0]!.base).toBe('text-white');
  });

  test('interactive hover goes to interactiveStates map', () => {
    const classes = ['bg-blue-500', 'hover:bg-blue-600', 'text-white'];
    const result = categorizeClasses(classes, 'light');

    expect(result.bgClasses).toHaveLength(1);
    expect(result.interactiveStates.size).toBe(1);
    expect(result.interactiveStates.has('hover')).toBe(true);

    const hoverBucket = result.interactiveStates.get('hover')!;
    expect(hoverBucket.bgClasses).toHaveLength(1);
    expect(hoverBucket.bgClasses[0]!.base).toBe('bg-blue-600');
  });

  test('focus-visible goes to interactiveStates map', () => {
    const classes = ['ring-transparent', 'focus-visible:ring-blue-500'];
    const result = categorizeClasses(classes, 'light');

    expect(result.interactiveStates.has('focus-visible')).toBe(true);
    const fvBucket = result.interactiveStates.get('focus-visible')!;
    expect(fvBucket.ringClasses).toHaveLength(1);
    expect(fvBucket.ringClasses[0]!.base).toBe('ring-blue-500');
  });

  test('aria-disabled: classes go to interactive state bucket', () => {
    const result = categorizeClasses(
      ['bg-white', 'text-black', 'aria-disabled:bg-gray-100', 'aria-disabled:text-gray-400'],
      'light',
    );
    expect(result.interactiveStates.has('aria-disabled')).toBe(true);
    const ariaState = result.interactiveStates.get('aria-disabled')!;
    expect(ariaState.bgClasses).toHaveLength(1);
    expect(ariaState.bgClasses[0]!.base).toBe('bg-gray-100');
    expect(ariaState.textClasses).toHaveLength(1);
    expect(ariaState.textClasses[0]!.base).toBe('text-gray-400');
  });

  test('untracked interactive variants (sm:, active:) are skipped entirely', () => {
    const classes = ['sm:bg-blue-500', 'active:bg-red-700'];
    const result = categorizeClasses(classes, 'light');

    expect(result.bgClasses).toHaveLength(0);
    expect(result.interactiveStates.size).toBe(0);
  });

  test('captures fontSize for large text detection', () => {
    const classes = ['text-2xl', 'text-white', 'bg-black'];
    const result = categorizeClasses(classes, 'light');
    expect(result.fontSize).toBe('text-2xl');
  });

  test('captures isBold flag', () => {
    const classes = ['font-bold', 'text-white', 'bg-black'];
    const result = categorizeClasses(classes, 'light');
    expect(result.isBold).toBe(true);
  });

  test('fontSize captured even from font-size utilities in text-* set', () => {
    const classes = ['text-xl', 'font-bold', 'text-white'];
    const result = categorizeClasses(classes, 'light');
    expect(result.fontSize).toBe('text-xl');
    expect(result.isBold).toBe(true);
  });

  test('dynamic classes ($) go to dynamicClasses', () => {
    const classes = ['bg-${color}', 'text-white'];
    const result = categorizeClasses(classes, 'light');
    expect(result.dynamicClasses).toHaveLength(1);
    expect(result.dynamicClasses[0]).toBe('bg-${color}');
  });

  test('empty classes array produces empty result', () => {
    const result = categorizeClasses([], 'light');
    expect(result.bgClasses).toHaveLength(0);
    expect(result.textClasses).toHaveLength(0);
    expect(result.borderClasses).toHaveLength(0);
    expect(result.fontSize).toBeNull();
    expect(result.isBold).toBe(false);
  });

  test('border/ring/outline are categorized in light mode', () => {
    const classes = ['border-red-500', 'ring-blue-500', 'outline-green-500'];
    const result = categorizeClasses(classes, 'light');

    expect(result.borderClasses).toHaveLength(1);
    expect(result.ringClasses).toHaveLength(1);
    expect(result.outlineClasses).toHaveLength(1);
  });

  test('empty string classes are filtered out', () => {
    const classes = ['', 'bg-red-500', '', 'text-white', ''];
    const result = categorizeClasses(classes, 'light');
    expect(result.bgClasses).toHaveLength(1);
    expect(result.textClasses).toHaveLength(1);
  });
});

// ── determineIsLargeText ──────────────────────────────────────────────

describe('determineIsLargeText', () => {
  test('text-2xl → large (always large)', () => {
    expect(determineIsLargeText('text-2xl', false)).toBe(true);
  });

  test('text-3xl → large (always large)', () => {
    expect(determineIsLargeText('text-3xl', false)).toBe(true);
  });

  test('text-9xl → large (always large)', () => {
    expect(determineIsLargeText('text-9xl', false)).toBe(true);
  });

  test('text-xl + bold → large', () => {
    expect(determineIsLargeText('text-xl', true)).toBe(true);
  });

  test('text-xl without bold → NOT large', () => {
    expect(determineIsLargeText('text-xl', false)).toBe(false);
  });

  test('text-lg → NOT large (18px < 18.67px threshold)', () => {
    expect(determineIsLargeText('text-lg', false)).toBe(false);
    expect(determineIsLargeText('text-lg', true)).toBe(false);
  });

  test('text-sm → NOT large', () => {
    expect(determineIsLargeText('text-sm', false)).toBe(false);
  });

  test('null fontSize → NOT large (conservative)', () => {
    expect(determineIsLargeText(null, false)).toBe(false);
    expect(determineIsLargeText(null, true)).toBe(false);
  });
});

// ── extractBalancedParens ─────────────────────────────────────────────

describe('extractBalancedParens', () => {
  test('simple parens', () => {
    const source = "('hello world')";
    const result = extractBalancedParens(source, 0);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("'hello world'");
    expect(result!.end).toBe(14);
  });

  test('nested parens', () => {
    const source = '(a(b)c)';
    const result = extractBalancedParens(source, 0);
    expect(result).not.toBeNull();
    expect(result!.content).toBe('a(b)c');
  });

  test('deeply nested', () => {
    const source = '(a(b(c(d))))';
    const result = extractBalancedParens(source, 0);
    expect(result).not.toBeNull();
    expect(result!.content).toBe('a(b(c(d)))');
  });

  test('with single-quoted string containing parens', () => {
    const source = "('bg-red-500', isActive && 'bg-blue-500')";
    const result = extractBalancedParens(source, 0);
    expect(result).not.toBeNull();
    expect(result!.content).toContain('bg-red-500');
    expect(result!.content).toContain('bg-blue-500');
  });

  test('with double-quoted string', () => {
    const source = '("hello (world)")';
    const result = extractBalancedParens(source, 0);
    expect(result).not.toBeNull();
    expect(result!.content).toBe('"hello (world)"');
  });

  test('with template literal containing parens', () => {
    const source = '(`foo (${bar})`)';
    const result = extractBalancedParens(source, 0);
    expect(result).not.toBeNull();
    expect(result!.content).toContain('foo');
  });

  test('unbalanced parens → null', () => {
    expect(extractBalancedParens('(open no close', 0)).toBeNull();
  });

  test('non-paren at start → null', () => {
    expect(extractBalancedParens('{content}', 0)).toBeNull();
    expect(extractBalancedParens('content)', 0)).toBeNull();
  });

  test('empty parens', () => {
    const result = extractBalancedParens('()', 0);
    expect(result).not.toBeNull();
    expect(result!.content).toBe('');
    expect(result!.end).toBe(1);
  });

  test('start at non-zero position', () => {
    const source = 'cn("class1", "class2")';
    const result = extractBalancedParens(source, 2);
    expect(result).not.toBeNull();
    expect(result!.content).toBe('"class1", "class2"');
  });
});

// ── extractStringLiterals ─────────────────────────────────────────────

describe('extractStringLiterals', () => {
  test('single-quoted strings', () => {
    const body = "'bg-red-500 text-white'";
    const result = extractStringLiterals(body);
    expect(result).toEqual(['bg-red-500', 'text-white']);
  });

  test('double-quoted strings', () => {
    const body = '"bg-blue-500 text-black"';
    const result = extractStringLiterals(body);
    expect(result).toEqual(['bg-blue-500', 'text-black']);
  });

  test('template literals', () => {
    const body = '`bg-green-500 text-white`';
    const result = extractStringLiterals(body);
    expect(result).toEqual(['bg-green-500', 'text-white']);
  });

  test('template with ${} placeholder is removed', () => {
    const body = '`bg-${color} text-white`';
    const result = extractStringLiterals(body);
    expect(result).toContain('text-white');
  });

  test('mixed quotes in cn() body', () => {
    const body = "'bg-red-500', isActive && \"text-white\"";
    const result = extractStringLiterals(body);
    expect(result).toContain('bg-red-500');
    expect(result).toContain('text-white');
  });

  test('multiple string literals', () => {
    const body = "'bg-red-500', 'text-white', 'border-blue-500'";
    const result = extractStringLiterals(body);
    expect(result).toEqual(['bg-red-500', 'text-white', 'border-blue-500']);
  });

  test('escaped quotes inside string', () => {
    const body = "'bg-red\\'s-class text-white'";
    const result = extractStringLiterals(body);
    expect(result.length).toBeGreaterThan(0);
  });

  test('body with no string literals → empty array', () => {
    const body = 'isActive && condition';
    expect(extractStringLiterals(body)).toEqual([]);
  });

  test('multiline class string', () => {
    const body = "'bg-red-500\\n  text-white'";
    const result = extractStringLiterals(body);
    expect(result.length).toBeGreaterThan(0);
  });
});
