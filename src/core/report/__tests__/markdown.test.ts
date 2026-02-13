import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateReport } from '../markdown.js';
import type { AuditResult, ContrastResult, IgnoredViolation, SkippedClass, ThemeMode } from '../../types.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Freeze Date for deterministic report timestamps */
function freezeDate() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
}

function unfreeze() {
  vi.useRealTimers();
}

function makeResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    filesScanned: 10,
    pairsChecked: 100,
    violations: [],
    passed: [],
    skipped: [],
    ignored: [],
    ...overrides
  };
}

function makeViolation(overrides: Partial<ContrastResult> = {}): ContrastResult {
  return {
    file: 'src/components/Button.tsx',
    line: 42,
    bgClass: 'bg-white',
    textClass: 'text-gray-400',
    bgHex: '#ffffff',
    textHex: '#9ca3af',
    ratio: 2.85,
    passAA: false,
    passAALarge: false,
    passAAA: false,
    passAAALarge: false,
    apcaLc: -38.2,
    ...overrides
  };
}

function makeIgnored(overrides: Partial<IgnoredViolation> = {}): IgnoredViolation {
  return {
    ...makeViolation(),
    ignoreReason: 'cross-variant cva',
    ...overrides
  };
}

function makeSkipped(overrides: Partial<SkippedClass> = {}): SkippedClass {
  return {
    file: 'src/components/Card.tsx',
    line: 15,
    className: 'bg-$dynamic',
    reason: 'dynamic value',
    ...overrides
  };
}

type ThemedAuditResult = { mode: ThemeMode, result: AuditResult };

// ── Tests ────────────────────────────────────────────────────────────

