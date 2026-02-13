// a11y-audit — programmatic API entry point
// This module re-exports the public API for consumers using the library as a dependency.

// ── Core types ────────────────────────────────────────────────────────
export type {
  ColorMap,
  RawPalette,
  ResolvedColor,
  ColorPair,
  ContrastResult,
  SkippedClass,
  IgnoredViolation,
  AuditResult,
  ThemeMode,
  InteractiveState,
  ConformanceLevel,
  ClassRegion,
  FileRegions,
  ContextOverride,
} from './types/public.js';

// ── Plugin interfaces ─────────────────────────────────────────────────
export type { ColorResolver, FileParser, ContainerConfig, AuditConfig } from './plugins/interfaces.js';

// ── Config ────────────────────────────────────────────────────────────
export { auditConfigSchema, type AuditConfigInput, type AuditConfigResolved } from './config/schema.js';
export { loadConfig } from './config/loader.js';

// ── Pipeline ──────────────────────────────────────────────────────────
export { runAudit, type AuditRunResult, type PipelineOptions, type ThemedAuditResult } from './core/pipeline.js';

// ── Built-in plugins (for programmatic use) ───────────────────────────
export { shadcnPreset } from './plugins/tailwind/presets/shadcn.js';
export { findTailwindPalette } from './plugins/tailwind/palette.js';

// ── Utilities ─────────────────────────────────────────────────────────
export { toHex } from './core/color-utils.js';
