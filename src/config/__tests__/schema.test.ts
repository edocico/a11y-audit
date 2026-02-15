import { describe, it, test, expect } from 'vitest';
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

  it('defaults baseline to undefined when not provided', () => {
    const result = auditConfigSchema.parse({});
    expect(result.baseline).toBeUndefined();
  });

  it('accepts baseline with defaults', () => {
    const result = auditConfigSchema.parse({ baseline: {} });
    expect(result.baseline).toEqual({
      enabled: false,
      path: '.a11y-baseline.json',
    });
  });

  it('accepts baseline with overrides', () => {
    const result = auditConfigSchema.parse({
      baseline: { enabled: true, path: 'custom-baseline.json' },
    });
    expect(result.baseline!.enabled).toBe(true);
    expect(result.baseline!.path).toBe('custom-baseline.json');
  });

  it('should accept portals configuration', () => {
    const input = {
      portals: {
        DialogContent: 'reset',
        PopoverContent: 'bg-popover',
        DialogOverlay: 'bg-black/80',
      },
    };
    const result = auditConfigSchema.parse(input);
    expect(result.portals).toEqual(input.portals);
  });

  it('should default portals to empty object', () => {
    const result = auditConfigSchema.parse({});
    expect(result.portals).toEqual({});
  });

  describe('cva config', () => {
    test('defaults to disabled with checkAllVariants=false', () => {
      const result = auditConfigSchema.parse({
        cva: {},
      });
      expect(result.cva).toEqual({
        enabled: false,
        checkAllVariants: false,
      });
    });

    test('accepts enabled with checkAllVariants', () => {
      const result = auditConfigSchema.parse({
        cva: { enabled: true, checkAllVariants: true },
      });
      expect(result.cva).toEqual({
        enabled: true,
        checkAllVariants: true,
      });
    });

    test('cva field is optional', () => {
      const result = auditConfigSchema.parse({});
      expect(result.cva).toBeUndefined();
    });
  });

  describe('suggestions config', () => {
    it('defaults to disabled with maxSuggestions=3', () => {
      const result = auditConfigSchema.parse({
        suggestions: {},
      });
      expect(result.suggestions).toEqual({
        enabled: false,
        maxSuggestions: 3,
      });
    });

    it('accepts enabled with custom maxSuggestions', () => {
      const result = auditConfigSchema.parse({
        suggestions: { enabled: true, maxSuggestions: 5 },
      });
      expect(result.suggestions).toEqual({
        enabled: true,
        maxSuggestions: 5,
      });
    });

    it('suggestions field is optional', () => {
      const result = auditConfigSchema.parse({});
      expect(result.suggestions).toBeUndefined();
    });
  });
});
