import type { ClassRegion, ContextOverride } from '../../core/types.js';
import { BG_NON_COLOR, extractBalancedParens } from './categorizer.js';

// ── @a11y-context Annotation Helpers ──────────────────────────────────

/** Matches @a11y-context (NOT @a11y-context-block) in a comment */
const A11Y_CONTEXT_SINGLE_REGEX =
  /(?:\/\/|\/\*)\s*@a11y-context(?!-block)\s+(.*?)(?:\s*\*\/)?$/;

/** Matches @a11y-context-block in a comment */
const A11Y_CONTEXT_BLOCK_REGEX =
  /(?:\/\/|\/\*)\s*@a11y-context-block\s+(.*?)(?:\s*\*\/)?$/;

/**
 * Parses annotation parameters from the body of an @a11y-context comment.
 * @internal Exported for unit testing
 */
export function parseAnnotationParams(body: string): ContextOverride | null {
  const override: ContextOverride = {};
  for (const token of body.trim().split(/\s+/)) {
    if (token.startsWith('bg:')) override.bg = token.slice(3);
    else if (token.startsWith('fg:')) override.fg = token.slice(3);
    else if (token === 'no-inherit') override.noInherit = true;
  }
  return override.bg || override.fg ? override : null;
}

// ── JSX Tag Helpers ───────────────────────────────────────────────────

/** Valid tag-name chars: letters, digits, dot (motion.div), hyphen */
function isTagNameCh(ch: string): boolean {
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    (ch >= '0' && ch <= '9') ||
    ch === '.' ||
    ch === '-'
  );
}

/** Reads a JSX tag name starting at `start`. Returns name + end position. */
function readTagName(source: string, start: number): { name: string; end: number } {
  let end = start;
  while (end < source.length && isTagNameCh(source[end]!)) end++;
  return { name: source.slice(start, end), end };
}

/**
 * From position `fromPos` (just after tag name), scans forward to determine
 * if the opening tag is self-closing (/>). Respects braces and strings
 * inside JSX attributes so that `>` in expressions doesn't false-match.
 * @internal Exported for unit testing
 */
export function isSelfClosingTag(source: string, fromPos: number): boolean {
  let j = fromPos;
  let braceDepth = 0;
  const len = source.length;

  while (j < len) {
    const ch = source[j]!;

    if (ch === '{') {
      braceDepth++;
      j++;
      continue;
    }
    if (ch === '}') {
      if (braceDepth > 0) braceDepth--;
      j++;
      continue;
    }

    // Skip string literals at any brace depth
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      j++;
      while (j < len && source[j] !== q) {
        if (source[j] === '\\') j++;
        j++;
      }
      if (j < len) j++;
      continue;
    }

    if (braceDepth === 0) {
      if (ch === '/' && j + 1 < len && source[j + 1] === '>') return true;
      if (ch === '>') return false;
    }

    j++;
  }

  return false; // malformed JSX, assume not self-closing
}

/**
 * Scans opening tag attributes for an explicit bg-* color class.
 * Returns first non-variant bg color class found, or null.
 * @internal Exported for unit testing
 */
export function findExplicitBgInTag(source: string, fromPos: number): string | null {
  let j = fromPos;
  let braceDepth = 0;
  const len = source.length;
  const start = j;

  while (j < len) {
    const ch = source[j]!;

    if (ch === '{') {
      braceDepth++;
      j++;
      continue;
    }
    if (ch === '}') {
      if (braceDepth > 0) braceDepth--;
      j++;
      continue;
    }

    // Skip strings at any depth
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      j++;
      while (j < len && source[j] !== q) {
        if (source[j] === '\\') j++;
        j++;
      }
      if (j < len) j++;
      continue;
    }

    if (braceDepth === 0) {
      if ((ch === '/' && j + 1 < len && source[j + 1] === '>') || ch === '>') break;
    }

    j++;
  }

  const content = source.slice(start, j);

  // Find bg-* color classes, skip variant-prefixed and non-color utilities
  const bgRegex = /\bbg-[\w][\w-]*(?:\/\d+)?/g;
  let match: RegExpExecArray | null;
  while ((match = bgRegex.exec(content)) !== null) {
    const cls = match[0];
    // Skip variant-prefixed (e.g., dark:bg-*, hover:bg-*)
    if (match.index > 0 && content[match.index - 1] === ':') continue;
    // Skip non-color bg utilities
    if (cls.startsWith('bg-linear-') || cls.startsWith('bg-gradient-') || BG_NON_COLOR.has(cls))
      continue;
    return cls;
  }

  return null;
}

