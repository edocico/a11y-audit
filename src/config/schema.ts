import { z } from 'zod';

export const auditConfigSchema = z.object({
  /** Source file glob patterns */
  src: z.array(z.string()).default(['src/**/*.tsx']),

  /** CSS files to parse for color definitions */
  css: z.array(z.string()).default([]),

  /** WCAG conformance level */
  threshold: z.enum(['AA', 'AAA']).default('AA'),

  /** Report output directory */
  reportDir: z.string().default('a11y-reports'),

  /** Report format */
  format: z.enum(['markdown', 'json']).default('markdown'),

  /** Run dark mode analysis */
  dark: z.boolean().default(true),

  /** Container context: component name → bg class */
  containers: z.record(z.string(), z.string()).default({}),

  /** Portal context: component name → bg class or "reset" (resets to defaultBg) */
  portals: z.record(z.string(), z.string()).default({}),

  /** Default page background class */
  defaultBg: z.string().default('bg-background'),

  /** Page background hex per theme (for alpha compositing) */
  pageBg: z.object({
    light: z.string(),
    dark: z.string(),
  }).default({ light: '#ffffff', dark: '#09090b' }),

  /** Preset name to load (e.g., "shadcn") */
  preset: z.string().optional(),

  /** Path to Tailwind palette CSS (auto-detected if not set) */
  tailwindPalette: z.string().optional(),

  /** Baseline configuration for brownfield adoption */
  baseline: z.object({
    /** Enable baseline reconciliation */
    enabled: z.boolean().default(false),
    /** Path to baseline file (relative to project root) */
    path: z.string().default('.a11y-baseline.json'),
  }).optional(),
});

export type AuditConfigInput = z.input<typeof auditConfigSchema>;
export type AuditConfigResolved = z.output<typeof auditConfigSchema>;
