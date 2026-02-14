import { readFileSync } from 'node:fs';
import { globSync } from 'glob';
import { relative } from 'node:path';
import { resolveClassToHex } from '../tailwind/css-resolver.js';
import { extractClassRegions } from './parser.js';
import {
  categorizeClasses,
  determineIsLargeText,
  extractStringLiterals,
  getIgnoreReasonForLine,
} from './categorizer.js';
import type { TaggedClass, ForegroundGroup, PairMeta } from './categorizer.js';
import type {
  ColorMap,
  ColorPair,
  FileRegions,
  SkippedClass,
  ThemeMode,
} from '../../core/types.js';

/** @internal Exported for unit testing */
export interface PreExtracted {
  files: FileRegions[];
  readErrors: SkippedClass[];
  filesScanned: number;
}

/**
 * Resolves the effective background classes for a region:
 * 1. Uses explicit bg classes if present, otherwise falls back to contextBg
 * 2. Inline backgroundColor (hex literal) overrides everything
 * @internal Exported for unit testing
 */
export function buildEffectiveBg(
  bgClasses: TaggedClass[],
  contextBg: string,
  inlineStyles?: { backgroundColor?: string },
): TaggedClass[] {
  let effective: TaggedClass[] =
    bgClasses.length > 0
      ? bgClasses
      : [
          {
            raw: contextBg,
            isDark: false,
            isInteractive: false,
            interactiveState: null,
            base: contextBg,
          },
        ];

  if (inlineStyles?.backgroundColor) {
    const hex = inlineStyles.backgroundColor;
    if (hex.startsWith('#') && hex.length >= 4) {
      effective = [
        {
          raw: `(inline) ${hex}`,
          isDark: false,
          isInteractive: false,
          interactiveState: null,
          base: `bg-[${hex}]`,
        },
      ];
    }
  }

  return effective;
}

/**
 * Generates color pairs from foreground groups against background classes.
 * Unified function for text (SC 1.4.3), non-text (SC 1.4.11), and interactive states.
 *
 * Skip behavior:
 * - Interactive pairs: all unresolvable classes skipped silently (base already reported them)
 * - Base text: unresolvable explicit bg -> skip with reason; unresolvable implicit bg -> pair with null bgHex
 * - Base non-text: unresolvable bg -> silent skip; unresolvable fg -> skip with reason
 * @internal Exported for unit testing
 */
export function generatePairs(
  fgGroups: ForegroundGroup[],
  effectiveBgClasses: TaggedClass[],
  meta: PairMeta,
  colorMap: ColorMap,
  hasExplicitBg: boolean,
  contextBg: string,
): { pairs: ColorPair[]; skipped: SkippedClass[] } {
  const pairs: ColorPair[] = [];
  const skipped: SkippedClass[] = [];
  const isInteractive = meta.interactiveState != null;

  for (const { classes: fgClasses, pairType } of fgGroups) {
    if (fgClasses.length === 0) continue;

    const isText = pairType == null;

    for (const bgTagged of effectiveBgClasses) {
      const bgResolved = resolveClassToHex(bgTagged.base, colorMap);

      if (!bgResolved) {
        // Base text + explicit bg: report skip
        if (!isInteractive && isText && hasExplicitBg) {
          skipped.push({
            file: meta.file,
            line: meta.line,
            className: bgTagged.raw,
            reason: `Unresolvable background: ${bgTagged.raw}`,
          });
        }
        // Only base text + implicit bg falls through to create pair with null bgHex
        if (isInteractive || !isText || hasExplicitBg) {
          continue;
        }
      }

      for (const fgTagged of fgClasses) {
        const fgResolved = resolveClassToHex(fgTagged.base, colorMap);

        if (!fgResolved) {
          if (!isInteractive) {
            skipped.push({
              file: meta.file,
              line: meta.line,
              className: fgTagged.raw,
              reason: `Unresolvable ${pairType ?? 'text'} color: ${fgTagged.raw}`,
            });
          }
          continue;
        }

        const pair: ColorPair = {
          file: meta.file,
          line: meta.line,
          bgClass: isInteractive || hasExplicitBg ? bgTagged.raw : `(implicit) ${contextBg}`,
          textClass: fgTagged.raw,
          bgHex: bgResolved?.hex ?? null,
          textHex: fgResolved.hex,
          bgAlpha: bgResolved?.alpha,
          textAlpha: fgResolved.alpha,
          ignored: meta.ignoreReason !== null,
          ignoreReason: meta.ignoreReason ?? undefined,
        };

        if (isText) {
          pair.isLargeText = meta.isLargeText;
        } else {
          pair.pairType = pairType;
        }

        if (meta.interactiveState != null) {
          pair.interactiveState = meta.interactiveState;
        }

        // US-05: Apply effective opacity as alpha reduction
        if (meta.effectiveOpacity != null && meta.effectiveOpacity < 1) {
          pair.effectiveOpacity = meta.effectiveOpacity;
          pair.textAlpha = (pair.textAlpha ?? 1) * meta.effectiveOpacity;
          pair.bgAlpha = (pair.bgAlpha ?? 1) * meta.effectiveOpacity;
        }

        pairs.push(pair);
      }
    }
  }

  return { pairs, skipped };
}

