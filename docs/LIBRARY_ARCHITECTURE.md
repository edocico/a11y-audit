# Architettura Tecnica: a11y-audit Library (v1.0)

> **Ultimo aggiornamento**: 2026-02-14 | **Versione**: 1.0.0 (standalone npm package) | **384 test TS across 16 files + 41 test Rust across 5 moduli**

---

## 1. Panoramica Architetturale v1.0

### Scopo

`a11y-audit` esegue un'**analisi statica** dei file `.tsx` (o qualsiasi file di template) per verificare la conformita WCAG 2.1 AA/AAA dei rapporti di contrasto tra colori. Non opera a runtime ne in un browser: legge i file sorgente, risolve le classi Tailwind in colori hex, e calcola i rapporti matematicamente. A differenza della versione precedente (script locale legato a un singolo progetto), la v1.0 e un **pacchetto npm standalone** con CLI compilata, configurazione esterna, e sistema a plugin.

### Cosa NON fa

- Non esegue rendering DOM (nessun headless browser)
- Supporto parziale per CSS inline (`style={{ color: '#hex', backgroundColor: '#hex' }}`): rileva solo valori hex letterali, non variabili CSS ne espressioni JS
- Non cattura pseudo-elementi (`before:`, `after:`) ne group-state (`group-hover:`)
- Non valida `@apply` o gradienti

### Cambiamenti chiave dalla v0.x (script locale)

| Aspetto | Script locale (v0.x) | Libreria npm (v1.0) |
|---------|---------------------|---------------------|
| **Natura** | Script eseguito con `tsx` | Pacchetto compilato (`dist/`) con CLI binaria |
| **Input** | Path hardcoded `src/**/*.tsx` | Configurabile via `--src` o config file |
| **Configurazione** | File statico `jsx-context-config.ts` | `a11y-audit.config.{js,mjs,json}` via `lilconfig` |
| **Tailwind** | Path hardcoded `node_modules/...` | Auto-discovery monorepo-aware + override via config |
| **Tipi** | `.d.ts` locali sparsi | Bundled types in `dist/index.d.ts` (via `tsup`) |
| **Contesti** | 21 componenti shadcn hardcoded | Preset opzionale (`shadcn`) + user overrides |
| **Output** | Solo Markdown | Markdown o JSON, directory configurabile |
| **Testing** | Mock di `fs` su path specifici | Co-located test con `__tests__/`, fixtures, property-based |

### Design: "Extract-Once / Resolve-Twice"

Il principio architetturale fondamentale e la separazione tra **I/O + parsing** (costosi) e **risoluzione colore** (per-tema). L'estrazione dei file sorgente avviene una sola volta e produce un albero intermedio (`PreExtracted`) completamente agnostico rispetto al tema. Questo albero viene poi risolto due volte — una per light mode, una per dark mode — eliminando la doppia lettura da disco e il doppio parsing della state machine.

```
extractAllFileRegions()       <-- I/O + parsing (UNA volta)
         |
         v
   PreExtracted {
     files: FileRegions[]     <-- per file: relPath, lines[], regions[]
     readErrors: SkippedClass[]
     filesScanned: number
   }
         |
    +----+----+
    v         v
resolve(light)    resolve(dark)   <-- risoluzione per-tema (DUE volte)
```

### Stack Tecnologico

| Dipendenza | Scopo | Perche questa |
|-----------|-------|---------------|
| **TypeScript** (ES2022, `tsup` bundler) | Linguaggio + build CJS/ESM dual-output | `tsup` genera `dist/index.js` (ESM), `dist/index.cjs`, `dist/index.d.ts` in un solo comando |
| **`commander`** | CLI parsing | Standard de facto per CLI Node.js. Gestisce flags, subcommands, help automatico |
| **`lilconfig`** | Config file discovery | Cerca `a11y-audit.config.{js,mjs,json}` e `package.json` con cosmiconfig-like resolution |
| **`zod`** | Schema validation + defaults | Valida la configurazione utente, applica defaults, produce tipi TypeScript inferiti |
| **`culori`** (via `color-utils.ts`) | Parsing colori oklch/hsl/display-p3 → hex | Tailwind v4 usa `oklch()` nativamente. `culori` e l'unica libreria che gestisce oklch con precisione subpixel. No bundled types → custom `culori.d.ts` |
| **`colord`** + plugin `a11y` (via `contrast-checker.ts`) | Calcolo WCAG contrast ratio | `colord` implementa la formula W3C con `.contrast()`. Il plugin a11y estende l'API base |
| **`apca-w3`** (via `contrast-checker.ts`) | Calcolo APCA Lightness Contrast (Lc) | Algoritmo next-gen di contrasto percettivo (W3 Silver). Custom `apca-w3.d.ts` (no bundled types) |
| **`glob`** (`globSync`) | File discovery | Pattern matching ricorsivo di `**/*.tsx` con supporto multi-pattern |
| **`fast-check`** (dev) | Property-based testing | Genera input casuali per validare invarianti matematici (bounds, round-trip, idempotenza) |

### Perche tre librerie colore? (Layer TypeScript)

`culori` gestisce il **parsing** di formati esotici (oklch con lightness percentuale, hsl con sintassi moderna, display-p3). `colord` con il plugin a11y implementa il **calcolo del contrasto** secondo la formula WCAG esatta. `apca-w3` calcola il valore APCA Lc — un algoritmo di contrasto percettivo complementare al ratio WCAG. Sono complementari: `culori` non ha `.contrast()`, `colord` non parsa oklch, e nessuna delle due implementa APCA.

### Native Engine: Rust via NAPI-RS (Phase 1 — in corso)

**Obiettivo**: Portare lo hot path (parsing JSX + math colore) in Rust per ridurre il tempo di scansione di >70%. L'I/O e l'orchestrazione restano in TypeScript.

**Approccio ibrido**: Il modulo nativo (`native/`) espone funzioni via NAPI-RS che sostituiscono le equivalenti TypeScript. Il binding JS (`src/native/index.ts`) fornisce un fallback graceful: se il modulo `.node` non e disponibile (es. piattaforma non supportata), la pipeline usa il codice TS originale.

| Componente | Linguaggio | Scopo |
| ---------- | ---------- | ----- |
| **Math engine** (hex, composite, wcag, apca, color_parse) | Rust | Calcoli puri: parsing colori, compositing alpha, contrast ratio WCAG, APCA Lc |
| **Parser** (tokenizer, visitors) | Rust (planned) | State machine JSX, context stack, annotation parsing |
| **Pipeline orchestration** | TypeScript | I/O disco, config loading, report generation |
| **NAPI bridge** | Rust + JS | Conversione tipi Rust ↔ JS via `#[napi(object)]` |

**Stack Rust**:

| Dipendenza | Versione | Scopo |
| ---------- | -------- | ----- |
| `napi` + `napi-derive` | 2.x | Binding Rust ↔ Node.js (N-API v8) |
| `serde` + `serde_json` | 1.x | Serializzazione tipi per interop JS |
| `csscolorparser` | 0.7 | Parsing CSS colors (oklch, hsl, rgb, named) — equivalente Rust di `culori` |

**Stato attuale (Task 1-6 di 20 completati)**:

- Infrastruttura NAPI-RS funzionante con `health_check()` esposto
- Tipi condivisi Rust equivalenti a `src/core/types.ts` con campi pre-wired per feature future (US-05, US-07, US-08, Phase 5)
- 5 moduli math completi: `hex`, `composite`, `wcag`, `apca`, `color_parse`
- 41 test Rust passanti, cross-validati contro i ground truth generati dalle librerie TS (colord, apca-w3, culori)

**Differenze implementative rispetto al layer TS**:

- **APCA**: Usa `pow(c/255, 2.4)` (curva semplice), NON la funzione piecewise WCAG. Include il **black soft clamp** (`blkThrs=0.022`, `blkClmp=1.414`) essenziale per accuratezza su colori scuri
- **Color parsing**: `csscolorparser` gestisce oklch nativamente (nessun workaround necessario, a differenza di quanto previsto nel piano)
- **WCAG contrast**: Implementazione diretta della formula W3C con linearizzazione piecewise sRGB (`soglia 0.04045`)

### Architettura a Strati (Layered Onion)

```
+---------------------------------------------------------------+
|                      CLI (commander)                           |
|  src/bin/cli.ts — flags, merging, process.exit                |
+---------------------------------------------------------------+
|                  Config (zod + lilconfig)                      |
|  src/config/schema.ts — validation + defaults                 |
|  src/config/loader.ts — file discovery + parsing              |
+---------------------------------------------------------------+
|                  Pipeline (orchestrator)                       |
|  src/core/pipeline.ts — runAudit(), report writing            |
+---------------------------------------------------------------+
|               Plugin Interfaces                               |
|  src/plugins/interfaces.ts — ColorResolver, FileParser,       |
|                               ContainerConfig, AuditConfig    |
+---------------------------------------------------------------+
|               Plugin Implementations                          |
|  src/plugins/tailwind/ — css-resolver, palette, presets       |
|  src/plugins/jsx/ — categorizer, parser, region-resolver      |
+---------------------------------------------------------------+
|                  Pure Math Core (TS)                           |
|  src/core/contrast-checker.ts — WCAG + APCA                  |
|  src/core/color-utils.ts — toHex() normalizzazione            |
|  src/core/types.ts — tutti i tipi condivisi                   |
+---------------------------------------------------------------+
        |  fallback se native non disponibile
        v
+---------------------------------------------------------------+
|              Native Engine (Rust + NAPI-RS)                    |
|  native/src/math/ — hex, composite, wcag, apca, color_parse  |
|  native/src/types.rs — tipi condivisi Rust                    |
|  src/native/index.ts — JS binding loader con fallback         |
+---------------------------------------------------------------+
```

