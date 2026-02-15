import type { RawPalette, ShadeFamily } from './types.js';

export interface ParsedClass {
  prefix: string;   // "text-", "bg-", "border-", "ring-", "outline-"
  family: string;   // "gray", "red", "sky"
  shade: number;    // 500, 600, 700
}

const STANDARD_SHADES = new Set([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]);

/**
 * Parses a Tailwind class into its prefix, color family, and shade number.
 * Returns null for semantic colors, arbitrary values, non-color utilities,
 * and context annotations.
 */
export function parseFamilyAndShade(className: string): ParsedClass | null {
  // Skip context annotations
  if (className.startsWith('(') || className.startsWith('@')) return null;

  // Match: prefix + family + shade, optionally followed by /alpha
  const match = className.match(
    /^(bg-|text-|border-|ring-|outline-)([a-z]+)-(\d+)(?:\/.*)?$/
  );
  if (!match) return null;

  const prefix = match[1]!;
  const family = match[2]!;
  const shade = parseInt(match[3]!, 10);

  // Filter out non-color utilities (gradient, 2xl, etc.)
  if (!STANDARD_SHADES.has(shade)) return null;

  return { prefix, family, shade };
}

/**
 * Groups Tailwind palette colors into shade families.
 * Matches entries like --color-gray-500 -> family "gray", shade 500.
 * Ignores non-numeric entries (black, white, semantic colors).
 */
export function extractShadeFamilies(palette: RawPalette): Map<string, ShadeFamily> {
  const families = new Map<string, ShadeFamily>();

  for (const [varName, hex] of palette) {
    const match = varName.match(/^--color-([a-z]+)-(\d+)$/);
    if (!match) continue;

    const family = match[1]!;
    const shade = parseInt(match[2]!, 10);

    let entry = families.get(family);
    if (!entry) {
      entry = { family, shades: new Map() };
      families.set(family, entry);
    }
    entry.shades.set(shade, hex);
  }

  return families;
}
