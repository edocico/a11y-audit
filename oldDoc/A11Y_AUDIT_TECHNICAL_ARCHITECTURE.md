# Architettura Tecnica: a11y-audit Tool (v4.0)

> **Ultimo aggiornamento**: 2026-02-12 | **Versione**: 4.0 P3 + TDD Retrofit Step 3 | **343 tests across 10 files, branch coverage >91%**

---

## 1. Panoramica del Sistema

### Scopo

Il tool esegue un'**analisi statica** dei file `.tsx` del progetto per verificare la conformità WCAG 2.1 AA dei rapporti di contrasto tra colori. Non opera a runtime né in un browser: legge i file sorgente, risolve le classi Tailwind in colori hex e calcola i rapporti matematicamente.

### Cosa NON fa

- Non esegue rendering DOM (nessun headless browser)
- Supporto parziale per CSS inline (`style={{ color: '#hex', backgroundColor: '#hex' }}`): rileva solo valori hex letterali, non variabili CSS né espressioni JS
- Non cattura pseudo-elementi (`before:`, `after:`) né group-state (`group-hover:`)
- Non valida `@apply` o gradienti

### Stack Tecnologico

| Dipendenza | Scopo | Perché questa |
|-----------|-------|---------------|
| **TypeScript** (ES2022, `tsx` runner) | Linguaggio + esecuzione diretta senza build step | `tsx` interpreta TS al volo — nessuna compilazione necessaria per script CLI |
| **`culori`** (via `tailwind-palette.ts`) | Parsing e conversione di colori oklch/hsl → hex | Tailwind v4 usa `oklch()` nativamente. `culori` è l'unica libreria che gestisce oklch con precisione subpixel. Nessun tipo bundled → custom `culori.d.ts` |
| **`colord`** + plugin `a11y` (via `contrast-checker.ts`) | Calcolo del contrast ratio WCAG | `colord` implementa la formula W3C con `.contrast()`. Il plugin a11y estende l'API base |
| **`apca-w3`** (via `contrast-checker.ts`) | Calcolo APCA Lightness Contrast (Lc) | Algoritmo next-gen di contrasto percettivo (W3 Silver). Complementare al ratio WCAG. Custom `apca-w3.d.ts` (no bundled types) |
| **`glob`** (`globSync`) | File discovery | Pattern matching ricorsivo di `**/*.tsx` nella directory `src/` |
| **`fast-check`** (dev, via `property-based.test.ts`) | Property-based testing | Genera input casuali per validare invarianti matematici (bounds, round-trip, idempotenza, commutatività) |
| **Node.js `fs`, `path`** | I/O filesystem | Lettura file sorgente, CSS, palette Tailwind, scrittura report |

### Perché tre librerie colore?

`culori` gestisce il **parsing** di formati esotici (oklch con lightness percentuale, hsl con sintassi moderna). `colord` con il plugin a11y implementa il **calcolo del contrasto** secondo la formula WCAG esatta. `apca-w3` calcola il valore APCA Lc — un algoritmo di contrasto percettivo complementare al ratio WCAG. Sono complementari: `culori` non ha `.contrast()`, `colord` non parsa oklch, e nessuna delle due implementa APCA.

---

## 2. Struttura dei File

```
scripts/a11y-audit/
├── index.ts                 # Entry point, orchestratore della pipeline
├── file-scanner.ts          # Estrazione classi (state machine), categorizzazione, pairing
├── css-parser.ts            # Risoluzione classi Tailwind → hex tramite catena di variabili CSS
├── contrast-checker.ts      # Calcolo contrasto WCAG con alpha compositing
├── report-generator.ts      # Generazione report Markdown
├── tailwind-palette.ts      # Estrazione palette colori da tailwindcss/theme.css
├── jsx-context-config.ts    # Mappa container JSX → sfondo implicito (21 componenti shadcn)
├── types.ts                 # Interfacce condivise
├── apca-w3.d.ts             # Dichiarazioni tipo manuali per apca-w3 (no bundled types)
├── culori.d.ts              # Dichiarazioni tipo manuali per culori (ESM, no bundled types)
├── tsconfig.json            # Isolato dal root — include solo scripts/a11y-audit/**/*.ts
├── vitest.config.ts         # root: __dirname per evitare leak dei test React
└── tests/
    ├── contrast-checker.test.ts       # 31 test — compositeOver, parseHexRGB, checkAllPairs, AAA, APCA
    ├── css-parser.test.ts             # 72 test — resolveClassToHex, extractBalancedBraces,
    │                                  #           parseThemeInline, alpha, combineAlpha, resolveAll (M4-M6)
    ├── css-parser.io.test.ts          # 7 test — buildThemeColorMaps con vi.mock('node:fs'):
    │                                  #           lettura file, risoluzione light/dark, M7 fallback dark→light
    ├── file-scanner.test.ts           # 119 test — stripVariants, categorizeClasses, routeClassToTarget,
    │                                  #            extractClassRegions, isSelfClosingTag (M20), findExplicitBgInTag,
    │                                  #            extractInlineStyleColors (M19), malformed JSX (M10)
    ├── file-scanner.io.test.ts        # 10 test — extractAllFileRegions con vi.mock('node:fs', 'glob'):
    │                                  #            glob pattern, read errors (C4), container context, relative paths
    ├── integration.test.ts            # 12 test — full pipeline: extract → resolve → check → report su 3 fixture
    ├── report-generator.test.ts       # 13 test — generateReport snapshot, empty, violations, truncation
    ├── tailwind-palette.test.ts       # 22 test — toHex: hex/oklch/hsl/display-p3/rgb/special values
    ├── tailwind-palette.io.test.ts    # 7 test — extractTailwindPalette con vi.mock('node:fs'):
    │                                  #           lettura path, conversione oklch, warning, file vuoto
    ├── property-based.test.ts         # 19 test — fast-check: compositeOver (5), parseHexRGB (3),
    │                                  #           stripVariants (6), combineAlpha (5) — ~5000 input casuali
    └── __snapshots__/                 # Vitest snapshot files (report-generator, integration)
```

---

## 3. Flusso di Esecuzione (The Pipeline)

```
                                    ┌──────────────────┐
                                    │   main.theme.css  │
                                    │     main.css      │
                                    │  tailwindcss/     │
                                    │    theme.css      │
                                    └────────┬─────────┘
                                             │
                                             ▼
┌─────────┐    ┌──────────────────────────────────────────┐
│ Phase 0  │    │         buildThemeColorMaps()             │
│ Bootstrap│───▶│  css-parser.ts + tailwind-palette.ts      │
│          │    │  Output: ColorMap (light) + ColorMap (dark)│
└─────────┘    └────────────────────┬─────────────────────┘
                                    │
                                    ▼
┌─────────┐    ┌──────────────────────────────────────────┐
│ Phase 1  │    │       extractAllFileRegions()             │
│ Extract  │───▶│  file-scanner.ts (state machine)          │
│ (1 volta)│    │  Input: src/**/*.tsx                       │
│          │    │  Output: PreExtracted { files, readErrors }│
└─────────┘    └────────────────────┬─────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
┌──────────────────────────┐  ┌──────────────────────────────┐
│  resolveFileRegions()    │  │  resolveFileRegions()         │
│  Theme: LIGHT            │  │  Theme: DARK                  │
│  ColorMap: light         │  │  ColorMap: dark               │
│  Output: ColorPair[]     │  │  Output: ColorPair[]          │
└────────────┬─────────────┘  └──────────────┬───────────────┘
             ▼                                ▼
┌──────────────────────────┐  ┌──────────────────────────────┐
│  checkAllPairs()         │  │  checkAllPairs()              │
│  contrast-checker.ts     │  │  contrast-checker.ts          │
│  Output: AuditResult     │  │  Output: AuditResult          │
└────────────┬─────────────┘  └──────────────┬───────────────┘
             │                                │
             └───────────────┬────────────────┘
                             ▼
              ┌──────────────────────────┐
              │    generateReport()       │
              │    report-generator.ts    │
              │    Output: Markdown file  │
              └──────────────────────────┘
```

### 3.1 Phase 0: Bootstrap — Costruzione delle Color Map

