// culori v4 does not ship bundled TypeScript declarations.
// This file provides the minimal subset used by the audit tool.
//
// Reference: https://culorijs.org/api/

declare module 'culori' {
  interface Color {
    mode: string;
    /** Alpha channel (0-1). undefined = fully opaque. */
    alpha?: number;
    [channel: string]: number | string | undefined;
  }

  export function parse(color: string): Color | undefined;
  export function formatHex(color: Color): string;
}
