import type { ContextOverride, InteractiveState } from '../../core/types.js';

// ── Non-color text-* utilities ────────────────────────────────────────
const TEXT_NON_COLOR = new Set([
  'text-xs',
  'text-sm',
  'text-base',
  'text-lg',
  'text-xl',
  'text-2xl',
  'text-3xl',
  'text-4xl',
  'text-5xl',
  'text-6xl',
  'text-7xl',
  'text-8xl',
  'text-9xl',
  'text-left',
  'text-center',
  'text-right',
  'text-justify',
  'text-start',
  'text-end',
  'text-wrap',
  'text-nowrap',
  'text-balance',
  'text-pretty',
  'text-clip',
  'text-ellipsis',
  'text-truncate',
  'text-underline',
  'text-overline',
  'text-line-through',
  'text-no-underline',
  'text-uppercase',
  'text-lowercase',
  'text-capitalize',
  'text-normal-case',
]);

const TEXT_SIZE_ARBITRARY = /^text-\[\d/;

// Non-color bg-* utilities
export const BG_NON_COLOR = new Set([
  'bg-clip-text',
  'bg-no-repeat',
  'bg-cover',
  'bg-contain',
  'bg-fixed',
  'bg-local',
  'bg-scroll',
]);

// ── Non-color utilities for SC 1.4.11 non-text contrast ──────────────
const BORDER_NON_COLOR = new Set([
  'border',
  'border-0',
  'border-2',
  'border-4',
  'border-8',
  'border-x',
  'border-y',
  'border-t',
  'border-b',
  'border-l',
  'border-r',
  'border-solid',
  'border-dashed',
  'border-dotted',
  'border-double',
  'border-none',
  'border-hidden',
  'border-collapse',
  'border-separate',
  'border-spacing-0',
  'border-spacing-px',
  'border-spacing-1',
  'border-spacing-2',
  // directional widths (not colors)
  'border-t-0',
  'border-t-2',
  'border-t-4',
  'border-t-8',
  'border-b-0',
  'border-b-2',
  'border-b-4',
  'border-b-8',
  'border-l-0',
  'border-l-2',
  'border-l-4',
  'border-l-8',
  'border-r-0',
  'border-r-2',
  'border-r-4',
  'border-r-8',
  'border-x-0',
  'border-x-2',
  'border-x-4',
  'border-x-8',
  'border-y-0',
  'border-y-2',
  'border-y-4',
  'border-y-8',
]);

const RING_NON_COLOR = new Set([
  'ring-0',
  'ring-1',
  'ring-2',
  'ring-4',
  'ring-8',
  'ring-inset',
  'ring-offset-0',
  'ring-offset-1',
  'ring-offset-2',
  'ring-offset-4',
  'ring-offset-8',
]);

const OUTLINE_NON_COLOR = new Set([
  'outline-none',
  'outline-hidden',
  'outline-0',
  'outline-1',
  'outline-2',
  'outline-4',
  'outline-8',
  'outline-dashed',
  'outline-dotted',
  'outline-double',
  'outline-offset-0',
  'outline-offset-1',
  'outline-offset-2',
  'outline-offset-4',
  'outline-offset-8',
]);

// Known Tailwind variant prefixes to strip
const VARIANT_PREFIXES = [
  'dark:',
  'hover:',
  'focus:',
  'focus-visible:',
  'focus-within:',
  'active:',
  'visited:',
  'disabled:',
  'group-hover:',
  'peer-hover:',
  'sm:',
  'md:',
  'lg:',
  'xl:',
  '2xl:',
  'first:',
  'last:',
  'odd:',
  'even:',
  'placeholder:',
  'aria-selected:',
  'aria-disabled:',
];

// ── Large text detection (WCAG SC 1.4.3) ─────────────────────────────
// ≥24px (18pt) any weight → always large
const ALWAYS_LARGE = new Set([
  'text-2xl',
  'text-3xl',
  'text-4xl',
  'text-5xl',
  'text-6xl',
  'text-7xl',
  'text-8xl',
  'text-9xl',
]);
// 20px (≥18.67px threshold) → large only if bold
const LARGE_IF_BOLD = new Set(['text-xl']);
// font-weight ≥700
const BOLD_CLASSES = new Set(['font-bold', 'font-extrabold', 'font-black']);

/** Maps variant prefixes to their interactive state name */
const INTERACTIVE_PREFIX_MAP = new Map<string, InteractiveState>([
  ['hover:', 'hover'],
  ['focus-visible:', 'focus-visible'],
  ['aria-disabled:', 'aria-disabled'],
]);

// ── Exported interfaces ──────────────────────────────────────────────

/** A class extracted from source with its variant flags */
export interface TaggedClass {
  raw: string;
  /** true if dark: prefix was present */
  isDark: boolean;
  /** true if any interactive/conditional prefix was present (hover:, focus:, sm:, etc.) */
  isInteractive: boolean;
  /** Which tracked interactive state, if any (hover, focus-visible). null for non-tracked variants */
  interactiveState: InteractiveState | null;
  base: string;
}

/** Shared bucket shape for bg/text/border/ring/outline class arrays */
export interface ClassBuckets {
  bgClasses: TaggedClass[];
  textClasses: TaggedClass[];
  borderClasses: TaggedClass[];
  ringClasses: TaggedClass[];
  outlineClasses: TaggedClass[];
}

/** Alias — per-state buckets have the same shape */
type StateClasses = ClassBuckets;

export interface CategorizedClasses extends ClassBuckets {
  dynamicClasses: string[];
  /** Tailwind font-size class found in this region (e.g. 'text-2xl'), null if none */
  fontSize: string | null;
  /** true if font-bold/font-extrabold/font-black present */
  isBold: boolean;
  /** Per interactive state (hover, focus-visible) class overrides */
  interactiveStates: Map<InteractiveState, StateClasses>;
}

/** A group of foreground classes (text or non-text) to pair against backgrounds */
export interface ForegroundGroup {
  classes: TaggedClass[];
  /** undefined = text pair (SC 1.4.3). Set = non-text pair type (SC 1.4.11) */
  pairType?: 'border' | 'ring' | 'outline';
}

/** Metadata shared across all pairs generated from one region */
export interface PairMeta {
  file: string;
  line: number;
  ignoreReason: string | null;
  isLargeText: boolean;
  interactiveState?: InteractiveState | null;
  effectiveOpacity?: number;
}

/** Result of generating pairs for a single set of fg/bg classes */
export interface GeneratedPairs {
  pairs: import('../../core/types.js').ColorPair[];
  skipped: import('../../core/types.js').SkippedClass[];
}

// ── Variant stripping ─────────────────────────────────────────────────

/**
 * Strips known variant prefixes. Tags with 'dark' variant if dark: is present.
 * Multiple prefixes are stripped (e.g., sm:dark:bg-red-500 -> bg-red-500).
 * @internal Exported for unit testing
 */
export function stripVariants(cls: string): TaggedClass {
  const raw = cls;
  let base = cls;
  let isDark = false;
  let isInteractive = false;
  let interactiveState: InteractiveState | null = null;

  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of VARIANT_PREFIXES) {
      if (base.startsWith(prefix)) {
        if (prefix === 'dark:') {
          isDark = true;
        } else {
          isInteractive = true;
          const tracked = INTERACTIVE_PREFIX_MAP.get(prefix);
          if (tracked) interactiveState = tracked;
        }
        base = base.slice(prefix.length);
        changed = true;
        break;
      }
    }
  }

  return { raw, isDark, isInteractive, interactiveState, base };
}

