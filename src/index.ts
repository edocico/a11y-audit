// a11y-audit — programmatic API entry point
// This module re-exports the public API for consumers using the library as a dependency.

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
} from './types/public.js';

// TODO: Export core pipeline functions once migrated
// export { audit } from './core/pipeline.js';
// export { defineConfig } from './core/config.js';