/**
 * Scans a JSX opening tag for inline style color properties.
 * Only extracts string literal values for `color` and `backgroundColor`.
 * @internal Exported for unit testing
 */
export function extractInlineStyleColors(
  source: string,
  classNamePos: number,
): { color?: string; backgroundColor?: string } | undefined {
  // Scan backward from className= to find the '<' that opens this tag
  let openTag = classNamePos;
  while (openTag > 0 && source[openTag] !== '<') openTag--;

  // Scan forward from className= to find tag end (respecting braces/strings)
  let closeTag = classNamePos;
  let braceDepth = 0;
  while (closeTag < source.length) {
    const ch = source[closeTag]!;
    if (ch === '{') braceDepth++;
    if (ch === '}') {
      if (braceDepth > 0) braceDepth--;
    }
    if (
      braceDepth === 0 &&
      (ch === '>' ||
        (ch === '/' && closeTag + 1 < source.length && source[closeTag + 1] === '>'))
    )
      break;
    closeTag++;
  }

  const tagContent = source.slice(openTag, closeTag + 1);

  // Look for style={{ ... }} — regex for double-brace pattern
  const styleMatch = tagContent.match(/style=\{\{([^}]*(?:\}[^}])*[^}]*)\}\}/);
  if (!styleMatch) return undefined;

  const styleBody = styleMatch[1]!;
  const result: { color?: string; backgroundColor?: string } = {};

  const colorMatch = styleBody.match(/\bcolor\s*:\s*['"]([^'"]+)['"]/);
  if (colorMatch) result.color = colorMatch[1];

  const bgMatch = styleBody.match(/\bbackgroundColor\s*:\s*['"]([^'"]+)['"]/);
  if (bgMatch) result.backgroundColor = bgMatch[1];

  if (!result.color && !result.backgroundColor) return undefined;
  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Returns true if char before position i is alphanumeric/underscore */
function isIdentChar(source: string, i: number): boolean {
  if (i === 0) return false;
  return /[a-zA-Z0-9_]/.test(source[i - 1]!);
}

function skipWS(source: string, i: number): number {
  while (i < source.length && /\s/.test(source[i]!)) i++;
  return i;
}

/** Find next unescaped occurrence of `char` starting from `start` */
function findUnescaped(source: string, char: string, start: number): number {
  let i = start;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === char) return i;
    i++;
  }
  return -1;
}

// ── State Machine ─────────────────────────────────────────────────────

/**
 * Extracts all className regions from a file buffer using a char-by-char
 * state machine. Handles multiline cn(), clsx(), className="...",
 * className={`...`}, and className={'...'}.
 *
 * Tracks JSX container context via a stack. Each region captures the
 * implied background from the nearest container.
 *
 * @param source - The full file source code
 * @param containerMap - Maps component names to implicit bg classes
 * @param defaultBg - Default page background class (default: 'bg-background')
 * @internal Exported for unit testing
 */