**File**: `css-parser.ts`, `tailwind-palette.ts`

**Obiettivo**: Costruire due `ColorMap` (light + dark) che mappano ogni variabile CSS (es. `--color-primary`) al suo valore hex finale.

**Catena di risoluzione**:

```
Tailwind class: bg-primary
       │
       ▼ (resolveClassToHex: rimuove prefisso "bg-")
CSS Variable: --color-primary
       │
       ▼ (colorMap.get)
@theme inline block: --color-primary: var(--primary)
       │
       ▼ (resolveVar: segue la catena var())
:root block: --primary: var(--color-sky-700)
       │
       ▼ (resolveVar: segue la catena var())
Tailwind palette: --color-sky-700: oklch(45.41% 0.188 231.535)
       │
       ▼ (toHex: culori parse + formatHex)
Hex: #0369a1
```

**Passaggi nel codice**:

1. **`extractTailwindPalette()`** (`tailwind-palette.ts`): Legge `node_modules/tailwindcss/theme.css`, estrae tutte le variabili `--color-*` con regex e converte i valori oklch in hex tramite `culori.parse()` + `culori.formatHex()`. Produce una `RawPalette` (Map\<string, string\>).

2. **`parseBlock(css, selector)`** (`css-parser.ts`): Trova tutti i blocchi CSS per un dato selettore (`:root` o `.dark`) e ne estrae le variabili. Usa `extractBalancedBraces()` (conteggio profondità `{}`), non regex non-greedy, per gestire blocchi annidati.

3. **`parseThemeInline(css)`**: Estrae le variabili dai blocchi `@theme inline { ... }` — la sintassi CSS-first di Tailwind v4 per i token semantici. Filtra solo `--color-*`.

4. **`resolveAll(blockVars, themeInlineVars, twPalette)`**: Unisce le tre sorgenti in ordine di priorità crescente (palette → block → theme inline) e risolve ricorsivamente ogni variabile tramite `resolveVar()`. Profondità massima: 10 livelli. Supporta: `var(--x)`, `var(--x, #fallback)`, `var(--x, var(--y))`.

5. **Fallback dark → light**: Dopo la risoluzione, le variabili presenti solo in light vengono copiate nel dark map come fallback.

**Alpha preservation**: L'intera catena preserva l'alpha channel. Se un colore oklch ha alpha < 1, `toHex()` restituisce hex a 8 digit (`#rrggbbaa`). `hexToResolved()` separa i 6 digit base dall'alpha e restituisce `ResolvedColor { hex, alpha? }`.

### 3.2 Phase 1: Extraction — State Machine Parsing

**File**: `file-scanner.ts` → `extractAllFileRegions()` e `extractClassRegions()`

**Obiettivo**: Trovare tutti i `className=` nei file `.tsx`, estrarne il contenuto, e annotarli con metadati di contesto (linea, sfondo implicito del container).

#### Architettura Extract-Once/Resolve-Twice (v3.4)

```
extractAllFileRegions()          ← I/O + parsing (UNA volta)
         │
         ▼
   PreExtracted {
     files: FileRegions[]        ← per ogni file: relPath, lines[], regions[]
     readErrors: SkippedClass[]  ← file non leggibili (try-catch C4)
     filesScanned: number
   }
         │
    ┌────┴────┐
    ▼         ▼
resolveFileRegions(light)    resolveFileRegions(dark)   ← risoluzione per-tema (DUE volte)
```

Questa separazione elimina la doppia lettura dei file da disco e il doppio parsing della state machine.

#### La State Machine (`extractClassRegions`)

Scansiona il sorgente **carattere per carattere** (non riga per riga). Gestisce:

| Pattern | Come lo trova | Come estrae il contenuto |
|---------|--------------|-------------------------|
| `className="..."` | Confronto stringa `source.startsWith('className=', i)` + virgoletta dopo `=` | `source.slice(start, end)` fino alla virgoletta chiusa |
| `className={'...'}` | `{` dopo `=`, poi virgoletta/apice dentro | `findUnescaped()` per trovare la chiusura della stringa |
| `` className={`...`} `` | Backtick dopo `{` | Template literal con rimozione di `${...}` (sostituiti con spazi) |
| `className={cn(...)}` | `cn(` o `clsx(` dopo `{` | `extractBalancedParens()`: conta `()` annidati, rispetta stringhe e template |
| `cn(...)` standalone | `cn(`, `clsx(`, `cva(` non preceduti da char identificatore | Stesso `extractBalancedParens()` |
| `style={{ color: '#hex' }}` | Scansione backward/forward dal `className=` per trovare il tag `<...>`, poi match di `style={{...}}` | Regex per `color:` e `backgroundColor:` con valori stringa hex letterali |

**Perché non regex?** Le regex non gestiscono parentesi annidate (`cn('a', cond && 'b')`) né stringhe multilinea con escape. La state machine traccia lo stato di annidamento con contatori di profondità.

**Lookup linea**: Pre-calcola un array `lineBreaks[]` con gli offset dei `\n` in un singolo pass O(n). Poi `lineAt(offset)` usa binary search O(log n) per convertire offset → numero di riga. L'alternativa naive (cercare il `\n` per ogni offset) sarebbe O(n*m).

#### Context Stack (container impliciti)

Oltre a estrarre le classi, la state machine traccia i **tag JSX aperti** che corrispondono a container con sfondo implicito (configurati in `jsx-context-config.ts`).

```
<Card>                          ← push { component: 'Card', bg: 'bg-card' }
  <p className="text-red-500">  ← region.contextBg = 'bg-card' (ereditato)
</Card>                         ← pop stack
```

**21 container** tracciati (Card, DialogContent, PopoverContent, ecc.), derivati dalla libreria shadcn/ui.

**Override esplicito**: Se un container ha un `bg-*` esplicito nelle sue props (`<Card className="bg-white">`), `findExplicitBgInTag()` scansiona gli attributi del tag e usa quel colore al posto del default.

**Self-closing**: `isSelfClosingTag()` distingue `<Card />` (nessun push) da `<Card>...</Card>` (push + pop). Rispetta `{}` e stringhe dentro le props per evitare falsi positivi su `>` inside expressions.

### 3.3 Phase 2: Resolution — Classe → ColorPair

**File**: `file-scanner.ts` → `resolveFileRegions()`

**Obiettivo**: Per ogni `ClassRegion` estratta, determinare tutti gli accoppiamenti (bg + fg) e risolvere ciascuno in hex.

#### 3.3.1 Estrazione classi dalla regione

```
region.content = "'bg-red-500 text-white hover:bg-red-600', isActive && 'ring-2 ring-primary'"
                                        │
                                        ▼ (hasQuotes → extractStringLiterals)
allClasses = ['bg-red-500', 'text-white', 'hover:bg-red-600', 'ring-2', 'ring-primary']
```

- Se il contenuto ha virgolette/apici → è da `cn()`/`clsx()` → `extractStringLiterals()` estrae i letterali
- Altrimenti → split su whitespace

#### 3.3.2 Stripping varianti e categorizzazione

Ogni classe passa per `stripVariants()`:

```
'dark:hover:bg-red-600'
    │
    ▼ stripVariants()
TaggedClass {
  raw:              'dark:hover:bg-red-600'
  base:             'bg-red-600'
  isDark:           true
  isInteractive:    true
  interactiveState: 'hover'       ← tracked (hover: è in INTERACTIVE_PREFIX_MAP)
}
```

**Stripping iterativo**: Un `while` loop rimuove un prefisso alla volta dall'inizio della stringa. Ogni iterazione setta i flag appropriati. `dark:hover:bg-...` → prima toglie `dark:` (isDark=true), poi `hover:` (isInteractive=true, interactiveState='hover').

Poi `categorizeClasses()` smista le classi in bucket:

