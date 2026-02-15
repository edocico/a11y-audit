/**
 * CVA (class-variance-authority) expansion utilities.
 *
 * Parses cva() call content to extract base classes and variant groups
 * for contrast auditing.
 *
 * @module
 */

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
