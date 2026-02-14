import { describe, test, expect, vi } from 'vitest';
import { extractClassRegions } from '../../plugins/jsx/parser.js';
import { resolveFileRegions, type PreExtracted } from '../../plugins/jsx/region-resolver.js';
import { checkAllPairs } from '../contrast-checker.js';
import { generateReport } from '../report/markdown.js';
import type { ColorMap, AuditResult, ThemeMode } from '../types.js';
import { shadcnPreset } from '../../plugins/tailwind/presets/shadcn.js';

// ── Fixture: minimal ColorMap with known color values ─────────────────

function createIntegrationColorMap(): ColorMap {
  return new Map([
    ['--color-white', { hex: '#ffffff' }],
    ['--color-black', { hex: '#000000' }],
    ['--color-red-500', { hex: '#ef4444' }],
    ['--color-red-700', { hex: '#b91c1c' }],
    ['--color-blue-500', { hex: '#3b82f6' }],
    ['--color-green-500', { hex: '#22c55e' }],
    ['--color-green-700', { hex: '#15803d' }],
    ['--color-slate-100', { hex: '#f1f5f9' }],
    ['--color-slate-600', { hex: '#475569' }],
    ['--color-gray-400', { hex: '#9ca3af' }],
    ['--color-background', { hex: '#ffffff' }],
    ['--color-foreground', { hex: '#0a0a0a' }],
    ['--color-primary', { hex: '#0369a1' }],
    ['--color-input', { hex: '#e5e5e5' }],
    ['--color-border', { hex: '#e5e5e5' }],
  ]);
}

// ── Fixture: 3 realistic JSX "files" covering key scenarios ───────────

const FIXTURE_FILES = {
  'components/Button.tsx': [
    '<button className="bg-primary text-white font-bold px-4 py-2">',
    '  Click me',
    '</button>',
    '<button className="bg-red-500 text-white hover:bg-red-700">',
    '  Delete',
    '</button>',
  ].join('\n'),

  'components/Card.tsx': [
    '<div className="bg-white text-foreground border-input p-4">',
    '  <h2 className="text-2xl font-bold text-black">Title</h2>',
    '  <p className="text-slate-600 bg-slate-100">Description</p>',
    '</div>',
  ].join('\n'),

  'components/Badge.tsx': [
    '// a11y-ignore: decorative element',
    '<span className="bg-green-500 text-white text-sm">Active</span>',
    '<span className="bg-background text-gray-400">Muted text</span>',
  ].join('\n'),

  'components/Overlay.tsx': [
    '// @a11y-context bg:#09090b',
    '<span className="text-white absolute top-0">Badge</span>',
    '{/* @a11y-context-block bg:bg-background */}',
    '<div>',
    '  <p className="text-foreground">Dialog body</p>',
    '</div>',
    '<p className="text-black">Normal paragraph</p>',
  ].join('\n'),
};

// ── Helper: build PreExtracted from fixture strings ───────────────────

function buildPreExtracted(): PreExtracted {
  const files = Object.entries(FIXTURE_FILES).map(([relPath, source]) => ({
    relPath,
    lines: source.split('\n'),
    regions: extractClassRegions(source, shadcnPreset.containers, shadcnPreset.defaultBg),
  }));

  return {
    files,
    readErrors: [],
    filesScanned: files.length,
  };
}

// ── Helper: run full pipeline ─────────────────────────────────────────

function runPipeline(themeMode: ThemeMode = 'light'): AuditResult {
  const colorMap = createIntegrationColorMap();
  const preExtracted = buildPreExtracted();
  const { pairs, skipped, filesScanned } = resolveFileRegions(preExtracted, colorMap, themeMode);
  return checkAllPairs(pairs, skipped, filesScanned, themeMode);
}

// ── Integration tests ─────────────────────────────────────────────────

