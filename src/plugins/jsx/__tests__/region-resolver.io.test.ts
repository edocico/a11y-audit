import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('glob', () => ({
  globSync: vi.fn(),
}));

import { readFileSync } from 'node:fs';
import { globSync } from 'glob';
import { extractAllFileRegions } from '../region-resolver.js';

// ── Fixtures ─────────────────────────────────────────────────────────────

const ROOT = '/mock/project';
const SRC = resolve(ROOT, 'src');

const CONTAINER_MAP = new Map<string, string>([['Card', 'bg-card']]);
const DEFAULT_BG = 'bg-background';

const FIXTURE_BUTTON = `export function Button() {
  return <button className="bg-primary text-white hover:bg-primary/90">Click</button>
}`;

const FIXTURE_CARD = `import { Card } from '@/components/ui/card';
export function UserCard() {
  return (
    <Card>
      <p className="text-muted-foreground text-sm">Name</p>
    </Card>
  )
}`;

// ── Tests ────────────────────────────────────────────────────────────────

describe('extractAllFileRegions (mocked I/O)', () => {
  const buttonPath = resolve(SRC, 'components/Button.tsx');
  const cardPath = resolve(SRC, 'components/UserCard.tsx');
  const brokenPath = resolve(SRC, 'components/Broken.tsx');

  beforeEach(() => {
    vi.mocked(globSync).mockReturnValue([buttonPath, cardPath, brokenPath]);
    vi.mocked(readFileSync).mockImplementation((path: unknown) => {
      const p = String(path);
      if (p === buttonPath) return FIXTURE_BUTTON;
      if (p === cardPath) return FIXTURE_CARD;
      if (p === brokenPath) throw new Error('ENOENT: no such file or directory');
      throw new Error(`Unexpected readFileSync path: ${p}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('calls globSync with correct pattern and cwd', () => {
    extractAllFileRegions(['src/**/*.tsx'], ROOT, CONTAINER_MAP, DEFAULT_BG);
    expect(globSync).toHaveBeenCalledWith('src/**/*.tsx', {
      cwd: ROOT,
      absolute: true,
    });
  });

  test('returns correct filesScanned count', () => {
    const result = extractAllFileRegions(['src/**/*.tsx'], ROOT, CONTAINER_MAP, DEFAULT_BG);
    expect(result.filesScanned).toBe(3);
  });

  test('reads each file found by glob', () => {
    extractAllFileRegions(['src/**/*.tsx'], ROOT, CONTAINER_MAP, DEFAULT_BG);
    expect(readFileSync).toHaveBeenCalledWith(buttonPath, 'utf-8');
    expect(readFileSync).toHaveBeenCalledWith(cardPath, 'utf-8');
    expect(readFileSync).toHaveBeenCalledWith(brokenPath, 'utf-8');
  });

  test('extracts regions from readable files', () => {
    const result = extractAllFileRegions(['src/**/*.tsx'], ROOT, CONTAINER_MAP, DEFAULT_BG);
    // 2 readable files (Button + Card), Broken is skipped
    expect(result.files.length).toBe(2);

    const buttonFile = result.files.find((f) => f.relPath.includes('Button.tsx'));
    expect(buttonFile).toBeDefined();
    expect(buttonFile!.regions.length).toBeGreaterThan(0);

    const cardFile = result.files.find((f) => f.relPath.includes('UserCard.tsx'));
    expect(cardFile).toBeDefined();
    expect(cardFile!.regions.length).toBeGreaterThan(0);
  });

  test('preserves file lines for downstream resolution', () => {
    const result = extractAllFileRegions(['src/**/*.tsx'], ROOT, CONTAINER_MAP, DEFAULT_BG);
    const buttonFile = result.files.find((f) => f.relPath.includes('Button.tsx'));
    expect(buttonFile!.lines).toEqual(FIXTURE_BUTTON.split('\n'));
  });

  test('collects read errors for unreadable files (C4 hardening)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = extractAllFileRegions(['src/**/*.tsx'], ROOT, CONTAINER_MAP, DEFAULT_BG);

    expect(result.readErrors.length).toBe(1);
    expect(result.readErrors[0]!.reason).toContain('File read error');
    expect(result.readErrors[0]!.reason).toContain('ENOENT');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Skipping'));
    warn.mockRestore();
  });

  test('stores relative paths in FileRegions', () => {
    const result = extractAllFileRegions(['src/**/*.tsx'], ROOT, CONTAINER_MAP, DEFAULT_BG);
    for (const file of result.files) {
      expect(file.relPath).toContain('src/components/');
      expect(file.relPath).toContain('.tsx');
    }
  });

  test('handles zero files from glob', () => {
    vi.mocked(globSync).mockReturnValue([]);
    const result = extractAllFileRegions(['src/**/*.tsx'], ROOT, CONTAINER_MAP, DEFAULT_BG);
    expect(result.files.length).toBe(0);
    expect(result.readErrors.length).toBe(0);
    expect(result.filesScanned).toBe(0);
  });

  test('extracts className content from Button fixture', () => {
    const result = extractAllFileRegions(['src/**/*.tsx'], ROOT, CONTAINER_MAP, DEFAULT_BG);
    const buttonFile = result.files.find((f) => f.relPath.includes('Button.tsx'));
    const region = buttonFile!.regions[0]!;
    expect(region.content).toContain('bg-primary');
    expect(region.content).toContain('text-white');
  });

  test('detects Card container context for nested elements', () => {
    const result = extractAllFileRegions(['src/**/*.tsx'], ROOT, CONTAINER_MAP, DEFAULT_BG);
    const cardFile = result.files.find((f) => f.relPath.includes('UserCard.tsx'));
    const pRegion = cardFile!.regions.find((r) => r.content.includes('text-muted-foreground'));
    expect(pRegion).toBeDefined();
    expect(pRegion!.contextBg).toBe('bg-card');
  });
});