Il codice puro (contrast-checker, color-utils) non ha dipendenze da I/O ne da framework. Le interfacce plugin (`ColorResolver`, `FileParser`, `ContainerConfig`) definiscono i contratti. Le implementazioni concrete (Tailwind + JSX) sono il primo set di plugin. Il layer di configurazione traduce l'input utente in oggetti tipizzati. La CLI e un sottile wrapper che chiama la pipeline.

---

## 2. Struttura dei File

```
a11y-audit/
├── package.json                  # name: "a11y-audit", bin: "a11y-audit"
├── tsup.config.ts                # Build: CJS + ESM + .d.ts
├── tsconfig.json                 # strict: noUncheckedIndexedAccess, verbatimModuleSyntax
├── vitest.config.ts              # Test runner config
├── dist/                         # Build output (npm publish)
│   ├── index.js                  # ESM entry
│   ├── index.cjs                 # CJS entry
│   ├── index.d.ts                # Bundled type declarations
│   └── bin/cli.js                # Compiled CLI binary
├── native/                       # Rust native engine (NAPI-RS)
│   ├── Cargo.toml                # Crate config: napi, serde, csscolorparser
│   ├── build.rs                  # NAPI build script
│   ├── src/
│   │   ├── lib.rs                # Root: health_check(), mod declarations
│   │   ├── types.rs              # Rust equivalents of core/types.ts (#[napi(object)])
│   │   └── math/
│   │       ├── mod.rs            # Module declarations
│   │       ├── hex.rs            # parse_hex_rgb(), extract_hex_alpha(), strip_hex_alpha()
│   │       ├── composite.rs      # composite_over() — Porter-Duff source-over
│   │       ├── wcag.rs           # srgb_to_linear(), relative_luminance(), contrast_ratio()
│   │       ├── apca.rs           # calc_apca_lc() — APCA-W3 con black soft clamp
│   │       └── color_parse.rs    # to_hex() — CSS color → hex via csscolorparser
│   └── tests/
│       └── fixtures/             # Ground truth JSON per cross-validation
│           ├── colord_ratios.json    # 8 WCAG ratio pairs (da colord)
│           ├── apca_values.json      # 6 APCA Lc pairs (da apca-w3)
│           └── to_hex_values.json    # 12 toHex conversions (da culori)
└── src/
    ├── index.ts                  # Public API re-exports
    ├── native/
    │   └── index.ts              # JS binding loader: isNativeAvailable(), getNativeModule()
    ├── bin/
    │   └── cli.ts                # Commander-based CLI entry point
    ├── config/
    │   ├── schema.ts             # Zod schema: AuditConfigInput, AuditConfigResolved
    │   ├── loader.ts             # lilconfig: search/load config files
    │   ├── defaults.ts           # Default values for config
    │   └── __tests__/
    │       └── schema.test.ts    # Config schema validation tests
    ├── core/
    │   ├── types.ts              # ALL shared types (single source of truth)
    │   ├── color-utils.ts        # toHex(): CSS color normalization via culori
    │   ├── contrast-checker.ts   # checkAllPairs(): WCAG + APCA contrast checking
    │   ├── pipeline.ts           # runAudit(): full pipeline orchestration
    │   ├── report/
    │   │   ├── markdown.ts       # generateReport(): Markdown audit output
    │   │   ├── json.ts           # generateJsonReport(): structured JSON output
    │   │   └── __tests__/
    │   │       ├── markdown.test.ts
    │   │       └── json.test.ts
    │   └── __tests__/
    │       ├── color-utils.test.ts
    │       ├── contrast-checker.test.ts
    │       ├── contrast-checker.property.test.ts  # fast-check property tests
    │       └── integration.test.ts                # Full pipeline e2e tests
    ├── plugins/
    │   ├── interfaces.ts         # ColorResolver, FileParser, ContainerConfig, AuditConfig
    │   ├── tailwind/
    │   │   ├── css-resolver.ts   # buildThemeColorMaps(), resolveClassToHex()
    │   │   ├── palette.ts        # extractTailwindPalette(), findTailwindPalette()
    │   │   ├── presets/
    │   │   │   └── shadcn.ts     # 21 component->bg mappings (ContainerConfig)
    │   │   └── __tests__/
    │   │       ├── css-resolver.test.ts
    │   │       ├── css-resolver.io.test.ts
    │   │       ├── css-resolver.property.test.ts
    │   │       └── palette.io.test.ts
    │   └── jsx/
    │       ├── categorizer.ts    # stripVariants(), routeClassToTarget(), categorizeClasses(), getContextOverrideForLine()
    │       ├── parser.ts         # extractClassRegions() state machine + @a11y-context annotation handling
    │       ├── region-resolver.ts  # buildEffectiveBg(), generatePairs(), resolveFileRegions()
    │       └── __tests__/
    │           ├── categorizer.test.ts
    │           ├── categorizer.property.test.ts
    │           ├── parser.test.ts
    │           ├── region-resolver.test.ts
    │           └── region-resolver.io.test.ts
    └── types/
        ├── public.ts             # Re-exports for public API
        ├── apca-w3.d.ts          # Manual type declarations (no bundled types)
        └── culori.d.ts           # Manual type declarations (no bundled types)
```

---

## 3. Installation & Usage

### Installazione

```bash
# Come devDependency di progetto
npm install -D a11y-audit

# Oppure globalmente
npm install -g a11y-audit
```

**Prerequisiti**: Il progetto target deve avere `tailwindcss` installato (il tool legge `tailwindcss/theme.css` per estrarre la palette colori). Node.js >= 18.

### Configurazione

Creare un file `a11y-audit.config.js` (o `.mjs`, `.json`) nella root del progetto. Il tool cerca automaticamente questi file tramite `lilconfig`:

```javascript
// a11y-audit.config.js
export default {
  // Glob pattern per i file sorgente da analizzare
  src: ['src/**/*.tsx'],

  // File CSS che definiscono le variabili colore (:root, .dark, @theme)
  css: ['src/main.theme.css', 'src/main.css'],

  // Livello WCAG: 'AA' (default) o 'AAA'
  threshold: 'AA',

  // Preset container context (carica le 21 mappature shadcn/ui)
  preset: 'shadcn',

  // Override o aggiunte ai container del preset
  containers: {
    MyCustomCard: 'bg-card',
    NavigationMenuContent: 'bg-popover',
  },

  // Directory di output per i report
  reportDir: 'a11y-reports',

  // Formato report: 'markdown' (default) o 'json'
  format: 'markdown',

  // Eseguire anche l'analisi dark mode (default: true)
  dark: true,
};
```

In alternativa, in `package.json`:

```json
{
  "a11y-audit": {
    "src": ["src/**/*.tsx"],
    "css": ["src/main.theme.css", "src/main.css"],
    "preset": "shadcn"
  }
}
```

I file cercati da `lilconfig`, in ordine di priorita:
1. `a11y-audit.config.js`
2. `a11y-audit.config.mjs`
3. `.a11y-auditrc.json`
4. `package.json` (chiave `"a11y-audit"`)

**Nota importante**: I file `.ts` non sono supportati come formato di configurazione. `lilconfig` non ha un loader TypeScript integrato. Usare `.js`, `.mjs` o `.json`.

### CLI Flags

```bash
npx a11y-audit [options]
```

| Flag | Tipo | Default | Descrizione |
|------|------|---------|-------------|
| `-c, --config <path>` | string | auto-search | Path esplicito al file di configurazione |
| `--src <glob...>` | string[] | `['src/**/*.tsx']` | Pattern glob per i file sorgente |
| `--css <paths...>` | string[] | `[]` | File CSS con definizioni colore |
| `--report-dir <dir>` | string | `'a11y-reports'` | Directory di output per i report |
| `--threshold <level>` | `'AA'` \| `'AAA'` | `'AA'` | Livello di conformita WCAG |
| `--format <type>` | `'markdown'` \| `'json'` | `'markdown'` | Formato del report |
| `--no-dark` | boolean | `false` | Salta l'analisi dark mode |
| `--preset <name>` | string | — | Preset container context (es. `shadcn`) |
| `--verbose` | boolean | `false` | Stampa progresso su stderr |

I flag CLI sovrascrivono i valori nel file di configurazione. Se nessun flag ne config file sono forniti, vengono usati i default dallo schema Zod.

### Uso Programmatico

```typescript
import { runAudit, loadConfig, findTailwindPalette, shadcnPreset } from 'a11y-audit';

const config = await loadConfig();
const palettePath = findTailwindPalette(process.cwd());

const { results, report, totalViolations } = runAudit({
  src: config.src,
  css: config.css.map(p => resolve(process.cwd(), p)),
  palettePath,
  cwd: process.cwd(),
  containerConfig: shadcnPreset,
  threshold: 'AA',
  reportDir: 'a11y-reports',
  format: 'markdown',
  dark: true,
});

console.log(`Violations: ${totalViolations}`);
```

