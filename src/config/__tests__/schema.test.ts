import { describe, it, expect } from 'vitest';
import { auditConfigSchema } from '../schema.js';

describe('auditConfigSchema', () => {
  it('returns defaults for empty object', () => {
    const result = auditConfigSchema.parse({});
    expect(result.src).toEqual(['src/**/*.tsx']);
    expect(result.threshold).toBe('AA');
    expect(result.dark).toBe(true);
    expect(result.pageBg.light).toBe('#ffffff');
    expect(result.pageBg.dark).toBe('#09090b');
    expect(result.format).toBe('markdown');
    expect(result.reportDir).toBe('a11y-reports');
    expect(result.defaultBg).toBe('bg-background');
  });

  it('accepts valid overrides', () => {
    const result = auditConfigSchema.parse({
      src: ['app/**/*.vue'],
      threshold: 'AAA',
      dark: false,
      containers: { Card: 'bg-card' },
    });
    expect(result.src).toEqual(['app/**/*.vue']);
    expect(result.threshold).toBe('AAA');
    expect(result.dark).toBe(false);
    expect(result.containers).toEqual({ Card: 'bg-card' });
  });

  it('rejects invalid threshold', () => {
    expect(() => auditConfigSchema.parse({ threshold: 'A' })).toThrow();
  });

  it('rejects invalid format', () => {
    expect(() => auditConfigSchema.parse({ format: 'xml' })).toThrow();
  });
});
