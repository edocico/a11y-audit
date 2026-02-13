// TODO: Port manual type declarations from multicoin-frontend/scripts/a11y-audit/apca-w3.d.ts
//
// apca-w3 does not ship bundled TypeScript declarations.
// This file provides the minimal subset used by the audit tool.
//
// Reference: https://github.com/nickshanks/apca-w3

declare module 'apca-w3' {
  /**
   * Calculate APCA Lightness Contrast (Lc) between text and background.
   * Returns a signed number: negative = dark-on-light, positive = light-on-dark.
   * |Lc| >= 60 ≈ WCAG AA equivalent.
   *
   * @param textColor - Text color as hex string (e.g., '#000000')
   * @param bgColor - Background color as hex string (e.g., '#ffffff')
   * @returns Signed Lc value, or 0 on failure
   */
  export function calcAPCA(textColor: string, bgColor: string): number;

  /**
   * Parses a color string into an array of [r, g, b] values.
   * Used internally by calcAPCA but also exported.
   */
  export function colorParsley(color: string): [number, number, number] | number;
}