---

## 4. Core Pipeline

### Diagramma completo

```
                    ┌─────────────────────┐
                    │   a11y-audit CLI     │
                    │   (commander)        │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Config Loading      │
                    │  lilconfig + zod     │
                    │  Output:             │
                    │   AuditConfigResolved│
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Adapter Init        │
                    │  - findTailwindPal.  │
                    │  - buildContainer.   │
                    │  - merge preset +   │
                    │    user overrides    │
                    │  Output:            │
                    │   PipelineOptions   │
                    └──────────┬──────────┘
                               │
                               ▼
┌───────────┐    ┌───────────────────────────────────────────┐
│ Phase 0   │    │         buildThemeColorMaps()              │
│ Bootstrap │───>│  css-resolver.ts + palette.ts              │
│           │    │  Input: CSS files + tailwindcss/theme.css  │
│           │    │  Output: ColorMap (light) + ColorMap (dark)│
└───────────┘    └───────────────────┬───────────────────────┘
                                     │
                                     ▼
┌───────────┐    ┌───────────────────────────────────────────┐
│ Phase 1   │    │       extractAllFileRegions()              │
│ Extract   │───>│  jsx/parser.ts (state machine)             │
│ (1 volta) │    │  Input: src glob patterns                  │
│           │    │  Output: PreExtracted { files, readErrors } │
└───────────┘    └───────────────────┬───────────────────────┘
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│  resolveFileRegions()        │  │  resolveFileRegions()         │
│  Theme: LIGHT                │  │  Theme: DARK                  │
│  ColorMap: light             │  │  ColorMap: dark               │
│  Output: ColorPair[]         │  │  Output: ColorPair[]          │
└──────────────┬───────────────┘  └──────────────┬───────────────┘
               ▼                                  ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│  checkAllPairs()             │  │  checkAllPairs()              │
│  contrast-checker.ts         │  │  contrast-checker.ts          │
│  Output: AuditResult         │  │  Output: AuditResult          │
└──────────────┬───────────────┘  └──────────────┬───────────────┘
               │                                  │
               └───────────────┬──────────────────┘
                               ▼
                ┌──────────────────────────┐
                │  generateReport() /      │
                │  generateJsonReport()    │
                │  Output: Markdown o JSON │
                └──────────────┬───────────┘
                               │
                               ▼
                ┌──────────────────────────┐
                │  writeFileSync()         │
                │  audit-YYYY-MM-DD.{md|json}
                └──────────────────────────┘
```

### Phase -1: Configuration Loading

**File**: `src/config/loader.ts`, `src/config/schema.ts`

Prima che la pipeline inizi, la CLI carica la configurazione:

1. **`loadConfig(explicitPath?)`** cerca il config file tramite `lilconfig`. Se `--config` e stato passato, carica quel file specifico; altrimenti cerca nell'ordine definito da `searchPlaces`.

2. Il raw config viene validato da **`auditConfigSchema.parse(raw)`** (Zod). Lo schema applica default per ogni campo non specificato:

   ```
   src:        ['src/**/*.tsx']
   css:        []
   threshold:  'AA'
   reportDir:  'a11y-reports'
   format:     'markdown'
   dark:       true
   containers: {}
   defaultBg:  'bg-background'
   pageBg:     { light: '#ffffff', dark: '#09090b' }
   ```

3. I **flag CLI sovrascrivono** i valori dal config file. La logica di merge risiede in `src/bin/cli.ts`: ogni flag viene applicato solo se esplicitamente passato dall'utente.

### Phase -0.5: Adapter Initialization

**File**: `src/bin/cli.ts` (funzione `buildContainerConfig`)

1. **Tailwind palette discovery**: Se il config non specifica `tailwindPalette`, `findTailwindPalette(cwd)` cerca `node_modules/tailwindcss/theme.css` nella directory corrente. Supporta layout flat (`node_modules/`) e pnpm/yarn berry (risoluzione alternativa). Se non trovato, lancia un errore chiaro.

2. **Container config merging**: Se `--preset shadcn` e specificato, carica `shadcnPreset` (21 componenti → sfondo implicito). Poi applica le `containers` dal config utente come override:

   ```
   shadcnPreset.containers     (base: 21 entry)
         +
   config.containers           (user overrides)
         =
   final ContainerConfig       (merged Map)
   ```

### Phase 0: Bootstrap — Costruzione delle Color Map

**File**: `src/plugins/tailwind/css-resolver.ts`, `src/plugins/tailwind/palette.ts`

**Obiettivo**: Costruire due `ColorMap` (light + dark) che mappano ogni variabile CSS al suo valore hex finale.

**Catena di risoluzione**:

```
Tailwind class: bg-primary
       |
       v  (resolveClassToHex: rimuove prefisso "bg-")
CSS Variable: --color-primary
       |
       v  (colorMap.get)
@theme inline block: --color-primary: var(--primary)
       |
       v  (resolveVar: segue la catena var())
:root block: --primary: var(--color-sky-700)
       |
       v  (resolveVar: segue la catena var())
Tailwind palette: --color-sky-700: oklch(45.41% 0.188 231.535)
       |
       v  (toHex: culori parse + formatHex)
Hex: #0369a1
```

**Passaggi nel codice**:

1. **`extractTailwindPalette(palettePath)`** (`palette.ts`): Legge il file `theme.css` di Tailwind (path fornito dalla config o auto-detected), estrae tutte le variabili `--color-*` con regex e converte i valori oklch in hex tramite `culori.parse()` + `culori.formatHex()`. Produce una `RawPalette` (Map\<string, string\>).

2. **`parseBlock(css, selector)`** (`css-resolver.ts`): Trova tutti i blocchi CSS per un dato selettore (`:root` o `.dark`) e ne estrae le variabili. Usa `extractBalancedBraces()` (conteggio profondita `{}`), non regex non-greedy, per gestire blocchi annidati.

3. **`parseThemeInline(css)`**: Estrae le variabili dai blocchi `@theme inline { ... }` e `@theme { ... }` — la sintassi CSS-first di Tailwind v4 per i token semantici. Filtra solo `--color-*`.

4. **`resolveAll(blockVars, themeInlineVars, twPalette)`**: Unisce le tre sorgenti in ordine di priorita crescente (palette → block → theme inline) e risolve ricorsivamente ogni variabile tramite `resolveVar()`. Profondita massima: 10 livelli. Supporta: `var(--x)`, `var(--x, #fallback)`, `var(--x, var(--y))`.

5. **Fallback dark → light**: Dopo la risoluzione, le variabili presenti solo in light vengono copiate nel dark map come fallback.

**Alpha preservation**: L'intera catena preserva l'alpha channel. Se un colore oklch ha alpha < 1, `toHex()` restituisce hex a 8 digit (`#rrggbbaa`). `hexToResolved()` separa i 6 digit base dall'alpha e restituisce `ResolvedColor { hex, alpha? }`.

### Phase 1: Extraction — State Machine Parsing

**File**: `src/plugins/jsx/parser.ts` → `extractClassRegions()`, `src/plugins/jsx/region-resolver.ts` → `extractAllFileRegions()`

**Obiettivo**: Trovare tutti i `className=` nei file sorgente, estrarne il contenuto, e annotarli con metadati di contesto (linea, sfondo implicito del container).

La state machine scansiona il sorgente **carattere per carattere** (non riga per riga). Gestisce:

| Pattern | Come lo trova | Come estrae il contenuto |
|---------|--------------|-------------------------|
| `className="..."` | Confronto stringa `source.startsWith('className=', i)` + virgoletta dopo `=` | `source.slice(start, end)` fino alla virgoletta chiusa |
| `className={'...'}` | `{` dopo `=`, poi virgoletta/apice dentro | `findUnescaped()` per trovare la chiusura della stringa |
| `` className={`...`} `` | Backtick dopo `{` | Template literal con rimozione di `${...}` (sostituiti con spazi) |
| `className={cn(...)}` | `cn(` o `clsx(` dopo `{` | `extractBalancedParens()`: conta `()` annidati, rispetta stringhe e template |
| `cn(...)` standalone | `cn(`, `clsx(`, `cva(` non preceduti da char identificatore | Stesso `extractBalancedParens()` |
| `style={{ color: '#hex' }}` | Scansione backward/forward dal `className=` per trovare il tag `<...>` | Regex per `color:` e `backgroundColor:` con valori stringa hex letterali |

**Perche non regex?** Le regex non gestiscono parentesi annidate (`cn('a', cond && 'b')`) ne stringhe multilinea con escape. La state machine traccia lo stato di annidamento con contatori di profondita.

**Lookup linea**: Pre-calcola un array `lineBreaks[]` con gli offset dei `\n` in un singolo pass O(n). Poi `lineAt(offset)` usa binary search O(log n) per convertire offset → numero di riga.

### Phase 2: Resolution — Classe → ColorPair

**File**: `src/plugins/jsx/region-resolver.ts` → `resolveFileRegions()`, `src/plugins/jsx/categorizer.ts`

**Obiettivo**: Per ogni `ClassRegion` estratta, determinare tutti gli accoppiamenti (bg + fg) e risolvere ciascuno in hex.

Il processo per ogni regione:

