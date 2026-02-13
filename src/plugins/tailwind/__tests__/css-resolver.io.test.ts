import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn()
}));

import { buildThemeColorMaps } from '../css-resolver.js';

// ── Fixtures ─────────────────────────────────────────────────────────────

/** Minimal Tailwind palette with known hex values */
const FIXTURE_TAILWIND_CSS = `
--color-sky-700: #0369a1;
--color-sky-300: #7dd3fc;
--color-slate-500: #64748b;
--color-white: #ffffff;
--color-black: #000000;
`;

/** Theme CSS: semantic tokens pointing to CSS variables */
const FIXTURE_THEME_CSS = `
@theme inline {
  --color-primary: var(--primary);
  --color-secondary: var(--secondary);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
}
`;

/** Main CSS: :root (light) and .dark variable blocks */
const FIXTURE_MAIN_CSS = `
:root {
  --primary: var(--color-sky-700);
  --secondary: var(--color-slate-500);
  --background: #ffffff;
  --foreground: #0a0a0a;
}
.dark {
  --primary: var(--color-sky-300);
  --background: #09090b;
  --foreground: #fafafa;
}
`;

/** Path-discriminating mock: returns correct CSS for each file */
function setupReadMock(mainCssOverride?: string) {
  vi.mocked(readFileSync).mockImplementation((path: unknown) => {
    const p = String(path);
    if (p === '/mock/palette/theme.css') return FIXTURE_TAILWIND_CSS;
    if (p === '/mock/css/theme.css') return FIXTURE_THEME_CSS;
    if (p === '/mock/css/main.css') return mainCssOverride ?? FIXTURE_MAIN_CSS;
    throw new Error(`Unexpected readFileSync path: ${p}`);
  });
}

const OPTIONS = {
  palettePath: '/mock/palette/theme.css',
  cssPaths: ['/mock/css/theme.css', '/mock/css/main.css']
};

// ── Tests ────────────────────────────────────────────────────────────────

describe('buildThemeColorMaps (mocked I/O)', () => {
  beforeEach(() => {
    setupReadMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('reads palette + all CSS files', () => {
    buildThemeColorMaps(OPTIONS);
    // 1 palette + 2 CSS files = 3 reads
    expect(readFileSync).toHaveBeenCalledTimes(3);
    expect(readFileSync).toHaveBeenCalledWith('/mock/palette/theme.css', 'utf-8');
    expect(readFileSync).toHaveBeenCalledWith('/mock/css/theme.css', 'utf-8');
    expect(readFileSync).toHaveBeenCalledWith('/mock/css/main.css', 'utf-8');
  });

  test('resolves light theme colors through var() chains', () => {
    const { light } = buildThemeColorMaps(OPTIONS);
    // --color-primary → var(--primary) → var(--color-sky-700) → #0369a1
    expect(light.get('--color-primary')).toEqual({ hex: '#0369a1' });
    // --color-secondary → var(--secondary) → var(--color-slate-500) → #64748b
    expect(light.get('--color-secondary')).toEqual({ hex: '#64748b' });
    // --color-background → var(--background) → #ffffff
    expect(light.get('--color-background')).toEqual({ hex: '#ffffff' });
    // --color-foreground → var(--foreground) → #0a0a0a
    expect(light.get('--color-foreground')).toEqual({ hex: '#0a0a0a' });
  });

  test('resolves dark theme with overridden values', () => {
    const { dark } = buildThemeColorMaps(OPTIONS);
    expect(dark.get('--color-primary')).toEqual({ hex: '#7dd3fc' });
    expect(dark.get('--color-background')).toEqual({ hex: '#09090b' });
    expect(dark.get('--color-foreground')).toEqual({ hex: '#fafafa' });
  });

  test('M7: dark inherits light values for vars not overridden', () => {
    const { light, dark } = buildThemeColorMaps(OPTIONS);
    expect(dark.get('--color-secondary')).toEqual(light.get('--color-secondary'));
    expect(dark.get('--color-secondary')).toEqual({ hex: '#64748b' });
  });

  test('includes raw Tailwind palette colors in both themes', () => {
    const { light, dark } = buildThemeColorMaps(OPTIONS);
    expect(light.get('--color-sky-700')).toEqual({ hex: '#0369a1' });
    expect(light.get('--color-white')).toEqual({ hex: '#ffffff' });
    expect(dark.get('--color-sky-700')).toEqual({ hex: '#0369a1' });
  });

  test('returns default rootFontSizePx (16) when no font-size in CSS', () => {
    const { rootFontSizePx } = buildThemeColorMaps(OPTIONS);
    expect(rootFontSizePx).toBe(16);
  });

  test('extracts custom rootFontSizePx from CSS', () => {
    setupReadMock(`html { font-size: 14px; }\n${FIXTURE_MAIN_CSS}`);
    const { rootFontSizePx } = buildThemeColorMaps(OPTIONS);
    expect(rootFontSizePx).toBe(14);
  });
});
