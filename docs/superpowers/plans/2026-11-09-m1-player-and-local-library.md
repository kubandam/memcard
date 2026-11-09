# M1 — Player + Bring Your Own File — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed Nuxt site ("Memcard") where a visitor drops a PS1 homebrew image, it is stored in IndexedDB, appears in "My games", and plays with sound/keyboard/gamepad on a Boot-styled player route — with the Shelf/Grey theming in place from day one.

**Architecture:** Nuxt 4 app (`app/` srcDir) deployed to Cloudflare Workers (static assets + Nitro `cloudflare_module`). Everything emulator-related is client-only: pure utils classify dropped files → `idb` stores metadata + Blobs → player page rebuilds a single `File` (zip-packed for multi-file games) and hands it to self-contained EmulatorJS 4.2.3 (CDN for M1). Two visual worlds split by route: Shelf layout (library pages) and Boot layout (`/play`). Theming is CSS custom properties toggled by `data-theme`.

**Tech Stack:** Nuxt 4.6.x, TypeScript, Vitest + `fake-indexeddb` + `@vue/test-utils`, Playwright, `idb`, `fflate`, `@nuxtjs/i18n`, EmulatorJS 4.2.3 (`pcsx_rearmed`), Wrangler.

**Spec:** [docs/superpowers/specs/2026-11-09-ps1-player-design.md](../specs/2026-11-09-ps1-player-design.md) (design, wins on conflict) and [spec.md](../../../spec.md) (functional requirements §5.1, §5.3, §6.2, §7, §8, §9 M1).

## Global Constraints

- EmulatorJS pinned **4.2.3**; `EJS_core = "psx"`; do not enable threads or COOP/COEP; do not use 4.3.0-pre.
- No commercial game or BIOS anywhere in the repo, fixtures, or CI; every test file has source + licence recorded in `tests/fixtures/README.md`.
- No Sony logos, wordmarks or △○×□ glyphs in UI artwork; colour dots only.
- Visitor files never leave the browser: no upload, no logging of file names/titles, no analytics in M1.
- UI strings only in `i18n/locales/en.json`; no literal copy in components.
- All colours/fonts/radii/shadows via CSS custom properties from `app/assets/css/tokens.css`; components never hard-code colour values.
- Leave `/play` only via full-page navigation (`<a href>`), never `<NuxtLink>`.
- Repo licence GPL-3.0; upstream licence files kept; "Source code" link in footer.
- Conventional commits; commit at the end of every task.
- Node ≥ 20, pnpm. Site name constant: `siteName: 'Memcard'` in `app.config.ts`.

## Review Focus

Failure modes the spec implies but no acceptance criterion names; each has a pinned test in the owning task.

1. **Lone `.bin` or lone `.cue` dropped** → refuse with a message naming the missing companion; nothing stored. (Task 3, Task 6)
2. **Storage quota exceeded while adding** → game still plays this session, "could not be saved" notice, no half-written entry left in `games`. (Task 4, Task 6)
3. **File names with spaces/unicode/parentheses** (`Magic Castle (Disc 1).chd`) → `.m3u` lines and zip entry names preserved byte-for-byte; title derived cleanly. (Task 3, Task 5)
4. **Unknown or deleted game id on `/play/local/[id]`** → "Game not found" + link to library; EmulatorJS loader never injected. (Task 7)
5. **Large images** (single file > 700 MB or multi-file total > 1.5 GB) → warning shown before adding, add still allowed. (Task 6)

---

## File structure

```
.gitignore  LICENSE (GPL-3.0)  README.md  package.json  nuxt.config.ts  app.config.ts
tsconfig.json  vitest.config.ts  playwright.config.ts
app/
  app.vue                         head: pre-paint theme script, fonts css
  layouts/shelf.vue               SiteHeader + <slot/> + SiteFooter (library pages)
  layouts/boot.vue                bare radial stage, no header
  assets/css/tokens.css           :root (dark) + [data-theme="grey"] tokens
  assets/css/fonts.css            @font-face for self-hosted fonts
  assets/css/base.css             reset, body bg from tokens, type scale
  components/shelf/SiteHeader.vue   wordmark, nav, ThemeToggle
  components/shelf/SiteFooter.vue   FourDots + source link
  components/shelf/ThemeToggle.vue
  components/shelf/FourDots.vue
  components/shelf/SectionLabel.vue
  components/shelf/GameTile.vue     cover/placeholder, spine, label, actions slot
  components/shelf/GameGrid.vue
  components/shelf/DropZone.vue     drag+drop + <input multiple>, emits files
  components/shelf/StorageMeter.vue
  components/shelf/Notice.vue       inline error/info panel
  components/boot/BootStage.vue     blocks + title + phase bar
  components/boot/PlayerOverlay.vue bar: fullscreen · controls · library
  components/boot/ControlsOverlay.vue
  composables/useTheme.ts
  composables/useLocalLibrary.ts    reactive wrapper over utils/localDb
  composables/useEmulator.ts        injects EmulatorJS, exposes phase + callbacks
  utils/gameFiles.ts                classifyFiles, titleFromFilename, parseCue, parseM3u, generateM3u
  utils/packGame.ts                 buildGameFile
  utils/localDb.ts                  idb schema + CRUD + settings + storage estimate
  utils/coverPlaceholder.ts         placeholderStyle(title)
  utils/format.ts                   formatBytes, formatRelative
  utils/emulatorjs.ts               constants: EJS version, base URL, RETROPAD_PS1_LABELS, mapping reader
  pages/index.vue                   Free games (hidden in M1) · My games · DropZone
  pages/settings.vue                theme, BIOS, storage, clear data, controls help
  pages/about.vue
  pages/play/[source]/[id].vue
shared/types/game.ts                LocalGame, GameFileRef, ClassifyResult
i18n/locales/en.json
public/fonts/*.woff2 + LICENSE-OFL.txt
tests/unit/*.test.ts  tests/components/*.test.ts  tests/e2e/*.spec.ts  tests/fixtures/README.md
docs/manual-tests/m1.md
```