1. **Estrazione classi**: Se il contenuto ha virgolette → `extractStringLiterals()` (da `cn()`/`clsx()`); altrimenti split su whitespace.

2. **Stripping varianti e categorizzazione**: Ogni classe passa per `stripVariants()` che rimuove iterativamente i prefissi (`dark:`, `hover:`, `sm:`, etc.) e setta i flag `isDark`, `isInteractive`, `interactiveState`. Poi `categorizeClasses()` smista le classi nei bucket: `bgClasses`, `textClasses`, `borderClasses`, `ringClasses`, `outlineClasses`.

3. **Background effettivo**: `buildEffectiveBg()` determina lo sfondo:
   - Se ci sono classi bg esplicite → usa quelle
   - Altrimenti → fallback al `contextBg` dal context stack
   - Se `inlineStyles.backgroundColor` contiene un hex → sovrascrive tutto

4. **Generazione coppie**: `generatePairs()` crea le coppie bg+fg per testo (SC 1.4.3) e non-testo (SC 1.4.11), poi ripete per ogni stato interattivo con CSS inheritance.

5. **Risoluzione hex**: `resolveClassToHex()` per ogni classe gestisce: opacity modifier (`/50`, `/[0.37]`, `/[50%]`), arbitrary values (`[#ff0000]`), lookup nella ColorMap via `--color-{name}`.

### Phase 3: Validation — Calcolo WCAG

**File**: `src/core/contrast-checker.ts`

Dettagliato nella sezione 5.1 (Alpha Compositing) e 5.2 (Soglie WCAG).

### Phase 4: Report Generation

**File**: `src/core/report/markdown.ts`, `src/core/report/json.ts`

Genera un file Markdown o JSON con:

1. **Summary**: File scansionati, coppie controllate, violazioni (text/non-text x base/interactive), ignorati, skippati
2. **Per-theme sections** (light, dark):
   - Violazioni testo (SC 1.4.3): tabella per file con Line, State, Background, Foreground, Size, Ratio, AA, AA Large
   - Violazioni non-testo (SC 1.4.11): tabella per file con Line, State, Type, Element, Against, Ratio, 3:1
3. **Ignored violations**: Raggruppati per file con motivo della soppressione
4. **Skipped classes**: Prime 50 classi non risolvibili, deduplicate tra temi
5. **Footnote `†`**: Le coppie con contesto sovrascitto da `@a11y-context` sono marcate con `†` nella colonna Background. Una nota a pie di pagina spiega il significato

Il file viene salvato in `{reportDir}/audit-YYYY-MM-DD.{md|json}` con suffisso incrementale se il file esiste gia (`-1`, `-2`, ..., fino a `-99`).

---

## 5. Sistema di Configurazione

### Il cuore del disaccoppiamento

La v1.0 separa completamente la logica di audit dalla configurazione specifica del progetto. Cio che prima era hardcoded nello script (path CSS, componenti container, directory di output) e ora governato da uno schema Zod con default sensati.

### Schema di configurazione (`AuditConfigInput`)

```typescript
// src/config/schema.ts
const auditConfigSchema = z.object({
  src:             z.array(z.string()).default(['src/**/*.tsx']),
  css:             z.array(z.string()).default([]),
  threshold:       z.enum(['AA', 'AAA']).default('AA'),
  reportDir:       z.string().default('a11y-reports'),
  format:          z.enum(['markdown', 'json']).default('markdown'),
  dark:            z.boolean().default(true),
  containers:      z.record(z.string(), z.string()).default({}),
  defaultBg:       z.string().default('bg-background'),
  pageBg:          z.object({
    light: z.string(),
    dark:  z.string(),
  }).default({ light: '#ffffff', dark: '#09090b' }),
  preset:          z.string().optional(),
  tailwindPalette: z.string().optional(),
});
```

| Campo | Tipo | Default | Scopo |
|-------|------|---------|-------|
| `src` | `string[]` | `['src/**/*.tsx']` | Glob pattern per i file da scansionare |
| `css` | `string[]` | `[]` | File CSS contenenti `:root`, `.dark`, `@theme` blocks |
| `threshold` | `'AA' \| 'AAA'` | `'AA'` | Livello WCAG per classificare violazioni |
| `reportDir` | `string` | `'a11y-reports'` | Directory di output (relativa a cwd) |
| `format` | `'markdown' \| 'json'` | `'markdown'` | Formato report |
| `dark` | `boolean` | `true` | Eseguire il pass dark mode |
| `containers` | `Record<string, string>` | `{}` | Override container contexts (si sommano al preset) |
| `defaultBg` | `string` | `'bg-background'` | Classe sfondo globale di default |
| `pageBg` | `{ light, dark }` | `{ '#ffffff', '#09090b' }` | Sfondo pagina per alpha compositing |
| `preset` | `string?` | — | Nome preset da caricare (es. `'shadcn'`) |
| `tailwindPalette` | `string?` | auto-detected | Path esplicito a `tailwindcss/theme.css` |

### Preset: come funzionano

Un preset e un oggetto `ContainerConfig` predefinito che mappa nomi di componenti al loro sfondo implicito. Attualmente esiste un unico preset: **`shadcn`**.

```typescript
// src/plugins/tailwind/presets/shadcn.ts
export const shadcnPreset: ContainerConfig = {
  containers: new Map([
    ['Card', 'bg-card'],
    ['CardHeader', 'bg-card'],
    ['CardContent', 'bg-card'],
    ['CardFooter', 'bg-card'],
    ['DialogContent', 'bg-background'],
    ['SheetContent', 'bg-background'],
    ['DrawerContent', 'bg-background'],
    ['AlertDialogContent', 'bg-background'],
    ['PopoverContent', 'bg-popover'],
    ['DropdownMenuContent', 'bg-popover'],
    ['DropdownMenuSubContent', 'bg-popover'],
    ['ContextMenuContent', 'bg-popover'],
    ['ContextMenuSubContent', 'bg-popover'],
    ['MenubarContent', 'bg-popover'],
    ['SelectContent', 'bg-popover'],
    ['Command', 'bg-popover'],
    ['TooltipContent', 'bg-popover'],
    ['HoverCardContent', 'bg-popover'],
    ['AccordionItem', 'bg-background'],
    ['TabsContent', 'bg-background'],
    ['Alert', 'bg-background'],
  ]),
  defaultBg: 'bg-background',
  pageBg: { light: '#ffffff', dark: '#09090b' },
};
```

**Abilitare il preset**: Basta specificare `preset: 'shadcn'` nel config o `--preset shadcn` via CLI.

**Override dei container**: Le entry in `containers` del config utente vengono **merged** sopra il preset. Questo permette di aggiungere componenti custom o sovrascrivere quelli del preset:

```javascript
// a11y-audit.config.js
export default {
  preset: 'shadcn',
  containers: {
    // Aggiunge un componente custom
    NavigationMenuContent: 'bg-popover',
    // Sovrascrive il background di Card dal preset
    Card: 'bg-muted',
  },
};
```

### Interface `ContainerConfig`

```typescript
// src/plugins/interfaces.ts
interface ContainerConfig {
  /** Component name → default bg class (es. "Card" → "bg-card") */
  readonly containers: ReadonlyMap<string, string>;
  /** Default page background class (es. "bg-background") */
  readonly defaultBg: string;
  /** Page background hex per theme (per alpha compositing) */
  readonly pageBg: { light: string; dark: string };
}
```

Il `pageBg` e usato dal contrast checker come base per il compositing di colori semi-trasparenti. `#ffffff` per light mode (bianco puro) e `#09090b` per dark mode (zinc-950, il tipico sfondo dark di shadcn/ui).

---

## 6. Algoritmi e Logica

### 6.1 Alpha Compositing

I colori con alpha devono essere "appiattiti" contro il loro sfondo prima di calcolare il contrasto. La formula e il **blending lineare** (Porter-Duff "source over"):

```
result_channel = fg_channel * alpha + bg_channel * (1 - alpha)
```

Il processo e a **due livelli** (`src/core/contrast-checker.ts`):

```
                    Page Background
                    (#ffffff light / #09090b dark)
                           |
                           v
Step 1:  bg has alpha? --> compositeOver(bgHex, pageBg, bgAlpha)
                           |
                           v
                      effectiveBg (opaque hex)
                           |
                           v
Step 2:  fg has alpha? --> compositeOver(fgHex, effectiveBg, fgAlpha)
                           |
                           v
                      effectiveFg (opaque hex)
                           |
                           v
Step 3:  colord(effectiveBg).contrast(colord(effectiveFg))
                           |
                           v
                      ratio (es. 4.56)
```

**`parseHexRGB(hex)`** (`contrast-checker.ts:147`): Converte hex 6-digit in `{r, g, b}`. Se il formato e invalido, logga warning e restituisce nero `{0,0,0}` come fallback sicuro.

**`compositeOver(fgHex, bgHex, alpha)`** (`contrast-checker.ts:131`): Implementa la formula canale per canale, arrotonda e restituisce hex 6-digit.

### 6.2 Soglie WCAG

Il parametro `violationLevel: ConformanceLevel` (default: `'AA'`) controlla quale soglia determina una violazione:

| Tipo coppia | Testo | Soglia AA | Soglia AAA | Riferimento |
|-------------|-------|-----------|------------|-------------|
| Testo normale | `< 18px` o `< 14px bold` | **4.5:1** | **7.0:1** | SC 1.4.3 / SC 1.4.6 |
| Testo grande | `>= 18px` o `>= 14px bold` | **3.0:1** | **4.5:1** | SC 1.4.3 / SC 1.4.6 |
| Non-testo (border/ring/outline) | Qualsiasi | **3.0:1** | **4.5:1** | SC 1.4.11 |

La logica (`contrast-checker.ts:46-58`):

```typescript
const isNonText = pair.pairType && pair.pairType !== 'text';
if (violationLevel === 'AAA') {
  isViolation = isNonText || pair.isLargeText
    ? !result.passAAALarge : !result.passAAA;
} else {
  isViolation = isNonText || pair.isLargeText
    ? !result.passAALarge : !result.passAA;
}
```

Se la coppia ha `ignored: true` (da `// a11y-ignore`), finisce in `ignored[]` anziche in `violations[]`.

### 6.3 APCA (Accessible Perceptual Contrast Algorithm)

Ogni coppia calcola anche il valore APCA Lc (Lightness Contrast) tramite `calcAPCA()` di `apca-w3`. A differenza del ratio WCAG, APCA e un valore con segno:

- **Negativo** → testo scuro su sfondo chiaro
- **Positivo** → testo chiaro su sfondo scuro
- **|Lc| >= 60** ≈ equivalente AA (approssimativo)
- **|Lc| > 100** ≈ contrasto massimo (nero/bianco)

Il calcolo APCA e **non-blocking**: se fallisce (colore non parsabile), `apcaLc` resta `null`. Attualmente e solo informativo — non influenza la determinazione di violazione.

### 6.4 Gestione Dark Mode: Bucket-then-Filter

**Problema**: In Tailwind, `bg-white dark:bg-slate-900` significa "bianco in light mode, slate-900 in dark mode". Se il dark mode analizzasse entrambe le classi, creerebbe coppie fantasma.

**Soluzione**: Strategia **bucket-then-filter** in `categorizeClasses()` (`src/plugins/jsx/categorizer.ts:360`):

```
Input (dark mode): ['bg-white', 'dark:bg-slate-900', 'text-gray-100', 'dark:text-white']

Step 1 -- Bucket temporaneo:
  darkBgBucket:   [{ base:'bg-white', isDark:false }, { base:'bg-slate-900', isDark:true }]
  darkTextBucket: [{ base:'text-gray-100', isDark:false }, { base:'text-white', isDark:true }]

Step 2 -- Override check:
  hasDarkBg = true   (esiste almeno un isDark in darkBgBucket)
  hasDarkText = true

Step 3 -- Filtro:
  bgClasses  <- solo isDark=true  -> [bg-slate-900]     (bg-white scartato)
  textClasses <- solo isDark=true -> [text-white]        (text-gray-100 scartato)
```

Se **non** ci sono `dark:bg-*`, allora le classi base vengono tutte incluse (nessun override). Questa logica si applica solo a bg e text. Border/ring/outline vengono filtrati direttamente.

### 6.5 Gestione Stati Interattivi: Ereditarieta CSS

`hover:bg-red-600` in Tailwind genera CSS che, in hover, sovrascrive SOLO il background. Il colore del testo rimane quello base.

```
Base classes:        bg-white, text-black, border-gray-300
Interactive:         hover:bg-red-600

                     +=====================================+
                     |  Per lo stato hover:                 |
                     |    bg:     hover:bg-red-600 (override)|
                     |    text:   text-black (ereditato)    |
                     |    border: border-gray-300 (ereditato)|
                     +=====================================+
```

Nel codice (`region-resolver.ts:256-259`):

```typescript
const stateBg = stateClasses.bgClasses.length > 0
  ? stateClasses.bgClasses : effectiveBg;    // override o inherit
const stateText = stateClasses.textClasses.length > 0
  ? stateClasses.textClasses : textClasses;   // override o inherit
```

**INTERACTIVE_PREFIX_MAP** definisce quali prefissi sono "tracked" (generano coppie verificabili):

| Prefix | InteractiveState | Tracked? | Motivazione |
|--------|-----------------|----------|-------------|
| `hover:` | `'hover'` | Si | SC 1.4.11 per componenti UI |
| `focus-visible:` | `'focus-visible'` | Si | SC 1.4.11 per componenti UI |
| `aria-disabled:` | `'aria-disabled'` | Si | Leggibilita stati disabilitati |
| `focus:` | — | No | Scartata |
| `active:` | — | No | Troppo transitorio |
| `sm:` / `md:` / ... | — | No | Breakpoint, non stati |

### 6.6 Large Text Detection

**WCAG definisce "testo grande"**: >= 18pt (24px) qualsiasi peso, oppure >= 14pt bold (18.67px).

**Mapping Tailwind → pixel** (`src/plugins/jsx/categorizer.ts`):

| Classe | Pixel | Large? |
|--------|-------|--------|
| `text-base` (16px) | 16 | No |
| `text-lg` (18px) | 18 | **No** (< 18.67px soglia) |
| `text-xl` (20px) | 20 | Solo se bold (`font-bold`, `font-extrabold`, `font-black`) |
| `text-2xl` (24px) | 24 | **Si** (sempre) |
| `text-3xl`+ | 30+ | **Si** |

**Strategia conservativa**: Se non c'e una classe dimensione esplicita, si assume testo normale → soglia 4.5:1. Meglio falsi positivi che falsi negativi.

**Root font-size**: `extractRootFontSize()` in `css-resolver.ts` legge il valore di `font-size` da `html {}` o `:root {}` nel CSS. Supporta `px`, `%`, e `rem`. Default: 16px. Attualmente esposto in `ThemeColorMaps.rootFontSizePx` per uso futuro — i set `ALWAYS_LARGE` e `LARGE_IF_BOLD` restano hardcoded alle soglie Tailwind standard.

### 6.7 Context Stack — Sfondo Implicito dei Container

**Problema**: `<Card><p className="text-red-500">` non ha un `bg-*` esplicito. Senza context, verrebbe confrontato con `bg-background` (il default globale), ma `Card` ha sfondo `bg-card`.

**Soluzione**: Stack LIFO in `extractClassRegions()` (`src/plugins/jsx/parser.ts:241`):

```
Inizializzazione:  [{ component: '_root', bg: defaultBg }]

<Card>             push { component: 'Card', bg: 'bg-card' }
  <CardContent>    push { component: 'CardContent', bg: 'bg-card' }
    <p className=  currentContext() -> 'bg-card'
  </CardContent>   pop (component match)
</Card>            pop (component match)
```

Il pop avviene solo se il nome del tag chiuso corrisponde al `component` in cima allo stack. Questo previene corruzione da tag HTML standard (`</div>`).

**Annotation-driven entries**: Le annotazioni `@a11y-context-block` aggiungono entry allo stack con prefisso `_annotation_` (es. `_annotation_div`). Queste entry si comportano come i container normali — definiscono il `contextBg` per i figli — ma vengono poppate alla chiusura del tag annotato. Se `noInherit: true`, i figli del blocco non ereditano l'override (utile per annotazioni che si applicano solo all'elemento diretto).

```
{/* @a11y-context-block bg:#09090b */}
<div>                push { component: '_annotation_div', bg: '#09090b', isAnnotation: true }
  <p className=      currentContext() -> '#09090b'
</div>               pop (match '_annotation_div')
<p className=        currentContext() -> defaultBg (torna al contesto precedente)
```

**Override esplicito**: Se un container ha un `bg-*` esplicito nelle sue props (`<Card className="bg-white">`), `findExplicitBgInTag()` scansiona gli attributi del tag e usa quel colore al posto del default.

**Self-closing**: `isSelfClosingTag()` distingue `<Card />` (nessun push) da `<Card>...</Card>` (push + pop). Rispetta `{}` e stringhe dentro le props per evitare falsi positivi su `>` nelle espressioni.

### 6.8 Risoluzione classe → hex (`resolveClassToHex`)

**File**: `src/plugins/tailwind/css-resolver.ts:275`

```
'bg-red-500/50'
      |
      v  regex strip prefisso 'bg-'
'red-500/50'
      |
      v  parsing opacity modifier
colorName = 'red-500', opacityAlpha = 0.5
      |
      v  costruzione CSS var
cssVar = '--color-red-500'
      |
      v  colorMap.get(cssVar)
ResolvedColor { hex: '#ef4444', alpha: undefined }
      |
      v  combineAlpha(undefined, 0.5)
finalAlpha = 0.5
      |
      v
return { hex: '#ef4444', alpha: 0.5 }
```

**Casi gestiti per l'opacita**:

1. **Slash numeric**: `red-500/50` → 50/100 = 0.5
2. **Slash bracket**: `red-500/[0.37]` → 0.37 diretto
3. **Slash bracket %**: `red-500/[50%]` → 50/100 = 0.5
4. **Bracket in mezzo**: `[#ff0000]/50` → arbitrary value + opacity
5. **Nessuno**: `red-500` → alpha undefined (opaco)

### 6.9 Soppressione `// a11y-ignore`

**Pattern riconosciuti** (`src/plugins/jsx/categorizer.ts:586`):

```
// a11y-ignore
// a11y-ignore: mutually exclusive ternary
{/* a11y-ignore: decorative border */}
```

