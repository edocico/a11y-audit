import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { toHex } from '../../core/color-utils.js';
import type { RawPalette } from '../../core/types.js';

/**
 * Extracts the full Tailwind v4 default color palette from theme.css.
 * All values are oklch — we convert each to hex for downstream use.
 *
 * Returns a Map like: "--color-sky-700" → "#0369a1"
 *
 * @param palettePath - Absolute path to tailwindcss/theme.css
 */
export function extractTailwindPalette(palettePath: string): RawPalette {
  const css = readFileSync(palettePath, 'utf-8');
  const palette: RawPalette = new Map();

  // Match lines like: --color-red-500: oklch(63.7% 0.237 25.331);
  const varRegex = /--(color-[a-z]+-\d+|color-black|color-white):\s*([^;]+);/g;
  let match: RegExpExecArray | null;

  while ((match = varRegex.exec(css)) !== null) {
    const varName = `--${match[1]!}`;
    const rawValue = match[2]!.trim();
    const hex = toHex(rawValue);

    if (hex) {
      palette.set(varName, hex);
    } else {
      console.warn(`[palette] Could not convert: ${varName} = ${rawValue}`);
    }
  }

  return palette;
}

/**
 * Auto-discovers the tailwindcss/theme.css path from a project root.
 * Checks standard flat node_modules first, then tries pnpm/yarn berry layout.
 *
 * @param cwd - Project root directory to search from
 * @throws If tailwindcss/theme.css cannot be found
 */
export function findTailwindPalette(cwd: string): string {
  // Try standard flat node_modules first
  const flat = resolve(cwd, 'node_modules/tailwindcss/theme.css');
  if (existsSync(flat)) return flat;

  // Try resolve for pnpm/yarn berry
  try {
    const twDir = resolve(cwd, 'node_modules/tailwindcss');
    const themePath = resolve(twDir, 'theme.css');
    if (existsSync(themePath)) return themePath;
  } catch {
    // Fall through to error
  }

  throw new Error(
    `Cannot find tailwindcss/theme.css from ${cwd}. ` +
    `Ensure tailwindcss is installed, or set "tailwindPalette" in config.`
  );
}