---

### Task 0: Spike — pin EmulatorJS 4.2.3 facts the plan relies on

Throwaway. Output is a set of verified constants/comments in `app/utils/emulatorjs.ts` (created in Task 7); nothing else from the spike is kept.

**Files:**
- Create (scratch, not committed): `<scratchpad>/ejs-spike/index.html`

- [ ] **Step 1: Write a static page** that sets `EJS_player="#game"`, `EJS_core="psx"`, `EJS_pathtodata="https://cdn.emulatorjs.org/4.2.3/data/"`, `EJS_startOnLoaded=true`, `EJS_DEBUG_XX=true`, and on a file `<input>` change sets `window.EJS_gameUrl = file` (the `File` object), `EJS_gameName = file.name`, then appends `<script src=".../4.2.3/data/loader.js">`. Define `EJS_ready`, `EJS_onGameStart`, `EJS_onSaveSave` that `console.log` their arguments. Serve with `python3 -m http.server` from the spike dir and open in Chrome.

- [ ] **Step 2: Verify File input.** Pick a legally redistributable PS1 homebrew `.chd` or `.bin+.cue` zipped (see Task 9 Step 1 for sourcing). Expected: game boots; console shows `EJS_ready` then `EJS_onGameStart`. If a `File` is rejected, record that and fall back to `URL.createObjectURL(new File([blob], name))` *with* `EJS_gameName` — note which worked.

- [ ] **Step 3: Record instance shape.** In console, log `Object.keys(EJS_emulator)`, `EJS_emulator.controls?.[0]`, `EJS_emulator.defaultControllers?.[0]`, and `EJS_emulator.gameManager && Object.getOwnPropertyNames(Object.getPrototypeOf(EJS_emulator.gameManager))`. Note the exact property holding the current keyboard mapping and its per-button shape (`{value, value2}` expected).

- [ ] **Step 4: Confirm PS1 button order.** With the game running, press keyboard keys for indices 0, 1, 8, 9 (default `x`, `s`, `z`, `a`) and note which PS1 face button each triggers (expected RetroPad: 0 = Cross, 1 = Square, 8 = Circle, 9 = Triangle; 2 Select, 3 Start, 4–7 D-pad U/D/L/R, 10 L1, 11 R1, 12 L2, 13 R2, 14 L3, 15 R3, 16–23 analog axes). Correct the table if different.

- [ ] **Step 5: Confirm save export path.** Open EmulatorJS menu → "Export save" → `EJS_onSaveSave` logs `{ save, screenshot, format }`. Note the `save` type (ArrayBuffer/Uint8Array) and whether a `.srm` download is otherwise triggered.

- [ ] **Step 6: Write findings** as a comment block at the top of `app/utils/emulatorjs.ts` (file created now, filled in Task 7): File-input result, mapping property name, button table, `save` type. No commit yet (Task 1 initialises git).

---

### Task 1: Scaffold — Nuxt 4 on Cloudflare, tooling, licence

**Files:**
- Create: `package.json`, `nuxt.config.ts`, `app.config.ts`, `app/app.vue`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `LICENSE`, `README.md`, `i18n/locales/en.json`, `tests/unit/smoke.test.ts`

**Interfaces:**
- Produces: `useAppConfig().siteName === 'Memcard'`; `useRuntimeConfig().public.emulatorjsBase` (string, default `https://cdn.emulatorjs.org/4.2.3/data/`); `$t()` from `@nuxtjs/i18n`; `pnpm test` (Vitest), `pnpm build` (Cloudflare preset).

- [ ] **Step 1:** `git init`, `pnpm dlx nuxi@latest init . --packageManager pnpm --gitInit false` (accept Nuxt 4 default layout with `app/`). Add `.gitignore` entries: `node_modules`, `.nuxt`, `.output`, `dist`, `.wrangler`, `.superpowers`, `tests/fixtures/*.chd`, `tests/fixtures/*.bin`, `tests/fixtures/*.cue`, `tests/fixtures/*.zip`, `.env*`.

- [ ] **Step 2:** Install: `pnpm add idb fflate @nuxtjs/i18n` and `pnpm add -D vitest @nuxt/test-utils @vue/test-utils happy-dom fake-indexeddb @playwright/test wrangler`.