describe('Integration: full pipeline (extract → resolve → check)', () => {
  test('produces correct file count', () => {
    const result = runPipeline();
    expect(result.filesScanned).toBe(4);
  });

  test('finds pairs from all fixture files', () => {
    const result = runPipeline();
    expect(result.pairsChecked).toBeGreaterThan(0);
    // At minimum: Button has bg-primary/text-white + bg-red-500/text-white,
    // Card has bg-white/text-foreground + bg-slate-100/text-slate-600, etc.
    expect(result.pairsChecked).toBeGreaterThanOrEqual(4);
  });

  test('bg-background + text-gray-400 is a violation (low contrast)', () => {
    const result = runPipeline();
    const grayViolation = result.violations.find(
      (v) => v.textClass === 'text-gray-400' && v.bgClass === 'bg-background',
    );
    expect(grayViolation).toBeDefined();
    expect(grayViolation!.ratio).toBeLessThan(4.5);
  });

  test('bg-primary + text-white passes AA', () => {
    const result = runPipeline();
    const primaryPair = result.passed.find(
      (v) => v.bgClass === 'bg-primary' && v.textClass === 'text-white',
    );
    expect(primaryPair).toBeDefined();
    expect(primaryPair!.passAA).toBe(true);
  });

  test('a11y-ignore suppresses pair into ignored list', () => {
    const result = runPipeline();
    // Badge.tsx has "// a11y-ignore: decorative element" before className
    const ignored = result.ignored.find(
      (v) => v.bgClass === 'bg-green-500' && v.textClass === 'text-white',
    );
    expect(ignored).toBeDefined();
    expect(ignored!.ignoreReason).toContain('decorative');
  });

  test('hover:bg-red-700 creates interactive state pair', () => {
    const result = runPipeline();
    const allResults = [...result.violations, ...result.passed, ...result.ignored];
    const hoverPair = allResults.find(
      (v) => v.bgClass === 'hover:bg-red-700' && v.interactiveState === 'hover',
    );
    expect(hoverPair).toBeDefined();
  });

  test('text-2xl + font-bold detected as large text', () => {
    const result = runPipeline();
    const allResults = [...result.violations, ...result.passed, ...result.ignored];
    const largePair = allResults.find(
      (v) => v.textClass === 'text-black' && v.isLargeText === true,
    );
    expect(largePair).toBeDefined();
  });

  test('border-input creates non-text pair', () => {
    const result = runPipeline();
    const allResults = [...result.violations, ...result.passed, ...result.ignored];
    const borderPair = allResults.find((v) => v.pairType === 'border');
    expect(borderPair).toBeDefined();
  });

  test('AAA fields are populated on all results', () => {
    const result = runPipeline();
    const allResults = [...result.violations, ...result.passed, ...result.ignored];
    for (const r of allResults) {
      expect(r).toHaveProperty('passAAA');
      expect(r).toHaveProperty('passAAALarge');
    }
  });

  test('APCA Lc values are calculated for text pairs', () => {
    const result = runPipeline();
    const textResults = [...result.violations, ...result.passed, ...result.ignored].filter(
      (r) => r.pairType === 'text' || !r.pairType,
    );
    // At least some text pairs should have APCA values
    const withApca = textResults.filter((r) => r.apcaLc != null);
    expect(withApca.length).toBeGreaterThan(0);
  });

  test('@a11y-context overrides bg for floating badge', () => {
    const result = runPipeline();
    const allResults = [...result.violations, ...result.passed, ...result.ignored];
    // Badge with @a11y-context bg:#09090b should be checked against dark bg
    const badge = allResults.find(
      (v) => v.file === 'components/Overlay.tsx'
        && v.textClass === 'text-white'
        && v.contextSource === 'annotation',
    );
    expect(badge).toBeDefined();
    expect(badge!.bgHex).not.toBe('#ffffff'); // NOT the default white background
  });

  test('@a11y-context-block applies to children, not siblings', () => {
    const result = runPipeline();
    const allResults = [...result.violations, ...result.passed, ...result.ignored];
    // Normal paragraph outside block annotation should use default bg
    const normalP = allResults.find(
      (v) => v.file === 'components/Overlay.tsx' && v.textClass === 'text-black',
    );
    expect(normalP).toBeDefined();
    expect(normalP!.contextSource).toBeUndefined();
  });
});

