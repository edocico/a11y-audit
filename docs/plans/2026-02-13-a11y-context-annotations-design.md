# Design: @a11y-context Annotations

**Date:** 2026-02-13
**Status:** Approved
**Scope:** Core logic — comment-based context overrides for static contrast audit

## Problem

The static analysis presumes DOM nesting equals visual nesting. This fails for:

- **Absolute/fixed positioning**: A floating badge composites against a different background than its DOM parent.
- **React Portals**: Modals/dialogs render at `<body>` level but appear nested in JSX source.
- **currentColor**: Statically unresolvable without walking the context tree.
- **Complex layouts**: Any case where the inferred background doesn't match what the user sees.

Today, the only escape hatch is `// a11y-ignore`, which suppresses the violation entirely. Users need a way to **correct** the context, not silence it.

## Solution

Two comment-based annotation forms that override the inferred background/foreground context:

### 1. `@a11y-context` — single-element scope

Applies to the next element on the same line or the line below. Identical scoping to `a11y-ignore`.

```tsx
// @a11y-context bg:bg-slate-900
<span className="text-white absolute top-0">Badge</span>

{/* @a11y-context bg:#ff0000 fg:text-white */}
<div className="...">Overlay</div>
```

### 2. `@a11y-context-block` — block scope

Pushes onto the parser's context stack. Applies to all children until the enclosing tag closes.

```tsx
{/* @a11y-context-block bg:bg-background */}
<DialogContent>
  <h2 className="text-foreground">Title</h2>
  <p className="text-muted-foreground">Body</p>
</DialogContent>
```

### Parameters

| Parameter | Format | Example | Required |
|-----------|--------|---------|----------|
| `bg:` | Tailwind class or `#hex` | `bg:bg-slate-900`, `bg:#09090b` | At least one of bg/fg |
| `fg:` | Tailwind class or `#hex` | `fg:text-white`, `fg:#ffffff` | Optional |
| `no-inherit` | Flag (no value) | `no-inherit` | Optional, block-scope only |

- `bg:` overrides the `contextBg` for contrast calculation.
- `fg:` overrides the resolved foreground hex (useful for `currentColor` situations).
- `no-inherit` prevents children from inheriting the override — direct children see it, but their nested descendants revert to the stack below.

### Parsing rules

- Both `//` and `{/* */}` comment styles supported.
- Parameters are space-separated, order-independent.
- Hex values must start with `#` (4, 7, or 9 chars).
- Tailwind class values are anything that doesn't start with `#`.

## Architecture

### New type

```typescript
/** Context override from @a11y-context or @a11y-context-block */
interface ContextOverride {
  bg?: string;          // Tailwind class or hex literal
  fg?: string;          // Tailwind class or hex literal
  noInherit?: boolean;  // Only meaningful for block scope
}
```

`ClassRegion` gains an optional `contextOverride?: ContextOverride` field.

### Processing flow

```
Source file
  → parser.ts: extractClassRegions()
    - Block comments scanned for @a11y-context-block → pushes contextStack
    - Single-line @a11y-context stored as pending override
    - Next className= match gets the pending override attached to ClassRegion
  → categorizer.ts: getContextOverrideForLine()
    - Parses annotation parameters (bg:, fg:, no-inherit)
    - Returns ContextOverride | null
  → region-resolver.ts: generatePairs()
    - If contextOverride.bg exists → replaces buildEffectiveBg() input
    - If contextOverride.fg exists → overrides resolved fg hex directly
```

### Module responsibilities

| Module | Change |
|--------|--------|
| `categorizer.ts` | New `getContextOverrideForLine()` function + regex (parallel to `getIgnoreReasonForLine()`) |
| `parser.ts` | Detect `@a11y-context-block` in comment-skip logic → push/pop contextStack. Detect `@a11y-context` → attach to next ClassRegion |
| `region-resolver.ts` | `generatePairs()` checks `contextOverride` before `buildEffectiveBg()` |
| `types.ts` | Add `ContextOverride` interface, add `contextOverride?` to `ClassRegion`, add `contextSource?` to `ContrastResult` |
| `report/markdown.ts` | Footnote marker on annotation-overridden pairs |
| `report/json.ts` | Include `contextSource` field |

### `no-inherit` behavior

The context stack entry gets a `noInherit: true` flag. When the parser pushes a new container onto the stack while `noInherit` is active, the new container does NOT inherit the annotation's bg — it falls through to the stack entry below the annotation.

Example:
```tsx
{/* @a11y-context-block bg:bg-background no-inherit */}
<DialogContent>
  {/* ← sees bg:bg-background (direct child) */}
  <Card>
    {/* ← sees Card's own bg (bg-card), NOT bg-background */}
    <span className="text-foreground">...</span>
  </Card>
</DialogContent>
```

## Reporting

### Markdown report

Annotated pairs get a footnote marker:

```
| bg-background† | text-white | 15.4:1 | AA ✓ |
† Context overridden via @a11y-context
```

### JSON report

`ContrastResult` gains:

```typescript
contextSource?: 'inferred' | 'annotation';
```

This lets CI tools distinguish manually-asserted from inferred contexts.

## Testing plan

| Layer | What | File |
|-------|------|------|
| Regex parsing | `getContextOverrideForLine()`: bg, fg, no-inherit, hex, class names, malformed input | `categorizer.test.ts` |
| Single-element | `extractClassRegions()` attaches override from preceding comment to next region only | `parser.test.ts` |
| Block scope | Stack push/pop on `@a11y-context-block`, children get overridden bg | `parser.test.ts` |
| no-inherit | Block override doesn't cascade to grandchildren past container boundaries | `parser.test.ts` |
| Pair generation | `generatePairs()` uses override bg/fg instead of inferred values | `region-resolver.test.ts` |
| End-to-end | Fixture file with annotations → correct violations/passes in report | `integration.test.ts` |
| Report output | Markdown footnote + JSON `contextSource` field present | `markdown.test.ts`, `json.test.ts` |

## Use cases solved

| Problem | Annotation |
|---------|------------|
| Floating badge over wrong bg | `// @a11y-context bg:bg-background` on the badge |
| React Portal (modal at body level) | `{/* @a11y-context-block bg:bg-background */}` around DialogContent |
| currentColor unresolvable | `// @a11y-context fg:#333333` to force the known color |
| Absolute element over grandparent bg | `// @a11y-context bg:bg-slate-900` |
| Complex nested theme override | `{/* @a11y-context-block bg:bg-card no-inherit */}` |

## Non-goals

- Automatic detection of portals or absolute positioning (future work).
- CVA/cva() variant parsing (separate design).
- CSS class conflict resolution for duplicate bg-* classes (separate design).
