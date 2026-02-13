import { colord, extend } from 'colord';
import a11yPlugin from 'colord/plugins/a11y';
import { calcAPCA } from 'apca-w3';
import type {
  AuditResult,
  ColorPair,
  ConformanceLevel,
  ContrastResult,
  IgnoredViolation,
  SkippedClass,
  ThemeMode,
} from './types.js';

extend([a11yPlugin]);

// Fallback page backgrounds for alpha compositing
const PAGE_BG_LIGHT = '#ffffff';
const PAGE_BG_DARK = '#09090b'; // zinc-950, typical dark mode bg

/**
 * Checks WCAG AA contrast for all resolved color pairs.
 * Performs alpha compositing when colors have transparency.
 *
 * WCAG 2.1 AA thresholds:
 *   - Normal text (< 18px or < 14px bold): ratio >= 4.5
 *   - Large text (>= 18px or >= 14px bold): ratio >= 3.0
 */
export function checkAllPairs(
  pairs: ColorPair[],
  skipped: SkippedClass[],
  filesScanned: number,
  themeMode: ThemeMode = 'light',
  violationLevel: ConformanceLevel = 'AA',
): AuditResult {
  const violations: ContrastResult[] = [];
  const passed: ContrastResult[] = [];
  const ignored: IgnoredViolation[] = [];
  const pageBg = themeMode === 'light' ? PAGE_BG_LIGHT : PAGE_BG_DARK;

  for (const pair of pairs) {
    if (!pair.bgHex || !pair.textHex) continue;

    const result = checkContrast(pair, pageBg);

    // Determine violation based on conformance level
    const isNonText = pair.pairType && pair.pairType !== 'text';
    let isViolation: boolean;
    if (violationLevel === 'AAA') {
      // AAA: 7:1 normal text, 4.5:1 large text / non-text
      isViolation = isNonText || pair.isLargeText
        ? !result.passAAALarge
        : !result.passAAA;
    } else {
      // AA: 4.5:1 normal text, 3:1 large text / non-text
      isViolation = isNonText || pair.isLargeText
        ? !result.passAALarge
        : !result.passAA;
    }

    if (isViolation && pair.ignored) {
      ignored.push({
        ...result,
        ignoreReason: pair.ignoreReason || 'suppressed',
      });
    } else if (isViolation) {
      violations.push(result);
    } else {
      passed.push(result);
    }
  }

  return {
    filesScanned,
    pairsChecked: pairs.length,
    violations,
    passed,
    skipped,
    ignored,
  };
}

/**
 * Computes contrast ratio with proper alpha compositing.
 *
 * 1. If bg has alpha, composite bg against page background first.
 * 2. Then composite fg (with its alpha) against the effective bg.
 * 3. Compute contrast between the two fully-opaque resulting colors.
 */
function checkContrast(pair: ColorPair, pageBg: string): ContrastResult {
  // Step 1: resolve effective background (composite bg alpha against page)
  const effectiveBg =
    pair.bgAlpha !== undefined
      ? compositeOver(pair.bgHex!, pageBg, pair.bgAlpha)
      : pair.bgHex!;

  // Step 2: resolve effective foreground (composite text alpha against effective bg)
  const effectiveFg =
    pair.textAlpha !== undefined
      ? compositeOver(pair.textHex!, effectiveBg, pair.textAlpha)
      : pair.textHex!;

  const bgColor = colord(effectiveBg);
  const fgColor = colord(effectiveFg);
  const ratio = bgColor.contrast(fgColor);

  let apcaLc: number | null = null;
  try {
    apcaLc = Math.round(calcAPCA(effectiveFg, effectiveBg) * 100) / 100;
  } catch {
    // APCA calculation failed — non-blocking, leave as null
    apcaLc = null;
  }

  return {
    ...pair,
    ratio: Math.round(ratio * 100) / 100,
    passAA: ratio >= 4.5,
    passAALarge: ratio >= 3.0,
    passAAA: ratio >= 7.0,
    passAAALarge: ratio >= 4.5,
    apcaLc,
  };
}

/**
 * Composites a foreground color over a background color with given alpha.
 * Formula: result = fg * alpha + bg * (1 - alpha)
 * Returns a 6-digit hex string.
 */
/** @internal Exported for unit testing */
export function compositeOver(
  fgHex: string,
  bgHex: string,
  alpha: number,
): string {
  const fg = parseHexRGB(fgHex);
  const bg = parseHexRGB(bgHex);

  const r = Math.round(fg.r * alpha + bg.r * (1 - alpha));
  const g = Math.round(fg.g * alpha + bg.g * (1 - alpha));
  const b = Math.round(fg.b * alpha + bg.b * (1 - alpha));

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** @internal Exported for unit testing */
export function parseHexRGB(hex: string): { r: number; g: number; b: number } {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;

  if (h.length < 6 || !/^[0-9a-fA-F]{6}/.test(h)) {
    console.warn(`[a11y-audit] Malformed hex: "${hex}" — defaulting to black`);
    return { r: 0, g: 0, b: 0 };
  }

  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
