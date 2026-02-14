import type { ContrastResult } from '../core/types.js';

/** ClassRegion as returned by the Rust parser (flattened vs TS nested structure) */
export interface NativeClassRegion {
    content: string;
    startLine: number;
    contextBg: string;
    inlineColor?: string | null;
    inlineBackgroundColor?: string | null;
    contextOverrideBg?: string | null;
    contextOverrideFg?: string | null;
    contextOverrideNoInherit?: boolean | null;
    ignored?: boolean | null;
    ignoreReason?: string | null;
    effectiveOpacity?: number | null;
}

export interface NativePreExtractedFile {
    path: string;
    regions: NativeClassRegion[];
}

export interface NativeCheckResult {
    violations: ContrastResult[];
    passed: ContrastResult[];
    ignored: ContrastResult[];
    ignoredCount: number;
    skippedCount: number;
}

interface NativeModule {
    healthCheck(): string;
    extractAndScan(options: {
        fileContents: Array<{ path: string; content: string }>;
        containerConfig: Array<{ component: string; bgClass: string }>;
        portalConfig: Array<{ component: string; bgClass: string }>;
        defaultBg: string;
    }): NativePreExtractedFile[];
    checkContrastPairs(
        pairs: Array<{
            file: string;
            line: number;
            bgClass: string;
            textClass: string;
            bgHex?: string | null;
            textHex?: string | null;
            bgAlpha?: number | null;
            textAlpha?: number | null;
            isLargeText?: boolean | null;
            pairType?: string | null;
            interactiveState?: string | null;
            ignored?: boolean | null;
            ignoreReason?: string | null;
            contextSource?: string | null;
            effectiveOpacity?: number | null;
            isDisabled?: boolean | null;
            unresolvedCurrentColor?: boolean | null;
        }>,
        threshold: string,
        pageBg: string,
    ): NativeCheckResult;
}

let nativeModule: NativeModule | null = null;

try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nativeModule = require('../../native/a11y-audit-native.node') as NativeModule;
} catch {
    // Native module not available — legacy fallback
}

export function isNativeAvailable(): boolean {
    return nativeModule !== null;
}

export function getNativeModule(): NativeModule {
    if (!nativeModule) {
        throw new Error(
            'Native module not available. Build with `npm run build:native` or run in legacy mode.',
        );
    }
    return nativeModule;
}
