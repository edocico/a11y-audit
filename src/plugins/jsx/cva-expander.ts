/**
 * CVA (class-variance-authority) expansion utilities.
 *
 * Parses cva() call content to extract base classes and variant groups
 * for contrast auditing.
 *
 * @module
 */

import type { CvaVariantGroup, CvaVariantOption } from '../../core/types.js';

interface ParsedCvaConfig {
  variants: CvaVariantGroup[];
  defaultVariants: Map<string, string>;
}

/**
 * Extracts the base classes (first string argument) from raw cva() content.
 * The content is everything between cva( and the matching ).
 *
 * @param content - The raw content inside cva(...)
 * @returns The base class string, trimmed, or empty string if not found
 */
export function extractCvaBase(content: string): string {
  const match = content.match(/^\s*["'`]([^"'`]*)["'`]/);
  return match ? match[1]!.trim() : '';
}

/**
 * Finds the matching closing brace for an opening brace at `openPos`.
 * Returns the index of the closing brace, or -1 if not found.
 * @internal Exported for unit testing
 */
export function findClosingBrace(content: string, openPos: number): number {
  let depth = 0;
  let inString: string | null = null;

  for (let i = openPos; i < content.length; i++) {
    const ch = content[i]!;

    if (inString) {
      if (ch === inString && content[i - 1] !== '\\') inString = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * Parses variant groups and defaultVariants from raw cva() content.
 * Uses textual pattern matching with balanced brace parsing.
 * Skips compoundVariants and non-string-literal values.
 */
export function parseCvaVariants(content: string): ParsedCvaConfig {
  const variants: CvaVariantGroup[] = [];
  const defaultVariants = new Map<string, string>();

  // Find the "variants:" block
  const variantsIdx = content.indexOf('variants:');
  if (variantsIdx === -1) return { variants, defaultVariants };

  // Find the opening brace of the variants object
  const variantsObjStart = content.indexOf('{', variantsIdx + 'variants:'.length);
  if (variantsObjStart === -1) return { variants, defaultVariants };

  const variantsObjEnd = findClosingBrace(content, variantsObjStart);
  if (variantsObjEnd === -1) return { variants, defaultVariants };

  const variantsBlock = content.slice(variantsObjStart + 1, variantsObjEnd);

  // Parse each variant axis (e.g., "variant: { ... }", "size: { ... }")
  const axisRegex = /(\w+)\s*:\s*\{/g;
  let axisMatch: RegExpExecArray | null;

  while ((axisMatch = axisRegex.exec(variantsBlock)) !== null) {
    const axisName = axisMatch[1]!;
    const axisObjStart = axisMatch.index + axisMatch[0].length - 1;
    const axisObjEnd = findClosingBrace(variantsBlock, axisObjStart);
    if (axisObjEnd === -1) continue;

    const axisBlock = variantsBlock.slice(axisObjStart + 1, axisObjEnd);

    // Parse each option: name: "classes"
    const optionRegex = /(\w+)\s*:\s*["'`]([^"'`]*)["'`]/g;
    const options: CvaVariantOption[] = [];
    let optionMatch: RegExpExecArray | null;

    while ((optionMatch = optionRegex.exec(axisBlock)) !== null) {
      options.push({
        name: optionMatch[1]!,
        classes: optionMatch[2]!,
      });
    }

    if (options.length > 0) {
      variants.push({ axis: axisName, options });
    }

    // Advance past this axis block to avoid re-matching nested braces
    axisRegex.lastIndex = axisObjStart + (axisObjEnd - axisObjStart) + 1;
  }

  // Parse defaultVariants
  const defaultIdx = content.indexOf('defaultVariants:');
  if (defaultIdx !== -1) {
    const defaultObjStart = content.indexOf('{', defaultIdx + 'defaultVariants:'.length);
    if (defaultObjStart !== -1) {
      const defaultObjEnd = findClosingBrace(content, defaultObjStart);
      if (defaultObjEnd !== -1) {
        const defaultBlock = content.slice(defaultObjStart + 1, defaultObjEnd);
        const defaultRegex = /(\w+)\s*:\s*["'`]([^"'`]*)["'`]/g;
        let defaultMatch: RegExpExecArray | null;

        while ((defaultMatch = defaultRegex.exec(defaultBlock)) !== null) {
          defaultVariants.set(defaultMatch[1]!, defaultMatch[2]!);
        }
      }
    }
  }

  return { variants, defaultVariants };
}
