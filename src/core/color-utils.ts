import { parse, formatHex } from 'culori';

/**
 * Converts any CSS color string to a hex color.
 * Handles:
 *   - oklch(50% 0.134 242.749)
 *   - oklch(0.50 0.134 242.749)
 *   - oklch(0.50 0.134 242.749 / 0.5) → 8-digit hex with alpha
 *   - hsl(210 40% 98%)
 *   - hsl(210, 40%, 98%)
 *   - rgb(255 0 128)
 *   - color(display-p3 1 0.5 0)
 *   - #1e293b / #f00 / #f008 / #ff000080
 *
 * Returns null for transparent, inherit, currentColor, empty, or unparseable values.
 */
export function toHex(value: string): string | null {
  if (
    !value ||
    value === 'transparent' ||
    value === 'inherit' ||
    value === 'currentColor'
  ) {
    return null;
  }

  // Direct hex passthrough / expansion
  if (value.startsWith('#')) {
    if (value.length === 4) {
      // 3-digit hex: #rgb → #rrggbb
      return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
    }
    if (value.length === 5) {
      // 4-digit hex with alpha: #rgba → #rrggbbaa
      return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}${value[4]}${value[4]}`;
    }
    return value;
  }

  // oklch with percentage lightness: oklch(50% ...) → oklch(0.50 ...)
  let normalized = value;
  if (normalized.startsWith('oklch(')) {
    normalized = normalized.replace(
      /oklch\((\d+(?:\.\d+)?)%/,
      (_, pct) => `oklch(${parseFloat(pct) / 100}`,
    );
  }

  const parsed = parse(normalized);
  if (!parsed) return null;

  try {
    const hex = formatHex(parsed);
    // Preserve alpha from oklch/hsl colors with alpha channels
    if (parsed.alpha !== undefined && parsed.alpha < 1) {
      const alphaHex = Math.round(parsed.alpha * 255)
        .toString(16)
        .padStart(2, '0');
      return hex + alphaHex;
    }
    return hex;
  } catch {
    return null;
  }
}
