// Public types re-exported from the library entry point.
// These form the stable API contract.

export type {
  // Core color types
  ColorMap,
  ResolvedColor,

  // Pair & result types
  ColorPair,
  ContrastResult,
  SkippedClass,
  IgnoredViolation,
  AuditResult,

  // Enum-like types
  ThemeMode,
  InteractiveState,
  ConformanceLevel,

  // File scanning types
  ClassRegion,
  FileRegions,
} from '../core/types.js';
