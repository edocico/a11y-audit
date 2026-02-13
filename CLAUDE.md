# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A framework-agnostic static contrast audit library for WCAG 2.1 AA/AAA and APCA. It's being ported from an internal `multicoin-frontend` audit script (2352 LOC + 343 tests) into a standalone npm package with a plugin architecture. Both a programmatic API (`src/index.ts`) and a CLI (`src/bin/cli.ts`) are planned; the CLI is scaffolded but not yet wired to the core pipeline.

### Reference documents

- `docs/plans/2026-02-13-library-extraction.md` — The implementation plan (6 phases, 23 tasks). This is the roadmap.
- `oldDoc/A11Y_AUDIT_TECHNICAL_ARCHITECTURE.md` — Architecture of the **original embedded script** (in Italian). Use as reference when porting source code from `../multicoin-frontend/scripts/a11y-audit/`. This does NOT describe the current package's architecture.

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

**Target architecture (Layered Onion):** pure math core → plugin interfaces (`ColorResolver`, `FileParser`, `ContainerConfig`) → config (`zod` + `lilconfig`) → CLI (`commander`). Tailwind + JSX are the first plugin implementations.

### Module layout

- `src/core/types.ts` — All shared types. Single source of truth; re-exported via `src/types/public.ts` → `src/index.ts`.
- `src/core/color-utils.ts` — `toHex()`: normalizes any CSS color (oklch, hsl, rgb, display-p3, hex) to 6- or 8-digit hex. Uses `culori` for parsing.
- `src/core/contrast-checker.ts` — `checkAllPairs()`: WCAG contrast checking with alpha compositing, APCA Lc calculation, AA/AAA level selection, and `// a11y-ignore` suppression. Uses `colord` for contrast ratios and `apca-w3` for APCA.
- `src/bin/cli.ts` — Commander-based CLI (stub, not yet wired).

### Pending modules (not yet ported)

The `TODO` comments in `src/index.ts` indicate these are planned: `pipeline.js` (orchestrator), `config.js` (defineConfig), file scanning/extraction, reporting.

### Original tool pipeline (context for porting)

The source script follows: Bootstrap → Extract (file I/O + state-machine parsing) → Resolve (per-theme light/dark) → Check (contrast math) → Report. Key pattern: **extract-once / resolve-twice** — file parsing happens once, then color resolution runs per theme mode.

### Key design decisions

- **Three color libraries**: `culori` for CSS color parsing (better oklch/display-p3 support), `colord` + a11y plugin for WCAG contrast ratios, `apca-w3` for APCA Lightness Contrast (Lc). `culori` and `apca-w3` lack bundled TypeScript declarations → custom `.d.ts` files in `src/types/`.
- **Alpha compositing**: Semi-transparent colors are composited against the page background before contrast calculation. Light mode uses `#ffffff`, dark mode uses `#09090b` (zinc-950).
- **Dual output**: tsup builds both CJS and ESM with declarations. The package uses `verbatimModuleSyntax` — always use `import type` for type-only imports.

## Testing Conventions

- Co-located tests in `__tests__/` directories next to their module.
- Property-based tests (`fast-check`) for mathematical invariants — see `contrast-checker.property.test.ts`.
- I/O tests use `*.io.test.ts` naming and `vi.mock()` for filesystem isolation — kept separate from pure unit tests.
- Test files use `makePair()` helpers to create test fixtures with sensible defaults + overrides.
- Internal functions are exported with `@internal` JSDoc tag for testability (e.g., `compositeOver`, `parseHexRGB`).

## TypeScript Strictness

The project uses a strict tsconfig: `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`. All imports from `.ts` files must use `.js` extensions (ESM resolution with bundler module resolution).

## Porting Workflow

When porting a module from the original script: read the source in `../multicoin-frontend/scripts/a11y-audit/`, port its tests first (adapt paths/imports), then port the implementation to make them pass. Hardcoded paths must become configurable via plugin interfaces or config. The plan's task list is the order of operations — each task specifies source file, target location, and acceptance criteria.