- [ ] **Step 3: Write `nuxt.config.ts`** with: `compatibilityDate: '2025-07-15'`; `modules: ['@nuxtjs/i18n']`; `i18n: { locales: [{ code: 'en', file: 'en.json' }], defaultLocale: 'en', strategy: 'no_prefix' }`; `nitro: { preset: 'cloudflare_module', cloudflare: { deployConfig: true, nodeCompat: true } }`; `routeRules: { '/play/**': { ssr: false }, '/emulatorjs/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } } }`; `runtimeConfig.public.emulatorjsBase` default as above; `css: ['~/assets/css/tokens.css', '~/assets/css/fonts.css', '~/assets/css/base.css']` (files created in Task 2 — create empty now).

- [ ] **Step 4: Write `app.config.ts`**: `export default defineAppConfig({ siteName: 'Memcard', sourceUrl: '<github url, placeholder until repo pushed>' })`.

- [ ] **Step 5: Write `vitest.config.ts`** using `defineVitestConfig` from `@nuxt/test-utils/config`, `environment: 'happy-dom'`, `setupFiles: ['tests/setup.ts']` where setup imports `fake-indexeddb/auto`. Add `tests/unit/smoke.test.ts` asserting `1 + 1 === 2`. Scripts: `"test": "vitest run"`, `"test:e2e": "playwright test"`, `"deploy": "nuxt build && wrangler deploy"`.

- [ ] **Step 6: Licence.** Copy GPL-3.0 text to `LICENSE`. `README.md`: one paragraph what it is, "plays PS1 games", EmulatorJS GPL-3.0 attribution, how to run.

- [ ] **Step 7: Verify.** Run `pnpm test` → smoke passes. Run `pnpm build` → completes, `.output/server/index.mjs` and generated `wrangler.json` exist (deployConfig). Run `pnpm dev` → `/` renders.

- [ ] **Step 8: Commit** `chore: scaffold Nuxt 4 app for Cloudflare Workers with GPL-3.0 licence`.

---

### Task 2: Design tokens, fonts, theme toggle, Shelf layout, About page

**Files:**
- Create: `app/assets/css/tokens.css`, `fonts.css`, `base.css`, `public/fonts/*.woff2`, `public/fonts/LICENSE-OFL.txt`, `app/composables/useTheme.ts`, `app/layouts/shelf.vue`, `app/layouts/boot.vue`, `app/components/shelf/{SiteHeader,SiteFooter,ThemeToggle,FourDots,SectionLabel,Notice}.vue`, `app/pages/about.vue`
- Modify: `app/app.vue`, `i18n/locales/en.json`
- Test: `tests/unit/useTheme.test.ts`, `tests/components/ThemeToggle.test.ts`

**Interfaces:**
- Produces: `useTheme(): { theme: Ref<'dark' | 'grey'>; setTheme(t): void; toggle(): void }`; localStorage key `memcard.theme`; `<html data-theme="dark|grey">`.
- Produces components: `<SectionLabel>` (slot, optional `meta` slot right-aligned), `<Notice kind="error|info">` (slot), `<FourDots/>`.

- [ ] **Step 1: Write failing tests.**
```ts
// tests/unit/useTheme.test.ts
it('defaults to dark and persists toggle', () => {
  const { theme, toggle } = useTheme()
  expect(theme.value).toBe('dark')
  toggle()
  expect(theme.value).toBe('grey')
  expect(localStorage.getItem('memcard.theme')).toBe('grey')
  expect(document.documentElement.dataset.theme).toBe('grey')
})
it('reads stored theme on init', () => { localStorage.setItem('memcard.theme','grey'); expect(useTheme().theme.value).toBe('grey') })
```
```ts
// tests/components/ThemeToggle.test.ts — mountSuspended(ThemeToggle); click; expect(document.documentElement.dataset.theme).toBe('grey'); expect aria-pressed on the GREY button.
```
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/useTheme.test.ts tests/components/ThemeToggle.test.ts` → FAIL (module not found).

- [ ] **Step 3: Fonts.** Download woff2 (latin subset) for Archivo Narrow 400/700, Inter 300/400/600, Chakra Petch 400/600/700 (and 700 italic) from Google Fonts into `public/fonts/`; copy the SIL OFL 1.1 text to `public/fonts/LICENSE-OFL.txt`. `fonts.css`: one `@font-face` per file, `font-display: swap`.

- [ ] **Step 4: `tokens.css`.** `:root` (dark/Shelf): `--bg:#0e0e0e; --bg-panel:#161616; --line:#2a2a2a; --line-strong:#333; --fg:#f2f2f2; --fg-muted:rgba(242,242,242,.65); --accent:#e2231a; --dot-red:#e2231a; --dot-yellow:#f5c518; --dot-blue:#1d6fd1; --dot-green:#1fa84a; --font-display:'Archivo Narrow'; --font-body:'Inter'; --display-weight:700; --display-style:normal; --label-weight:300; --label-tracking:.18em; --radius:4px; --tile-shadow:0 0 0 1px var(--line-strong), 0 10px 30px rgba(0,0,0,.6); --spine:#000; --header-bg:transparent; --boot-bg:radial-gradient(ellipse at 50% 15%, #26262e 0%, #0b0b10 55%, #000 100%)`. `[data-theme="grey"]`: `--bg:linear-gradient(#d9d6cd,#c6c3b9); --bg-panel:#cfccc3; --line:#a9a69d; --line-strong:#9b988f; --fg:#1f1f1f; --fg-muted:#555; --font-display:'Chakra Petch'; --font-body:'Chakra Petch'; --display-style:italic; --label-weight:600; --label-tracking:.1em; --radius:8px; --tile-shadow:inset 0 1px 0 #fff, 0 3px 0 #9b988f; --spine:#a9a69d; --header-bg:#b9b6ad`. `--boot-bg` unchanged in grey (design §4.3).

