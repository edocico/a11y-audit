import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { BaselineData, ContrastResult } from '../types.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadBaseline, saveBaseline } from '../baseline.js';

function makeViolation(overrides: Partial<ContrastResult> = {}): ContrastResult {
  return {
    file: 'src/components/Button.tsx',
    line: 10,
    bgClass: 'bg-white',
    textClass: 'text-gray-500',
    bgHex: '#ffffff',
    textHex: '#6b7280',
    ratio: 3.8,
    passAA: false,
    passAALarge: true,
    passAAA: false,
    passAAALarge: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadBaseline', () => {
  test('returns null when file does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(loadBaseline('/path/.a11y-baseline.json')).toBeNull();
  });

  test('returns parsed BaselineData for valid file', () => {
    const data: BaselineData = {
      version: '1.1.0',
      generatedAt: '2026-02-14T00:00:00.000Z',
      violations: { 'src/Button.tsx': { abc123: 2 } },
    };
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(data));
    expect(loadBaseline('/path/.a11y-baseline.json')).toEqual(data);
  });

  test('returns null for invalid JSON', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('not json');
    expect(loadBaseline('/path/.a11y-baseline.json')).toBeNull();
  });

  test('returns null for JSON missing violations field', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: '1.0' }));
    expect(loadBaseline('/path/.a11y-baseline.json')).toBeNull();
  });
});

describe('saveBaseline', () => {
  test('writes JSON grouped by file with sorted file keys', () => {
    const violations = [
      makeViolation({ file: 'src/Z.tsx' }),
      makeViolation({ file: 'src/A.tsx' }),
      makeViolation({ file: 'src/Z.tsx' }),
    ];
    saveBaseline('/path/.a11y-baseline.json', violations);

    expect(writeFileSync).toHaveBeenCalledOnce();
    const content = vi.mocked(writeFileSync).mock.calls[0]![1] as string;
    const parsed = JSON.parse(content) as BaselineData;
    expect(parsed.version).toBe('1.1.0');
    expect(Object.keys(parsed.violations)).toEqual(['src/A.tsx', 'src/Z.tsx']);
  });

  test('counts duplicate hashes correctly', () => {
    const v = makeViolation();
    saveBaseline('/path/.a11y-baseline.json', [v, v]);

    const content = vi.mocked(writeFileSync).mock.calls[0]![1] as string;
    const parsed = JSON.parse(content) as BaselineData;
    const fileCounts = parsed.violations['src/components/Button.tsx']!;
    const count = Object.values(fileCounts)[0];
    expect(count).toBe(2);
  });
});
