import { describe, it, expect } from 'vitest';
import { isNativeAvailable, getNativeModule } from '../index.js';

// These tests require the native module to be built first:
//   npm run build:native
// If the module is not available, tests are skipped gracefully.

const skipIfNoNative = () => {
    if (!isNativeAvailable()) {
        console.warn('Skipping native bridge tests — module not built');
        return true;
    }
    return false;
};

describe('native bridge', () => {
    it('health check returns expected string', () => {
        if (skipIfNoNative()) return;
        expect(getNativeModule().healthCheck()).toBe('a11y-audit-native ok');
    });

    it('extractAndScan returns regions for simple JSX', () => {
        if (skipIfNoNative()) return;
        const result = getNativeModule().extractAndScan({
            fileContents: [
                {
                    path: 'test.tsx',
                    content: '<div className="bg-red-500 text-white">x</div>',
                },
            ],
            containerConfig: [],
            portalConfig: [],
            defaultBg: 'bg-background',
        });
        expect(result).toHaveLength(1);
        expect(result[0]!.regions).toHaveLength(1);
        expect(result[0]!.regions[0]!.content).toBe('bg-red-500 text-white');
        expect(result[0]!.regions[0]!.contextBg).toBe('bg-background');
    });

    it('extractAndScan handles container config', () => {
        if (skipIfNoNative()) return;
        const result = getNativeModule().extractAndScan({
            fileContents: [
                {
                    path: 'card.tsx',
                    content:
                        '<Card><span className="text-white">x</span></Card>',
                },
            ],
            containerConfig: [{ component: 'Card', bgClass: 'bg-card' }],
            portalConfig: [],
            defaultBg: 'bg-background',
        });
        expect(result[0]!.regions[0]!.contextBg).toBe('bg-card');
    });

    it('extractAndScan handles multiple files', () => {
        if (skipIfNoNative()) return;
        const result = getNativeModule().extractAndScan({
            fileContents: [
                {
                    path: 'a.tsx',
                    content: '<div className="text-white">a</div>',
                },
                {
                    path: 'b.tsx',
                    content: '<div className="text-black">b</div>',
                },
            ],
            containerConfig: [],
            portalConfig: [],
            defaultBg: 'bg-background',
        });
        expect(result).toHaveLength(2);
    });

    it('extractAndScan detects annotations', () => {
        if (skipIfNoNative()) return;
        const result = getNativeModule().extractAndScan({
            fileContents: [
                {
                    path: 'annotated.tsx',
                    content:
                        '// @a11y-context bg:#09090b\n<div className="text-white">x</div>',
                },
            ],
            containerConfig: [],
            portalConfig: [],
            defaultBg: 'bg-background',
        });
        expect(result[0]!.regions[0]!.contextOverrideBg).toBe('#09090b');
    });

    it('extractAndScan detects disabled elements', () => {
        if (skipIfNoNative()) return;
        const result = getNativeModule().extractAndScan({
            fileContents: [
                {
                    path: 'disabled.tsx',
                    content:
                        '<button disabled className="text-gray-400">x</button>',
                },
            ],
            containerConfig: [],
            portalConfig: [],
            defaultBg: 'bg-background',
        });
        expect(result[0]!.regions[0]!.ignored).toBe(true);
    });

    it('checkContrastPairs categorizes violations', () => {
        if (skipIfNoNative()) return;
        const result = getNativeModule().checkContrastPairs(
            [
                {
                    file: 'test.tsx',
                    line: 1,
                    bgClass: 'bg-white',
                    textClass: 'text-black',
                    bgHex: '#ffffff',
                    textHex: '#000000',
                },
                {
                    file: 'test.tsx',
                    line: 2,
                    bgClass: 'bg-white',
                    textClass: 'text-gray',
                    bgHex: '#ffffff',
                    textHex: '#cccccc',
                },
            ],
            'AA',
            '#ffffff',
        );
        expect(result.passed).toHaveLength(1);
        expect(result.violations).toHaveLength(1);
        expect(result.passed[0]!.ratio).toBeCloseTo(21.0, 0);
    });

    it('checkContrastPairs skips missing hex', () => {
        if (skipIfNoNative()) return;
        const result = getNativeModule().checkContrastPairs(
            [
                {
                    file: 'test.tsx',
                    line: 1,
                    bgClass: 'bg-unknown',
                    textClass: 'text-unknown',
                },
            ],
            'AA',
            '#ffffff',
        );
        expect(result.skippedCount).toBe(1);
    });

    it('getNativeModule throws when not available', () => {
        // This test only works when native IS available (to verify the
        // function signature). The throw path is tested implicitly by
        // the `skipIfNoNative` guard in other tests.
        if (!isNativeAvailable()) {
            expect(() => getNativeModule()).toThrow('Native module not available');
        }
    });
});
