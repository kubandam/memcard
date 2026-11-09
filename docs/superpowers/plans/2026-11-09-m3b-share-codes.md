# M3b — Share Codes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner of an encrypted library can give anyone a short code for one game or for the whole library; the recipient enters it (no account, no invite) and either downloads the game into My games or sees the library read-only as "Shared library"; the owner can revoke any code, after which nothing new can be fetched with it.

**Architecture:** Codes carry 80 random bits `S`. The browser derives `shareId` (lookup) and `K_share` (wrapping key) from `S`; the server stores only `shareId → libraryId, gameId?, allowedKeys, wrapped, revokedAt`, where `wrapped` = AES-GCM under `K_share` of `{ kLib }` or `{ game }`. Share reads use `Authorization: Share <shareId>`; the server checks the row is active and scopes reads (library share: manifest + any object of that library; game share: only that game's object keys, no manifest). Revocation sets `revoked_at`; the server never had the keys. Reuses M3a's `libraryService`, `downloadObject`, `buildGamePayload` and player.

**Tech Stack:** as M3a (Nuxt 4 on Workers, D1, R2, `ratelimits` binding, WebCrypto, Vitest, Playwright).

**Spec:** [encrypted-libraries design](../specs/2026-11-09-encrypted-libraries-design.md) §3 "Share codes", §4 routes, §5 UI. M3a code is the base.

## Global Constraints

- Code format `MC-XXXX-XXXX-XXXX-XXXX`: 16 Crockford base32 chars = exactly 80 bits from `crypto.getRandomValues(new Uint8Array(10))`; input is case-insensitive, dashes/spaces optional, `MC-` prefix optional.
- `shareId` = Crockford base32 of the first 16 bytes of `SHA-256("memcard-share-id" || S)` → 26 chars. `K_share` = HKDF-SHA256(`S`, info `"share"`, 32 bytes) as AES-GCM key. `wrapped` = `encryptJson(K_share, payload)` (random IV).
- Payloads: library `{ v: 1, kind: 'library', kLib: base64url(32 bytes) }`; game `{ v: 1, kind: 'game', game: CloudGame }` (CloudGame already contains `kGame`).
- Server never receives `S`, `K_share`, `kLib`, `kGame`, titles or names. `allowedKeys` (random object keys) and `gameId` (random uuid) are not sensitive.
- Every refusal (unknown, revoked, out of scope) is **404**. `GET /api/share/:shareId` is rate-limited by IP with binding `RL_SHARE` (`namespace_id "1002"`, 30 per 60 s). Max 100 active shares per library (429 beyond).
- Share holders can only **read**: no manifest writes, uploads, deletes, or creating/listing/revoking shares.
- Deleting a game in the owner UI revokes that game's codes first.
- UI strings in `en.json`; colours via tokens; conventional commits; commit per task; work on `main`.

## Review Focus

1. **Revoked code** used in an already-open shared library tab → next object fetch fails with "This code is no longer valid", no partial game started. (Tasks 3, 6)
2. **Game code** holder tries the manifest or another game's object key with their share id → 404. (Task 3)
3. **Mistyped code** (O/0, I/1, lowercase, missing dashes) still redeems; a code with a wrong character count says "That doesn't look like a code" without a network call. (Tasks 2, 6)
4. **Owner opens their own library code** on the same PC → it appears as "Shared library" without breaking the owner session or writing anything. (Task 6)
5. **Game deleted by the owner** after sharing → its codes are revoked and the recipient sees "no longer valid", not a decrypt error. (Tasks 5, 6)

---

## File structure

```
migrations/0004_shares.sql
wrangler.jsonc                               + RL_SHARE
shared/utils/shareCodes.ts                   newShareSecret, formatShareCode, parseShareCode, deriveShareKeys, wrap/unwrap payloads
shared/types/share.ts                        SharePayload, ShareInfo, IssuedShare
shared/utils/libraryKeys.ts                  deriveLibraryKeys also returns kLibRaw
server/utils/libraryStore.ts                 + createShare/getShare/listShares/revokeShare/countActiveShares
server/utils/libraryService.ts               + share-aware reads (scope check)
server/utils/libraryAuth.ts                  + resolveAccess(event, store, libraryId) → { kind: 'owner' } | { kind: 'share', share }
server/utils/libraryRoute.ts                 readerAction (owner or share) next to ownerAction
server/api/share/[shareId].get.ts            public lookup (rate-limited)
server/api/lib/[id]/shares/index.get.ts / index.post.ts / [shareId].delete.ts
server/api/lib/[id]/manifest.get.ts          owner or library share
server/api/lib/[id]/objects/[key]/index.get.ts   owner or scoped share
app/utils/cloudApi.ts                        + createShare/listShares/revokeShare; createShareReader(shareId, libraryId)
app/composables/useCloudLibrary.ts           + shareGame, shareLibrary, issuedShares, revokeShare; deleteGame revokes first
app/composables/useSharedLibraries.ts        redeem(code), saved libraries, games per library, downloadGameFiles, downloadToLocal, remove
app/components/shelf/ShareCodeBox.vue        code display + copy
app/components/shelf/IssuedShares.vue        list + revoke (owner)
app/components/shelf/RedeemCode.vue          "Have a code?" input + result (game preview / library added)
app/components/shelf/SharedLibrary.vue       read-only grid for one saved library
app/pages/index.vue                          + Redeem entry, Shared library sections
app/pages/play/[source]/[id].vue             + source = shared (?share=<shareId>)
tests/unit/{shareCodes,shareService}.test.ts, tests/unit/useSharedLibraries.test.ts, + additions to existing
tests/components/{RedeemCode,IssuedShares,SharedLibrary}.test.ts
tests/e2e/m3b-share-codes.spec.ts
docs/manual-tests/m3b.md
```

---

### Task 1: Shares table, rate-limit binding, store methods

**Files:** Create `migrations/0004_shares.sql`; modify `wrangler.jsonc`, `server/utils/bindings.ts`, `server/utils/libraryStore.ts`, `tests/unit/libraryStore.test.ts`.

**Interfaces:**
```sql
CREATE TABLE shares (id TEXT PRIMARY KEY, library_id TEXT NOT NULL, game_id TEXT, allowed_keys TEXT NOT NULL DEFAULT '[]',
  wrapped BLOB NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER);
CREATE INDEX shares_library ON shares(library_id);
```
```ts
export interface ShareRow { id: string; libraryId: string; gameId: string | null; allowedKeys: string[]; wrapped: Uint8Array; createdAt: number; revokedAt: number | null }
// LibraryStore additions
createShare(row: Omit<ShareRow, 'createdAt' | 'revokedAt'>): Promise<'created' | 'exists'>
getShare(id: string): Promise<ShareRow | null>
listShares(libraryId: string): Promise<Omit<ShareRow, 'wrapped'>[]>   // newest first
revokeShare(libraryId: string, id: string): Promise<boolean>          // false if not that library's / already revoked
countActiveShares(libraryId: string): Promise<number>
```
`MemcardEnv.RL_SHARE?` like `RL_CREATE`.

- [ ] **Step 1:** Store contract tests (memory): create/exists; get returns bytes equal; list excludes `wrapped`, newest first; revoke only within own library (other library → false) and sets `revokedAt`; count ignores revoked.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement memory + D1 (`allowed_keys` JSON text). Add `RL_SHARE` to `wrangler.jsonc`. Apply migration locally and remote (`pnpm d1:migrate:local`, `pnpm d1:migrate`).
- [ ] **Step 4:** Run → PASS. **Step 5: Commit** `feat: shares table and store methods`.

---

### Task 2: Share code crypto (shared)

**Files:** Create `shared/utils/shareCodes.ts`, `shared/types/share.ts`; modify `shared/utils/libraryKeys.ts` (`LibraryKeys.kLibRaw: Uint8Array`); test `tests/unit/shareCodes.test.ts` (node env).

**Interfaces:**
```ts
export type SharePayload = { v: 1; kind: 'library'; kLib: string } | { v: 1; kind: 'game'; game: CloudGame }
export function newShareSecret(): Uint8Array                       // 10 random bytes
export function formatShareCode(secret: Uint8Array): string        // 'MC-XXXX-XXXX-XXXX-XXXX' (uppercase for display)
export function parseShareCode(input: string): Uint8Array | null   // null when not exactly 16 base32 chars after normalising
export async function deriveShareKeys(secret: Uint8Array): Promise<{ shareId: string; kShare: CryptoKey }>
export async function wrapPayload(kShare: CryptoKey, p: SharePayload): Promise<Uint8Array>
export async function unwrapPayload(kShare: CryptoKey, bytes: Uint8Array): Promise<SharePayload>   // throws on tamper / bad shape
```
- [ ] **Step 1: Tests:** format/parse round-trip; parse accepts lowercase, no dashes, no `MC-`, `O`→0, `I`/`L`→1; rejects 15 or 17 chars and `U`; shareId 26 chars, deterministic, differs per secret; **pin a vector** (`deriveShareKeys(new Uint8Array([1,2,3,4,5,6,7,8,9,10])).shareId` literal recorded at RED time); wrap/unwrap library + game payloads; unwrap under another code's key rejects; `deriveLibraryKeys(...).kLibRaw` imported as AES key decrypts what `kLib` encrypted.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Commit** `feat: share code format and key derivation`.

---

### Task 3: Share-aware server — lookup, owner share routes, scoped reads

**Files:** Modify `server/utils/libraryAuth.ts`, `server/utils/libraryRoute.ts`, `server/utils/libraryService.ts`, `server/api/lib/[id]/manifest.get.ts`, `server/api/lib/[id]/objects/[key]/index.get.ts`; create `server/api/share/[shareId].get.ts`, `server/api/lib/[id]/shares/index.get.ts`, `index.post.ts`, `[shareId].delete.ts`; test `tests/unit/shareService.test.ts`.

**Interfaces:**
```ts
// libraryService additions (pure, testable with memory store + fake R2)
createShare(libraryId, input: { shareId: string; gameId: string | null; allowedKeys: string[]; wrapped: Uint8Array }): Promise<void>  // 429 at 100 active, 409 exists
listShares(libraryId): Promise<{ id: string; gameId: string | null; createdAt: number; revokedAt: number | null }[]>
revokeShare(libraryId, shareId): Promise<void>        // 404 if not found in that library
lookupShare(shareId): Promise<{ libraryId: string; gameId: string | null; wrapped: Uint8Array }>  // 404 unknown/revoked
/** Throws 404 unless the share is active, belongs to libraryId, and covers `what`. */
authorizeShare(shareId, libraryId, what: { manifest: true } | { key: string }): Promise<void>
```
- `resolveAccess(event, store, libraryId)`: `Authorization: Bearer …` → owner (as today); `Authorization: Share <26 chars>` → `{ kind: 'share', shareId }`; anything else → 404.
- `readerAction(event, what, fn)` in `libraryRoute.ts`: owner passes; share → `authorizeShare` then `fn`. Used only by `manifest.get` and `objects/[key]/index.get`. All other routes stay `ownerAction`.
- `POST /api/lib/:id/shares` body `{ shareId, gameId, allowedKeys, wrapped: base64url }` (owner) → 201. `GET` (owner) → list. `DELETE …/shares/:shareId` (owner) → revoke.
- `GET /api/share/:shareId` (public): `RL_SHARE.limit({ key: ip })` → 429; validate 26-char id; → `{ libraryId, gameId, wrapped: base64url }` with `cache-control: no-store`.

- [ ] **Step 1: Tests** (`shareService.test.ts`, memory store + fake R2 from M3a tests): library share reads manifest and any key of its library, not another library's; game share reads only its `allowedKeys` and is refused the manifest; revoked share → 404 on lookup, manifest and object; unknown → 404; 101st active share → 429; revoke from another library → 404; listShares newest first without `wrapped`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement service, auth, routes; add `RL_SHARE` handling.
- [ ] **Step 4:** PASS; manual `curl` against `pnpm dev` with a share created by a tsx script (extend `/tmp` smoke): lookup 200, revoked 404, game-share manifest 404.
- [ ] **Step 5: Commit** `feat: share codes on the server — lookup, owner routes, scoped reads, revoke`.

---

### Task 4: Client — owner sharing in `useCloudLibrary`, recipient composable

**Files:** Modify `app/utils/cloudApi.ts`, `app/composables/useCloudLibrary.ts`; create `app/composables/useSharedLibraries.ts`; tests `tests/unit/useCloudLibrary.test.ts` (+ shares), `tests/unit/useSharedLibraries.test.ts`; extend `tests/unit/fakeCloudApi.ts` with an in-memory share table and a `reader(shareId)` that enforces the same scope rules as Task 3.

**Interfaces:**
```ts
// cloudApi
CloudApi.createShare(input: { shareId; gameId; allowedKeys; wrapped: Uint8Array }): Promise<void>
CloudApi.listShares(): Promise<IssuedShareRow[]>; CloudApi.revokeShare(shareId: string): Promise<void>
export interface ShareReader { getManifest(): Promise<{ bytes: Uint8Array; etag: string } | null>; getRange(key, start, end): Promise<Uint8Array> }
export function createShareReader(opts: { shareId: string; libraryId: string; baseUrl?: string }): ShareReader   // Authorization: Share <id>
export function lookupShare(shareId: string, baseUrl?: string): Promise<{ libraryId: string; gameId: string | null; wrapped: Uint8Array }>  // ApiError 404/429

// useCloudLibrary additions
shareGame(gameId: string): Promise<string>          // returns formatted code
shareLibrary(): Promise<string>
issuedShares: Ref<{ id: string; label: string; kind: 'game' | 'library'; createdAt: number }[]>   // active only; label = game title or 'Whole library'
loadIssuedShares(): Promise<void>; revokeShare(id: string): Promise<void>
// deleteGame: revoke that game's active shares before saving the manifest

// useSharedLibraries.ts (module singleton; saved list in localDb setting 'sharedLibraries': { code: string; libraryId: string; addedAt: number }[])
redeem(input: string): Promise<{ kind: 'game'; game: CloudGame; code: string } | { kind: 'library'; libraryId: string } | { error: 'format' | 'invalid' | 'rate' | 'network' }>
libraries: Ref<{ shareId: string; libraryId: string; games: CloudGame[]; status: 'ok' | 'revoked' | 'error' }[]>
restore(): Promise<void>                               // reload saved codes, fetch + decrypt manifests
downloadGameFiles(shareId: string, game: CloudGame, onProgress?): Promise<File[]>   // ApiError 404 → throws ShareRevokedError
downloadToLocal(source: { shareId: string; game: CloudGame }): Promise<LocalGame | null>
remove(shareId: string): Promise<void>
export class ShareRevokedError extends Error {}
```
Game codes are **not** saved (one-shot download). Library codes are saved (by code, so keys are re-derived each visit; the `kLib` itself is not persisted).

- [ ] **Step 1: Tests.** Owner: `shareGame` posts `allowedKeys` = that game's file keys + cover key, `gameId`, and a `wrapped` that `unwrapPayload` (with the code) turns back into the same CloudGame; `shareLibrary` wraps `kLibRaw`; `deleteGame` revokes the game's shares first; `issuedShares` labels. Recipient: redeem game code → game preview; library code → saved + manifest decrypted; malformed → `{ error: 'format' }` with no fetch; revoked → `{ error: 'invalid' }`; `downloadGameFiles` after revoke → `ShareRevokedError`; owner's own library code on the same "PC" works and leaves `useCloudLibrary` state untouched.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Commit** `feat: share and redeem codes in the client`.

---

### Task 5: Owner UI — Share game, Share library, Issued codes

**Files:** Create `app/components/shelf/ShareCodeBox.vue`, `app/components/shelf/IssuedShares.vue`; modify `app/components/shelf/CloudLibrary.vue`, `en.json`; tests `tests/components/IssuedShares.test.ts`, `tests/components/CloudLibrary.test.ts` (+share).

- Tile action **Share** → creates a game code, shows `ShareCodeBox` (code in large mono type, Copy, text: "Anyone with this code can download this game. You can revoke it below.").
- Bar button **Share library** → code + text "Anyone with this code can see and play every game in this library, including ones you add later, until you revoke it."
- **Codes you issued** (collapsed `<details>`): rows `label · created date · Revoke` (two-step confirm), empty state.
- Copy strings: `share.*`.

- [ ] **Step 1: Tests:** Share on a tile calls `shareGame(id)` and shows the returned code; Share library shows its code with the "later" warning; IssuedShares lists labels and revoke requires two clicks then calls `revokeShare(id)`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + browser check (share a game in dev, code appears, revoke). **Step 5: Commit** `feat: owner UI to share games and the library and revoke codes`.

---

### Task 6: Recipient UI — redeem, Shared library, player `source = shared`

**Files:** Create `app/components/shelf/RedeemCode.vue`, `app/components/shelf/SharedLibrary.vue`; modify `app/pages/index.vue`, `app/pages/play/[source]/[id].vue`, `en.json`; tests `tests/components/RedeemCode.test.ts`, `tests/components/SharedLibrary.test.ts`, `tests/components/PlayPage.test.ts` (+shared).

- **RedeemCode** (on home, below Online library, always visible): input "Enter a code (MC-…)", Redeem. Results: format error (`share.badFormat`), invalid/revoked (`share.invalid`), rate (`share.tooMany`); game → card "Title · size" + **Download to My games** (progress, then "Added to My games"); library → "Shared library added" and the section appears.
- **SharedLibrary** per saved library: heading "Shared library" + `share.readOnly` label, grid with *Play* (`/play/shared/<gameId>?share=<shareId>`) and *Download to this PC*, **Remove** (forget code). Revoked → notice `share.revokedLibrary` + Remove only.
- Player `source=shared`: `useSharedLibraries().restore()`, find library by `?share`, game by id; download+decrypt via reader → `boot`; `ShareRevokedError` → `fail(t('share.invalid'))`; not saved/not found → not-found screen.

- [ ] **Step 1: Tests:** RedeemCode: malformed shows format error without calling `redeem`'s network (spy on `lookupShare`); game result shows title and download button calling `downloadToLocal`; library result emits `added`. SharedLibrary: tiles link to `/play/shared/<id>?share=<shareId>`; revoked status shows notice and hides Play. PlayPage shared: phases reading → loading, `EJS_gameUrl.name === primaryName`; revoked → "no longer valid", no loader injected.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + browser: two profiles (owner + recipient) via Playwright contexts. **Step 5: Commit** `feat: redeem share codes, shared library section and shared playback`.

---

### Task 7: E2E, manual checklist, deploy

**Files:** Create `tests/e2e/m3b-share-codes.spec.ts`, `docs/manual-tests/m3b.md`.

- [ ] **Step 1: E2E** (fixture required): owner context creates library, uploads fixture, **Share** game → reads code, **Share library** → reads code. Recipient context (fresh): redeems game code → Download → game in My games and plays; redeems library code → Shared library with 1 game → Play from shared → running. Owner revokes the library code. Recipient reloads → Shared library shows revoked notice; Play link absent. Network assertions: no request carries a code string (`MC-…` or its base32) or the fixture name; `/api/share/` responses contain no title.
- [ ] **Step 2:** `pnpm test && pnpm test:e2e` → all pass.
- [ ] **Step 3: Manual checklist** `docs/manual-tests/m3b.md`: share a 600 MB game to a friend's real PC, they download and play; share library to phone; revoke while friend has page open → next Play fails cleanly; delete shared game → friend sees invalid; mistyped code variants.
- [ ] **Step 4: Deploy:** `pnpm d1:migrate`, `pnpm build`, `wrangler deploy --config .output/server/wrangler.json`; production smoke via tsx script: create library (invite), create share, lookup 200, scoped object read 200, manifest with game share 404, revoke → 404; delete **only** that smoke library and its shares by printed id.
- [ ] **Step 5: Commit** `test: M3b share codes end-to-end and manual checklist`.

---

## Self-review notes

- Design §3 share codes: format/derivation (T2), wrapped payloads (T2, T4), server scope + revocation (T3), "server never had the keys" (Global Constraints, T7 network assertions).
- Design §5 UI: owner share + issued list (T5), recipient section + game download (T6).
- Review Focus 1–5 pinned: revoked-in-open-tab (T4 ShareRevokedError, T6 PlayPage), game-share scope (T3), mistyped codes (T2, T6), owner redeeming own code (T4), delete cascades revoke (T4, T6).
- Types: `SharePayload`/`CloudGame` shared; `ShareReader` used by `useSharedLibraries` and player; `issuedShares` labels computed from current manifest.
- Library-code revocation does not rotate `kLib`: a recipient who copied keys out of their browser keeps the ability to *decrypt* ciphertext they already have, but cannot fetch anything new (server refuses). Matches design §3; noted for the owner.
