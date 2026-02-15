import { colord, extend } from 'colord';
import a11yPlugin from 'colord/plugins/a11y';
import type {
  ColorSuggestion,
  ConformanceLevel,
  ContrastResult,
  RawPalette,
  ShadeFamily,
  ThemeMode,
} from './types.js';
import { compositeOver } from './contrast-checker.js';

extend([a11yPlugin]);

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

const PAGE_BG_LIGHT = '#ffffff';
const PAGE_BG_DARK = '#09090b';

const DEFAULT_MAX_SUGGESTIONS = 3;

/**
 * Generates shade-family suggestions for a contrast violation.
 *
 * Algorithm (luminosity-directed walk):
 * 1. Parse the violating fg class to find its shade family
 * 2. Compute effective bg (with alpha compositing)
 * 3. Determine search direction based on bg luminance
 * 4. Walk shade family, filtering candidates by luminosity direction + threshold
 * 5. Return closest passing shades (sorted by distance from original)
 */
export function generateSuggestions(
  violation: ContrastResult,
  families: Map<string, ShadeFamily>,
  threshold: ConformanceLevel,
  themeMode: ThemeMode,
  maxSuggestions: number = DEFAULT_MAX_SUGGESTIONS,
): ColorSuggestion[] {
  // 1. Parse the foreground class
  const parsed = parseFamilyAndShade(violation.textClass);
  if (!parsed) return [];

  const family = families.get(parsed.family);
  if (!family) return [];

  // 2. Compute effective background (same logic as contrast-checker)
  if (!violation.bgHex) return [];
  const pageBg = themeMode === 'light' ? PAGE_BG_LIGHT : PAGE_BG_DARK;
  const effectiveBg = violation.bgAlpha !== undefined
    ? compositeOver(violation.bgHex, pageBg, violation.bgAlpha)
    : violation.bgHex;

  // 3. Determine required threshold ratio
  const isNonText = violation.pairType !== undefined && violation.pairType !== 'text';
  let requiredRatio: number;
  if (threshold === 'AAA') {
    requiredRatio = (isNonText || violation.isLargeText) ? 4.5 : 7.0;
  } else {
    requiredRatio = (isNonText || violation.isLargeText) ? 3.0 : 4.5;
  }

  // 4. Compute bg luminance for direction hint
  const bgLuminance = colord(effectiveBg).luminance();
  const bgColor = colord(effectiveBg);

  // 5. Walk all shades, collect passing candidates
  const candidates: ColorSuggestion[] = [];

  for (const [shade, hex] of family.shades) {
    if (shade === parsed.shade) continue; // skip current shade

    // Verify luminosity direction: on light bg, want darker fg (lower luminance)
    const candidateLuminance = colord(hex).luminance();
    if (bgLuminance > 0.5 && candidateLuminance >= bgLuminance) continue;
    if (bgLuminance <= 0.5 && candidateLuminance <= bgLuminance) continue;

    const ratio = Math.round(bgColor.contrast(colord(hex)) * 100) / 100;
    if (ratio < requiredRatio) continue;

    candidates.push({
      suggestedClass: `${parsed.prefix}${parsed.family}-${shade}`,
      suggestedHex: hex,
      newRatio: ratio,
      shadeDistance: Math.abs(shade - parsed.shade),
    });
  }

  // 6. Sort by shade distance (closest first), then by ratio (lower = minimal visual change)
  candidates.sort((a, b) => a.shadeDistance - b.shadeDistance || a.newRatio - b.newRatio);

  return candidates.slice(0, maxSuggestions);
}