// ── Class routing ─────────────────────────────────────────────────────

/**
 * Routes a tagged class to the correct bucket based on its prefix.
 * Returns true if routed, false if class doesn't match any known color category.
 * @internal Exported for unit testing
 */
export function routeClassToTarget(tagged: TaggedClass, target: ClassBuckets): boolean {
  const base = tagged.base;

  if (base.startsWith('bg-')) {
    if (
      base.startsWith('bg-linear-') ||
      base.startsWith('bg-gradient-') ||
      BG_NON_COLOR.has(base)
    )
      return false;
    target.bgClasses.push(tagged);
    return true;
  }

  if (base.startsWith('text-')) {
    if (TEXT_NON_COLOR.has(base) || TEXT_SIZE_ARBITRARY.test(base)) return false;
    target.textClasses.push(tagged);
    return true;
  }

  if (base.startsWith('border-') || base.startsWith('divide-')) {
    if (BORDER_NON_COLOR.has(base)) return false;
    target.borderClasses.push(tagged);
    return true;
  }

  if (base.startsWith('ring-')) {
    if (RING_NON_COLOR.has(base) || base.startsWith('ring-offset-')) return false;
    target.ringClasses.push(tagged);
    return true;
  }

  if (base.startsWith('outline-')) {
    if (OUTLINE_NON_COLOR.has(base)) return false;
    target.outlineClasses.push(tagged);
    return true;
  }

  return false;
}

// ── Class categorization ──────────────────────────────────────────────

