# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A framework-agnostic static contrast audit library for WCAG 2.1 AA/AAA and APCA. It's being ported from an internal `multicoin-frontend` audit script into a standalone npm package. Both a programmatic API (`src/index.ts`) and a CLI (`src/bin/cli.ts`) are planned; the CLI is scaffolded but not yet wired to the core pipeline.

## Commands

```bash
npm run build          # tsup → dist/ (CJS + ESM + .d.ts)
npm run dev            # tsup --watch
npm test               # vitest run (all tests)
npm run test:watch     # vitest in watch mode
npx vitest run src/core/__tests__/contrast-checker.test.ts   # single test file
npx vitest run -t "compositeOver"                            # single test by name
npm run typecheck      # tsc --noEmit (strict mode)
```

## Architecture

**Port-in-progress from multicoin-frontend.** Modules are migrated one at a time with full test coverage before moving to the next. The pipeline is not yet connected end-to-end.

### Module layout

- `src/core/types.ts` — All shared types. Single source of truth; re-exported via `src/types/public.ts` → `src/index.ts`.
- `src/core/color-utils.ts` — `toHex()`: normalizes any CSS color (oklch, hsl, rgb, display-p3, hex) to 6- or 8-digit hex. Uses `culori` for parsing.
- `src/core/contrast-checker.ts` — `checkAllPairs()`: WCAG contrast checking with alpha compositing, APCA Lc calculation, AA/AAA level selection, and `// a11y-ignore` suppression. Uses `colord` for contrast ratios and `apca-w3` for APCA.
- `src/bin/cli.ts` — Commander-based CLI (stub, not yet wired).

### Pending modules (not yet ported)

The `TODO` comments in `src/index.ts` indicate these are planned: `pipeline.js` (orchestrator), `config.js` (defineConfig), file scanning/extraction, reporting.

### Key design decisions

- **Two color libraries**: `culori` for CSS color parsing (better oklch/display-p3 support), `colord` for contrast ratio calculation (WCAG formula). Both lack bundled TypeScript declarations → custom `.d.ts` files in `src/types/`.
- **Alpha compositing**: Semi-transparent colors are composited against the page background before contrast calculation. Light mode uses `#ffffff`, dark mode uses `#09090b` (zinc-950).
- **Dual output**: tsup builds both CJS and ESM with declarations. The package uses `verbatimModuleSyntax` — always use `import type` for type-only imports.

## Testing Conventions

- Co-located tests in `__tests__/` directories next to their module.
- Property-based tests (`fast-check`) for mathematical invariants — see `contrast-checker.property.test.ts`.
- Test files use `makePair()` helpers to create test fixtures with sensible defaults + overrides.
- Internal functions are exported with `@internal` JSDoc tag for testability (e.g., `compositeOver`, `parseHexRGB`).

## TypeScript Strictness

The project uses a strict tsconfig: `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`. All imports from `.ts` files must use `.js` extensions (ESM resolution with bundler module resolution).