```
┌─────────────────────────────────────────────────────────────────┐
│                     categorizeClasses()                          │
│                                                                  │
│  Input: allClasses[], themeMode                                  │
│                                                                  │
│  Per ogni classe:                                                │
│    ├─ contiene '$' → dynamicClasses (skipped)                    │
│    ├─ isInteractive + interactiveState tracked                   │
│    │    └─ routeToStateBucket() → interactiveStates Map          │
│    ├─ isInteractive + NON tracked (sm:, active:, ...)            │
│    │    └─ SCARTATA (non verificabile staticamente)              │
│    ├─ isDark + light mode → SCARTATA                             │
│    ├─ dark mode → temp bucket (dark override logic)              │
│    └─ light mode / non-dark →                                    │
│         routeClassToTarget() → bgClasses | textClasses |         │
│                                 borderClasses | ringClasses |    │
│                                 outlineClasses                   │
│                                                                  │
│  Cattura anche: fontSize, isBold (per large text detection)      │
└─────────────────────────────────────────────────────────────────┘
```

**Filtri non-colore**: Ogni categoria ha un Set di utility che NON sono colori:
- `TEXT_NON_COLOR` (33 voci): `text-center`, `text-xs`, `text-wrap`, ecc.
- `BG_NON_COLOR` (7 voci): `bg-cover`, `bg-clip-text`, ecc.
- `BORDER_NON_COLOR` (56 voci): `border-2`, `border-solid`, `border-t-4`, ecc.
- `RING_NON_COLOR` (11 voci): `ring-2`, `ring-inset`, `ring-offset-*`
- `OUTLINE_NON_COLOR` (13 voci): `outline-hidden`, `outline-2`, `outline-offset-*`

**`routeClassToTarget()`** è il singolo punto di routing (DRY): dato un `TaggedClass` e un bucket target, smista per prefisso (`bg-`, `text-`, `border-`/`divide-`, `ring-`, `outline-`) dopo aver escluso i non-colore. Usato sia per le classi base che per le interattive.

#### 3.3.3 Pairing e risoluzione colore (v4.0 P3 — God Function decomposition)

`resolveFileRegions()` (~80 LOC) orchestra due funzioni estratte:

**`buildEffectiveBg(bgClasses, contextBg, inlineStyles?)`** — risolve lo sfondo effettivo:

1. Se ci sono classi bg esplicite → le usa direttamente
2. Altrimenti → fallback al contextBg dal context stack
3. Se `inlineStyles.backgroundColor` contiene un hex literal → sovrascrive tutto

**`generatePairs(fgGroups, effectiveBg, meta, colorMap, hasExplicitBg, contextBg)`** — generazione unificata delle coppie. Un'unica funzione (~60 LOC) gestisce tutti e 4 i modi di pairing:

```
ForegroundGroup[] = [
  { classes: textClasses },                          ← SC 1.4.3
  { classes: borderClasses, pairType: 'border' },    ← SC 1.4.11
  { classes: ringClasses,   pairType: 'ring' },      ← SC 1.4.11
  { classes: outlineClasses, pairType: 'outline' }   ← SC 1.4.11
]
```

**Comportamento skip** (controllato da `isText` e `isInteractive`):

- **Interattivo**: tutti gli irrisolvibili → skip silenzioso (la base li ha già riportati)
- **Base testo + bg esplicito irrisolvibile** → skip con ragione
- **Base testo + bg implicito irrisolvibile** → coppia con `bgHex: null`
- **Base non-testo + bg irrisolvibile** → skip silenzioso

**Tipi**: `ForegroundGroup` (classi + pairType opzionale), `PairMeta` (file/riga/ignoreReason/isLargeText/interactiveState), `GeneratedPairs` (pairs + skipped).

**CSS inheritance per stati interattivi**: `resolveFileRegions()` calcola l'ereditarietà prima di chiamare `generatePairs()`:
- Se esiste `hover:bg-*`, sovrascrive il bg base; altrimenti eredita
- Se esiste `hover:text-*`, sovrascrive; altrimenti eredita il text base
- Stessa logica per border/ring/outline

Ogni `ColorPair` viene annotato con `interactiveState: 'hover' | 'focus-visible' | 'aria-disabled' | null`.

#### 3.3.4 Risoluzione classe → hex (`resolveClassToHex`)

```
'bg-red-500/50'
      │
      ▼ regex strip prefisso 'bg-'
'red-500/50'
      │
      ▼ parsing opacity modifier
colorName = 'red-500', opacityAlpha = 0.5
      │
      ▼ costruzione CSS var
cssVar = '--color-red-500'
      │
      ▼ colorMap.get(cssVar)
ResolvedColor { hex: '#ef4444', alpha: undefined }
      │
      ▼ combineAlpha(undefined, 0.5)
finalAlpha = 0.5
      │
      ▼
return { hex: '#ef4444', alpha: 0.5 }
```

**Casi gestiti per l'opacità**:
1. **Slash numeric**: `red-500/50` → 50/100 = 0.5
2. **Slash bracket**: `red-500/[0.37]` → 0.37 diretto
3. **Slash bracket %**: `red-500/[50%]` → 50/100 = 0.5
4. **Bracket in mezzo**: `[#ff0000]/50` → arbitrary value + opacity
5. **Nessuno**: `red-500` → alpha undefined (opaco)

**`combineAlpha()`**: Combina due canali alpha moltiplicandoli. `combineAlpha(0.8, 0.5) = 0.4`. Se il risultato è >= 0.999, restituisce `undefined` (opaco).

### 3.4 Phase 3: Validation — Calcolo WCAG

**File**: `contrast-checker.ts`

**Obiettivo**: Per ogni `ColorPair`, calcolare il contrast ratio e determinare se supera la soglia.

#### Alpha Compositing

I colori con alpha devono essere "appiattiti" contro il loro sfondo prima di calcolare il contrasto. La formula è il **blending lineare**:

```
result_channel = fg_channel * alpha + bg_channel * (1 - alpha)
```

Il processo è a **due livelli**:

```
                    Page Background
                    (#ffffff light / #09090b dark)
                           │
                           ▼
Step 1:  bg has alpha? ──▶ compositeOver(bgHex, pageBg, bgAlpha)
                           │
                           ▼
                      effectiveBg (opaque hex)
                           │
                           ▼
Step 2:  fg has alpha? ──▶ compositeOver(fgHex, effectiveBg, fgAlpha)
                           │
                           ▼
                      effectiveFg (opaque hex)
                           │
                           ▼
Step 3:  colord(effectiveBg).contrast(colord(effectiveFg))
                           │
                           ▼
                      ratio (es. 4.56)
```

**`parseHexRGB()`**: Converte hex 6-digit in `{r, g, b}`. Validazione: se il formato è invalido, logga warning e restituisce nero `{0,0,0}` come fallback sicuro (non crasha).

**`compositeOver()`**: Implementa la formula canale per canale, arrotonda e restituisce hex 6-digit.

#### Soglie WCAG

Il parametro `violationLevel: ConformanceLevel` (default: `'AA'`) controlla quale soglia determina una violazione:

| Tipo coppia | Testo | Soglia AA | Soglia AAA | Riferimento |
| ----------- | ----- | --------- | ---------- | ----------- |
| Testo normale | `< 18px` o `< 14px bold` | **4.5:1** | **7.0:1** | SC 1.4.3 / SC 1.4.6 |
| Testo grande | `>= 18px` o `>= 14px bold` | **3.0:1** | **4.5:1** | SC 1.4.3 / SC 1.4.6 |
| Non-testo (border/ring/outline) | Qualsiasi | **3.0:1** | **4.5:1** | SC 1.4.11 |

La logica di determinazione:

```typescript
const isNonText = pair.pairType && pair.pairType !== 'text';
let isViolation: boolean;
if (violationLevel === 'AAA') {
  isViolation = isNonText || pair.isLargeText ? !result.passAAALarge : !result.passAAA;
} else {
  isViolation = isNonText || pair.isLargeText ? !result.passAALarge : !result.passAA;
}
```

Se la coppia ha `ignored: true` (da `// a11y-ignore`), finisce in `ignored[]` anziché in `violations[]`.

#### APCA (Accessible Perceptual Contrast Algorithm)

Ogni coppia calcola anche il valore APCA Lc (Lightness Contrast) tramite `calcAPCA()` di `apca-w3`. A differenza del ratio WCAG, APCA è un valore con segno:

