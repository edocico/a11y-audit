import { readFileSync } from 'node:fs';
import { toHex } from '../../core/color-utils.js';
import type { ColorMap, RawPalette, ResolvedColor } from '../../core/types.js';
import { extractTailwindPalette } from './palette.js';

const MAX_RESOLVE_DEPTH = 10;

export interface ThemeColorMaps {
  light: ColorMap
  dark: ColorMap
  rootFontSizePx: number
}

export interface TailwindResolverOptions {
  /** Paths to CSS files containing :root/.dark variable definitions */
  cssPaths: string[];
  /** Path to tailwindcss/theme.css (or auto-detected) */
  palettePath: string;
}

/**
 * Builds fully-resolved color maps for both light and dark themes.
 *
 * Resolution chain:
 *   Tailwind class (bg-primary)
 *     -> --color-primary (@theme inline)
 *     -> var(--primary) (:root block)
 *     -> var(--color-sky-700) (Tailwind palette)
 *     -> oklch(...) -> hex
 */
export function buildThemeColorMaps(options: TailwindResolverOptions): ThemeColorMaps {
  const twPalette = extractTailwindPalette(options.palettePath);

  const fullCss = options.cssPaths
    .map(p => readFileSync(p, 'utf-8'))
    .join('\n');

  const rootVars = parseBlock(fullCss, ':root');
  const darkVars = parseBlock(fullCss, '.dark');
  const themeInlineVars = parseThemeInline(fullCss);

  const light = resolveAll(rootVars, themeInlineVars, twPalette);
  const dark = resolveAll(darkVars, themeInlineVars, twPalette);

  // Dark mode fallback: inherit light values for vars not overridden
  for (const [key, val] of light) {
    if (!dark.has(key)) dark.set(key, val);
  }

  const rootFontSizePx = extractRootFontSize(fullCss);

  return { light, dark, rootFontSizePx };
}

/**
 * Extracts content between balanced braces starting at openPos.
 * css[openPos] MUST be '{'.
 * @internal Exported for unit testing
 */
export function extractBalancedBraces(css: string, openPos: number): string | null {
  if (css[openPos] !== '{') return null;

  let depth = 1;
  let i = openPos + 1;

  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    if (depth > 0) i++;
  }

  if (depth !== 0) return null;
  return css.slice(openPos + 1, i);
}

/**
 * Parses all CSS variable declarations inside a given selector block.
 * Uses brace counting to handle nested blocks correctly.
 * @internal Exported for unit testing
 */
export function parseBlock(css: string, selector: string): Map<string, string> {
  const vars = new Map<string, string>();
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const selectorRegex = new RegExp(`${escapedSelector}\\s*\\{`, 'g');
  let selectorMatch: RegExpExecArray | null;

  while ((selectorMatch = selectorRegex.exec(css)) !== null) {
    const openBrace = selectorMatch.index + selectorMatch[0].length - 1;
    const blockContent = extractBalancedBraces(css, openBrace);
    if (!blockContent) continue;

    const propRegex = /--([\w-]+):\s*([^;]+);/g;
    let propMatch: RegExpExecArray | null;

    while ((propMatch = propRegex.exec(blockContent)) !== null) {
      vars.set(`--${propMatch[1]!}`, propMatch[2]!.trim());
    }
  }

  return vars;
}

/**
 * Parses @theme inline { ... } and @theme { ... } blocks.
 * Uses balanced-brace extraction to handle nested braces safely.
 * @internal Exported for unit testing
 */