- [ ] **Step 5: `base.css`.** Reset; `body { background: var(--bg); color: var(--fg); font-family: var(--font-body) }`; `.display { font-family: var(--font-display); font-weight: var(--display-weight); font-style: var(--display-style); text-transform: uppercase }`; `.label { font-weight: var(--label-weight); letter-spacing: var(--label-tracking); text-transform: uppercase; font-size: 11px; color: var(--fg-muted) }`; container max-width 1200px, 16px side gutter.

- [ ] **Step 6: `useTheme.ts`** per the interface; a module-level `ref` so all callers share state; guard `typeof window`. In `app.vue` add `useHead({ script: [{ innerHTML: "try{document.documentElement.dataset.theme=localStorage.getItem('memcard.theme')||'dark'}catch(e){document.documentElement.dataset.theme='dark'}", tagPosition: 'head' }] })`.

- [ ] **Step 7: Components.** `SiteHeader`: red square + wordmark `siteName` in `.display`, nav links (`/`, `/settings`, `/about`) as `.label`, `<ThemeToggle>` (two buttons DARK/GREY, `aria-pressed`). `SiteFooter`: `<FourDots/>` + `<a :href="sourceUrl">` "Source code" + "GPL-3.0". `layouts/shelf.vue` = header + `<main class="container"><slot/></main>` + footer. `layouts/boot.vue` = `<div class="boot-stage" style="background: var(--boot-bg)"><slot/></div>` full-viewport.

- [ ] **Step 8: `about.vue`** (layout shelf): sections What it is · Content rules in plain language (the four hard rules from spec §3) · Licences (EmulatorJS GPL-3.0, cores GPL, fonts OFL) · Source link. All copy in `en.json` under `about.*`.

- [ ] **Step 9: Run tests** → PASS. `pnpm dev`, check `/about` in both themes, no flash on reload.

- [ ] **Step 10: Commit** `feat: design tokens, self-hosted fonts, dark/grey theme toggle, shelf layout and about page`.

---

### Task 3: Game file classification (pure utils)

**Files:**
- Create: `app/utils/gameFiles.ts`, `shared/types/game.ts`
- Test: `tests/unit/gameFiles.test.ts`

**Interfaces:**
- Produces (in `shared/types/game.ts`):
```ts
export type GameKind = 'single' | 'multi'
export interface GameFileRef { name: string; size: number; blobKey: string }
export interface ClassifiedGame { title: string; kind: GameKind; primaryName: string; files: File[]; generatedM3u?: string; totalBytes: number }
export type ClassifyError = { code: 'empty' | 'unsupported' | 'missing-cue' | 'missing-bin' | 'missing-m3u-disc' | 'mixed'; details: string[] }
export type ClassifyResult = { ok: true; game: ClassifiedGame } | { ok: false; error: ClassifyError }
```
- Produces (in `gameFiles.ts`): `classifyFiles(files: File[]): ClassifyResult`; `titleFromFilename(name: string): string`; `parseCue(text: string): string[]` (referenced file names); `parseM3u(text: string): string[]`; `generateM3u(discNames: string[]): string`; `SUPPORTED_EXTENSIONS = ['chd','pbp','iso','img','bin','cue','m3u','zip','7z'] as const`; `isSupported(name): boolean`.