describe('Integration: report generation', () => {
  test('generates non-empty report from pipeline results', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'));

    const result = runPipeline();
    const report = generateReport([{ mode: 'light', result }]);

    expect(report).toContain('# A11y Contrast Audit Report');
    expect(report).toContain('| Files scanned | 4 |');
    expect(report).toContain('Light');

    vi.useRealTimers();
  });

  test('report snapshot is stable for known fixture input', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:00:00Z'));

    const result = runPipeline();
    const report = generateReport([{ mode: 'light', result }]);

    expect(report).toMatchSnapshot();

    vi.useRealTimers();
  });
});

// ── US-05: Opacity stack E2E tests ─────────────────────────────────────

describe('Integration: US-05 opacity stack', () => {
  test('effectiveOpacity reduces contrast via alpha reduction on both bg and text', () => {
    const colorMap = createIntegrationColorMap();
    const preExtracted: PreExtracted = {
      files: [{
        relPath: 'opacity-test.tsx',
        lines: [
          '<div className="opacity-50">',
          '  <span className="bg-background text-foreground">content</span>',
          '</div>',
        ],
        regions: [{
          content: 'bg-background text-foreground',
          startLine: 2,
          contextBg: 'bg-background',
          effectiveOpacity: 0.5,
        }],
      }],
      readErrors: [],
      filesScanned: 1,
    };

    const { pairs } = resolveFileRegions(preExtracted, colorMap, 'light');
    expect(pairs.length).toBeGreaterThan(0);
    // effectiveOpacity should reduce both alphas
    expect(pairs[0]!.effectiveOpacity).toBe(0.5);
    expect(pairs[0]!.bgAlpha).toBe(0.5);
    expect(pairs[0]!.textAlpha).toBe(0.5);
  });

  test('no effectiveOpacity means normal contrast (no alpha reduction)', () => {
    const colorMap = createIntegrationColorMap();
    const preExtracted: PreExtracted = {
      files: [{
        relPath: 'no-opacity-test.tsx',
        lines: [
          '<span className="bg-background text-foreground">content</span>',
        ],
        regions: [{
          content: 'bg-background text-foreground',
          startLine: 1,
          contextBg: 'bg-background',
        }],
      }],
      readErrors: [],
      filesScanned: 1,
    };

    const { pairs } = resolveFileRegions(preExtracted, colorMap, 'light');
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs[0]!.effectiveOpacity).toBeUndefined();
    expect(pairs[0]!.bgAlpha).toBeUndefined();
    expect(pairs[0]!.textAlpha).toBeUndefined();
  });

  test('effectiveOpacity flows through full pipeline to contrast results', () => {
    const colorMap = createIntegrationColorMap();
    const preExtracted: PreExtracted = {
      files: [{
        relPath: 'opacity-pipeline.tsx',
        lines: [
          '<div className="opacity-50">',
          '  <span className="bg-background text-foreground">content</span>',
          '</div>',
        ],
        regions: [{
          content: 'bg-background text-foreground',
          startLine: 2,
          contextBg: 'bg-background',
          effectiveOpacity: 0.5,
        }],
      }],
      readErrors: [],
      filesScanned: 1,
    };

    const { pairs, skipped, filesScanned } = resolveFileRegions(preExtracted, colorMap, 'light');
    const result = checkAllPairs(pairs, skipped, filesScanned, 'light');

    // The pair should appear in results (violations or passed) with effectiveOpacity
    const allResults = [...result.violations, ...result.passed, ...result.ignored];
    expect(allResults.length).toBeGreaterThan(0);
    const opacityResult = allResults.find(r => r.file === 'opacity-pipeline.tsx');
    expect(opacityResult).toBeDefined();
    expect(opacityResult!.effectiveOpacity).toBe(0.5);
  });
});