/** Routes a tagged class with a tracked interactive state into the correct state bucket */
function routeToStateBucket(
  tagged: TaggedClass,
  states: Map<InteractiveState, StateClasses>,
): void {
  const state = tagged.interactiveState!;
  let bucket = states.get(state);
  if (!bucket) {
    bucket = {
      bgClasses: [],
      textClasses: [],
      borderClasses: [],
      ringClasses: [],
      outlineClasses: [],
    };
    states.set(state, bucket);
  }
  routeClassToTarget(tagged, bucket);
}

/**
 * Categorizes classes by type (bg/text) and filters by theme mode.
 * Light mode: skip dark:-prefixed classes.
 * Dark mode: include dark:-prefixed and base classes.
 * Tracked interactive variants (hover, focus-visible) go to per-state buckets.
 * Untracked interactive variants (sm:, active:, etc.) are still skipped.
 * @internal Exported for unit testing
 */
export function categorizeClasses(
  classes: string[],
  themeMode: import('../../core/types.js').ThemeMode,
): CategorizedClasses {
  const bgClasses: TaggedClass[] = [];
  const textClasses: TaggedClass[] = [];
  const borderClasses: TaggedClass[] = [];
  const ringClasses: TaggedClass[] = [];
  const outlineClasses: TaggedClass[] = [];
  const dynamicClasses: string[] = [];
  let fontSize: string | null = null;
  let isBold = false;
  const interactiveStates = new Map<InteractiveState, StateClasses>();

  // Temp buckets for dark-mode override logic (bg/text only)
  const darkBgBucket: TaggedClass[] = [];
  const darkTextBucket: TaggedClass[] = [];

  for (const cls of classes) {
    if (!cls) continue;

    if (cls.includes('$')) {
      dynamicClasses.push(cls);
      continue;
    }

    const tagged = stripVariants(cls);

    // Capture font size/weight BEFORE any filtering
    if (ALWAYS_LARGE.has(tagged.base) || LARGE_IF_BOLD.has(tagged.base))
      fontSize = tagged.base;
    if (BOLD_CLASSES.has(tagged.base)) isBold = true;

    // Route tracked interactive states to per-state buckets
    if (tagged.isInteractive) {
      if (tagged.interactiveState) {
        routeToStateBucket(tagged, interactiveStates);
      }
      continue;
    }

    // Light mode: skip dark:-prefixed classes
    if (tagged.isDark && themeMode === 'light') continue;

    const base = tagged.base;

    // Dark mode special handling: bg/text go to temp buckets for override logic
    if (themeMode === 'dark' && base.startsWith('bg-')) {
      if (
        base.startsWith('bg-linear-') ||
        base.startsWith('bg-gradient-') ||
        BG_NON_COLOR.has(base)
      )
        continue;
      darkBgBucket.push(tagged);
      continue;
    }

    if (themeMode === 'dark' && base.startsWith('text-')) {
      if (TEXT_NON_COLOR.has(base) || TEXT_SIZE_ARBITRARY.test(base)) continue;
      darkTextBucket.push(tagged);
      continue;
    }

    // Light mode bg/text + all modes border/ring/outline: use shared router
    routeClassToTarget(tagged, {
      bgClasses,
      textClasses,
      borderClasses,
      ringClasses,
      outlineClasses,
    });
  }

  // Dark mode override semantics — dark: variants replace base classes
  if (themeMode === 'dark') {
    const hasDarkBg = darkBgBucket.some((t) => t.isDark);
    const hasDarkText = darkTextBucket.some((t) => t.isDark);

    for (const t of darkBgBucket) {
      if (hasDarkBg && !t.isDark) continue;
      bgClasses.push(t);
    }
    for (const t of darkTextBucket) {
      if (hasDarkText && !t.isDark) continue;
      textClasses.push(t);
    }
  }

  return {
    bgClasses,
    textClasses,
    borderClasses,
    ringClasses,
    outlineClasses,
    dynamicClasses,
    fontSize,
    isBold,
    interactiveStates,
  };
}

// ── Large Text Determination ──────────────────────────────────────────

/**
 * Determines if text qualifies as "large" per WCAG SC 1.4.3.
 * - ≥24px (text-2xl+) any weight → large
 * - ≥18.67px (text-xl) with bold (font-weight ≥700) → large
 * - Otherwise → normal (conservative: applies 4.5:1 threshold)
 * @internal Exported for unit testing
 */
export function determineIsLargeText(fontSize: string | null, isBold: boolean): boolean {
  if (!fontSize) return false;
  if (ALWAYS_LARGE.has(fontSize)) return true;
  if (LARGE_IF_BOLD.has(fontSize) && isBold) return true;
  return false;
}

// ── Balanced parentheses extraction ───────────────────────────────────

/**
 * Extracts content between balanced parentheses.
 * source[openPos] MUST be '('.
 * @internal Exported for unit testing
 */
