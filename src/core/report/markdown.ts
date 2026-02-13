import type { AuditResult, ContrastResult, IgnoredViolation, ThemeMode } from '../types.js';

interface ThemedAuditResult {
  mode: ThemeMode
  result: AuditResult
}

/**
 * Generates a Markdown audit report from light + dark mode results.
 * Groups violations by file for easier reading.
 * Separates text (SC 1.4.3) and non-text (SC 1.4.11) violations.
 * Interactive state (hover/focus-visible) pairs with State column.
 */
export function generateReport(results: ThemedAuditResult[]): string {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const lines: string[] = [];

  lines.push('# A11y Contrast Audit Report');
  lines.push(`> Generated: ${now}`);
  lines.push('');

  // Overall summary
  const totalFiles = results[0]?.result.filesScanned ?? 0;
  const totalPairs = results.reduce((s, r) => s + r.result.pairsChecked, 0);
  const totalViolations = results.reduce((s, r) => s + r.result.violations.length, 0);
  const totalSkipped = results.reduce((s, r) => s + r.result.skipped.length, 0);
  const totalIgnored = results.reduce((s, r) => s + r.result.ignored.length, 0);

  // Count text vs non-text violations
  const totalTextViolations = results.reduce((s, r) =>
    s + r.result.violations.filter((v) => !v.pairType || v.pairType === 'text').length, 0);
  const totalNonTextViolations = totalViolations - totalTextViolations;

  // Count base vs interactive violations
  const totalBaseViolations = results.reduce((s, r) =>
    s + r.result.violations.filter((v) => !v.interactiveState).length, 0);
  const totalInteractiveViolations = totalViolations - totalBaseViolations;

  // Count AAA violations (informational — pairs that would fail AAA across all checked)
  const totalAAATextViolations = results.reduce((s, r) =>
    s + [...r.result.violations, ...r.result.passed].filter((v) =>
      (!v.pairType || v.pairType === 'text') && !v.passAAA).length, 0);

  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Files scanned | ${totalFiles} |`);
  lines.push(`| Color pairs checked | ${totalPairs} |`);
  lines.push(`| **Violations (AA)** | **${totalViolations}** |`);
  lines.push(`| — Text contrast (SC 1.4.3) | ${totalTextViolations} |`);
  lines.push(`| — Non-text contrast (SC 1.4.11) | ${totalNonTextViolations} |`);
  lines.push(`| — Base state | ${totalBaseViolations} |`);
  lines.push(`| — Interactive states (hover/focus-visible) | ${totalInteractiveViolations} |`);
  lines.push(`| Would fail AAA text (informational) | ${totalAAATextViolations} |`);
  lines.push(`| Ignored (a11y-ignore) | ${totalIgnored} |`);
  lines.push(`| Skipped (dynamic/unresolvable) | ${totalSkipped} |`);
  lines.push('');

  // Per-theme sections
  for (const { mode, result } of results) {
    const modeLabel = mode === 'light' ? 'Light Mode' : 'Dark Mode';
    const icon = mode === 'light' ? '☀️' : '🌙';

    // Partition into text and non-text violations
    const textViolations = result.violations.filter((v) => !v.pairType || v.pairType === 'text');
    const nonTextViolations = result.violations.filter((v) => v.pairType && v.pairType !== 'text');

    // ── Text Contrast (SC 1.4.3) ──────────────────────────────────
    lines.push(`## ${icon} ${modeLabel} — Text Contrast (SC 1.4.3)`);
    lines.push('');

    if (textViolations.length === 0) {
      lines.push('No text contrast violations found.');
      lines.push('');
    } else {
      const grouped = groupByFile(textViolations);

      for (const [file, violations] of grouped) {
        lines.push(`### \`${file}\``);
        lines.push('');
        lines.push('| Line | State | Background | Foreground | Size | Ratio | AA | AAA | AA Large | APCA Lc |');
        lines.push('|------|:-----:|-----------|------------|:----:|------:|:---:|:---:|:--------:|--------:|');

        for (const v of violations) {
          const stateLabel = v.interactiveState ?? 'base';
          const bgLabel = `${v.bgClass} (${v.bgHex})`;
          const fgLabel = `${v.textClass} (${v.textHex})`;
          const sizeLabel = v.isLargeText ? 'LARGE' : 'normal';
          const aaIcon = v.passAA ? 'PASS' : '**FAIL**';
          const aaaIcon = v.passAAA ? 'PASS' : '**FAIL**';
          const aaLargeIcon = v.passAALarge ? 'PASS' : '**FAIL**';
          const apcaLabel = v.apcaLc != null ? `${v.apcaLc}` : '—';

          lines.push(
            `| ${v.line} | ${stateLabel} | ${bgLabel} | ${fgLabel} | ${sizeLabel} | ${v.ratio}:1 | ${aaIcon} | ${aaaIcon} | ${aaLargeIcon} | ${apcaLabel} |`
          );
        }

        lines.push('');
      }
    }

    // ── Non-Text Contrast (SC 1.4.11) ────────────────────────────
    lines.push(`## ${icon} ${modeLabel} — Non-Text Contrast (SC 1.4.11)`);
    lines.push('');

    if (nonTextViolations.length === 0) {
      lines.push('No non-text contrast violations found.');
      lines.push('');
    } else {
      const grouped = groupByFile(nonTextViolations);

      for (const [file, violations] of grouped) {
        lines.push(`### \`${file}\``);
        lines.push('');
        lines.push('| Line | State | Type | Element | Against | Ratio | 3:1 |');
        lines.push('|------|:-----:|:----:|---------|---------|------:|:---:|');

        for (const v of violations) {
          const stateLabel = v.interactiveState ?? 'base';
          const typeLabel = v.pairType ?? 'border';
          const elementLabel = `${v.textClass} (${v.textHex})`;
          const againstLabel = `${v.bgClass} (${v.bgHex})`;
          const passIcon = v.passAALarge ? 'PASS' : '**FAIL**';

          lines.push(
            `| ${v.line} | ${stateLabel} | ${typeLabel} | ${elementLabel} | ${againstLabel} | ${v.ratio}:1 | ${passIcon} |`
          );
        }

        lines.push('');
      }
    }
  }

  // Ignored violations section (combined across themes)
  const allIgnored = results.flatMap((r) => r.result.ignored);
  if (allIgnored.length > 0) {
    lines.push('## Ignored Violations (`a11y-ignore`)');
    lines.push('');

    const groupedIgnored = groupIgnoredByFile(allIgnored);

    for (const [file, items] of groupedIgnored) {
      lines.push(`### \`${file}\``);
      lines.push('');
      lines.push('| Line | Background | Foreground | Ratio | Reason |');
      lines.push('|------|-----------|------------|------:|--------|');

      for (const v of items) {
        lines.push(
          `| ${v.line} | ${v.bgClass} (${v.bgHex}) | ${v.textClass} (${v.textHex}) | ${v.ratio}:1 | ${v.ignoreReason} |`
        );
      }

      lines.push('');
    }
  }

  // Skipped section (deduplicated across all themes by file+line+class)
  const seenSkipped = new Set<string>();
  const allSkipped = results.flatMap((r) => r.result.skipped).filter((s) => {
    const key = `${s.file}:${s.line}:${s.className}`;
    if (seenSkipped.has(key)) return false;
    seenSkipped.add(key);
    return true;
  });
  if (allSkipped.length > 0) {
    lines.push('## Skipped Classes');
    lines.push('');
    lines.push('| File | Line | Class | Reason |');
    lines.push('|------|------|-------|--------|');

    // Limit to first 50 to keep report manageable
    const displayed = allSkipped.slice(0, 50);
    for (const s of displayed) {
      lines.push(`| ${s.file} | ${s.line} | \`${s.className}\` | ${s.reason} |`);
    }

    if (allSkipped.length > 50) {
      lines.push(`| ... | ... | ... | ${allSkipped.length - 50} more skipped |`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

function groupByFile(violations: ContrastResult[]): Map<string, ContrastResult[]> {
  const map = new Map<string, ContrastResult[]>();

  for (const v of violations) {
    const existing = map.get(v.file);
    if (existing) {
      existing.push(v);
    } else {
      map.set(v.file, [v]);
    }
  }

  return map;
}

function groupIgnoredByFile(ignored: IgnoredViolation[]): Map<string, IgnoredViolation[]> {
  const map = new Map<string, IgnoredViolation[]>();

  for (const v of ignored) {
    const existing = map.get(v.file);
    if (existing) {
      existing.push(v);
    } else {
      map.set(v.file, [v]);
    }
  }

  return map;
}
