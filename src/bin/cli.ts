#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'node:path';
import { loadConfig } from '../config/loader.js';
import { runAudit, type PipelineOptions } from '../core/pipeline.js';
import { findTailwindPalette } from '../plugins/tailwind/palette.js';
import { shadcnPreset } from '../plugins/tailwind/presets/shadcn.js';
import type { ContainerConfig } from '../plugins/interfaces.js';

const program = new Command();

program
  .name('a11y-audit')
  .description('Framework-agnostic static contrast audit for WCAG 2.1 AA/AAA and APCA')
  .version('0.1.0')
  .option('-c, --config <path>', 'Path to config file')
  .option('--src <glob...>', 'Source file glob patterns')
  .option('--css <paths...>', 'CSS files to parse for color definitions')
  .option('--report-dir <dir>', 'Output directory for reports')
  .option('--threshold <level>', 'WCAG conformance level: AA or AAA')
  .option('--format <type>', 'Report format: markdown or json')
  .option('--no-dark', 'Skip dark mode analysis')
  .option('--preset <name>', 'Container preset (e.g., "shadcn")')
  .option('--verbose', 'Print progress to stderr')
  .option('--update-baseline', 'Generate or update the baseline file')
  .option('--baseline-path <path>', 'Override baseline file path')
  .option('--fail-on-improvement', 'Fail CI if fewer violations than baseline (forces baseline update)')
  .action(async (opts) => {
    try {
      // 1. Load config file (if any), then merge CLI flags as overrides
      const fileConfig = await loadConfig(opts.config as string | undefined);

      const cwd = process.cwd();

      // CLI flags override config file values (only when explicitly provided)
      const src: string[] = (opts.src as string[] | undefined) ?? fileConfig.src;
      const css: string[] = (opts.css as string[] | undefined) ?? fileConfig.css;
      const reportDir: string = (opts.reportDir as string | undefined) ?? fileConfig.reportDir;
      const threshold = ((opts.threshold as string | undefined) ?? fileConfig.threshold) as 'AA' | 'AAA';
      const format = ((opts.format as string | undefined) ?? fileConfig.format) as 'markdown' | 'json';
      const dark: boolean = opts.dark !== false && fileConfig.dark;
      const preset: string | undefined = (opts.preset as string | undefined) ?? fileConfig.preset;
      const verbose: boolean = opts.verbose === true;
      const updateBaseline: boolean = opts.updateBaseline === true;
      const failOnImprovement: boolean = opts.failOnImprovement === true;
      const baselinePath: string =
        (opts.baselinePath as string | undefined) ?? fileConfig.baseline?.path ?? '.a11y-baseline.json';
      const baselineEnabled: boolean = fileConfig.baseline?.enabled ?? false;

      // 2. Resolve CSS file paths relative to cwd
      const resolvedCss = css.map((p: string) => resolve(cwd, p));

      // 3. Discover Tailwind palette
      const palettePath = fileConfig.tailwindPalette
        ? resolve(cwd, fileConfig.tailwindPalette)
        : findTailwindPalette(cwd);

      // 4. Build container config from preset + config overrides
      const containerConfig = buildContainerConfig(preset, fileConfig.containers, fileConfig.defaultBg, fileConfig.pageBg);

      // 5. Run pipeline
      const pipelineOpts: PipelineOptions = {
        src,
        css: resolvedCss,
        palettePath,
        cwd,
        containerConfig,
        threshold,
        reportDir,
        format,
        dark,
        verbose,
        baseline: (baselineEnabled || updateBaseline) ? {
          enabled: baselineEnabled,
          path: baselinePath,
          updateBaseline,
          failOnImprovement,
        } : undefined,
      };

      const { totalViolations, baselineSummary, baselineUpdated } = runAudit(pipelineOpts);

      if (baselineUpdated) {
        console.log(`[a11y-audit] Baseline updated: ${totalViolations} violations baselined.`);
        process.exit(0);
      }

      if (baselineSummary) {
        if (failOnImprovement && totalViolations < baselineSummary.baselineTotal) {
          console.log(
            `[a11y-audit] Baseline is stale: ${totalViolations} current vs ${baselineSummary.baselineTotal} baselined.`,
          );
          console.log('[a11y-audit] Run with --update-baseline to refresh.');
          process.exit(1);
        }
        if (baselineSummary.newCount > 0) {
          console.log(
            `[a11y-audit] ${baselineSummary.newCount} NEW violations (${baselineSummary.knownCount} baselined, ${baselineSummary.fixedCount} fixed).`,
          );
          process.exit(1);
        }
        console.log(
          `[a11y-audit] No new violations. ${baselineSummary.knownCount} baselined, ${baselineSummary.fixedCount} fixed.`,
        );
      } else {
        if (totalViolations > 0) {
          console.log(`[a11y-audit] ${totalViolations} total violations found.`);
          process.exit(1);
        }
        console.log('[a11y-audit] All checks passed!');
      }
    } catch (err) {
      console.error(`[a11y-audit] Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    }
  });

program.parse();

/**
 * Merges a preset (e.g., shadcn) with user-defined container overrides.
 */
function buildContainerConfig(
  preset: string | undefined,
  userContainers: Record<string, string>,
  defaultBg: string,
  pageBg: { light: string; dark: string },
): ContainerConfig {
  const PRESETS: Record<string, ContainerConfig> = {
    shadcn: shadcnPreset,
  };

  const basePreset = preset ? PRESETS[preset] : undefined;
  if (preset && !basePreset) {
    console.warn(`[a11y-audit] Unknown preset "${preset}" — using defaults`);
  }

  const containers = new Map<string, string>(basePreset?.containers ?? []);

  // User overrides merge on top of preset
  for (const [key, value] of Object.entries(userContainers)) {
    containers.set(key, value);
  }

  return {
    containers,
    defaultBg: basePreset?.defaultBg ?? defaultBg,
    pageBg: basePreset?.pageBg ?? pageBg,
  };
}