/**
 * Resolves pre-extracted file regions against a color map for a specific theme.
 * Separated from file I/O — receives pre-extracted regions from extractAllFileRegions().
 * This eliminates double file reads when auditing both light and dark themes.
 */
export function resolveFileRegions(
  preExtracted: PreExtracted,
  colorMap: ColorMap,
  themeMode: ThemeMode = 'light',
): { pairs: ColorPair[]; skipped: SkippedClass[]; filesScanned: number } {
  const allPairs: ColorPair[] = [];
  const allSkipped: SkippedClass[] = [];

  allSkipped.push(...preExtracted.readErrors);

  for (const file of preExtracted.files) {
    const { relPath, lines, regions } = file;

    for (const region of regions) {
      const lineNum = region.startLine;
      const ignoreReason = getIgnoreReasonForLine(lines, lineNum);

      // Extract classes: quoted content is from cn()/clsx(); otherwise static className
      const hasQuotes =
        region.content.includes("'") ||
        region.content.includes('"') ||
        region.content.includes('`');
      const allClasses = hasQuotes
        ? extractStringLiterals(region.content)
        : region.content.split(/\s+/).filter(Boolean);

      const categorized = categorizeClasses(allClasses, themeMode);
      const isLargeText = determineIsLargeText(categorized.fontSize, categorized.isBold);

      for (const dc of categorized.dynamicClasses) {
        allSkipped.push({
          file: relPath,
          line: lineNum,
          className: dc,
          reason: 'Dynamic class (template expression)',
        });
      }

      // Resolve effective background (context fallback + inline override + annotation)
      const hasAnnotation = region.contextOverride != null;
      const contextBg = region.contextOverride?.bg?.startsWith('#')
        ? region.contextBg // hex override goes through inlineStyles path
        : (region.contextOverride?.bg || region.contextBg);

      // Build inline styles, merging annotation hex bg if present
      const inlineStyles = region.contextOverride?.bg?.startsWith('#')
        ? { ...region.inlineStyles, backgroundColor: region.contextOverride.bg }
        : region.inlineStyles;

      const effectiveBg = buildEffectiveBg(
        categorized.bgClasses,
        contextBg,
        inlineStyles,
      );
      const hasExplicitBg = categorized.bgClasses.length > 0;

      // Inline text color: add synthetic text class
      const textClasses = [...categorized.textClasses];
      if (region.inlineStyles?.color) {
        const hex = region.inlineStyles.color;
        if (hex.startsWith('#') && hex.length >= 4) {
          textClasses.push({
            raw: `(inline) ${hex}`,
            isDark: false,
            isInteractive: false,
            interactiveState: null,
            base: `text-[${hex}]`,
          });
        }
      }

      // fg override from @a11y-context annotation
      if (region.contextOverride?.fg) {
        const fgOverride = region.contextOverride.fg;
        const isHex = fgOverride.startsWith('#') && fgOverride.length >= 4;
        textClasses.length = 0;
        textClasses.push({
          raw: `(@a11y-context) ${fgOverride}`,
          isDark: false,
          isInteractive: false,
          interactiveState: null,
          base: isHex ? `text-[${fgOverride}]` : fgOverride,
        });
      }

      const meta: PairMeta = {
        file: relPath,
        line: lineNum,
        ignoreReason,
        isLargeText,
        effectiveOpacity: region.effectiveOpacity,
      };

      // Base pairs (text SC 1.4.3 + non-text SC 1.4.11)
      const baseFgGroups: ForegroundGroup[] = [
        { classes: textClasses },
        { classes: categorized.borderClasses, pairType: 'border' },
        { classes: categorized.ringClasses, pairType: 'ring' },
        { classes: categorized.outlineClasses, pairType: 'outline' },
      ];
      const baseResult = generatePairs(
        baseFgGroups,
        effectiveBg,
        meta,
        colorMap,
        hasExplicitBg,
        contextBg,
      );
      allPairs.push(...baseResult.pairs);
      if (hasAnnotation) {
        for (const pair of baseResult.pairs) {
          pair.contextSource = 'annotation';
        }
      }
      allSkipped.push(...baseResult.skipped);

      // Interactive state pairs (CSS inheritance: state overrides base)
      for (const [state, stateClasses] of categorized.interactiveStates) {
        const stateBg =
          stateClasses.bgClasses.length > 0 ? stateClasses.bgClasses : effectiveBg;
        const stateText =
          stateClasses.textClasses.length > 0 ? stateClasses.textClasses : textClasses;
        const stateMeta: PairMeta = { ...meta, interactiveState: state };

        const stateFgGroups: ForegroundGroup[] = [
          { classes: stateText },
          { classes: stateClasses.borderClasses, pairType: 'border' },
          { classes: stateClasses.ringClasses, pairType: 'ring' },
          { classes: stateClasses.outlineClasses, pairType: 'outline' },
        ];
        const stateResult = generatePairs(
          stateFgGroups,
          stateBg,
          stateMeta,
          colorMap,
          hasExplicitBg,
          contextBg,
        );
        allPairs.push(...stateResult.pairs);
        if (hasAnnotation) {
          for (const pair of stateResult.pairs) {
            pair.contextSource = 'annotation';
          }
        }
        allSkipped.push(...stateResult.skipped);
      }
    }
  }

  return {
    pairs: allPairs,
    skipped: allSkipped,
    filesScanned: preExtracted.filesScanned,
  };
}