- **Negativo** → testo scuro su sfondo chiaro
- **Positivo** → testo chiaro su sfondo scuro
- **|Lc| >= 60** ≈ equivalente AA (approssimativo)
- **|Lc| > 100** ≈ contrasto massimo (nero/bianco)

Il calcolo APCA è **non-blocking**: se fallisce (colore non parsabile), `apcaLc` resta `null`. Attualmente è solo informativo — non influenza la determinazione di violazione.

### 3.5 Phase 4: Report Generation

**File**: `report-generator.ts`

Genera un file Markdown con:

1. **Summary table**: File scansionati, coppie controllate, violazioni (text/non-text x base/interactive), ignorati, skippati
2. **Per-theme sections** (light, dark):
   - Violazioni testo (SC 1.4.3): tabella per file con colonne Line, State, Background, Foreground, Size, Ratio, AA, AA Large
   - Violazioni non-testo (SC 1.4.11): tabella per file con Line, State, Type, Element, Against, Ratio, 3:1
3. **Ignored violations**: Raggruppati per file con motivo della soppressione
4. **Skipped classes**: Prime 50 classi non risolvibili (dynamic, unresolvable), deduplicate tra temi

Il file viene salvato in `a11y-reports/audit-YYYY-MM-DD.md` con suffisso incrementale se il file esiste già.

---

## 4. Strutture Dati Chiave

### 4.1 ResolvedColor

```typescript
interface ResolvedColor {
  hex: string           // 6-digit hex opaco: '#ef4444'
  alpha?: number        // 0-1. undefined = completamente opaco
}
```

Il **perché** della separazione hex/alpha: il compositing richiede di operare sui canali separatamente. Se l'alpha fosse pre-composito nell'hex, si perderebbe l'informazione per il compositing a due stadi.

### 4.2 ColorMap e RawPalette

```typescript
type ColorMap = Map<string, ResolvedColor>;   // Chiave: '--color-primary' → { hex, alpha? }
type RawPalette = Map<string, string>;         // Chiave: '--color-sky-700' → '#0369a1' (solo hex grezzo)
```

`RawPalette` è il formato intermedio prima della risoluzione completa. `ColorMap` è il prodotto finale usabile da `resolveClassToHex()`.

### 4.3 TaggedClass

```typescript
interface TaggedClass {
  raw: string                              // 'dark:hover:bg-red-600' (originale)
  isDark: boolean                          // true se dark: era presente
  isInteractive: boolean                   // true se qualsiasi variant interattiva era presente
  interactiveState: InteractiveState | null // 'hover' | 'focus-visible' se tracked, null altrimenti
  base: string                             // 'bg-red-600' (dopo stripping)
}
```

**Perché due boolean?** `isDark` e `isInteractive` sono indipendenti perché `dark:hover:bg-red-600` è sia dark che interactive. Il filtro dark si applica in base al themeMode; il filtro interactive si applica sempre (le classi interattive non-tracked vengono scartate, quelle tracked vanno nei bucket di stato).

### 4.4 ClassBuckets

```typescript
interface ClassBuckets {
  bgClasses: TaggedClass[]
  textClasses: TaggedClass[]
  borderClasses: TaggedClass[]
  ringClasses: TaggedClass[]
  outlineClasses: TaggedClass[]
}
```

Interfaccia condivisa da `CategorizedClasses` (bucket principale) e `StateClasses` (alias per i bucket per-stato). Questo garantisce che `routeClassToTarget()` funzioni con entrambi i tipi senza duplicazione.

### 4.5 ClassRegion

```typescript
interface ClassRegion {
  content: string       // Testo estratto dal className (es. "'bg-red-500 text-white', isActive && 'ring-primary'")
  startLine: number     // Numero di riga 1-based del className= nel sorgente
  contextBg: string     // Sfondo implicito del container (es. 'bg-card' dentro <Card>)
  inlineStyles?: {      // (v4.0 P2) Colori estratti da style={{ ... }} sullo stesso tag
    color?: string            // es. '#ff0000' — diventa text-[#ff0000] in risoluzione
    backgroundColor?: string  // es. '#ffffff' — sovrascrive bg in risoluzione
  }
}
```

Rappresenta il "token" intermedio tra la fase di estrazione e quella di risoluzione. Il campo `inlineStyles` è popolato da `extractInlineStyleColors()`, che scansiona il tag JSX contenente il `className=` alla ricerca di un attributo `style={{ }}` con proprietà `color` o `backgroundColor` con valori hex letterali.

### 4.6 ColorPair

```typescript
interface ColorPair {
  file: string               // Path relativo del file sorgente
  line: number               // Numero di riga del className=
  bgClass: string            // Classe sfondo (es. 'bg-red-500' o '(implicit) bg-card')
  textClass: string          // Classe foreground (testo, border, ring o outline)
  bgHex: string | null       // Hex risolto dello sfondo
  textHex: string | null     // Hex risolto del foreground
  bgAlpha?: number           // Alpha dello sfondo (0-1)
  textAlpha?: number         // Alpha del foreground (0-1)
  isLargeText?: boolean      // true se qualifica come testo grande WCAG
  pairType?: 'text' | 'border' | 'ring' | 'outline'  // Tipo di coppia
  interactiveState?: InteractiveState | null           // hover/focus-visible o null (base)
  ignored?: boolean          // true se soppresso via // a11y-ignore
  ignoreReason?: string      // Motivo della soppressione
}
```

### 4.7 ContrastResult e AuditResult

```typescript
interface ContrastResult extends ColorPair {
  ratio: number          // Es. 4.56
  passAA: boolean        // ratio >= 4.5
  passAALarge: boolean   // ratio >= 3.0
  passAAA: boolean       // ratio >= 7.0
  passAAALarge: boolean  // ratio >= 4.5
  apcaLc?: number | null // APCA Lightness Contrast (null se calcolo fallito)
}

type ConformanceLevel = 'AA' | 'AAA';

interface AuditResult {
  filesScanned: number
  pairsChecked: number
  violations: ContrastResult[]   // Fallite E non ignorate
  passed: ContrastResult[]       // Superate
  skipped: SkippedClass[]        // Non risolvibili
  ignored: IgnoredViolation[]    // Fallite MA con // a11y-ignore
}
```

### 4.8 PreExtracted e FileRegions

```typescript
interface FileRegions {
  relPath: string
  lines: string[]              // Righe del file (per lookup a11y-ignore)
  regions: ClassRegion[]       // Regioni className estratte
}

interface PreExtracted {
  files: FileRegions[]
  readErrors: SkippedClass[]   // File non leggibili
  filesScanned: number
}
```

`PreExtracted` è il prodotto della Phase 1, completamente agnostico rispetto al tema. Viene passato due volte a `resolveFileRegions()` (light + dark).

---

## 5. Algoritmi e Trasformazioni

### 5.1 Gestione Dark Mode: Bucket-then-Filter

**Problema**: In Tailwind, `bg-white dark:bg-slate-900` significa "bianco in light mode, slate-900 in dark mode". Se il dark mode analizzasse entrambe le classi, creerebbe coppie fantasma (bg-white + dark text).

**Soluzione**: Strategia **bucket-then-filter** in `categorizeClasses()`:

```
Input (dark mode): ['bg-white', 'dark:bg-slate-900', 'text-gray-100', 'dark:text-white']

Step 1 — Bucket temporaneo:
  darkBgBucket:   [{ base:'bg-white', isDark:false }, { base:'bg-slate-900', isDark:true }]
  darkTextBucket: [{ base:'text-gray-100', isDark:false }, { base:'text-white', isDark:true }]

Step 2 — Override check:
  hasDarkBg = true   (esiste almeno un isDark in darkBgBucket)
  hasDarkText = true

Step 3 — Filtro:
  bgClasses  ← solo isDark=true  → [bg-slate-900]     (bg-white scartato)
  textClasses ← solo isDark=true → [text-white]        (text-gray-100 scartato)
```

Se **non** ci sono `dark:bg-*`, allora le classi base vengono tutte incluse (nessun override).

Questa logica si applica solo a bg e text. Border/ring/outline non usano temp bucket — vengono filtrati direttamente (dark: skip in light, passa in dark).