export function parseThemeInline(css: string): Map<string, string> {
  const vars = new Map<string, string>();

  const selectorRegex = /@theme(?:\s+inline)?\s*\{/g;
  let selectorMatch: RegExpExecArray | null;

  while ((selectorMatch = selectorRegex.exec(css)) !== null) {
    const openBrace = selectorMatch.index + selectorMatch[0].length - 1;
    const blockContent = extractBalancedBraces(css, openBrace);
    if (!blockContent) continue;

    const propRegex = /--([\w-]+):\s*([^;]+);/g;
    let propMatch: RegExpExecArray | null;

    while ((propMatch = propRegex.exec(blockContent)) !== null) {
      const name = `--${propMatch[1]!}`;
      const value = propMatch[2]!.trim();
      if (name.startsWith('--color-')) {
        vars.set(name, value);
      }
    }
  }

  return vars;
}

/**
 * Strips alpha channel from 8-digit (#rrggbbaa) and 5-digit (#rgba) hex.
 * Returns opaque 6-digit hex (#rrggbb).
 * @internal Exported for unit testing
 */
export function stripHexAlpha(hex: string): string {
  if (hex.length === 9 && hex.startsWith('#')) return hex.slice(0, 7);
  if (hex.length === 5 && hex.startsWith('#')) {
    return `#${hex[1]!}${hex[1]!}${hex[2]!}${hex[2]!}${hex[3]!}${hex[3]!}`;
  }
  if (hex.length === 4 && hex.startsWith('#')) {
    return `#${hex[1]!}${hex[1]!}${hex[2]!}${hex[2]!}${hex[3]!}${hex[3]!}`;
  }
  return hex;
}

/**
 * Extracts alpha from hex colors with alpha channels.
 * Returns alpha 0-1, or undefined if fully opaque.
 * @internal Exported for unit testing
 */
export function extractHexAlpha(hex: string): number | undefined {
  if (hex.length === 9 && hex.startsWith('#')) {
    const alpha = parseInt(hex.slice(7, 9), 16) / 255;
    return alpha < 0.999 ? alpha : undefined;
  }
  if (hex.length === 5 && hex.startsWith('#')) {
    const alpha = parseInt(hex[4]! + hex[4]!, 16) / 255;
    return alpha < 0.999 ? alpha : undefined;
  }
  return undefined;
}

/** Combines two alpha values (both 0-1). Returns undefined if fully opaque. */
/** @internal Exported for unit testing */
export function combineAlpha(a1: number | undefined, a2: number | undefined): number | undefined {
  if (a1 === undefined && a2 === undefined) return undefined;
  const combined = (a1 ?? 1) * (a2 ?? 1);
  return combined < 0.999 ? combined : undefined;
}

/**
 * Converts a raw hex string to ResolvedColor, preserving alpha from 8-digit hex.
 */
function hexToResolved(hex: string): ResolvedColor {
  const alpha = extractHexAlpha(hex);
  const opaque = stripHexAlpha(hex);
  return alpha !== undefined ? { hex: opaque, alpha } : { hex: opaque };
}

/**
 * Wraps a plain hex string (from toHex conversion) into a ResolvedColor.
 */
function hexOrNull(hex: string | null): ResolvedColor | null {
  if (!hex) return null;
  return hexToResolved(hex);
}

/**
 * Recursively resolves a single CSS variable to a ResolvedColor.
 * Preserves alpha from 8-digit hex (#rrggbbaa) through the full var() chain.
 * Supports var() fallback syntax: var(--a, var(--b)) and var(--a, #fff).
 */
function resolveVar(
  name: string,
  allRaw: Map<string, string>,
  twPalette: RawPalette,
  depth: number
): ResolvedColor | null {
  if (depth > MAX_RESOLVE_DEPTH) return null;

  const rawValue = allRaw.get(name);

  if (rawValue) {
    if (rawValue.startsWith('#')) return hexToResolved(rawValue);

    // var(--something) or var(--something, fallback)
    const varMatch = rawValue.match(/var\(--([\w-]+)(?:\s*,\s*(.+))?\)/);
    if (varMatch) {
      const refName = `--${varMatch[1]!}`;
      const resolved = resolveVar(refName, allRaw, twPalette, depth + 1);
      if (resolved) return resolved;

      // Try fallback value
      const fallbackRaw = varMatch[2];
      if (fallbackRaw) {
        const fallback = fallbackRaw.trim();
        if (fallback.startsWith('#')) return hexToResolved(fallback);
        if (fallback.startsWith('var(')) {
          const innerVar = fallback.match(/var\(--([\w-]+)\)/);
          if (innerVar) return resolveVar(`--${innerVar[1]!}`, allRaw, twPalette, depth + 1);
        }
        return hexOrNull(toHex(fallback));
      }

      return null;
    }

    return hexOrNull(toHex(rawValue));
  }

  // Fallback: palette lookup (only if allRaw didn't have it)
  const paletteHex = twPalette.get(name);
  if (paletteHex && paletteHex.startsWith('#')) return hexToResolved(paletteHex);

  return null;
}

/**
 * Resolves all variables to ResolvedColor values by walking the reference chain.
 * Preserves alpha from 8-digit hex and oklch colors with alpha channels.
 * @internal Exported for unit testing
 */
export function resolveAll(
  blockVars: Map<string, string>,
  themeInlineVars: Map<string, string>,
  twPalette: RawPalette
): ColorMap {
  const resolved: ColorMap = new Map();

  const allRaw = new Map<string, string>();
  for (const [k, v] of twPalette) allRaw.set(k, v);
  for (const [k, v] of blockVars) allRaw.set(k, v);
  for (const [k, v] of themeInlineVars) allRaw.set(k, v);

  for (const [name] of allRaw) {
    const color = resolveVar(name, allRaw, twPalette, 0);
    if (color) resolved.set(name, color);
  }

  return resolved;
}

/**
 * Resolves a Tailwind class name to its hex color + optional alpha.
 *
 * Returns ResolvedColor with separate hex and alpha instead of
 * pre-composited color. Compositing happens in the contrast checker
 * where both bg and fg are known.
 */
export function resolveClassToHex(
  className: string,
  colorMap: ColorMap
): ResolvedColor | null {
  const colorPart = className.replace(/^(bg-|text-|border-(?:[trblxy]-)?|divide-|ring-|outline-)/, '');

  // Parse opacity modifier, but protect / inside brackets
  let colorName: string = colorPart;
  let opacityAlpha: number | undefined;

  // Handle slash-bracket arbitrary opacity FIRST: color/[value]
  const slashBracket = colorPart.match(/^(.+)\/\[([^\]]+)\]$/);
  if (slashBracket) {
    colorName = slashBracket[1]!;
    const raw = slashBracket[2]!;
    if (raw.endsWith('%')) {
      opacityAlpha = parseFloat(raw) / 100;
    } else {
      opacityAlpha = parseFloat(raw);
    }
    if (Number.isNaN(opacityAlpha)) opacityAlpha = undefined;
  } else if (colorPart.indexOf('[') !== -1) {
    const bracketIdx = colorPart.indexOf('[');
    const closeBracket = colorPart.indexOf(']', bracketIdx);
    if (closeBracket !== -1) {
      const afterBracket = colorPart.slice(closeBracket + 1);
      const slashIdx = afterBracket.indexOf('/');
      if (slashIdx !== -1) {
        colorName = colorPart.slice(0, closeBracket + 1);
        opacityAlpha = parseInt(afterBracket.slice(slashIdx + 1), 10) / 100;
      } else {
        colorName = colorPart;
      }
    } else {
      colorName = colorPart;
    }
  } else {
    const slashIdx = colorPart.indexOf('/');
    if (slashIdx !== -1) {
      colorName = colorPart.slice(0, slashIdx);
      opacityAlpha = parseInt(colorPart.slice(slashIdx + 1), 10) / 100;
    } else {
      colorName = colorPart;
    }
  }

  // Arbitrary value: [#ff0000] or [oklch(...)]
  if (colorName.startsWith('[') && colorName.endsWith(']')) {
    const raw = colorName.slice(1, -1);
    const hex = toHex(raw);
    if (!hex) return null;
    const hexAlpha = extractHexAlpha(hex);
    const opaqueHex = stripHexAlpha(hex);
    const finalAlpha = combineAlpha(hexAlpha, opacityAlpha);
    if (finalAlpha !== undefined) return { hex: opaqueHex, alpha: finalAlpha };
    return { hex: opaqueHex };
  }

  if (!colorName || colorName === 'transparent' || colorName === 'current' || colorName === 'inherit') {
    return null;
  }

  const cssVar = `--color-${colorName}`;
  const resolved = colorMap.get(cssVar);

  if (!resolved) return null;

  // Combine alpha from CSS variable with Tailwind opacity modifier (/50)
  const finalAlpha = combineAlpha(resolved.alpha, opacityAlpha);
  return finalAlpha !== undefined ? { hex: resolved.hex, alpha: finalAlpha } : { hex: resolved.hex };
}

/**
 * Extracts the root font-size from CSS (html or :root selector).
 * Returns pixel value. Supports: px, percentage of 16px default, rem.
 * Returns 16 (browser default) if not found.
 * @internal Exported for unit testing
 */
export function extractRootFontSize(css: string): number {
  const DEFAULT = 16;

  for (const selector of ['html', ':root']) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escaped}\\s*\\{[^}]*font-size:\\s*([^;]+);`, 'g');
    const match = regex.exec(css);
    if (match) {
      const value = match[1]!.trim();
      if (value.endsWith('px')) return parseFloat(value);
      if (value.endsWith('%')) return (parseFloat(value) / 100) * DEFAULT;
      if (value.endsWith('rem')) return parseFloat(value) * DEFAULT;
    }
  }

  return DEFAULT;
}