**Dove deve essere**: Il commento deve trovarsi sulla stessa riga o sulla riga immediatamente precedente al `className=`. Le coppie soppresse finiscono in `IgnoredViolation[]` con `ignoreReason`, vengono mostrate nel report ma non incrementano il conteggio delle violazioni e non causano `process.exit(1)`.

### 6.10 Annotazioni `@a11y-context` e `@a11y-context-block`

**Problema**: L'analisi statica inferisce lo sfondo dal DOM nesting (context stack), ma in molti casi il contesto visivo reale e diverso da quello strutturale:

- **Posizionamento assoluto/fixed**: Un badge `position: absolute` su un overlay scuro viene verificato contro il parent DOM (spesso bianco), non contro lo sfondo visivo reale
- **React Portals**: Il contenuto renderizzato via portal ha un parent DOM diverso dal parent visuale
- **`currentColor`**: Classi come `border-current` ereditano il colore testo, ma il tool non puo inferirlo

**Soluzione**: Due annotazioni comment-based che permettono di sovrascrivere il contesto inferito.

**Sintassi**:

```
// @a11y-context bg:<valore> [fg:<valore>]           → singolo elemento (riga successiva)
{/* @a11y-context bg:<valore> [fg:<valore>] */}       → singolo elemento (JSX)
// @a11y-context-block bg:<valore> [no-inherit]       → blocco (tutti i figli)
{/* @a11y-context-block bg:<valore> [no-inherit] */}  → blocco (JSX)
```

I valori possono essere classi Tailwind (`bg-slate-900`) o hex letterali (`#09090b`).

**Flusso dati**:

```
Commento nel sorgente
       |
       v  getContextOverrideForLine() (categorizer.ts)
ContextOverride { bg?, fg?, noInherit? }
       |
       v  parser.ts (state machine)
       |
       ├── @a11y-context     → pendingOverride → attaccato al ClassRegion successivo
       └── @a11y-context-block → push su contextStack con prefisso _annotation_
       |
       v  region-resolver.ts (resolveFileRegions)
       |
       ├── bg override → sovrascrive contextBg
       ├── fg override → sovrascrive textClasses con classe sintetica
       └── contextSource = 'annotation' su tutte le coppie generate
       |
       v  report/markdown.ts
       Footnote marker (†) sulle coppie con contextSource === 'annotation'
```

**Esempio pratico** — badge floating su overlay scuro:

```jsx
{/* @a11y-context bg:#09090b */}
<span className="text-white absolute top-0">Badge</span>
```

Senza l'annotazione, `text-white` verrebbe verificato contro `bg-background` (#ffffff) → violazione. Con l'annotazione, viene verificato contro `#09090b` → passa.

**Esempio blocco** — dialog con sfondo custom:

```jsx
{/* @a11y-context-block bg:bg-background */}
<div>
  <h2 className="text-foreground">Title</h2>
  <p className="text-slate-600">Body</p>
</div>
```

Tutte le coppie dentro il `<div>` usano `bg-background` come sfondo, indipendentemente dal context stack.

**Pattern riconosciuti** (`src/plugins/jsx/categorizer.ts`):

```
// @a11y-context bg:#09090b
// @a11y-context bg:bg-slate-900 fg:text-white
{/* @a11y-context-block bg:bg-background */}
{/* @a11y-context-block bg:#1a1a2e no-inherit */}
```

**Implementazione nel parser**: Il parsing delle annotazioni avviene nelle stesse sezioni di skip dei commenti (`//` e `/* */`) gia usate per `a11y-ignore`. Due regex separate distinguono `@a11y-context` (negative lookahead per `-block`) da `@a11y-context-block`. I parametri vengono estratti con `parseAnnotationParams()` che riconosce i token `bg:`, `fg:`, e `no-inherit`.

**Report**: Le coppie con `contextSource === 'annotation'` sono marcate con `†` nella colonna Background del report Markdown. Una nota a pie di pagina spiega il significato del simbolo.

---

## 7. Strutture Dati Chiave

### ResolvedColor

```typescript
interface ResolvedColor {
  hex: string           // 6-digit hex opaco: '#ef4444'
  alpha?: number        // 0-1. undefined = completamente opaco
}
```

Il **perche** della separazione hex/alpha: il compositing richiede di operare sui canali separatamente. Se l'alpha fosse pre-composito nell'hex, si perderebbe l'informazione per il compositing a due stadi.

### ColorMap e RawPalette

```typescript
type ColorMap = Map<string, ResolvedColor>;   // '--color-primary' -> { hex, alpha? }
type RawPalette = Map<string, string>;         // '--color-sky-700' -> '#0369a1'
```

### TaggedClass

```typescript
interface TaggedClass {
  raw: string                              // 'dark:hover:bg-red-600' (originale)
  isDark: boolean                          // true se dark: era presente
  isInteractive: boolean                   // true se qualsiasi variant interattiva era presente
  interactiveState: InteractiveState | null // 'hover' | 'focus-visible' se tracked
  base: string                             // 'bg-red-600' (dopo stripping)
}
```

### ContextOverride

```typescript
interface ContextOverride {
  /** Classe Tailwind (es. 'bg-slate-900') o hex letterale (es. '#09090b') */
  bg?: string
  /** Classe Tailwind (es. 'text-white') o hex letterale (es. '#ffffff') */
  fg?: string
  /** Quando true, i children del blocco non ereditano l'override */
  noInherit?: boolean
}
```

Prodotto da `getContextOverrideForLine()` (`categorizer.ts`) quando un commento `@a11y-context` o `@a11y-context-block` e presente sulla riga corrente o precedente. Viene attaccato al `ClassRegion` durante il parsing e usato dal resolver per sovrascrivere bg/fg inferiti.

### ClassRegion

```typescript
interface ClassRegion {
  content: string       // Testo estratto dal className
  startLine: number     // Numero di riga 1-based
  contextBg: string     // Sfondo implicito del container (es. 'bg-card')
  inlineStyles?: {      // Colori da style={{ ... }}
    color?: string
    backgroundColor?: string
  }
  contextOverride?: ContextOverride  // Override da @a11y-context annotation
}
```

### ColorPair e ContrastResult

```typescript
interface ColorPair {
  file: string
  line: number
  bgClass: string
  textClass: string
  bgHex: string | null
  textHex: string | null
  bgAlpha?: number
  textAlpha?: number
  isLargeText?: boolean
  pairType?: 'text' | 'border' | 'ring' | 'outline'
  interactiveState?: InteractiveState | null
  ignored?: boolean
  ignoreReason?: string
  contextSource?: 'inferred' | 'annotation'  // 'annotation' se overridden via @a11y-context
}

interface ContrastResult extends ColorPair {
  ratio: number
  passAA: boolean        // ratio >= 4.5
  passAALarge: boolean   // ratio >= 3.0
  passAAA: boolean       // ratio >= 7.0
  passAAALarge: boolean  // ratio >= 4.5
  apcaLc?: number | null
}
```

### AuditResult

```typescript
interface AuditResult {
  filesScanned: number
  pairsChecked: number
  violations: ContrastResult[]
  passed: ContrastResult[]
  skipped: SkippedClass[]
  ignored: IgnoredViolation[]
}
```

### PreExtracted e FileRegions

```typescript
interface FileRegions {
  relPath: string
  lines: string[]
  regions: ClassRegion[]
}

interface PreExtracted {
  files: FileRegions[]
  readErrors: SkippedClass[]
  filesScanned: number
}
```

`PreExtracted` e il prodotto della Phase 1, completamente agnostico rispetto al tema. Viene passato due volte a `resolveFileRegions()` (light + dark).

---

## 8. Extensibility Guide

### 8.1 Aggiungere un Componente Container

Quando si aggiunge un componente UI che funge da superficie con sfondo proprio (es. un custom `Accordion`, `NavigationMenu`), il tool deve sapere quale sfondo implicito usa. Altrimenti il testo interno verra confrontato con `bg-background` (il fallback root).

**Nella v1.0, non serve modificare il codice sorgente.** Aggiornare il file di configurazione:

```javascript
// a11y-audit.config.js
export default {
  preset: 'shadcn',
  containers: {
    // Nuovo componente: testo interno verificato contro bg-popover
    NavigationMenuContent: 'bg-popover',
    // Componente custom con sfondo scuro
    DarkSidebar: 'bg-slate-900',
  },
};
```

**Regole**:
- Il nome del componente e **case-sensitive** e deve corrispondere al tag JSX (`Card`, non `card`)
- Solo i componenti **non self-closing** vengono tracciati (il tag deve avere children)
- Se il componente ha un `bg-*` esplicito nelle sue props (`<Card className="bg-white">`), il valore nel config viene automaticamente sovrascitto da `findExplicitBgInTag()`

**Verifica**: Eseguire `npx a11y-audit --verbose` e controllare che le coppie dentro il nuovo componente mostrino `(implicit) bg-popover` anziche `(implicit) bg-background`.

### 8.2 Cambiare lo sfondo di default della pagina

Se il progetto usa uno sfondo pagina diverso da `bg-background`:

```javascript
export default {
  defaultBg: 'bg-slate-50',
  pageBg: {
    light: '#f8fafc',  // hex di slate-50
    dark: '#0f172a',   // hex di slate-900
  },
};
```