describe('generateReport', () => {
  beforeEach(() => freezeDate());
  afterEach(() => unfreeze());

  // ── M13: Empty results ──────────────────────────────────────────

  test('empty results produce clean report with zero counts', () => {
    const input: ThemedAuditResult[] = [
      { mode: 'light', result: makeResult() },
      { mode: 'dark', result: makeResult() }
    ];
    const report = generateReport(input);

    expect(report).toContain('# A11y Contrast Audit Report');
    expect(report).toContain('Generated: 2026-01-15 12:00:00');
    expect(report).toContain('| **Violations (AA)** | **0** |');
    expect(report).toContain('| Color pairs checked | 200 |');
    expect(report).toContain('No text contrast violations found.');
    expect(report).toContain('No non-text contrast violations found.');
    // Should NOT contain skipped section when no skips
    expect(report).not.toContain('## Skipped Classes');
    // Should NOT contain ignored section when no ignores
    expect(report).not.toContain('## Ignored Violations');
  });

  // ── Text violations ─────────────────────────────────────────────

  test('text violations render in correct table format', () => {
    const violation = makeViolation();
    const input: ThemedAuditResult[] = [
      { mode: 'light', result: makeResult({ violations: [violation] }) },
      { mode: 'dark', result: makeResult() }
    ];
    const report = generateReport(input);

    // Summary counts
    expect(report).toContain('| **Violations (AA)** | **1** |');
    expect(report).toContain('| — Text contrast (SC 1.4.3) | 1 |');
    expect(report).toContain('| — Non-text contrast (SC 1.4.11) | 0 |');

    // File heading in light mode section
    expect(report).toContain('### `src/components/Button.tsx`');
    // Table header
    expect(report).toContain('| Line | State | Background | Foreground | Size | Ratio | AA | AAA | AA Large | APCA Lc |');
    // Violation row
    expect(report).toContain('| 42 | base |');
    expect(report).toContain('bg-white (#ffffff)');
    expect(report).toContain('text-gray-400 (#9ca3af)');
    expect(report).toContain('2.85:1');
    expect(report).toContain('**FAIL**');
  });

  // ── Non-text violations ─────────────────────────────────────────

  test('non-text violations render in separate SC 1.4.11 section', () => {
    const borderViolation = makeViolation({
      textClass: 'border-input',
      textHex: '#e5e5e5',
      pairType: 'border',
      ratio: 1.28
    });
    const input: ThemedAuditResult[] = [
      { mode: 'light', result: makeResult({ violations: [borderViolation] }) },
      { mode: 'dark', result: makeResult() }
    ];
    const report = generateReport(input);

    expect(report).toContain('| — Non-text contrast (SC 1.4.11) | 1 |');
    // Non-text table header
    expect(report).toContain('| Line | State | Type | Element | Against | Ratio | 3:1 |');
    expect(report).toContain('| 42 | base | border |');
  });

  // ── Interactive state violations ────────────────────────────────

  test('interactive state violations show state label', () => {
    const hoverViolation = makeViolation({
      interactiveState: 'hover',
      textClass: 'hover:text-gray-300'
    });
    const input: ThemedAuditResult[] = [
      { mode: 'light', result: makeResult({ violations: [hoverViolation] }) },
      { mode: 'dark', result: makeResult() }
    ];
    const report = generateReport(input);

    expect(report).toContain('| 42 | hover |');
    expect(report).toContain('| — Interactive states (hover/focus-visible) | 1 |');
  });

  // ── Large text label ────────────────────────────────────────────

  test('large text violations show LARGE in size column', () => {
    const largeViolation = makeViolation({ isLargeText: true });
    const input: ThemedAuditResult[] = [
      { mode: 'light', result: makeResult({ violations: [largeViolation] }) },
      { mode: 'dark', result: makeResult() }
    ];
    const report = generateReport(input);

    expect(report).toContain('| LARGE |');
  });

  // ── AAA informational row ───────────────────────────────────────

  test('AAA informational count includes both violations and passed that fail AAA', () => {
    // Violation: fails AA + AAA
    const violation = makeViolation({ passAAA: false });
    // Passed pair: passes AA but fails AAA
    const passedButFailsAAA: ContrastResult = {
      ...makeViolation({
        ratio: 5.2, passAA: true, passAALarge: true, passAAA: false, passAAALarge: true
      })
    };
    const input: ThemedAuditResult[] = [
      { mode: 'light', result: makeResult({ violations: [violation], passed: [passedButFailsAAA] }) },
      { mode: 'dark', result: makeResult() }
    ];
    const report = generateReport(input);

    expect(report).toContain('| Would fail AAA text (informational) | 2 |');
  });

  // ── APCA Lc column ─────────────────────────────────────────────

  test('APCA Lc shows dash when null', () => {
    const violation = makeViolation({ apcaLc: null });
    const input: ThemedAuditResult[] = [
      { mode: 'light', result: makeResult({ violations: [violation] }) },
      { mode: 'dark', result: makeResult() }
    ];
    const report = generateReport(input);

    expect(report).toContain('| — |');
  });

  // ── Ignored section ─────────────────────────────────────────────

  test('ignored violations render in dedicated section', () => {
    const ignored = makeIgnored();
    const input: ThemedAuditResult[] = [
      { mode: 'light', result: makeResult({ ignored: [ignored] }) },
      { mode: 'dark', result: makeResult() }
    ];
    const report = generateReport(input);

    expect(report).toContain('## Ignored Violations (`a11y-ignore`)');
    expect(report).toContain('| Line | Background | Foreground | Ratio | Reason |');
    expect(report).toContain('cross-variant cva');
  });

  // ── Skipped section ─────────────────────────────────────────────

  test('skipped classes render in table', () => {
    const skipped = makeSkipped();
    const input: ThemedAuditResult[] = [
      { mode: 'light', result: makeResult({ skipped: [skipped] }) },
      { mode: 'dark', result: makeResult() }
    ];
    const report = generateReport(input);

    expect(report).toContain('## Skipped Classes');
    expect(report).toContain('| src/components/Card.tsx | 15 | `bg-$dynamic` | dynamic value |');
  });

  // ── M14: Skipped truncation ─────────────────────────────────────

  test('truncates skipped list at 50 with count message', () => {
    const manySkipped = Array.from({ length: 60 }, (_, i) =>
      makeSkipped({ line: i + 1, className: `bg-dyn-${i}` }));
    const input: ThemedAuditResult[] = [
      { mode: 'light', result: makeResult({ skipped: manySkipped }) },
      { mode: 'dark', result: makeResult() }
    ];
    const report = generateReport(input);

    // Should show first 50
    expect(report).toContain('`bg-dyn-0`');
    expect(report).toContain('`bg-dyn-49`');
    // Should NOT show item 51+
    expect(report).not.toContain('`bg-dyn-50`');
    // Should show "10 more skipped"
    expect(report).toContain('10 more skipped');
  });

  // ── Skipped deduplication across themes ──────────────────────────

  test('deduplicates skipped entries across light and dark modes', () => {
    const skipped = makeSkipped();
    const input: ThemedAuditResult[] = [
      { mode: 'light', result: makeResult({ skipped: [skipped] }) },
      { mode: 'dark', result: makeResult({ skipped: [skipped] }) }
    ];
    const report = generateReport(input);

    // Should appear only once (deduplicated by file+line+class)
    const matches = report.match(/bg-\$dynamic/g);
    expect(matches).toHaveLength(1);
  });

  // ── M15: Markdown special characters ────────────────────────────

  test('handles pipe characters in class names (markdown table safety)', () => {
    const violation = makeViolation({
      textClass: 'text-[color:var(--c|fallback)]',
      textHex: '#333333'
    });
    const input: ThemedAuditResult[] = [
      { mode: 'light', result: makeResult({ violations: [violation] }) },
      { mode: 'dark', result: makeResult() }
    ];
    // Should not throw — markdown may render oddly but generation shouldn't fail
    const report = generateReport(input);
    expect(report).toContain('text-[color:var(--c|fallback)]');
  });

  // ── Annotated pairs footnote ──────────────────────────────────

  test('annotated violation shows dagger on bgClass and footnote at end', () => {
    const violation = makeViolation({
      bgClass: 'bg-card',
      bgHex: '#1e293b',
      contextSource: 'annotation',
    });

    const input: ThemedAuditResult[] = [
      { mode: 'light', result: makeResult({ violations: [violation] }) },
      { mode: 'dark', result: makeResult() },
    ];
    const report = generateReport(input);

    // bgClass should have dagger marker in the table row
    expect(report).toContain('bg-card†');
    // Footnote line at the end
    expect(report).toContain('† Context overridden via `@a11y-context` annotation');
  });

  test('non-annotated violations do not show dagger or footnote', () => {
    const violation = makeViolation(); // no contextSource
    const input: ThemedAuditResult[] = [
      { mode: 'light', result: makeResult({ violations: [violation] }) },
      { mode: 'dark', result: makeResult() },
    ];
    const report = generateReport(input);

    expect(report).not.toContain('†');
    expect(report).not.toContain('@a11y-context');
  });

  test('annotated non-text violation shows dagger on againstLabel', () => {
    const borderViolation = makeViolation({
      textClass: 'border-input',
      textHex: '#e5e5e5',
      bgClass: 'bg-popover',
      bgHex: '#1e293b',
      pairType: 'border',
      ratio: 1.28,
      contextSource: 'annotation',
    });

    const input: ThemedAuditResult[] = [
      { mode: 'light', result: makeResult({ violations: [borderViolation] }) },
      { mode: 'dark', result: makeResult() },
    ];
    const report = generateReport(input);

    expect(report).toContain('bg-popover†');
    expect(report).toContain('† Context overridden via `@a11y-context` annotation');
  });

  test('annotated ignored violation shows dagger', () => {
    const ignored = makeIgnored({
      bgClass: 'bg-sidebar',
      bgHex: '#1e293b',
      contextSource: 'annotation',
    });

    const input: ThemedAuditResult[] = [
      { mode: 'light', result: makeResult({ ignored: [ignored] }) },
      { mode: 'dark', result: makeResult() },
    ];
    const report = generateReport(input);

    expect(report).toContain('bg-sidebar†');
    expect(report).toContain('† Context overridden via `@a11y-context` annotation');
  });

  // ── Snapshot test ───────────────────────────────────────────────

  test('full report snapshot with mixed violations', () => {
    const textViolation = makeViolation();
    const borderViolation = makeViolation({
      file: 'src/components/Input.tsx',
      line: 20,
      textClass: 'border-input',
      textHex: '#e5e5e5',
      pairType: 'border',
      ratio: 1.28,
      passAA: false,
      passAALarge: false,
      passAAA: false,
      passAAALarge: false,
      apcaLc: -12.5
    });
    const hoverViolation = makeViolation({
      line: 55,
      interactiveState: 'hover',
      textClass: 'hover:text-gray-300',
      textHex: '#d1d5db',
      ratio: 1.46,
      apcaLc: -18.3
    });
    const ignored = makeIgnored({ file: 'src/components/Badge.tsx', line: 8 });
    const skipped = makeSkipped();
    const passed: ContrastResult = {
      ...makeViolation({
        textClass: 'text-gray-900',
        textHex: '#111827',
        ratio: 15.39,
        passAA: true,
        passAALarge: true,
        passAAA: true,
        passAAALarge: true,
        apcaLc: -97.6
      })
    };

    const input: ThemedAuditResult[] = [
      {
        mode: 'light',
        result: makeResult({
          violations: [textViolation, borderViolation, hoverViolation],
          passed: [passed],
          ignored: [ignored],
          skipped: [skipped]
        })
      },
      {
        mode: 'dark',
        result: makeResult({
          violations: [makeViolation({ file: 'src/pages/Home.tsx', line: 100 })]
        })
      }
    ];
    const report = generateReport(input);

    expect(report).toMatchSnapshot();
  });
});
