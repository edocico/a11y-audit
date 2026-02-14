import type { AuditResult, BaselineSummary, ThemeMode } from '../types.js';

interface ThemedAuditResult {
  mode: ThemeMode;
  result: AuditResult;
}

/**
 * Generates a structured JSON audit report from themed results.
 * Includes summary statistics, per-theme violations/passed/skipped/ignored.
 */
export function generateJsonReport(
  results: ThemedAuditResult[],
  baselineSummary?: BaselineSummary,
): string {
  const totalViolations = results.reduce((s, r) => s + r.result.violations.length, 0);
  const totalTextViolations = results.reduce(
    (s, r) => s + r.result.violations.filter((v) => !v.pairType || v.pairType === 'text').length,
    0,
  );

  return JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      summary: {
        filesScanned: results[0]?.result.filesScanned ?? 0,
        totalPairs: results.reduce((s, r) => s + r.result.pairsChecked, 0),
        totalViolations,
        textViolations: totalTextViolations,
        nonTextViolations: totalViolations - totalTextViolations,
        totalSkipped: results.reduce((s, r) => s + r.result.skipped.length, 0),
        totalIgnored: results.reduce((s, r) => s + r.result.ignored.length, 0),
        ...(baselineSummary
          ? {
              newViolations: baselineSummary.newCount,
              baselineViolations: baselineSummary.knownCount,
              fixedViolations: baselineSummary.fixedCount,
            }
          : {}),
      },
      themes: results.map(({ mode, result }) => ({
        mode,
        pairsChecked: result.pairsChecked,
        violations: result.violations,
        passed: result.passed,
        skipped: result.skipped,
        ignored: result.ignored,
      })),
    },
    null,
    2,
  );
}
