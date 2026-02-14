import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { globSync } from 'glob';
import type { AuditResult, SkippedClass, ThemeMode } from './types.js';
import type { ContainerConfig } from '../plugins/interfaces.js';
import { buildThemeColorMaps, type TailwindResolverOptions } from '../plugins/tailwind/css-resolver.js';
import { extractAllFileRegions, resolveFileRegions } from '../plugins/jsx/region-resolver.js';
import type { PreExtracted } from '../plugins/jsx/region-resolver.js';
import { checkAllPairs } from './contrast-checker.js';
import { generateReport } from './report/markdown.js';
import { generateJsonReport } from './report/json.js';
import { isNativeAvailable, getNativeModule } from '../native/index.js';
import { convertNativeResult } from '../native/converter.js';
import { loadBaseline, saveBaseline, reconcileViolations } from './baseline.js';
import type { BaselineSummary } from './types.js';

const MAX_REPORT_COUNTER = 100;

export interface ThemedAuditResult {
  mode: ThemeMode;
  result: AuditResult;
}

export interface AuditRunResult {
  results: ThemedAuditResult[];
  report: string;
  totalViolations: number;
  /** Present when baseline reconciliation was performed */
  baselineSummary?: BaselineSummary;
  /** true when --update-baseline was used and baseline file was written */
  baselineUpdated?: boolean;
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

  /** Baseline configuration */
  baseline?: {
    enabled: boolean;
    path: string;
    updateBaseline: boolean;
    failOnImprovement: boolean;
  };
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
  let preExtracted: PreExtracted;

  if (isNativeAvailable()) {
    log(verbose, '[a11y-audit] Extracting file regions (native Rust engine)...');
    preExtracted = extractWithNativeEngine(src, cwd, containerConfig, verbose);
  } else {
    log(verbose, '[a11y-audit] Extracting file regions (legacy TypeScript engine)...');
    log(verbose, '  ⚠ Native module not available. Disabled detection (US-07) and currentColor resolution (US-08) will be skipped.');
    preExtracted = extractAllFileRegions(
      src,
      cwd,
      containerConfig.containers,
      containerConfig.defaultBg,
    );
  }
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

  // Phase 3.5: Baseline — save or reconcile
  let baselineSummary: BaselineSummary | undefined;
  let baselineUpdated = false;

  if (options.baseline) {
    const resolvedPath = resolve(cwd, options.baseline.path);

    if (options.baseline.updateBaseline) {
      log(verbose, '[a11y-audit] Updating baseline...');
      const allViolations = results.flatMap(r => r.result.violations);
      saveBaseline(resolvedPath, allViolations);
      log(verbose, `  Baseline updated: ${allViolations.length} violations across ${new Set(allViolations.map(v => v.file)).size} files`);
      log(verbose, `  Saved to: ${options.baseline.path}`);
      baselineUpdated = true;
    } else if (options.baseline.enabled) {
      log(verbose, '[a11y-audit] Loading baseline...');
      const baseline = loadBaseline(resolvedPath);

      if (baseline) {
        const allViolations = results.flatMap(r => r.result.violations);
        const reconciled = reconcileViolations(allViolations, baseline);

        // Distribute annotated violations back to their themes
        let offset = 0;
        for (const themed of results) {
          const count = themed.result.violations.length;
          themed.result.violations = reconciled.annotated.slice(offset, offset + count);
          offset += count;
        }

        baselineSummary = {
          newCount: reconciled.newCount,
          knownCount: reconciled.knownCount,
          fixedCount: reconciled.fixedCount,
          baselineTotal: reconciled.baselineTotal,
        };
        log(verbose, `  Baseline: ${reconciled.baselineTotal} total, ${reconciled.newCount} new, ${reconciled.knownCount} known, ${reconciled.fixedCount} fixed`);
      } else {
        log(verbose, '  ⚠ Baseline file not found — all violations treated as new');
      }
    }
  }

  // Phase 4: Generate report
  log(verbose, '[a11y-audit] Generating report...');
  const report = format === 'json'
    ? generateJsonReport(results, baselineSummary)
    : generateReport(results, baselineSummary);

  // Write report to disk
  const resolvedReportDir = resolve(cwd, reportDir);
  const outputPath = getOutputPath(resolvedReportDir, format);
  writeFileSync(outputPath, report, 'utf-8');

  const relPath = relative(cwd, outputPath);
  log(verbose, `Report saved to: ${relPath}`);

  const totalViolations = results.reduce((s, r) => s + r.result.violations.length, 0);

  return { results, report, totalViolations, baselineSummary, baselineUpdated };
}

/**
 * Reads files via glob + readFileSync, then passes content to the Rust
 * native engine for parallel parsing. Converts the flat Rust output back
 * to the TS PreExtracted format for downstream resolution.
 */
function extractWithNativeEngine(
  srcPatterns: string[],
  cwd: string,
  containerConfig: ContainerConfig,
  verbose: boolean | undefined,
): PreExtracted {
  const filePaths = srcPatterns.flatMap((pattern) =>
    globSync(pattern, { cwd, absolute: true }),
  );

  const fileContents: Array<{ path: string; content: string }> = [];
  const sourceLines = new Map<string, string[]>();
  const readErrors: SkippedClass[] = [];

  for (const filePath of filePaths) {
    const relPath = relative(cwd, filePath);
    try {
      const content = readFileSync(filePath, 'utf-8');
      fileContents.push({ path: relPath, content });
      sourceLines.set(relPath, content.split('\n'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(verbose, `  Skipping ${relPath}: ${message}`);
      readErrors.push({
        file: relPath,
        line: 0,
        className: '(file)',
        reason: `File read error: ${message}`,
      });
    }
  }

  const containerEntries = Array.from(containerConfig.containers.entries()).map(
    ([component, bgClass]) => ({ component, bgClass }),
  );

  const nativeResult = getNativeModule().extractAndScan({
    fileContents,
    containerConfig: containerEntries,
    defaultBg: containerConfig.defaultBg,
  });

  return convertNativeResult(nativeResult, sourceLines, readErrors, filePaths.length);
}