/**
 * Extracts all file regions (theme-agnostic). Call once, then pass
 * the result to resolveFileRegions() for each theme mode.
 *
 * @param srcPatterns - Glob patterns for source files (e.g., ['src/**\/*.tsx'])
 * @param cwd - Project root directory
 * @param containerMap - Component name → default bg class
 * @param defaultBg - Default page background class
 */
export function extractAllFileRegions(
  srcPatterns: string[],
  cwd: string,
  containerMap: ReadonlyMap<string, string>,
  defaultBg: string,
): PreExtracted {
  const filePaths = srcPatterns.flatMap((pattern) =>
    globSync(pattern, { cwd, absolute: true }),
  );
  const files: FileRegions[] = [];
  const readErrors: SkippedClass[] = [];

  for (const filePath of filePaths) {
    const relPath = relative(cwd, filePath);

    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[a11y-audit] Skipping ${relPath}: ${message}`);
      readErrors.push({
        file: relPath,
        line: 0,
        className: '(file)',
        reason: `File read error: ${message}`,
      });
      continue;
    }

    const lines = content.split('\n');
    const regions = extractClassRegions(content, containerMap, defaultBg);
    files.push({ relPath, lines, regions });
  }

  return {
    files,
    readErrors,
    filesScanned: filePaths.length,
  };
}