export function extractClassRegions(
  source: string,
  containerMap: ReadonlyMap<string, string>,
  defaultBg: string = 'bg-background',
): ClassRegion[] {
  const regions: ClassRegion[] = [];
  const len = source.length;

  // Pre-compute line break offsets in a single O(n) pass
  const lineBreaks: number[] = [0]; // line 1 starts at offset 0
  for (let k = 0; k < len; k++) {
    if (source[k] === '\n') lineBreaks.push(k + 1);
  }

  // ── Context Stack: tracks implied bg from container components ──
  const contextStack: Array<{ component: string; bg: string; isAnnotation?: boolean; noInherit?: boolean }> = [
    { component: '_root', bg: defaultBg },
  ];

  // ── Single-element @a11y-context override state ──
  let pendingOverride: ContextOverride | null = null;
  let currentTagOverride: ContextOverride | null = null;

  // ── Block-scoped @a11y-context-block override state ──
  let pendingBlockOverride: ContextOverride | null = null;

  function currentContext(): string {
    return contextStack[contextStack.length - 1]!.bg;
  }

  /** Binary search: O(log n) per call instead of O(n) linear scan */
  function lineAt(offset: number): number {
    let lo = 0;
    let hi = lineBreaks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineBreaks[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1; // 1-based line number
  }

  let i = 0;

  while (i < len) {
    // Skip single-line comments (detect @a11y-context)
    if (source[i] === '/' && i + 1 < len && source[i + 1] === '/') {
      const commentStart = i;
      while (i < len && source[i] !== '\n') i++;
      const commentText = source.slice(commentStart, i);
      if (/@a11y-context\s/.test(commentText) && !/@a11y-context-block/.test(commentText)) {
        const match = A11Y_CONTEXT_SINGLE_REGEX.exec(commentText);
        if (match) pendingOverride = parseAnnotationParams(match[1]!);
      }
      if (/@a11y-context-block/.test(commentText)) {
        const match = A11Y_CONTEXT_BLOCK_REGEX.exec(commentText);
        if (match) pendingBlockOverride = parseAnnotationParams(match[1]!);
      }
      continue;
    }

    // Skip block comments (detect @a11y-context)
    if (source[i] === '/' && i + 1 < len && source[i + 1] === '*') {
      const commentStart = i;
      i += 2;
      while (i < len - 1 && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      const commentText = source.slice(commentStart, i);
      if (/@a11y-context\s/.test(commentText) && !/@a11y-context-block/.test(commentText)) {
        const match = A11Y_CONTEXT_SINGLE_REGEX.exec(commentText);
        if (match) pendingOverride = parseAnnotationParams(match[1]!);
      }
      if (/@a11y-context-block/.test(commentText)) {
        const match = A11Y_CONTEXT_BLOCK_REGEX.exec(commentText);
        if (match) pendingBlockOverride = parseAnnotationParams(match[1]!);
      }
      continue;
    }

    // ── JSX Container Tag Tracking ───────────────────────────────
    if (source[i] === '<' && i + 1 < len) {
      const next = source[i + 1]!;

      // Non-closing tag: consume pending single-element override
      if (next !== '/' && next !== '!') {
        currentTagOverride = pendingOverride;
        pendingOverride = null;

        // Block override: push annotation onto context stack for the next container tag
        if (pendingBlockOverride) {
          const blockTag = readTagName(source, i + 1);
          if (blockTag.name && !isSelfClosingTag(source, blockTag.end)) {
            contextStack.push({
              component: `_annotation_${blockTag.name}`,
              bg: pendingBlockOverride.bg || currentContext(),
              isAnnotation: true,
              noInherit: pendingBlockOverride.noInherit,
            });
          }
          pendingBlockOverride = null;
        }
      }

      // Closing tag: </ComponentName>
      if (next === '/') {
        const tag = readTagName(source, i + 2);
        if (tag.name) {
          const bg = containerMap.get(tag.name);
          if (
            bg &&
            contextStack.length > 1 &&
            contextStack[contextStack.length - 1]!.component === tag.name
          ) {
            contextStack.pop();
          }

          // Pop annotation block entries
          const annotationKey = `_annotation_${tag.name}`;
          if (
            contextStack.length > 1 &&
            contextStack[contextStack.length - 1]!.component === annotationKey
          ) {
            contextStack.pop();
          }
        }
      }

      // Opening tag: <ComponentName (uppercase first char)
      if (next >= 'A' && next <= 'Z') {
        const tag = readTagName(source, i + 1);
        if (tag.name) {
          const configBg = containerMap.get(tag.name);
          if (configBg && !isSelfClosingTag(source, tag.end)) {
            const explicitBg = findExplicitBgInTag(source, tag.end);
            contextStack.push({ component: tag.name, bg: explicitBg || configBg });
          }
        }
      }
    }

    // ── Pattern 1: className="..." or className={...} ────────────
    if (source.startsWith('className=', i)) {
      const classNamePos = i;
      const eqEnd = i + 'className='.length;
      const afterEq = skipWS(source, eqEnd);

      // className="..."
      if (source[afterEq] === '"') {
        const start = afterEq + 1;
        const end = source.indexOf('"', start);
        if (end !== -1) {
          regions.push({
            content: source.slice(start, end),
            startLine: lineAt(i),
            contextBg: currentContext(),
          });
          if (currentTagOverride) {
            regions[regions.length - 1]!.contextOverride = currentTagOverride;
            currentTagOverride = null;
          }
          const inlineStyles = extractInlineStyleColors(source, classNamePos);
          if (inlineStyles) regions[regions.length - 1]!.inlineStyles = inlineStyles;
          i = end + 1;
          continue;
        }
      }

      // className={...}
      if (source[afterEq] === '{') {
        const inner = skipWS(source, afterEq + 1);

        // className={'...'} or className={"..."}
        if (source[inner] === "'" || source[inner] === '"') {
          const quote = source[inner]!;
          const strStart = inner + 1;
          const strEnd = findUnescaped(source, quote, strStart);
          if (strEnd !== -1) {
            regions.push({
              content: source.slice(strStart, strEnd),
              startLine: lineAt(i),
              contextBg: currentContext(),
            });
            if (currentTagOverride) {
              regions[regions.length - 1]!.contextOverride = currentTagOverride;
              currentTagOverride = null;
            }
            const inlineStyles = extractInlineStyleColors(source, classNamePos);
            if (inlineStyles) regions[regions.length - 1]!.inlineStyles = inlineStyles;
            i = strEnd + 1;
            continue;
          }
        }

        // className={`...`}
        if (source[inner] === '`') {
          const tStart = inner + 1;
          const tEnd = findUnescaped(source, '`', tStart);
          if (tEnd !== -1) {
            const staticContent = source.slice(tStart, tEnd).replace(/\$\{[^}]*\}/g, ' ');
            regions.push({
              content: staticContent,
              startLine: lineAt(i),
              contextBg: currentContext(),
            });
            if (currentTagOverride) {
              regions[regions.length - 1]!.contextOverride = currentTagOverride;
              currentTagOverride = null;
            }
            const inlineStyles = extractInlineStyleColors(source, classNamePos);
            if (inlineStyles) regions[regions.length - 1]!.inlineStyles = inlineStyles;
            i = tEnd + 1;
            continue;
          }
        }

        // className={cn(...)} or className={clsx(...)}
        if (source.startsWith('cn(', inner) || source.startsWith('clsx(', inner)) {
          const fnLen = source.startsWith('cn(', inner) ? 2 : 4;
          const parenStart = inner + fnLen; // position of '('
          const block = extractBalancedParens(source, parenStart);
          if (block) {
            regions.push({
              content: block.content,
              startLine: lineAt(i),
              contextBg: currentContext(),
            });
            if (currentTagOverride) {
              regions[regions.length - 1]!.contextOverride = currentTagOverride;
              currentTagOverride = null;
            }
            const inlineStyles = extractInlineStyleColors(source, classNamePos);
            if (inlineStyles) regions[regions.length - 1]!.inlineStyles = inlineStyles;
            i = block.end + 1;
            continue;
          }
        }
      }

      i = eqEnd;
      continue;
    }

    // ── Pattern 2: standalone cn(), clsx(), or cva() ────────────
    if (
      (source.startsWith('cn(', i) ||
        source.startsWith('clsx(', i) ||
        source.startsWith('cva(', i)) &&
      !isIdentChar(source, i)
    ) {
      const fnLen = source.startsWith('cn(', i) ? 2 : source.startsWith('cva(', i) ? 3 : 4;
      const parenStart = i + fnLen;
      const block = extractBalancedParens(source, parenStart);
      if (block) {
        regions.push({
          content: block.content,
          startLine: lineAt(i),
          contextBg: currentContext(),
        });
        if (currentTagOverride) {
          regions[regions.length - 1]!.contextOverride = currentTagOverride;
          currentTagOverride = null;
        }
        i = block.end + 1;
        continue;
      }
    }

    i++;
  }

  return regions;
}
