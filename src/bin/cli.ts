#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('a11y-audit')
  .description('Framework-agnostic static contrast audit for WCAG 2.1 AA/AAA and APCA')
  .version('0.1.0')
  .option('-c, --config <path>', 'Path to config file')
  .option('--src <glob...>', 'Source file glob patterns', ['src/**/*.tsx'])
  .option('--css <paths...>', 'CSS files to parse for color definitions')
  .option('--report-dir <dir>', 'Output directory for reports', 'a11y-reports')
  .option('--threshold <level>', 'WCAG conformance level: AA or AAA', 'AA')
  .option('--format <type>', 'Report format: markdown or json', 'markdown')
  .option('--no-dark', 'Skip dark mode analysis')
  .action((options) => {
    console.log('[a11y-audit] CLI initialized');
    console.log('Options:', JSON.stringify(options, null, 2));
    // TODO: Wire up to core pipeline
  });

program.parse();