`defaultBg` controlla quale classe viene usata come fallback quando non c'e nessun container ne bg esplicito. `pageBg` controlla il colore hex usato per l'alpha compositing (il "foglio" sotto tutti i livelli).

### 8.3 Scansionare file diversi da `.tsx`

```javascript
export default {
  src: [
    'src/**/*.tsx',
    'src/**/*.jsx',
    'app/**/*.tsx',     // Next.js app router
  ],
};
```

### 8.4 Usare un path Tailwind custom

In monorepo dove `tailwindcss` e installato nella root o in un pacchetto diverso:

```javascript
export default {
  tailwindPalette: '../../node_modules/tailwindcss/theme.css',
};
```

Se non specificato, `findTailwindPalette(cwd)` cerca automaticamente nella directory corrente.

### 8.5 Scrivere un Preset custom

Creare un modulo che esporta un `ContainerConfig`:

```javascript
// my-preset.js
export const myPreset = {
  containers: new Map([
    ['AppShell', 'bg-surface'],
    ['Sidebar', 'bg-surface-dark'],
    ['Modal', 'bg-overlay'],
  ]),
  defaultBg: 'bg-surface',
  pageBg: { light: '#fafafa', dark: '#1a1a2e' },
};
```

Poi usarlo programmaticamente:

```typescript
import { runAudit } from 'a11y-audit';
import { myPreset } from './my-preset.js';

runAudit({
  // ...
  containerConfig: myPreset,
});
```

### 8.6 Aggiungere filtri non-colore

Se Tailwind aggiunge nuove utility con prefisso ambiguo e il report mostra "Unresolvable border color: border-spacing-3" negli skipped, la classe va aggiunta al Set corretto. Questo richiede una modifica al codice sorgente in `src/plugins/jsx/categorizer.ts`:

| Set | Prefisso | File | Esempio |
|-----|----------|------|---------|
| `TEXT_NON_COLOR` | `text-` | `categorizer.ts:4` | `text-balance`, `text-wrap` |
| `BG_NON_COLOR` | `bg-` | `categorizer.ts:44` | `bg-clip-text`, `bg-fixed` |
| `BORDER_NON_COLOR` | `border-` | `categorizer.ts:55` | `border-spacing-3` |
| `RING_NON_COLOR` | `ring-` | `categorizer.ts:106` | `ring-inset`, `ring-offset-2` |
| `OUTLINE_NON_COLOR` | `outline-` | `categorizer.ts:120` | `outline-hidden` |

---

## 9. Testing

### Struttura (384 test TS across 16 file + 41 test Rust across 5 moduli)

Il test suite e organizzato in quattro livelli (TS) piu i test Rust:

1. **Unit test puri** (no I/O, no mock): Testano funzioni pure con input → output deterministico
2. **I/O test con mock** (`*.io.test.ts`): Isolano `readFileSync`/`globSync` tramite `vi.mock()`
3. **Integration test**: Full pipeline su fixture files
4. **Property-based test** (`*.property.test.ts`): Invarianti matematici su input casuali (`fast-check`)

```
src/config/__tests__/
  schema.test.ts                       # Zod schema validation + defaults

src/core/__tests__/
  color-utils.test.ts                  # toHex: hex/oklch/hsl/display-p3/rgb
  contrast-checker.test.ts             # compositeOver, parseHexRGB, checkAllPairs, AAA, APCA
  contrast-checker.property.test.ts    # fast-check: compositeOver, parseHexRGB bounds
  integration.test.ts                  # Full pipeline: extract -> resolve -> check -> report

src/core/report/__tests__/
  markdown.test.ts                     # generateReport: snapshot, empty, violations, truncation
  json.test.ts                         # generateJsonReport: structured output, summary

src/plugins/tailwind/__tests__/
  css-resolver.test.ts                 # resolveClassToHex, extractBalancedBraces, parseThemeInline
  css-resolver.io.test.ts             # buildThemeColorMaps con vi.mock('node:fs')
  css-resolver.property.test.ts       # fast-check: combineAlpha bounds
  palette.io.test.ts                  # extractTailwindPalette con vi.mock('node:fs')

src/plugins/jsx/__tests__/
  categorizer.test.ts                  # stripVariants, categorizeClasses, routeClassToTarget
  categorizer.property.test.ts        # fast-check: stripVariants idempotency
  parser.test.ts                       # extractClassRegions state machine, isSelfClosingTag
  region-resolver.test.ts              # buildEffectiveBg, generatePairs, resolveFileRegions
  region-resolver.io.test.ts           # extractAllFileRegions con vi.mock('node:fs', 'glob')
```

**Test Rust** (41 test, `cargo test` dalla directory `native/`):

```text
native/src/math/
  hex.rs            # 8 test: parse_hex_rgb, extract_hex_alpha, strip_hex_alpha
  composite.rs      # 4 test: composite_over (black/white, midpoint, full opacity)
  wcag.rs           # 11 test: luminance, contrast ratio, thresholds (cross-validated vs colord)
  apca.rs           # 6 test: calc_apca_lc (cross-validated vs apca-w3, ±1.0 Lc tolerance)
  color_parse.rs    # 12 test: to_hex (hex, rgb, hsl, oklch, named, transparent, inherit)
```

I test Rust usano un approccio **cross-validation**: i valori ground truth sono generati dalle librerie TS (`colord`, `apca-w3`, `culori`) e salvati come fixture JSON in `native/tests/fixtures/`. I test Rust verificano che l'output corrisponda entro tolleranze definite (±1 per canale RGB, ±1.0 per APCA Lc).

### Convenzioni

