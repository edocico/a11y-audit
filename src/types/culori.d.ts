// TODO: Port manual type declarations from multicoin-frontend/scripts/a11y-audit/culori.d.ts
//
// culori v4 does not ship bundled TypeScript declarations.
// This file provides the minimal subset used by the audit tool:
//   - parse(color: string): Color | undefined
//   - formatHex(color: Color): string
//
// Reference: https://culorijs.org/api/

declare module 'culori' {
  interface Color {
    mode: string;
    [channel: string]: number | string | undefined;
  }

  export function parse(color: string): Color | undefined;
  export function formatHex(color: Color): string;
}