### 5.2 Gestione Stati Interattivi: Ereditarietà CSS

**Contesto**: `hover:bg-red-600` in Tailwind genera CSS che, in hover, sovrascrive SOLO il background. Il colore del testo rimane quello base.

**Implementazione**:

```
Base classes:        bg-white, text-black, border-gray-300
Interactive:         hover:bg-red-600

                     ╔═══════════════════════════════════════╗
                     ║  Per lo stato hover:                   ║
                     ║    bg:     hover:bg-red-600 (override) ║
                     ║    text:   text-black (ereditato)      ║
                     ║    border: border-gray-300 (ereditato) ║
                     ╚═══════════════════════════════════════╝
```

Nel codice:

```typescript
const stateBgClasses = stateClasses.bgClasses.length > 0
  ? stateClasses.bgClasses      // override
  : effectiveBgClasses;          // inherit from base

const stateTextClasses = stateClasses.textClasses.length > 0
  ? stateClasses.textClasses
  : textClasses;                 // inherit from base
```

**INTERACTIVE_PREFIX_MAP** definisce quali prefissi sono "tracked" (generano coppie verificabili):

| Prefix | InteractiveState | Tracked? |
|--------|-----------------|----------|
| `hover:` | `'hover'` | Si |
| `focus-visible:` | `'focus-visible'` | Si |
| `aria-disabled:` | `'aria-disabled'` | Si |
| `focus:` | — | No (scartata) |
| `active:` | — | No |
| `sm:` / `md:` / ... | — | No |

**Perché hover, focus-visible e aria-disabled?** `hover:` e `focus-visible:` sono le pseudo-classi per cui il contrasto è un requisito WCAG esplicito (SC 1.4.11 per componenti UI). `aria-disabled:` è stato aggiunto (v4.0 P2) perché i componenti disabilitati spesso usano colori a basso contrasto che possono violare le soglie di leggibilità. `active:` è troppo transitorio, i breakpoint responsive non sono stati.

### 5.3 Large Text Detection

**WCAG definisce "testo grande"**: >= 18pt (24px) qualsiasi peso, oppure >= 14pt bold (18.67px, che arrotondato è 19px).

**Mapping Tailwind → pixel**:

| Classe | Pixel | Large? |
|--------|-------|--------|
| `text-base` (16px) | 16 | No |
| `text-lg` (18px) | 18 | **No** (< 18.67px soglia) |
| `text-xl` (20px) | 20 | Solo se bold |
| `text-2xl` (24px) | 24 | **Si** (sempre) |
| `text-3xl`+ | 30+ | **Si** |

**Strategia conservativa**: Se non c'è una classe dimensione esplicita, si assume testo normale → soglia 4.5:1. Meglio falsi positivi che falsi negativi.

**Root font-size configurabile** (v4.0 P2): `extractRootFontSize()` in `css-parser.ts` legge il valore di `font-size` da `html {}` o `:root {}` nel CSS. Supporta `px`, `%` (relativa a 16px), e `rem`. Se non trovato, il default rimane 16px. Questo valore è esposto in `ThemeColorMaps.rootFontSizePx` e loggato durante l'esecuzione della pipeline. Attualmente usato per documentazione — in futuro potrà sostituire l'assunzione hardcoded `1rem = 16px` nelle soglie di large text.

### 5.4 Soppressione `// a11y-ignore`

**Pattern riconosciuti**:
```
// a11y-ignore
// a11y-ignore: mutually exclusive ternary
{/* a11y-ignore: decorative border */}
```

**Dove deve essere**: La state machine registra `region.startLine` (la riga del `className=`). Il controllo cerca il pattern sulla riga corrente O sulla riga precedente (`startLine - 1`). Questo significa che il commento deve essere **direttamente sopra** o **sulla stessa riga** del `className=`.

**Cosa succede quando ignorato**: La coppia finisce in `IgnoredViolation[]` con `ignoreReason`, viene mostrata nel report ma non incrementa il conteggio delle violazioni e non causa `process.exit(1)`.

### 5.5 Context Stack — Sfondo Implicito dei Container

**Problema**: `<Card><p className="text-red-500">` non ha un `bg-*` esplicito. Senza context, verrebbe confrontato con `bg-background` (il default globale), ma `Card` ha sfondo `bg-card` (che potrebbe essere diverso).

**Soluzione**: Stack LIFO in `extractClassRegions()`:

```
Inizializzazione:  [{ component: '_root', bg: 'bg-background' }]

<Card>             push { component: 'Card', bg: 'bg-card' }
  <CardContent>    push { component: 'CardContent', bg: 'bg-card' }
    <p className=  currentContext() → 'bg-card'
  </CardContent>   pop (component match)
</Card>            pop (component match)
```

**Validazione del pop**: Il pop avviene solo se il nome del tag chiuso corrisponde al `component` in cima allo stack. Questo previene corruzione da tag HTML standard (`</div>`) che non sono nel config.

---

## 6. Limitazioni Note e Blind Spot

| Limitazione | Causa | Impatto | Workaround |
|-------------|-------|---------|------------|
| Pseudo-elementi (`before:bg-*`, `after:text-*`) | Non in `VARIANT_PREFIXES` | Silenziosamente scartati | Aggiungere a `VARIANT_PREFIXES` (bassa priorità) |
| `group-hover:`, `peer-hover:` | In `VARIANT_PREFIXES` ma non in `INTERACTIVE_PREFIX_MAP` | Scartati come interattivi non-tracked | Non verificabili staticamente (dipendono dal parent) |
| `dark:hover:` compound | `isInteractive` check eseguito prima del dark filter | Skippati (entrambi i flag settati) | Noto, verrà affrontato quando il dark mode sarà implementato |
| CSS inline `style={{}}` | Supporto parziale (v4.0 P2): solo `color` e `backgroundColor` con valori hex letterali | Variabili CSS, espressioni JS e `rgb()`/`hsl()` non rilevati | Raro nel codebase (Tailwind-first). I pochi casi con valori non-hex sono edge cases |
| `@apply` in CSS | Lo script legge solo `.tsx`, non `.css` | Non analizzati | Raro — solo in file di configurazione globali |
| Ternari cross-branch | `cond ? 'bg-A text-A' : 'bg-B text-B'` → audit vede bg-A+text-B | Falsi positivi | `// a11y-ignore: mutually exclusive ternary` |
| cva cross-variant | cva estrae tutti i letterali da tutte le varianti | Falsi positivi | `// a11y-ignore: cross-variant cva` |
| `}` in commenti CSS in `@theme` | `extractBalancedBraces` conta profondità senza skip dei commenti | Troncamento prematuro | Non un problema: `@theme` è auto-generato, mai contiene `/* } */` |

---

## 7. Testing

### Struttura (312 test, 10 file)

Il test suite è organizzato in tre livelli:

1. **Unit test puri** (no I/O, no mock): `contrast-checker.test.ts`, `css-parser.test.ts`, `file-scanner.test.ts`, `tailwind-palette.test.ts`, `report-generator.test.ts`
2. **I/O test con mock** (`*.io.test.ts`): `css-parser.io.test.ts`, `file-scanner.io.test.ts`, `tailwind-palette.io.test.ts` — isolano `readFileSync`/`globSync` tramite `vi.mock('node:fs')` e `vi.mock('glob')`
3. **Integration test**: `integration.test.ts` — full pipeline su fixture files
4. **Property-based test**: `property-based.test.ts` — invarianti matematici su input casuali (`fast-check`)

