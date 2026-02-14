import type { AuditConfigResolved } from './schema.js';

/** Resolved defaults (what you get with zero config) */
export const DEFAULT_CONFIG: AuditConfigResolved = {
  src: ['src/**/*.tsx'],
  css: [],
  threshold: 'AA',
  reportDir: 'a11y-reports',
  format: 'markdown',
  dark: true,
  containers: {},
  portals: {},
  defaultBg: 'bg-background',
  pageBg: { light: '#ffffff', dark: '#09090b' },
  preset: undefined,
  tailwindPalette: undefined,
};
