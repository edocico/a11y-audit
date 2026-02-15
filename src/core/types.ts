// ===== Shared Types for A11y Contrast Audit =====

/**
 * A resolved CSS color variable: name -> hex value + optional alpha.
 * Alpha is preserved from 8-digit hex or oklch with alpha channel.
 */
export type ColorMap = Map<string, ResolvedColor>;

/** A color resolved from a Tailwind class, with optional alpha channel */
export interface ResolvedColor {
  hex: string;
  /** 0-1 range. undefined = fully opaque */
  alpha?: number;
}

/** A bg/text pair found in a source file */
export interface ColorPair {
  file: string;
  line: number;
  bgClass: string;
  textClass: string;
  /** null when class couldn't be resolved to a hex value */
  bgHex: string | null;
  textHex: string | null;
  /** Alpha channel for bg color (0-1). undefined = opaque */
  bgAlpha?: number;
  /** Alpha channel for text color (0-1). undefined = opaque */
  textAlpha?: number;
  /** true when text qualifies as "large" per WCAG (>=18pt or >=14pt bold) -> 3:1 threshold */
  isLargeText?: boolean;
  /** 'text' = text/bg (SC 1.4.3), 'border'|'ring'|'outline' = non-text/bg (SC 1.4.11, 3:1) */
  pairType?: 'text' | 'border' | 'ring' | 'outline';
  /** null = base state, 'hover' | 'focus-visible' = interactive state */
  interactiveState?: InteractiveState | null;
  /** true when suppressed via // a11y-ignore */
  ignored?: boolean;
  ignoreReason?: string;
  /** 'inferred' = bg determined by parser stack, 'annotation' = overridden via @a11y-context */
  contextSource?: 'inferred' | 'annotation';
  /** US-05: Cumulative opacity applied to this pair (0.0-1.0). undefined = fully opaque. */
  effectiveOpacity?: number;
}

/** Result of a WCAG contrast check */
export interface ContrastResult extends ColorPair {
  ratio: number;
  passAA: boolean;
  passAALarge: boolean;
  /** WCAG AAA: ratio >= 7.0 for normal text */
  passAAA: boolean;
  /** WCAG AAA Large: ratio >= 4.5 for large text */
  passAAALarge: boolean;
  /** APCA Lightness Contrast value (Lc). null if APCA calculation disabled */
  apcaLc?: number | null;
  /** true = known baseline violation, false = new violation, undefined = baseline not active */
  isBaseline?: boolean;
  /** Auto-generated suggestions for fixing this violation (empty if none available) */
  suggestions?: ColorSuggestion[];
}

/** A class that couldn't be resolved */
export interface SkippedClass {
  file: string;
  line: number;
  className: string;
  reason: string;
}

/** A pair suppressed via // a11y-ignore */
export interface IgnoredViolation extends ContrastResult {
  ignoreReason: string;
}

/** Full audit result */
export interface AuditResult {
  filesScanned: number;
  pairsChecked: number;
  violations: ContrastResult[];
  passed: ContrastResult[];
  skipped: SkippedClass[];
  ignored: IgnoredViolation[];
}

/** Raw palette: CSS var name → hex string (no alpha, all opaque) */
export type RawPalette = Map<string, string>;

/** Theme mode for dual-mode auditing */
export type ThemeMode = 'light' | 'dark';

/** Tracked interactive states for contrast auditing */
export type InteractiveState = 'hover' | 'focus-visible' | 'aria-disabled';

/** WCAG conformance level for violation threshold */
export type ConformanceLevel = 'AA' | 'AAA';

/** Context override from @a11y-context or @a11y-context-block annotation */
export interface ContextOverride {
  /** Tailwind class (e.g. 'bg-slate-900') or hex literal (e.g. '#09090b') */
  bg?: string;
  /** Tailwind class (e.g. 'text-white') or hex literal (e.g. '#ffffff') */
  fg?: string;
  /** When true, children of this block do not inherit the override */
  noInherit?: boolean;
}

/** A className region extracted from a source file */
export interface ClassRegion {
  content: string;
  startLine: number;
  /** Implied background from nearest enclosing container (e.g., 'bg-card' inside <Card>) */
  contextBg: string;
  /** Inline style colors extracted from style={{ color: '...', backgroundColor: '...' }} */
  inlineStyles?: {
    color?: string;
    backgroundColor?: string;
  };
  /** Context override from an @a11y-context annotation on the same/preceding line */
  contextOverride?: ContextOverride;
  /** US-05: Cumulative opacity from ancestor containers (0.0-1.0). undefined = fully opaque. */
  effectiveOpacity?: number;
}

/** Pre-extracted file data, theme-agnostic. Used for extract-once/resolve-twice pattern. */
export interface FileRegions {
  relPath: string;
  lines: string[];
  regions: ClassRegion[];
}

/** Stored baseline data: maps file → hash → violation count */
export interface BaselineData {
  version: string;
  generatedAt: string;
  violations: Record<string, Record<string, number>>;
}

/** Summary of baseline reconciliation for a single audit run */
export interface BaselineSummary {
  newCount: number;
  knownCount: number;
  fixedCount: number;
  baselineTotal: number;
}

/** A shade family from the Tailwind palette (e.g., gray-50..gray-950) */
export interface ShadeFamily {
  /** Family name (e.g., "gray", "red", "sky") */
  family: string;
  /** Shade number -> hex value (e.g., 500 -> "#6b7280") */
  shades: Map<number, string>;
}

/** A suggested fix for a contrast violation */
export interface ColorSuggestion {
  /** The suggested Tailwind class (e.g., "text-gray-600") */
  suggestedClass: string;
  /** Resolved hex of the suggested class */
  suggestedHex: string;
  /** WCAG contrast ratio with the suggested color */
  newRatio: number;
  /** How many shade steps from the original (e.g., 500->600 = 1) */
  shadeDistance: number;
}
