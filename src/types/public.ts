// Public types re-exported from the library entry point.
// These form the stable API contract.

/** WCAG conformance level for violation threshold */
export type ConformanceLevel = 'AA' | 'AAA';

/** Theme mode for dual-mode auditing */
export type ThemeMode = 'light' | 'dark';

/** Tracked interactive states for contrast auditing */
export type InteractiveState = 'hover' | 'focus-visible' | 'aria-disabled';

/** A resolved CSS color with optional alpha channel */
export interface ResolvedColor {
  hex: string;
  /** 0-1 range. undefined = fully opaque */
  alpha?: number;
}