- [ ] **Step 1: Write failing tests** (use `new File([bytes], name)`; cue/m3u contents as strings):
```ts
it('single chd', () => expect(classifyFiles([f('Magic Castle (Disc 1).chd')])).toMatchObject({ ok: true, game: { kind: 'single', primaryName: 'Magic Castle (Disc 1).chd', title: 'Magic Castle' } }))
it('cue + bins', async () => { const r = await classifyFiles([f('g.cue', 'FILE "g (Track 1).bin" BINARY\nFILE "g (Track 2).bin" BINARY'), f('g (Track 1).bin'), f('g (Track 2).bin')]); expect(r).toMatchObject({ ok: true, game: { kind: 'multi', primaryName: 'g.cue' } }) })
it('cue referencing missing bin', async () => expect(await classifyFiles([f('g.cue', 'FILE "g.bin" BINARY')])).toMatchObject({ ok: false, error: { code: 'missing-bin', details: ['g.bin'] } }))
it('lone bin', async () => expect(await classifyFiles([f('g.bin')])).toMatchObject({ ok: false, error: { code: 'missing-cue' } }))
it('m3u with discs', …) ; it('m3u missing disc → missing-m3u-disc with the name', …)
it('several chd without m3u → generatedM3u lists discs sorted, primaryName ends with .m3u', …)
it('unsupported ext → unsupported with details [name]', …) ; it('empty → empty', …)
it('zip is single', …)
it('titleFromFilename strips (USA) [!] (Disc 2) and extension', () => expect(titleFromFilename('Foo Bar (USA) (Disc 2) [!].chd')).toBe('Foo Bar'))
it('generateM3u preserves unicode and spaces', () => expect(generateM3u(['Hra č.1 (Disc 1).chd'])).toBe('Hra č.1 (Disc 1).chd\n'))
```
Note `classifyFiles` must read `.cue`/`.m3u` text (`await file.text()`), so it is `Promise<ClassifyResult>` — update the interface line above accordingly.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** Rules: exactly one file with ext in `chd|pbp|iso|img|zip|7z` → single. `.cue` present → parse, every referenced name must be in the set (case-insensitive compare, but keep original names) else `missing-bin`; primary = cue; extra unreferenced `.bin` → `mixed`. `.m3u` present → parse non-empty, non-`#` lines; each must be present else `missing-m3u-disc`; primary = m3u. ≥2 disc images (`chd|pbp|iso|img`, or cue sets) without m3u → `generatedM3u`, primary `${title}.m3u`. `.bin` without `.cue` → `missing-cue`. Any unsupported ext → `unsupported`. Title: from primary name, strip extension, strip trailing groups `(…)`/`[…]`, collapse spaces, trim.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: classify dropped PS1 game files`.

---

### Task 4: Local library database (IndexedDB)

**Files:**
- Create: `app/utils/localDb.ts`
- Modify: `shared/types/game.ts`
- Test: `tests/unit/localDb.test.ts`

**Interfaces:**
- Produces types:
```ts
export interface LocalGame { id: string; title: string; source: 'local' | 'cloud'; kind: GameKind; primaryName: string; files: GameFileRef[]; generatedM3u?: string; sizeBytes: number; createdAt: number; lastPlayedAt: number | null; coverBlobKey?: string }
export class StorageError extends Error { constructor(public code: 'quota' | 'unavailable', message: string) }
```
- Produces functions (all async): `openDb()`; `addGame(game: ClassifiedGame): Promise<LocalGame>` (stores each File as a Blob under a fresh `blobKey`, then the metadata; on failure rolls back written blobs and throws `StorageError`); `listGames(): Promise<LocalGame[]>` (sorted `lastPlayedAt desc, createdAt desc`); `getGame(id)`; `renameGame(id, title)` (throws `RangeError` on empty/whitespace); `deleteGame(id)` (removes blobs too); `touchLastPlayed(id)`; `getBlob(blobKey): Promise<Blob | undefined>`; `getSetting<T>(key): Promise<T | undefined>`; `setSetting(key, value)`; `deleteSetting(key)`; `clearAll()`; `estimateStorage(): Promise<{ usage: number; quota: number } | null>`; `requestPersist(): Promise<boolean>`.
- DB name `memcard`, version 1, stores: `games` (keyPath `id`, index `lastPlayedAt`), `blobs` (out-of-line keys), `settings` (out-of-line keys). Settings keys used later: `bios` (blobKey), `biosName`, `cloudCacheOptIn`.

- [ ] **Step 1: Write failing tests** (`fake-indexeddb/auto` from setup; `indexedDB = new IDBFactory()` in `beforeEach`):
```ts
it('addGame stores metadata and blobs, listGames returns it', …) // files.length === 2, getBlob(files[0].blobKey) size matches
it('two games with same title get distinct ids', …)
it('renameGame rejects empty', async () => await expect(renameGame(id, '  ')).rejects.toBeInstanceOf(RangeError))
it('deleteGame removes blobs', …) // getBlob → undefined
it('touchLastPlayed sorts first', …)
it('addGame on QuotaExceededError leaves no blobs or game behind and throws StorageError quota', …) // mock put to throw DOMException name 'QuotaExceededError' on 2nd blob
it('estimateStorage returns null when navigator.storage missing', …)
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with `idb` (`openDB<MemcardDb>`), ids via `crypto.randomUUID()`. Map `DOMException.name === 'QuotaExceededError'` → `StorageError('quota')`, `InvalidStateError`/open failure → `StorageError('unavailable')`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: IndexedDB local game library`.

---

### Task 5: Build the single `File` EmulatorJS receives

**Files:**
- Create: `app/utils/packGame.ts`
- Test: `tests/unit/packGame.test.ts`

**Interfaces:**
- Produces: `buildGameFile(game: LocalGame, getBlob: (key: string) => Promise<Blob | undefined>, onProgress?: (fraction: number) => void): Promise<File>`.
  - `kind === 'single'` → `new File([blob], game.primaryName)` (no copy, no zip).
  - `kind === 'multi'` → store-only zip (fflate `zipSync` with `level: 0`) containing every file by original name plus `generatedM3u` as `game.primaryName` when present; result `new File([zip], \`${game.title}.zip\`)`. `onProgress` called per file.

- [ ] **Step 1: Write failing tests**: single returns same bytes + name; multi zip, when `unzipSync`'d, has exactly the file names (unicode preserved) and the m3u text; progress called N times ending at 1.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: PASS.** **Step 5: Commit** `feat: pack multi-file games into a store-only zip for EmulatorJS`.

---

### Task 6: Home page — drop zone, My games grid, storage meter, notices

**Files:**
- Create: `app/components/shelf/{DropZone,GameTile,GameGrid,StorageMeter}.vue`, `app/composables/useLocalLibrary.ts`, `app/utils/{coverPlaceholder,format}.ts`, `app/pages/index.vue`
- Modify: `i18n/locales/en.json`
- Test: `tests/unit/format.test.ts`, `tests/unit/coverPlaceholder.test.ts`, `tests/components/DropZone.test.ts`, `tests/components/GameTile.test.ts`, `tests/components/IndexPage.test.ts`

**Interfaces:**
- Produces: `useLocalLibrary(): { games: Ref<LocalGame[]>; loading: Ref<boolean>; notice: Ref<{ kind: 'error' | 'info'; key: string; params?: Record<string, string> } | null>; sessionOnly: Ref<ClassifiedGame | null>; refresh(); addFiles(files: File[]): Promise<LocalGame | null>; rename(id, title); remove(id); storage: Ref<{ usage: number; quota: number } | null> }`.
  - `addFiles`: `classifyFiles` → if error set `notice` with key `errors.${code}` and `params.details` → return null. If `totalBytes > 700 MB` (single) or `> 1.5 GB` (multi) set info notice `warnings.largeFile` (still continue). `requestPersist()` on first add. `addGame` → on `StorageError('quota')` set `errors.quota`, put the classified game in `sessionOnly` (playable via `/play/session/current`, see Task 7) → return null.
- Produces: `placeholderStyle(title: string): { background: string }` (deterministic hue from string hash; two-stop dark gradient); `formatBytes(n): string` ("1.2 GB"); `formatRelative(ts: number | null, now = Date.now()): string` ("never", "2 days ago").
- `GameTile` props `{ game: LocalGame; href: string }`, slot `actions`; shows title label, `formatBytes(sizeBytes)`, `formatRelative(lastPlayedAt)`; spine + tokens; `href` wrapped in a plain `<a>` (full page nav into player).
- `DropZone` emits `files(File[])` from drop (`DataTransfer.files` and `items` with `webkitGetAsEntry` for folders) and from `<input type=file multiple accept=".chd,.pbp,.iso,.img,.bin,.cue,.m3u,.zip,.7z">`; copy: `drop.title`, `drop.hint` ("Recommend .chd — smallest"), `drop.privacy` ("Nothing is uploaded").
- `StorageMeter` props `{ usage, quota }` → bar + "1.2 GB used of 40 GB".

- [ ] **Step 1: Write failing tests**: `formatBytes(1234567890) === '1.2 GB'`; `placeholderStyle` deterministic and distinct for two titles; `DropZone` emits files from input change; `GameTile` renders title/size/relative and `<a href>`; `IndexPage` (mock `localDb`) hides "Free games" section entirely when manifest empty, lists games, shows `errors.missing-cue` notice after dropping a lone `.bin`, shows `errors.quota` + a "Play anyway (this session)" link when `addGame` throws `StorageError('quota')`, shows `warnings.largeFile` for an 800 MB single file.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** components + composable + page (layout shelf; sections: Free games placeholder `v-if="freeGames.length"` with `freeGames = []` until M2; My games `<GameGrid>` with rename (inline `prompt`-free: small inline input) and delete (two-step confirm button, no `window.confirm`); DropZone; StorageMeter under My games). Mobile: DropZone collapses to a button below 640px.
- [ ] **Step 4: Run** → PASS. Manually: drag a `.chd` in dev → tile appears; reload → still there.
- [ ] **Step 5: Commit** `feat: home page with drop zone, local game grid and storage meter`.

---

### Task 7: Player route — Boot stage + EmulatorJS integration

**Files:**
- Create: `app/pages/play/[source]/[id].vue`, `app/components/boot/{BootStage,PlayerOverlay}.vue`, `app/composables/useEmulator.ts`, `app/utils/emulatorjs.ts`
- Test: `tests/unit/emulatorjs.test.ts`, `tests/components/PlayPage.test.ts`

**Interfaces:**
- Produces (`utils/emulatorjs.ts`): `EJS_VERSION = '4.2.3'`; `RETROPAD_PS1_LABELS: Record<number, string>` (from Task 0 Step 4; e.g. `{0:'Cross',1:'Square',2:'Select',3:'Start',4:'D-pad Up',5:'D-pad Down',6:'D-pad Left',7:'D-pad Right',8:'Circle',9:'Triangle',10:'L1',11:'R1',12:'L2',13:'R2',14:'L3',15:'R3',16:'Left stick →',…}`); `readKeyboardMapping(emu: unknown): Array<{ button: string; key: string }>` (reads the property pinned in Task 0 Step 3, falls back to `[]`); `buildEjsGlobals(opts: { file: File; gameName: string; base: string; biosFile?: File; color: string }): Record<string, unknown>`.
- Produces (`useEmulator`): `useEmulator(): { phase: Ref<'idle'|'reading'|'packing'|'loading'|'starting'|'running'|'error'>; progress: Ref<number>; error: Ref<string | null>; start(opts): Promise<void>; onSaveExport: (cb: (save: Uint8Array) => void) => void }`. `start` sets `window.EJS_*` from `buildEjsGlobals`, defines `window.EJS_ready = () => phase='starting'`, `window.EJS_onGameStart = () => phase='running'`, `window.EJS_onSaveSave = (e) => cb(e.save)`, then appends `<script src="${base}loader.js">`. Progress by phase: reading 0.1→0.4 (blob read), packing 0.4→0.7, loading 0.7 (indeterminate shimmer), starting 0.9, running 1.
- Page `/play/[source]/[id]`: `definePageMeta({ layout: 'boot' })`; `source` ∈ `local | session` in M1 (`free`, `cloud` → `createError({ statusCode: 404 })` for now). `local`: `getGame(id)` → not found → render "Game not found" + `<a href="/">` back, do **not** call `start`. Found: `touchLastPlayed`, `buildGameFile` with progress, read optional BIOS (`getSetting('bios')` → blob → `File(biosName)`), `start`. `session`: reads `sessionOnly` from a module-level store set by Task 6 (lost on reload → "not found").
- `BootStage` props `{ title, phase, progress }`: radial bg from layout, 3 absolutely positioned `.blk` divs with slow CSS drift animation (`prefers-reduced-motion` → static), title `.boot-title` (Inter 300, letter-spacing .4em, white text-shadow glow), 2 px bar, `.label` status text from `en.json` `boot.${phase}`; fades out (`opacity 0`, `pointer-events none`) when `phase === 'running'`.
- `PlayerOverlay`: appears on mouse move / tap, hides after 2.5 s; buttons: FULLSCREEN (calls `document.getElementById('game')?.requestFullscreen()` — our container, EmulatorJS's own toolbar remains for its fullscreen), CONTROLS (opens Task 8 overlay), `<a href="/">LIBRARY</a>`. Set `EJS_color` from tokens (`#f2f2f2` dark / `#1f1f1f` grey), `EJS_backgroundColor` `#000`, `EJS_startOnLoaded = true`, `EJS_disableAutoLang = true`, `EJS_language = 'en-US'`.

- [ ] **Step 1: Write failing tests**: `buildEjsGlobals` returns `EJS_core: 'psx'`, `EJS_gameUrl` is the File, `EJS_gameName` equals name, includes `EJS_biosUrl` only when `biosFile` given; `readKeyboardMapping` maps a fixture object shaped as Task 0 recorded into `[{button:'Cross', key:'x'}, …]`; `PlayPage` with mocked `getGame` → undefined renders `play.notFound` text and no `<script src*="loader.js">` is appended; with a game, phase goes `reading → packing → loading` and a loader script tag exists with `src` ending `/loader.js`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: PASS.** Manual: open a local game in dev → boot stage → game runs with sound; keyboard works; press LIBRARY → full reload to `/`.
- [ ] **Step 5: Commit** `feat: boot-styled player route loading local games into EmulatorJS`.

---

### Task 8: Controls overlay, memory-card export, settings page (BIOS, storage, clear data)

**Files:**
- Create: `app/components/boot/ControlsOverlay.vue`, `app/pages/settings.vue`
- Modify: `app/components/boot/PlayerOverlay.vue`, `app/pages/play/[source]/[id].vue`, `i18n/locales/en.json`
- Test: `tests/components/ControlsOverlay.test.ts`, `tests/components/SettingsPage.test.ts`

**Interfaces:**
- `ControlsOverlay` props `{ mapping: Array<{ button: string; key: string }>; open: boolean }`, emits `close`; table Button → Key; text `controls.remapHint` ("Remap in the emulator menu → Control Settings"); `controls.gamepadHint` ("Gamepads work automatically; press any button").
- Player: `onSaveExport(save => downloadBlob(new Blob([save]), \`${game.title}.srm\`))` using an `<a download>` click. Import stays EmulatorJS's own "Import save" menu item; `controls.saveHint` explains both.
- `settings.vue` (layout shelf): ThemeToggle; **BIOS**: file input (`.bin`), stores via `setSetting('bios', blobKey)` + `setSetting('biosName', name)` after saving the blob with a new helper `putBlob(blob): Promise<string>` added to `localDb.ts` (export it; add unit test); shows current BIOS name + "Remove"; copy `settings.biosOptional` ("Optional. Games run without it; some run better with a real BIOS you own."). **Storage**: `StorageMeter` + persisted status (`navigator.storage.persisted()`). **Clear local data**: two-step confirm button → `clearAll()` + notice. **Controls help**: static `RETROPAD_PS1_LABELS` with default keys from `EJS_defaultControls`-shaped constant `DEFAULT_KEYS` in `emulatorjs.ts` (values recorded in Task 0).

- [ ] **Step 1: Write failing tests**: `ControlsOverlay` renders one row per mapping entry and emits `close` on Escape; `SettingsPage` (mocked localDb) adding a BIOS file calls `putBlob` then `setSetting('bios', key)` and shows the name; clear requires two clicks and calls `clearAll`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: PASS.** Manual: export save from EmulatorJS menu → `.srm` downloads with game title.
- [ ] **Step 5: Commit** `feat: controls overlay, memory card export, settings with optional BIOS and storage management`.

---

### Task 9: M1 acceptance — fixture, Playwright e2e, manual checklist

**Files:**
- Create: `tests/fixtures/README.md`, `scripts/fetch-fixture.mjs`, `playwright.config.ts`, `tests/e2e/m1-local-game.spec.ts`, `docs/manual-tests/m1.md`

- [ ] **Step 1: Fixture.** Choose one PS1 homebrew whose author grants redistribution (a permissively licensed Net Yaroze / PSn00bSDK sample release is the right class; verify the licence file in the release itself). Record in `tests/fixtures/README.md`: title, author, licence, exact source URL, sha256. `scripts/fetch-fixture.mjs` downloads it into `tests/fixtures/` and verifies the hash; the binary is gitignored (Task 1). If no suitable title with an explicit licence is found, stop and ask the owner — do not substitute.

- [ ] **Step 2: Write the e2e** (`playwright.config.ts`: `webServer: { command: 'pnpm dev', port: 3000 }`, chromium only, `use.launchOptions.args: ['--autoplay-policy=no-user-gesture-required']`; skip the whole spec with a clear message when the fixture file is absent):
```ts
test('add, persist, play locally', async ({ browser }) => {
  const context = await browser.newContext(); const page = await context.newPage()
  await page.goto('/')
  await page.setInputFiles('input[type=file]', FIXTURE)
  await expect(page.getByRole('link', { name: /FIXTURE_TITLE/i })).toBeVisible()
  // persistence: new page in same context (same origin storage)
  const page2 = await context.newPage(); await page2.goto('/')
  await expect(page2.getByRole('link', { name: /FIXTURE_TITLE/i })).toBeVisible()
  // privacy: no request body or URL contains the fixture bytes/name
  const requests: string[] = []; page2.on('request', r => requests.push(r.url() + (r.postData() ?? '')))
  await page2.getByRole('link', { name: /FIXTURE_TITLE/i }).click()
  await page2.waitForFunction(() => document.documentElement.dataset.phase === 'running', null, { timeout: 90_000 })
  expect(requests.some(r => r.includes(FIXTURE_BASENAME))).toBe(false)
  await expect(page2.locator('#game canvas')).toBeVisible()
})
```
(Player page sets `document.documentElement.dataset.phase = phase` for this hook.)
- [ ] **Step 3: Run** `pnpm test:e2e` → PASS (or SKIPPED with the fixture message if absent — then fetch and rerun).
- [ ] **Step 4: Manual checklist** `docs/manual-tests/m1.md` for the owner: DualSense over Bluetooth and USB (all face buttons, sticks); audio on Safari after first click; fullscreen on Mac Chrome/Safari; phone Safari touch gamepad; export `.srm` then import via emulator menu restores the save; both themes; browser restart keeps game + in-game save.
- [ ] **Step 5: Commit** `test: M1 end-to-end flow with documented homebrew fixture and manual checklist`.

---

### Task 10: Deploy to Cloudflare (`memcard.devffice.com`)

**Files:**
- Modify: `nuxt.config.ts` (nitro `cloudflare.wrangler` overrides), `README.md`

- [ ] **Step 1:** In `nuxt.config.ts` add `nitro.cloudflare.wrangler: { name: 'memcard', routes: [{ pattern: 'memcard.devffice.com', custom_domain: true }] }` so the generated wrangler config carries the custom domain. Document `wrangler login` in README.
- [ ] **Step 2:** `pnpm build && npx wrangler deploy` (owner's account; first run prompts login). Expected: deploy succeeds, URL printed.
- [ ] **Step 3: Verify in production:** `curl -I https://memcard.devffice.com/` → 200, HTML (SSR). Open in Chrome: add fixture, play, reload persists, both themes; DevTools Network shows no request with game bytes.
- [ ] **Step 4:** Set `sourceUrl` in `app.config.ts` to the pushed repo URL (owner creates the GitHub repo; push). **Step 5: Commit** `chore: Cloudflare deploy config for memcard.devffice.com`.

---

## Self-review notes

- Spec §5.1 touch controls: EmulatorJS virtual gamepad is on by default on mobile — no task needed beyond not disabling it; mobile layout polish is M5.
- Spec §5.3 `.7z`: accepted and passed through as a single file (EmulatorJS extracts); no own 7z code.
- Spec §6.2 self-hosted `data/`: M5 (CDN allowed in M1); `runtimeConfig.public.emulatorjsBase` is the single switch.
- Spec §8 error messages: unsupported/out-of-storage/large-memory covered (Tasks 3, 4, 6); network failure and expired signed URL belong to M2/M3.
- Interface check: `ClassifyResult` is awaited everywhere (`classifyFiles` is async); `putBlob` added in Task 8 to `localDb.ts` and tested there; `dataset.phase` hook defined in Task 7 and consumed in Task 9.