- **Co-located**: I test vivono in `__tests__/` accanto al modulo che testano, non in una directory `tests/` separata.
- **I/O isolation**: I test con `vi.mock()` vivono in file separati (`*.io.test.ts`) perche `vi.mock()` e hoisted a livello di file e non puo essere scopato a un singolo `describe`. Questo previene la contaminazione dei test puri.
- **Property-based**: Usano `fast-check` per generare ~5000 input casuali e verificare invarianti matematici (bounds dei canali RGB, round-trip conversions, idempotenza dello stripping, commutativita dell'alpha).
- **`makePair()` helpers**: I test usano factory helpers per creare fixture con defaults sensati + override puntuali.

### Comandi

```bash
# TypeScript
npm test                  # vitest run (tutti i test)
npm run test:watch        # vitest in watch mode
npx vitest run src/core/__tests__/contrast-checker.test.ts   # singolo file
npx vitest run -t "compositeOver"                            # singolo test per nome
npm run typecheck         # tsc --noEmit (strict mode)

# Rust native engine
cd native && cargo test                    # tutti i 41 test Rust
cd native && cargo test math::apca         # singolo modulo
cd native && cargo build                   # debug build → target/debug/
npm run build:native                       # release build → *.node
```

---

## 10. Limitazioni Note e Blind Spot

| Limitazione | Causa | Impatto | Workaround |
|-------------|-------|---------|------------|
| Pseudo-elementi (`before:bg-*`, `after:text-*`) | Non in `INTERACTIVE_PREFIX_MAP` | Silenziosamente scartati | Bassa priorita — rari in pratica |
| `group-hover:`, `peer-hover:` | In `VARIANT_PREFIXES` ma non tracked | Scartati come interattivi | Non verificabili staticamente (dipendono dal parent) |
| CSS inline `style={{}}` | Supporto parziale: solo hex letterali | Variabili CSS, espressioni JS, `rgb()`/`hsl()` non rilevati | Raro nel codebase Tailwind-first |
| `@apply` in CSS | Il tool legge solo file template, non `.css` | Non analizzati | Raro — solo in file di configurazione globali |
| Ternari cross-branch | `cond ? 'bg-A text-A' : 'bg-B text-B'` → audit vede bg-A+text-B | Falsi positivi | `// a11y-ignore: mutually exclusive ternary` |
| cva cross-variant | cva estrae tutti i letterali da tutte le varianti | Falsi positivi | `// a11y-ignore: cross-variant cva` |
| Posizionamento assoluto/fixed | DOM nesting ≠ visual nesting | Falsi positivi/negativi per elementi sovrapposti | `// @a11y-context bg:<sfondo-reale>` |
| React Portals | Portal renderizza fuori dal parent DOM | Sfondo inferito errato | `// @a11y-context bg:<sfondo-reale>` |
| Trasparenze impilate | Compositing solo contro il container piu vicino | Hex leggermente diverso dal reale | Impatto trascurabile in pratica |
| `1rem = 16px` hardcoded | ALWAYS_LARGE/LARGE_IF_BOLD usano pixel statici | Se root font-size cambia, soglie imprecise | `rootFontSizePx` e disponibile per futura integrazione |

### Precisione Numerica

| Operazione | Precisione | Note |
|-----------|-----------|------|
| oklch → hex (`culori`) | ±0.5/255 per canale | Arrotondamento a 8 bit |
| Contrast ratio (`colord`) | 2 decimali | `Math.round(ratio * 100) / 100` |
| Alpha compositing | ±1/255 per canale | `Math.round()` per canale RGB |
| Alpha threshold | `< 0.999` = semi-trasparente | Evita falsi positivi da floating point |
| APCA Lc (Rust vs TS) | ±1.0 Lc | Differenze `f64` nei soft clamp edge case |
| WCAG ratio (Rust vs TS) | ±0.1 | Cross-validato contro `colord` su 8 pairs |

### Classi non riconosciute: fail-safe

Se una classe sconosciuta sfugge ai filtri non-colore, il tool:
1. Tenta `resolveClassToHex()` → cerca `--color-{name}` → non trovato → `null`
2. Finisce in `skipped[]` con reason "Unresolvable text color"

Nessun falso positivo ne falso negativo. L'unico effetto e un leggero rumore nella sezione "Skipped Classes" del report.

---

## 11. CI/CD e Manuale Operativo

### Exit Codes

| Exit Code | Significato | Quando |
|-----------|-------------|--------|
| **0** | Successo | Zero violazioni (ignored e skipped non contano) |
| **1** | Violazioni trovate | `totalViolations > 0` |
| **2** | Errore fatale | Config non trovato, file CSS mancanti, crash |

La v1.0 distingue exit code 1 (violazioni) da exit code 2 (errori). Questo permette alla CI di differenziare i due casi.

### Output

| Artefatto | Path | Formato |
|-----------|------|---------|
| Report Markdown | `{reportDir}/audit-YYYY-MM-DD.md` | Markdown |
| Report JSON | `{reportDir}/audit-YYYY-MM-DD.json` | JSON strutturato |
| Log console | stderr (con `--verbose`) | Testo plain con progress |

Il report non viene mai sovrascritto: se il file esiste, un suffisso incrementale viene aggiunto (`-1`, `-2`, ..., fino a `-99`).

### Esempio GitHub Actions

```yaml
name: A11y Contrast Audit

on:
  pull_request:
    paths:
      - 'src/**/*.tsx'
      - 'src/**/*.css'

jobs:
  a11y-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'

      - run: npm ci

      - name: Run a11y contrast audit
        id: audit
        run: npx a11y-audit --verbose
        continue-on-error: true

      - name: Upload audit report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: a11y-audit-report
          path: a11y-reports/
          retention-days: 30

      - name: Fail if violations found
        if: steps.audit.outcome == 'failure'
        run: exit 1
```

**Punti chiave**:
- `continue-on-error: true` permette di caricare l'artefatto anche in caso di violazioni
- Il report viene sempre caricato (`if: always()`)
- `npx a11y-audit` usa la CLI compilata direttamente — non serve `tsx` ne build step aggiuntivo

---

## 12. Troubleshooting

### Tabella Diagnostica

| Sintomo | Causa Probabile | Soluzione |
|---------|----------------|-----------|
| `Cannot find tailwindcss/theme.css from /path` | `tailwindcss` non installato o in un path non standard | Eseguire `npm install tailwindcss` oppure settare `tailwindPalette` nel config |
| `Error: Config file not found at /path/custom.js` | Path esplicito `--config` errato | Verificare il path. Senza `--config`, il tool cerca automaticamente |
| No config file trovato (nessun errore) | Nessun `a11y-audit.config.js` presente | Il tool usa i default dello schema Zod. Creare un config file per personalizzare |
| `Unknown preset "xyz"` | Preset non riconosciuto | Attualmente supportato solo `shadcn`. Usare `containers` per mapping custom |
| "Unresolvable background: bg-custom" | `--color-custom` non definita nei file CSS | Aggiungere la variabile in uno dei file CSS specificati nel config |
| "Dynamic class (template expression)" in skipped | Classe contiene `$` (es. `${isActive ? 'bg-red' : 'bg-blue'}`) | Non un errore — il tool non risolve espressioni dinamiche. Verificare manualmente |
| `[a11y-audit] Skipping src/...: ENOENT` | File non leggibile (permessi, encoding, symlink rotto) | Verificare il file con `ls -la`, encoding UTF-8 |
| "Malformed hex: ... defaulting to black" | `toHex()` ha prodotto un hex non valido | Controllare il valore raw nel CSS. Formato non supportato da `culori`? |
| Report mostra `(implicit) bg-background` dentro un `<Card>` | Container non nel preset/config **oppure** tag self-closing | Aggiungere in `containers` nel config. Verificare che nel JSX il tag abbia children |
| Falsi positivi da ternari condizionali | `cond ? 'bg-A text-A' : 'bg-B text-B'` | `// a11y-ignore: mutually exclusive ternary` |
| Falsi positivi da `cva()` | cva mette tutte le varianti nello stesso pool | `// a11y-ignore: cross-variant cva` |
| 0 file trovati | Pattern glob non corrisponde o cwd errata | Verificare `src` nel config. Eseguire dalla root del progetto |
| Dark mode mostra centinaia di violazioni | L'app non ha dark mode implementato | Atteso. Usare `--no-dark` o `dark: false` nel config |
| Report JSON vuoto | `format` non specificato (default: markdown) | Usare `--format json` o `format: 'json'` nel config |
| CSS variables non risolte | File CSS non inclusi nel config | Aggiungere tutti i file CSS rilevanti in `css: [...]` |

### FAQ

**Q: Posso eseguire l'audit solo su un file specifico?**
A: Si. Usa `--src 'src/components/MyFile.tsx'` o specificalo nel config.

**Q: Posso disabilitare l'audit dark mode?**
A: Si. Usa `--no-dark` via CLI o `dark: false` nel config.

**Q: Come faccio a sapere se un `// a11y-ignore` e stato rilevato?**
A: Controlla la sezione "Ignored Violations" nel report. Ogni coppia soppressa e elencata con file, riga, ratio e motivo.

**Q: Perche `border-input` su `bg-background` viene segnalato?**
A: SC 1.4.11 richiede 3:1 per elementi non-testo. Bordi decorativi sono esenti — usa `// a11y-ignore: decorative border`.

**Q: Il tool funziona in monorepo?**
A: Si. `findTailwindPalette()` cerca `node_modules/tailwindcss/theme.css` partendo dalla directory corrente. Se Tailwind e installato nella root del monorepo, specificare `tailwindPalette` nel config con il path relativo corretto.

**Q: Posso avere output sia Markdown che JSON?**
A: Non nella stessa esecuzione. Eseguire due volte con `--format markdown` e `--format json`, oppure usare l'API programmatica.

**Q: Come uso `@a11y-context` per correggere un falso positivo da posizionamento assoluto?**
A: Aggiungi un commento sulla riga precedente al `className=` con lo sfondo reale: `// @a11y-context bg:#09090b` (hex) o `// @a11y-context bg:bg-slate-900` (classe Tailwind). Nel report, la coppia sara marcata con `†`.

**Q: Qual e la differenza tra `@a11y-context` e `@a11y-context-block`?**
A: `@a11y-context` si applica solo all'elemento immediatamente successivo (singola riga). `@a11y-context-block` si applica a tutti i figli del tag successivo (push/pop sul context stack). Usare `-block` per dialog, overlay, o sezioni con sfondo uniforme.

**Q: Posso sovrascrivere sia bg che fg con `@a11y-context`?**
A: Si. Usa `// @a11y-context bg:#09090b fg:text-white`. L'override `fg:` sostituisce tutte le classi testo estratte con una classe sintetica.

---

## 13. Glossario

| Termine | Significato |
|---------|-------------|
| **ColorMap** | Dizionario variabile CSS → colore risolto, prodotto per-tema |
| **RawPalette** | Dizionario variabile → hex grezzo, pre-risoluzione |
| **TaggedClass** | Classe Tailwind annotata con flag dark/interactive dopo lo stripping |
| **ClassRegion** | Blocco di testo `className=` estratto con metadati di linea e contesto |
| **ColorPair** | Accoppiamento bg+fg pronto per il contrast check |
| **PreExtracted** | Risultato I/O-agnostico dell'estrazione, riusabile per entrambi i temi |
| **ContrastResult** | ColorPair arricchito con ratio e verdetti pass/fail |
| **Compositing** | Appiattimento di un colore trasparente su uno sfondo opaco |
| **Tracked state** | Pseudo-classe CSS che genera coppie verificabili (hover, focus-visible, aria-disabled) |
| **Context stack** | Stack LIFO che traccia lo sfondo implicito dei container JSX annidati. Include entry da container config e da `@a11y-context-block` |
| **ContextOverride** | Override di contesto da annotazione `@a11y-context` o `@a11y-context-block`. Contiene bg?, fg?, noInherit? |
| **`@a11y-context`** | Annotazione comment-based che sovrascrive il contesto bg/fg per un singolo elemento |
| **`@a11y-context-block`** | Annotazione comment-based che sovrascrive il contesto bg per tutti i figli di un blocco (push sul context stack) |
| **Preset** | Set predefinito di container contexts (es. `shadcn` = 21 componenti) |
| **Pipeline** | Sequenza di 5 fasi: config → bootstrap → extract → resolve → report |
| **Native Engine** | Modulo Rust compilato via NAPI-RS che sostituisce gli hot path TS (math + parser) |
| **NAPI-RS** | Framework per esporre funzioni Rust a Node.js tramite N-API. `#[napi]` per funzioni, `#[napi(object)]` per struct |
| **Black soft clamp** | Operazione APCA che aggiunge luminanza ai colori molto scuri (`Y < 0.022`) per evitare artefatti nel calcolo Lc |
| **Cross-validation** | Approccio di test: ground truth generati dalle librerie TS, verificati contro l'implementazione Rust |