```
tests/
├── contrast-checker.test.ts       # 31 test — compositeOver, parseHexRGB, checkAllPairs, AAA, APCA
├── css-parser.test.ts             # 72 test — resolveClassToHex, extractBalancedBraces,
│                                  #           parseThemeInline, alpha handling, combineAlpha, extractRootFontSize,
│                                  #           resolveAll var() chains (M4-M6: depth, circular, override, alpha)
├── css-parser.io.test.ts          # 7 test — buildThemeColorMaps con vi.mock('node:fs'):
│                                  #           lettura 3 file, risoluzione light/dark attraverso var() chains,
│                                  #           M7 dark fallback (variabili non sovrascritta in .dark → ereditata da light),
│                                  #           extractRootFontSize, palette raw in entrambi i temi
├── file-scanner.test.ts           # 119 test — stripVariants, categorizeClasses, routeClassToTarget,
│                                  #            extractClassRegions, extractStringLiterals, large text, inline styles,
│                                  #            aria-disabled, isSelfClosingTag (M20), findExplicitBgInTag,
│                                  #            extractInlineStyleColors (M19), malformed JSX (M10)
├── file-scanner.io.test.ts        # 10 test — extractAllFileRegions con vi.mock('node:fs', 'glob'):
│                                  #            glob pattern + cwd, filesScanned, per-file read, region extraction,
│                                  #            line preservation, C4 read errors (ENOENT), relative paths,
│                                  #            zero files edge case, className content, Card container context
├── integration.test.ts            # 12 test — full pipeline: extract → resolve → check → report su 3 fixture files.
│                                  #           pair generation, violation detection, a11y-ignore suppression,
│                                  #           hover interactive state, large text, non-text pairs, AAA/APCA, snapshot
├── report-generator.test.ts       # 13 test — generateReport snapshot, empty results (M13), text/non-text violations,
│                                  #           interactive states, AAA row, APCA column, ignored/skipped, truncation (M14),
│                                  #           deduplication, markdown pipe safety (M15)
├── tailwind-palette.test.ts       # 22 test — toHex: hex passthrough (3/4/6/8-digit), oklch (decimal/percent/alpha),
│                                  #           hsl (space/comma/alpha), display-p3, rgb, special values
├── tailwind-palette.io.test.ts    # 7 test — extractTailwindPalette con vi.mock('node:fs'):
│                                  #           lettura path corretto, estrazione --color-*, conversione oklch→hex,
│                                  #           passthrough hex, dimensione map, warning su unconvertible, CSS vuoto
├── property-based.test.ts         # 19 test — fast-check (~5000 input casuali):
│                                  #           compositeOver (5: valid hex, α=0→bg, α=1→fg, identical, RGB bounds),
│                                  #           parseHexRGB (3: round-trip, channel bounds, malformed→black),
│                                  #           stripVariants (6: idempotency, raw, no prefixes, dark, hover, compound),
│                                  #           combineAlpha (5: bounds, undefined×undefined, identity, commutativity, opaque)
└── __snapshots__/                 # Vitest snapshot files (report-generator, integration)
```

### Pattern `@internal Exported for unit testing`

Le funzioni che sarebbero private vengono esportate con JSDoc marker `@internal`. Accettabile per script CLI (non libreria pubblica). Include: `parseHexRGB`, `compositeOver` (contrast-checker); `extractBalancedBraces`, `parseThemeInline`, `stripHexAlpha`, `extractHexAlpha`, `combineAlpha`, `resolveAll` (css-parser); `stripVariants`, `routeClassToTarget`, `categorizeClasses`, `determineIsLargeText`, `extractStringLiterals`, `extractBalancedParens`, `extractClassRegions`, `isSelfClosingTag`, `findExplicitBgInTag`, `extractInlineStyleColors` (file-scanner). Interfacce esportate per testing: `TaggedClass`, `ClassBuckets`, `PreExtracted` (file-scanner).

Funzioni pubbliche usate anche negli I/O test: `buildThemeColorMaps` (css-parser), `extractTailwindPalette` (tailwind-palette), `extractAllFileRegions` (file-scanner). Queste non richiedono `@internal` perché sono già parte dell'API pubblica dello script.

### Isolamento I/O test (`*.io.test.ts`)

I test con `vi.mock()` vivono in file separati (`*.io.test.ts`) perché `vi.mock()` è hoisted a livello di file — non può essere scopato a un singolo `describe`. Questo previene la contaminazione dei test puri che importano le stesse funzioni. Pattern di mock:

```typescript
// Path-discriminating mock (più robusto di mockReturnValueOnce sequenziale)
vi.mocked(readFileSync).mockImplementation((path: unknown) => {
  const p = String(path);
  if (p.endsWith('tailwindcss/theme.css')) return FIXTURE_TAILWIND_CSS;
  if (p.endsWith('main.theme.css')) return FIXTURE_THEME_CSS;
  if (p.endsWith('main.css')) return FIXTURE_MAIN_CSS;
  throw new Error(`Unexpected readFileSync path: ${p}`);
});
```

### Isolamento Vitest

Il `vitest.config.ts` usa `root: resolve(__dirname)` per evitare che i test React della root (`tests/`) vengano inclusi nella run. Senza questo, `--config` da solo non cambia la directory di ricerca dei pattern `include`.

### Comandi

```bash
npm run a11y:test            # Run once (CI)
npm run a11y:test:watch      # Watch mode (dev)
```

---

## 8. Glossario Rapido

| Termine | Significato nel contesto |
|---------|------------------------|
| **ColorMap** | Dizionario variabile CSS → colore risolto, prodotto per-tema |
| **RawPalette** | Dizionario variabile → hex grezzo, pre-risoluzione |
| **TaggedClass** | Classe Tailwind annotata con flag dark/interactive dopo lo stripping |
| **ClassRegion** | Blocco di testo className= estratto con metadati di linea e contesto |
| **ColorPair** | Accoppiamento bg+fg pronto per il contrast check |
| **PreExtracted** | Risultato I/O-agnostico dell'estrazione, riusabile per entrambi i temi |
| **ContrastResult** | ColorPair arricchito con ratio e verdetti pass/fail |
| **Compositing** | Appiattimento di un colore trasparente su uno sfondo opaco |
| **Tracked state** | Pseudo-classe CSS che genera coppie verificabili (hover, focus-visible) |
| **Context stack** | Stack LIFO che traccia lo sfondo implicito dei container JSX annidati |

---

## 9. Developer Guide: Estendere il Tool

### 9.1 Aggiungere un Componente Container (shadcn/ui)

Quando si aggiunge un nuovo componente shadcn che funge da superficie con sfondo proprio (es. `<Accordion>`, `<NavigationMenu>`), il tool deve sapere quale sfondo implicito usa, altrimenti il testo interno verrà confrontato con `bg-background` (il fallback root).

**Step-by-step**:

1. **Identifica lo sfondo del componente**. Apri il file del componente shadcn in `src/components/ui/` e cerca la classe `bg-*` nel suo template. Ad esempio, se `accordion.tsx` ha `bg-muted`, il background è `bg-muted`.

2. **Aggiungi l'entry in `jsx-context-config.ts`**:

```typescript
// jsx-context-config.ts — aggiungere nella sezione appropriata

export const DEFAULT_CONTAINER_CONTEXTS: Record<string, string> = {
  // ... entries esistenti ...

  // ── Navigation ──────────────────────────────────────────────
  NavigationMenuContent: 'bg-popover',   // ← NUOVA ENTRY
};
```

1. **La `CONTAINER_CONTEXT_MAP`** (riga 50-52) si auto-ricostruisce da `DEFAULT_CONTAINER_CONTEXTS` — non serve toccarla.

1. **Verifica**: Esegui `npm run a11y:audit` e controlla che le coppie dentro il nuovo componente ora mostrino `(implicit) bg-popover` anziché `(implicit) bg-background`.

**Regole**:

- Il nome del componente è **case-sensitive** e deve corrispondere al tag JSX (`Card`, non `card`)
- Solo i componenti **non self-closing** vengono tracciati (il tag deve avere children)
- Se il componente ha un `bg-*` esplicito nelle sue props (`<Card className="bg-white">`), il valore nel config viene automaticamente sovrascitto dal `findExplicitBgInTag()` — non serve gestire questo caso nel config

### 9.2 Aggiungere un Prefisso Variant Tailwind

Se Tailwind introduce un nuovo variant (es. `aria-disabled:`) e il tool lo ignora:

1. **Aggiungi a `VARIANT_PREFIXES`** in `file-scanner.ts` (riga 55-77):

```typescript
const VARIANT_PREFIXES = [
  // ... existing ...
  'aria-disabled:',   // ← NUOVO
];
```

