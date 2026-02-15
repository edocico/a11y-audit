import type { RawPalette, ShadeFamily } from './types.js';

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
