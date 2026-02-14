import { describe, it, expect } from 'vitest';
import { isNativeAvailable, getNativeModule } from '../../native/index.js';
import { convertNativeResult } from '../../native/converter.js';

// These tests verify the native extraction path produces compatible output
// for the downstream resolveFileRegions() pipeline.

const skipIfNoNative = () => {
    if (!isNativeAvailable()) {
        console.warn('Skipping native pipeline tests — module not built');
        return true;
    }
    return false;
};

describe('native pipeline integration', () => {
    describe('convertNativeResult', () => {
        it('converts flat NativeClassRegion to nested ClassRegion', () => {
            if (skipIfNoNative()) return;

            const nativeResult = getNativeModule().extractAndScan({
                fileContents: [
                    {
                        path: 'test.tsx',
                        content:
                            '// @a11y-context bg:#09090b fg:text-white\n<div className="text-muted">x</div>',
                    },
                ],
                containerConfig: [],
                defaultBg: 'bg-background',
            });

            const sourceLines = new Map<string, string[]>();
            sourceLines.set(
                'test.tsx',
                '// @a11y-context bg:#09090b fg:text-white\n<div className="text-muted">x</div>'.split(
                    '\n',
                ),
            );

            const result = convertNativeResult(
                nativeResult,
                sourceLines,
                [],
                1,
            );

            expect(result.filesScanned).toBe(1);
            expect(result.files).toHaveLength(1);

            const region = result.files[0]!.regions[0]!;
            expect(region.content).toBe('text-muted');
            expect(region.contextBg).toBe('bg-background');
            // contextOverride should be nested
            expect(region.contextOverride).toBeDefined();
            expect(region.contextOverride!.bg).toBe('#09090b');
            expect(region.contextOverride!.fg).toBe('text-white');
        });

        it('converts inline styles from flat to nested', () => {
            if (skipIfNoNative()) return;

            const nativeResult = getNativeModule().extractAndScan({
                fileContents: [
                    {
                        path: 'inline.tsx',
                        content:
                            '<div style={{ color: "red", backgroundColor: "#00ff00" }} className="text-white">x</div>',
                    },
                ],
                containerConfig: [],
                defaultBg: 'bg-background',
            });

            const sourceLines = new Map([
                [
                    'inline.tsx',
                    [
                        '<div style={{ color: "red", backgroundColor: "#00ff00" }} className="text-white">x</div>',
                    ],
                ],
            ]);

            const result = convertNativeResult(
                nativeResult,
                sourceLines,
                [],
                1,
            );

            const region = result.files[0]!.regions[0]!;
            expect(region.inlineStyles).toBeDefined();
            expect(region.inlineStyles!.color).toBe('red');
            expect(region.inlineStyles!.backgroundColor).toBe('#00ff00');
        });

        it('handles no-inherit annotation', () => {
            if (skipIfNoNative()) return;

            const nativeResult = getNativeModule().extractAndScan({
                fileContents: [
                    {
                        path: 'noinherit.tsx',
                        content:
                            '// @a11y-context bg:#fff no-inherit\n<div className="text-black">x</div>',
                    },
                ],
                containerConfig: [],
                defaultBg: 'bg-background',
            });

            const sourceLines = new Map([
                [
                    'noinherit.tsx',
                    [
                        '// @a11y-context bg:#fff no-inherit',
                        '<div className="text-black">x</div>',
                    ],
                ],
            ]);

            const result = convertNativeResult(
                nativeResult,
                sourceLines,
                [],
                1,
            );

            const region = result.files[0]!.regions[0]!;
            expect(region.contextOverride?.noInherit).toBe(true);
        });

        it('preserves source lines for getIgnoreReasonForLine', () => {
            if (skipIfNoNative()) return;

            const sourceLines = new Map([
                ['file.tsx', ['line 0', '// a11y-ignore: test reason', '<div className="text-gray">x</div>']],
            ]);

            const nativeResult = getNativeModule().extractAndScan({
                fileContents: [
                    {
                        path: 'file.tsx',
                        content: 'line 0\n// a11y-ignore: test reason\n<div className="text-gray">x</div>',
                    },
                ],
                containerConfig: [],
                defaultBg: 'bg-background',
            });

            const result = convertNativeResult(
                nativeResult,
                sourceLines,
                [],
                1,
            );

            expect(result.files[0]!.lines).toHaveLength(3);
            expect(result.files[0]!.lines[1]).toBe('// a11y-ignore: test reason');
        });

        it('passes through read errors', () => {
            const readErrors = [
                {
                    file: 'broken.tsx',
                    line: 0,
                    className: '(file)',
                    reason: 'File read error: ENOENT',
                },
            ];

            const result = convertNativeResult([], new Map(), readErrors, 1);
            expect(result.readErrors).toHaveLength(1);
            expect(result.readErrors[0]!.file).toBe('broken.tsx');
        });

        it('handles container config propagation', () => {
            if (skipIfNoNative()) return;

            const nativeResult = getNativeModule().extractAndScan({
                fileContents: [
                    {
                        path: 'card.tsx',
                        content:
                            '<Card><span className="text-white">x</span></Card>',
                    },
                ],
                containerConfig: [{ component: 'Card', bgClass: 'bg-card' }],
                defaultBg: 'bg-background',
            });

            const sourceLines = new Map([
                [
                    'card.tsx',
                    ['<Card><span className="text-white">x</span></Card>'],
                ],
            ]);

            const result = convertNativeResult(
                nativeResult,
                sourceLines,
                [],
                1,
            );

            expect(result.files[0]!.regions[0]!.contextBg).toBe('bg-card');
        });
    });
});