1. **Se il variant è uno stato interattivo verificabile**, aggiungi anche a `INTERACTIVE_PREFIX_MAP` (riga 198-201):

```typescript
const INTERACTIVE_PREFIX_MAP = new Map<string, InteractiveState>([
  ['hover:', 'hover'],
  ['focus-visible:', 'focus-visible'],
  // ['aria-disabled:', 'aria-disabled'],  // ← solo se vuoi generare coppie per questo stato
]);
```

1. Se aggiungi un nuovo `InteractiveState`, estendi il type union in `types.ts`:

```typescript
export type InteractiveState = 'hover' | 'focus-visible' | 'aria-disabled';
```

### 9.3 Aggiungere Filtri Non-Colore

Quando Tailwind aggiunge una nuova utility con prefisso ambiguo (es. `border-spacing-*`, `text-balance`), il tool potrebbe interpretarla erroneamente come colore.

**Diagnosi**: Il report mostra "Unresolvable border color: border-spacing-3" negli skipped.

**Fix**: Aggiungi la classe al Set corretto in `file-scanner.ts`:

| Set | Prefisso | Esempio |
| --- | -------- | ------- |
| `TEXT_NON_COLOR` | `text-` | `text-balance`, `text-wrap` |
| `BG_NON_COLOR` | `bg-` | `bg-clip-text`, `bg-fixed` |
| `BORDER_NON_COLOR` | `border-` | `border-spacing-3`, `border-collapse` |
| `RING_NON_COLOR` | `ring-` | `ring-inset`, `ring-offset-2` |
| `OUTLINE_NON_COLOR` | `outline-` | `outline-hidden`, `outline-offset-4` |

### 9.4 Regole e Soglie di Conformità

Il parametro `violationLevel` di `checkAllPairs()` determina quale livello WCAG viene usato come soglia di violazione:

- **`'AA'`** (default): 4.5:1 testo normale, 3:1 testo grande e non-testo
- **`'AAA'`**: 7:1 testo normale, 4.5:1 testo grande e non-testo

Il tipo `ConformanceLevel = 'AA' | 'AAA'` è definito in `types.ts`. Il report include sempre tutte le colonne (AA, AAA, APCA Lc) indipendentemente dal livello selezionato — il livello controlla solo la classificazione pass/violation.

**Classificazione testo/non-testo** → `file-scanner.ts`, funzione `routeClassToTarget()`: il routing `bg-` / `text-` / `border-` / `ring-` / `outline-`

**APCA Lc** è calcolato per ogni coppia tramite `calcAPCA()` di `apca-w3`. È puramente informativo e non influenza la logica di violazione. Se il calcolo fallisce, `apcaLc` resta `null`

---

## 10. Manuale Operativo (CI/CD)

### 10.1 Exit Codes

| Exit Code | Significato | Quando |
| --------- | ----------- | ------ |
| **0** | Successo | Zero violazioni (le coppie `ignored` e `skipped` non contano) |
| **1** | Violazioni trovate | `totalViolations > 0` dopo la somma di light + dark |
| **1** (implicit) | Crash non gestito | Errore I/O fatale (es. `main.theme.css` non trovato), errore di parsing in `culori`/`colord`, OOM |

**Nota**: Non esiste distinzione tra exit code per "violazioni trovate" e "crash". Entrambi producono exit code 1. In caso di crash, lo stack trace di Node.js viene stampato su stderr. Le violazioni sono determinate dal `violationLevel` configurato (AA di default, AAA se specificato).

### 10.2 Output

| Artefatto | Path | Formato |
| --------- | ---- | ------- |
| Report | `a11y-reports/audit-YYYY-MM-DD.md` | Markdown |
| Log console | stdout | Testo plain con progress |

Il report non viene mai sovrascritto: se il file esiste, un suffisso incrementale viene aggiunto (`-1`, `-2`, ..., fino a `-99`).

**Non esiste**: output JSON, output machine-readable, flag `--json`, flag `--fix`, flag `--quiet`. Il tool è monoformato.

### 10.3 Variabili d'Ambiente e CLI Flags

**Nessuna.** Il tool non legge `process.env` né `process.argv`. Tutti i percorsi sono derivati da `process.cwd()`:

| Percorso | Derivazione |
| -------- | ----------- |
| File sorgente | `${cwd}/src/**/*.tsx` |
| CSS tema | `${cwd}/src/main.theme.css` e `${cwd}/src/main.css` |
| Palette Tailwind | `${cwd}/node_modules/tailwindcss/theme.css` |
| Report output | `${cwd}/a11y-reports/` |

**Implicazione CI**: Il comando deve essere eseguito dalla root del progetto, dove `package.json` risiede.

### 10.4 Esempio GitHub Actions

```yaml
name: A11y Contrast Audit

on:
  pull_request:
    paths:
      - 'src/**/*.tsx'
      - 'src/main.css'
      - 'src/main.theme.css'

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

      # Il tool dipende dalla palette in node_modules/tailwindcss/theme.css
      # che è già installata da npm ci

      - name: Run a11y contrast audit
        id: audit
        run: npm run a11y:audit
        continue-on-error: true   # Non blocca il job — leggiamo l'exit code dopo

      - name: Upload audit report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: a11y-audit-report
          path: a11y-reports/
          retention-days: 30

      - name: Comment PR with results
        if: steps.audit.outcome == 'failure'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const glob = require('glob');
            const reports = glob.sync('a11y-reports/audit-*.md');
            if (reports.length === 0) return;
            const report = fs.readFileSync(reports[reports.length - 1], 'utf-8');
            // Estrai solo la summary table (prime 20 righe dopo "## Summary")
            const summaryMatch = report.match(/## Summary\n\n([\s\S]*?)(?=\n##)/);
            const summary = summaryMatch ? summaryMatch[1] : 'See full report in artifacts.';
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## A11y Contrast Audit Results\n\n${summary}\n\nFull report available as build artifact.`
            });

      - name: Fail if violations found
        if: steps.audit.outcome == 'failure'
        run: exit 1
