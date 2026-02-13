// Public types re-exported from the library entry point.
// These form the stable API contract.

export type {
  // Core color types
  ColorMap,
  RawPalette,
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

  // Annotation types
  ContextOverride,
} from '../core/types.js';
