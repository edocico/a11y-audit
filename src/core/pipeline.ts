import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import type { AuditResult, ThemeMode } from './types.js';
import type { ContainerConfig } from '../plugins/interfaces.js';
import { buildThemeColorMaps, type TailwindResolverOptions } from '../plugins/tailwind/css-resolver.js';
import { extractAllFileRegions, resolveFileRegions } from '../plugins/jsx/region-resolver.js';
import { checkAllPairs } from './contrast-checker.js';
import { generateReport } from './report/markdown.js';

const MAX_REPORT_COUNTER = 100;

export interface ThemedAuditResult {
  mode: ThemeMode;
  result: AuditResult;
}

export interface AuditRunResult {
  results: ThemedAuditResult[];
  report: string;
  totalViolations: number;
}

export interface PipelineOptions {
  /** Source file glob patterns (e.g., ['src/**\/*.tsx']) */
  src: string[];

  /** CSS files to parse for color definitions */
  css: string[];

  /** Path to tailwindcss/theme.css */
  palettePath: string;

  /** Project root directory */
  cwd: string;

  /** Container context config */
  containerConfig: ContainerConfig;

  /** WCAG conformance level */
  threshold: 'AA' | 'AAA';

  /** Report output directory */
  reportDir: string;

  /** Report format */
  format: 'markdown' | 'json';

  /** Whether to run dark mode analysis */
  dark: boolean;

  /** If true, print progress to stderr */
  verbose?: boolean;
}

function log(verbose: boolean | undefined, msg: string): void {
  if (verbose) console.error(msg);
}

/**
 * Generates a unique report path: {reportDir}/audit-YYYY-MM-DD.{ext}
 * If that file exists, appends -1, -2, etc. Never overwrites.
 */
function getOutputPath(reportDir: string, format: 'markdown' | 'json'): string {
  mkdirSync(reportDir, { recursive: true });

  const ext = format === 'json' ? 'json' : 'md';
  const today = new Date().toISOString().slice(0, 10);
  const baseName = `audit-${today}`;

  const firstPath = resolve(reportDir, `${baseName}.${ext}`);
  if (!existsSync(firstPath)) return firstPath;

  let counter = 1;
  while (
    existsSync(resolve(reportDir, `${baseName}-${counter}.${ext}`)) &&
    counter < MAX_REPORT_COUNTER
  ) {
    counter++;
  }
  return resolve(reportDir, `${baseName}-${counter}.${ext}`);
}

/**
 * Runs the full audit pipeline:
 * 1. Build color maps (once)
 * 2. Extract file regions (once, theme-agnostic)
 * 3. Resolve + check contrast (per theme)
 * 4. Generate report
 */
export function runAudit(options: PipelineOptions): AuditRunResult {
  const {
    src,
    css,
    palettePath,
    cwd,
    containerConfig,
    threshold,
    reportDir,
    format,
    dark,
    verbose,
  } = options;

  // Phase 0: Build color maps
  log(verbose, '[a11y-audit] Building color maps...');
  const resolverOpts: TailwindResolverOptions = { cssPaths: css, palettePath };
  const { light, dark: darkMap } = buildThemeColorMaps(resolverOpts);
  log(verbose, `  Light map: ${light.size} resolved colors`);
  log(verbose, `  Dark map:  ${darkMap.size} resolved colors`);

  // Phase 1: Extract once (theme-agnostic file I/O + state machine parsing)
  log(verbose, '[a11y-audit] Extracting file regions...');
  const preExtracted = extractAllFileRegions(
    src,
    cwd,
    containerConfig.containers,
    containerConfig.defaultBg,
  );
  log(verbose, `  ${preExtracted.filesScanned} files scanned`);

  // Phase 2+3: Resolve per theme + check contrast
  const themes: { mode: ThemeMode; map: typeof light }[] = [
    { mode: 'light', map: light },
  ];
  if (dark) {
    themes.push({ mode: 'dark', map: darkMap });
  }

  const results: ThemedAuditResult[] = [];
  for (const { mode, map } of themes) {
    log(verbose, `[a11y-audit] Resolving pairs (${mode} mode)...`);
    const { pairs, skipped, filesScanned } = resolveFileRegions(preExtracted, map, mode);
    log(verbose, `  ${pairs.length} pairs, ${skipped.length} skipped`);

    log(verbose, `[a11y-audit] Checking contrast (${mode} mode)...`);
    const result = checkAllPairs(pairs, skipped, filesScanned, mode, threshold);
    log(verbose, `  ${result.violations.length} violations, ${result.passed.length} passed`);

    results.push({ mode, result });
  }

  // Phase 4: Generate report
  log(verbose, '[a11y-audit] Generating report...');
  let report: string;
  if (format === 'json') {
    // JSON reporter imported lazily when needed
    report = JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        summary: {
          filesScanned: results[0]?.result.filesScanned ?? 0,
          totalPairs: results.reduce((s, r) => s + r.result.pairsChecked, 0),
          totalViolations: results.reduce((s, r) => s + r.result.violations.length, 0),
          totalSkipped: results.reduce((s, r) => s + r.result.skipped.length, 0),
          totalIgnored: results.reduce((s, r) => s + r.result.ignored.length, 0),
        },
        themes: results.map(({ mode, result }) => ({
          mode,
          violations: result.violations,
          passed: result.passed,
          skipped: result.skipped,
          ignored: result.ignored,
        })),
      },
      null,
      2,
    );
  } else {
    report = generateReport(results);
  }

  // Write report to disk
  const resolvedReportDir = resolve(cwd, reportDir);
  const outputPath = getOutputPath(resolvedReportDir, format);
  writeFileSync(outputPath, report, 'utf-8');

  const relPath = relative(cwd, outputPath);
  log(verbose, `Report saved to: ${relPath}`);

  const totalViolations = results.reduce((s, r) => s + r.result.violations.length, 0);

  return { results, report, totalViolations };
}
