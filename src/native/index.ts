let nativeModule: NativeModule | null = null;

interface NativeModule {
    healthCheck(): string;
}

try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nativeModule = require('../../native/a11y-audit-native.node') as NativeModule;
} catch {
    // Native module not available — legacy fallback
}

export function isNativeAvailable(): boolean {
    return nativeModule !== null;
}

export function getNativeModule(): NativeModule | null {
    return nativeModule;
}
