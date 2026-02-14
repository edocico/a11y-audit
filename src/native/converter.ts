import type { ClassRegion, ContextOverride } from '../core/types.js';
import type { NativeClassRegion, NativePreExtractedFile } from './index.js';
import type { PreExtracted } from '../plugins/jsx/region-resolver.js';
import type { FileRegions, SkippedClass } from '../core/types.js';

/**
 * Convert a single Rust NativeClassRegion (flat structure) to a TS ClassRegion
 * (nested contextOverride + inlineStyles).
 */
function convertNativeRegion(native: NativeClassRegion): ClassRegion {
    const region: ClassRegion = {
        content: native.content,
        startLine: native.startLine,
        contextBg: native.contextBg,
    };

    // Reconstruct nested inlineStyles from flat fields
    if (native.inlineColor || native.inlineBackgroundColor) {
        region.inlineStyles = {};
        if (native.inlineColor) {
            region.inlineStyles.color = native.inlineColor;
        }
        if (native.inlineBackgroundColor) {
            region.inlineStyles.backgroundColor = native.inlineBackgroundColor;
        }
    }

    // Reconstruct nested contextOverride from flat fields
    if (native.contextOverrideBg || native.contextOverrideFg || native.contextOverrideNoInherit) {
        const override: ContextOverride = {};
        if (native.contextOverrideBg) {
            override.bg = native.contextOverrideBg;
        }
        if (native.contextOverrideFg) {
            override.fg = native.contextOverrideFg;
        }
        if (native.contextOverrideNoInherit) {
            override.noInherit = true;
        }
        region.contextOverride = override;
    }

    // US-05: Bridge effective opacity
    if (native.effectiveOpacity != null) {
        region.effectiveOpacity = native.effectiveOpacity;
    }

    return region;
}

/**
 * Convert native extraction results to the TS PreExtracted format.
 *
 * Requires the source line arrays (for resolveFileRegions' getIgnoreReasonForLine).
 * The Rust parser pre-computes ignored/ignoreReason, but the TS resolver re-derives
 * them from source lines for consistency with the existing pipeline.
 */
export function convertNativeResult(
    nativeFiles: NativePreExtractedFile[],
    sourceLines: Map<string, string[]>,
    readErrors: SkippedClass[],
    filesScanned: number,
): PreExtracted {
    const files: FileRegions[] = [];

    for (const nativeFile of nativeFiles) {
        const lines = sourceLines.get(nativeFile.path) ?? [];
        const regions = nativeFile.regions.map(convertNativeRegion);
        files.push({ relPath: nativeFile.path, lines, regions });
    }

    return { files, readErrors, filesScanned };
}
