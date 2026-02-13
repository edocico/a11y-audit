import type { ColorMap, ClassRegion, ResolvedColor } from '../core/types.js';

/**
 * Resolves CSS utility classes to hex colors.
 * Tailwind implementation: resolves via CSS variable chains.
 * Generic implementation: could parse CSS files directly.
 */
export interface ColorResolver {
  /** Build color maps for all supported themes */
  buildColorMaps(): { light: ColorMap; dark: ColorMap; rootFontSizePx: number };

  /** Resolve a single utility class to a hex color */
  resolveClass(className: string, colorMap: ColorMap): ResolvedColor | null;
}

/**
 * Extracts class regions from source files.
 * JSX implementation: state machine for className= in .tsx/.jsx
 * Vue implementation: would parse :class= in .vue SFCs
 */
export interface FileParser {
  /** Glob patterns for files to scan */
  readonly filePatterns: string[];

  /** Extract class regions from a single file's source code */
  extractRegions(source: string, filePath: string): ClassRegion[];
}

/**
 * Maps component names to their implicit background classes.
 * shadcn preset: Card → bg-card, DialogContent → bg-background
 * Custom: user-defined mappings
 */
export interface ContainerConfig {
  /** Component name → default bg class (e.g., "Card" → "bg-card") */
  readonly containers: ReadonlyMap<string, string>;

  /** Default page background class (e.g., "bg-background") */
  readonly defaultBg: string;

  /** Page background hex per theme (for alpha compositing) */
  readonly pageBg: { light: string; dark: string };
}

/**
 * Full configuration for an audit run.
 */
export interface AuditConfig {
  /** Source file glob patterns */
  src: string[];

  /** CSS files to parse for color definitions */
  css: string[];

  /** Color resolver plugin */
  colorResolver: ColorResolver;

  /** File parser plugin */
  fileParser: FileParser;

  /** Container context config */
  containerConfig: ContainerConfig;

  /** WCAG conformance level */
  threshold: 'AA' | 'AAA';

  /** Report output directory */
  reportDir: string;

  /** Report format */
  format: 'markdown' | 'json';

  /** Whether to run dark mode analysis */
  dark: boolean;
}