```

**Punti chiave dello snippet**:

- `continue-on-error: true` sull'audit permette di caricare l'artefatto anche in caso di violazioni
- Il report viene sempre caricato (`if: always()`)
- Il commento sulla PR estrae solo la tabella Summary per non sovraccaricare la PR di testo
- Il job fallisce esplicitamente nell'ultimo step solo se ci sono violazioni

### 10.5 Integrazione con Pre-commit (locale)

L'audit è **troppo lento per un pre-commit hook** (scansiona tutti i `.tsx` di `src/`). Per uso locale, eseguirlo manualmente o in pre-push:

```bash
# In .husky/pre-push (opzionale, non configurato di default)
npm run a11y:audit
```

---

## 11. Troubleshooting & FAQ

### 11.1 Tabella Diagnostica

| Sintomo | Causa Probabile | Soluzione |
| ------- | --------------- | --------- |
| "Unresolvable background: bg-custom" | Variabile `--color-custom` non definita in `:root`, `.dark`, né in `@theme inline` | Aggiungere la variabile in `src/main.theme.css` o `src/main.css`, oppure verificare che il nome sia corretto |
| "Unresolvable text color: text-brand" | Come sopra per `--color-brand` | Come sopra |
| "Dynamic class (template expression)" in skipped | Classe contiene `$` (es. `${isActive ? 'bg-red' : 'bg-blue'}`) | Non un errore — il tool non può risolvere espressioni dinamiche. Verificare manualmente |
| "[a11y-audit] Skipping src/...: ENOENT" | File non leggibile (permessi, encoding, symlink rotto) | Verificare `ls -la` sul file, encoding UTF-8, e che non sia un symlink a un file rimosso |
| "Malformed hex: ... defaulting to black" | `toHex()` ha prodotto un hex non valido (colore oklch malformato?) | Controllare il valore raw nel CSS. Se è un formato non supportato da `culori`, aggiungere un workaround in `toHex()` |
| Contrasto errato su testo evidentemente grande | La dimensione è impostata via `style={{fontSize: '24px'}}` o CSS custom, non con classi Tailwind | Il tool usa solo le classi `text-{size}` per determinare "large text". CSS inline e `@apply` non sono analizzati |
| Report mostra `(implicit) bg-background` dentro un `<Card>` | Il container non è nel config **oppure** il tag è self-closing | Aggiungere il componente in `jsx-context-config.ts`. Verificare che nel JSX il tag abbia children (non `<Card />`) |
| Falsi positivi da ternari condizionali | `cond ? 'bg-A text-A' : 'bg-B text-B'` genera combinazioni cross-branch impossibili | Aggiungere `// a11y-ignore: mutually exclusive ternary` sulla riga prima del `className=` |
| Falsi positivi da cva() | cva() mette tutte le varianti nello stesso pool di classi | Aggiungere `// a11y-ignore: cross-variant cva` sulla riga prima di `const ...Variants = cva(` |
| "Cannot find module 'culori'" | Dipendenza non installata | `npm install` — `culori` è una devDependency del progetto |
| Il tool trova 0 file | Working directory errata | Assicurarsi di eseguire dalla root del progetto (dove c'è `package.json`). Il tool cerca `${cwd}/src/**/*.tsx` |
| Dark mode mostra centinaia di violazioni | L'app non ha dark mode → nessun `dark:text-*` definito → le classi base vengono usate su sfondi dark | Atteso. Ignorare le violazioni dark mode finché il dark mode non viene implementato |
| `npm run a11y:audit` crasha con stack trace | Crash in `culori.parse()` o `readFileSync` su file CSS mancante | Verificare che `node_modules/tailwindcss/theme.css` esista (`npm ci`) e che `src/main.theme.css` / `src/main.css` esistano |

### 11.2 FAQ

**Q: Posso eseguire l'audit solo su un file specifico?**
A: No. Il tool scansiona sempre tutto `src/**/*.tsx`. Non esiste un filtro per file. Per analisi mirata, filtra il report Markdown con grep: `grep "src/components/MyFile" a11y-reports/audit-*.md`.

**Q: Posso disabilitare l'audit dark mode?**
A: No (non c'è un flag). Il tool esegue sempre entrambi i pass (light + dark). Puoi ignorare la sezione dark mode nel report — è documentato che le violazioni dark non sono actionable finché il dark mode non è implementato.

**Q: Come faccio a sapere se un `// a11y-ignore` è stato rilevato?**
A: Controlla la sezione "Ignored Violations" nel report. Ogni coppia soppressa è elencata con file, riga, ratio e motivo.

**Q: Perché `border-input` su `bg-background` viene segnalato?**
A: SC 1.4.11 richiede 3:1 per elementi non-testo. Molti bordi decorativi (card edges, dividers) falliscono ma sono esenti perché puramente decorativi. Usa `// a11y-ignore: decorative border`.

**Q: Il tool supporta output JSON?**
A: No. L'unico formato è Markdown in `a11y-reports/`. Per parsing automatico, si può effettuare il parse delle tabelle Markdown o estendere `report-generator.ts` aggiungendo una funzione `generateJsonReport()`.

---

## 12. Appendice A: Limiti Matematici e Edge Cases

### A.1 Conversione Pixel e assunzione `1rem = 16px`

Il tool determina il "testo grande" (WCAG SC 1.4.3) basandosi esclusivamente sulle classi Tailwind:

```text
text-2xl → 1.5rem → 24px → LARGE (always)
text-xl  → 1.25rem → 20px → LARGE (only if bold)
text-lg  → 1.125rem → 18px → NOT large (< 18.67px threshold)
```

Questa conversione assume **`1rem = 16px`** (il default del browser). A partire dalla v4.0 P2, il tool **legge il root font-size dal CSS** tramite `extractRootFontSize()`: cerca `font-size` in `html {}` o `:root {}`, supportando valori `px`, `%` e `rem`. Il valore è esposto in `ThemeColorMaps.rootFontSizePx`.

Il progetto attuale **non** sovrascrive `html { font-size }` (verificato: nessun override in `main.css` né `main.theme.css`), quindi il valore letto è il default di 16px.

**Se il progetto dovesse cambiare il root font-size** (es. `html { font-size: 14px }`):

- `text-xl` diventerebbe `1.25 × 14 = 17.5px` — ancora sotto la soglia "large"
- `text-2xl` diventerebbe `1.5 × 14 = 21px` — ancora sopra la soglia "large"
- L'impatto pratico sarebbe minimo, ma **`text-xl` con bold** potrebbe non qualificare più come "large" (17.5px < 18.67px)

I set `ALWAYS_LARGE` e `LARGE_IF_BOLD` restano hardcoded alle soglie Tailwind standard. Il `rootFontSizePx` è disponibile per una futura integrazione dinamica con le soglie di large text.

### A.2 Anti-Aliasing e Contrasto Percepito

L'audit calcola il **contrasto matematico puro** secondo la formula WCAG 2.1:

```text
Contrast Ratio = (L1 + 0.05) / (L2 + 0.05)

dove L = luminanza relativa = 0.2126 × R + 0.7152 × G + 0.0722 × B
     (dopo linearizzazione sRGB dei canali)
```

Questo valore **non** tiene conto di:

| Fattore | Effetto | Impatto |
| ------- | ------- | ------- |
| **Font smoothing** (subpixel/antialiasing) | Riduce il contrasto percepito del testo sottile | Un ratio di 4.5:1 potrebbe risultare meno leggibile su testo `font-weight: 300` |
| **Font rendering** (hinting, gamma) | Varia tra OS e browser | Stesso hex, resa diversa su macOS vs Windows |
| **APCA** (Advanced Perceptual Contrast Algorithm) | Formula alternativa più accurata per la percezione umana | WCAG 3.0 potrebbe adottarla, ma il tool implementa solo WCAG 2.1 |

**Implicazione pratica**: Un ratio di 4.5:1 è il **minimo matematico**. Per testo sottile (`font-weight: 300-400`) o piccolo (`text-xs`, `text-sm`), è consigliabile puntare a 5:1 o superiore anche se il tool non lo richiede.

### A.3 Alpha Compositing: Modello Semplificato

Il compositing del tool usa il **modello di blending lineare** (Porter-Duff "source over"):

```text
C_result = C_fg × α + C_bg × (1 - α)
```

Questo è corretto per un singolo livello di trasparenza. Tuttavia:

- **Trasparenze impilate** (es. `bg-red-500/50` dentro un `<Card className="bg-blue-500/30">`) vengono compositate solo rispetto al container esplicito più vicino, non attraverso l'intera catena di trasparenze
- Il **page background** usato come base finale è hardcoded: `#ffffff` per light, `#09090b` (zinc-950) per dark
- Se il layout reale ha uno sfondo intermedio diverso (es. un `<div className="bg-slate-100">` non nel config), il compositing potrebbe produrre un hex leggermente diverso da quello effettivo

### A.4 Precisione Numerica

| Operazione | Precisione | Note |
| ---------- | ---------- | ---- |
| oklch → hex (`culori`) | Arrotondamento a 8 bit per canale (0-255) | Errore massimo: ±0.5/255 per canale |
| Contrast ratio (`colord`) | `Math.round(ratio * 100) / 100` | 2 decimali nel report |
| Alpha compositing | `Math.round()` per canale RGB | Accumulo errore trascurabile (±1 livello su 255) |
| Alpha threshold | `< 0.999` = semi-trasparente | Evita falsi positivi da errori di floating point su alpha=1.0 |

### A.5 Classi Non Riconosciute che Sfuggono ai Filtri

Il tool usa Set statici per filtrare le utility non-colore. Se Tailwind aggiunge nuove utility con prefisso ambiguo (es. ipotetico `text-truncate-2`), queste potrebbero:

1. **Non matchare alcun Set** → passano a `resolveClassToHex()`
1. **`resolveClassToHex()` cerca `--color-truncate-2`** → non trovato → `null`
1. **Finiscono in `skipped[]`** con reason "Unresolvable text color"

Questo è un **fail-safe**: classi sconosciute non generano mai falsi positivi né falsi negativi. Vengono semplicemente skippate e documentate nel report. L'unico effetto è un leggero rumore nella sezione "Skipped Classes".