export function extractBalancedParens(
  source: string,
  openPos: number,
): { content: string; end: number } | null {
  if (source[openPos] !== '(') return null;

  let depth = 1;
  let i = openPos + 1;
  const len = source.length;

  while (i < len && depth > 0) {
    const ch = source[i]!;

    // Skip string literals
    if (ch === "'" || ch === '"') {
      i++;
      while (i < len && source[i] !== ch) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }

    // Skip template literals
    if (ch === '`') {
      i++;
      while (i < len && source[i] !== '`') {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }

    if (ch === '(') depth++;
    else if (ch === ')') depth--;

    if (depth > 0) i++;
  }

  if (depth !== 0) return null;

  return { content: source.slice(openPos + 1, i), end: i };
}

// ── String literal extraction ─────────────────────────────────────────

/**
 * Extracts all string literal contents from a cn()/clsx() body.
 * Handles single-quoted, double-quoted, and template literal strings.
 * @internal Exported for unit testing
 */
export function extractStringLiterals(body: string): string[] {
  const classes: string[] = [];
  let i = 0;
  const len = body.length;

  while (i < len) {
    const ch = body[i]!;

    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i + 1;
      i++;
      while (i < len && body[i] !== quote) {
        if (body[i] === '\\') i++;
        i++;
      }
      if (i < len) {
        const literal = body.slice(start, i);
        classes.push(...literal.split(/\s+/).filter(Boolean));
      }
      i++;
      continue;
    }

    if (ch === '`') {
      const start = i + 1;
      i++;
      while (i < len && body[i] !== '`') {
        if (body[i] === '\\') i++;
        i++;
      }
      if (i < len) {
        const literal = body.slice(start, i).replace(/\$\{[^}]*\}/g, ' ');
        classes.push(...literal.split(/\s+/).filter(Boolean));
      }
      i++;
      continue;
    }

    i++;
  }

  return classes;
}

// ── a11y-ignore detection ─────────────────────────────────────────────

// Matches: // a11y-ignore, {/* a11y-ignore */}, // a11y-ignore: reason text
const A11Y_IGNORE_REGEX =
  /(?:\/\/|\/\*)\s*a11y-ignore(?::\s*(.+?))?(?:\s*\*\/\s*\}?\s*)?$/;

function getIgnoreReason(lines: string[], lineIndex: number): string | null {
  const currentMatch = A11Y_IGNORE_REGEX.exec(lines[lineIndex]!);
  if (currentMatch) return currentMatch[1]?.trim() || 'suppressed';

  if (lineIndex > 0) {
    const prevMatch = A11Y_IGNORE_REGEX.exec(lines[lineIndex - 1]!.trim());
    if (prevMatch) return prevMatch[1]?.trim() || 'suppressed';
  }

  return null;
}

export function getIgnoreReasonForLine(lines: string[], line1Based: number): string | null {
  const idx = line1Based - 1;
  if (idx < 0 || idx >= lines.length) return null;
  return getIgnoreReason(lines, idx);
}

// ── @a11y-context annotation detection ────────────────────────────────

// Matches: // @a11y-context ..., {/* @a11y-context ... */}, // @a11y-context-block ...
const A11Y_CONTEXT_REGEX =
  /(?:\/\/|\/\*)\s*@a11y-context(?:-block)?\s+(.*?)(?:\s*\*\/\s*\}?\s*)?$/;

function parseContextParams(paramString: string): ContextOverride | null {
  const override: ContextOverride = {};
  const tokens = paramString.trim().split(/\s+/);

  for (const token of tokens) {
    if (token.startsWith('bg:')) {
      override.bg = token.slice(3);
    } else if (token.startsWith('fg:')) {
      override.fg = token.slice(3);
    } else if (token === 'no-inherit') {
      override.noInherit = true;
    }
  }

  // Must have at least bg or fg to be valid
  if (!override.bg && !override.fg) return null;

  return override;
}

function getContextOverride(lines: string[], lineIndex: number): ContextOverride | null {
  const currentMatch = A11Y_CONTEXT_REGEX.exec(lines[lineIndex]!);
  if (currentMatch) return parseContextParams(currentMatch[1]!);

  if (lineIndex > 0) {
    const prevMatch = A11Y_CONTEXT_REGEX.exec(lines[lineIndex - 1]!.trim());
    if (prevMatch) return parseContextParams(prevMatch[1]!);
  }

  return null;
}

/** @internal Exported for unit testing */
export function getContextOverrideForLine(
  lines: string[],
  line1Based: number,
): ContextOverride | null {
  const idx = line1Based - 1;
  if (idx < 0 || idx >= lines.length) return null;
  return getContextOverride(lines, idx);
}
