# M3a — Encrypted Online Library Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visitor with an invite code creates a password-only library; the owner uploads games from their local library (encrypted in the browser, resumable), sees them on any PC after typing the same password, plays them straight from the cloud or downloads them into the local library, and deletes them — with the server, R2 and D1 holding only ciphertext.

**Architecture:** All cryptography in the browser (WebCrypto): PBKDF2 → `K_root` → HKDF → `libraryId` / `K_auth` / `K_lib`; per-game `K_game`, per-object HKDF subkey, AES-256-GCM in 4 MiB chunks with counter nonces and AAD. The Nuxt server on Cloudflare Workers is a thin gate: D1 for `libraries`/`objects`/`uploads`, R2 for `manifest` and object blobs, bodies streamed through the `R2` binding's multipart API. The client reuses M1's `GamePayload` → `useEmulator` path for playback and `localDb` for "Download to this PC".

**Tech Stack:** Nuxt 4.6 / Nitro `cloudflare_module`, `nitro-cloudflare-dev` 0.2.x (bindings in `nuxt dev`), Cloudflare D1 + R2 + `ratelimits` binding, WebCrypto, Vitest, Playwright, wrangler 4.159.

**Spec:** [docs/superpowers/specs/2026-11-09-encrypted-libraries-design.md](../specs/2026-11-09-encrypted-libraries-design.md) (binding) and [M1 design](../specs/2026-11-09-ps1-player-design.md). Sharing (codes) is **M3b**, not here.

## Global Constraints

- Server, D1, R2 and logs never see a password, `K_root`, `K_auth` (only its SHA-256), `K_lib`, `K_game`, a title, a file name, or plaintext bytes. Server code must not log request bodies or object keys beyond `libraryId`/`objectKey`.
- PBKDF2-SHA256, **600 000** iterations, salt `"memcard-v1"`; HKDF-SHA256 infos `"id"`, `"auth"`, `"lib"`, `"obj" || objectKey`; AES-256-GCM, 96-bit nonce, 128-bit tag; chunk size **4 MiB**; parts **16 MiB**.
- `libraryId` = Crockford base32 (lowercase) of the first 16 bytes of HKDF(`K_root`, `"id"`) → 26 chars. Object keys are 22-char base32 of 14 random bytes.
- Library creation requires an invite from env `MEMCARD_INVITES` (comma-separated). Unknown library, wrong key and missing invite all answer **404**, never 401/403 (no enumeration).
- Quota: per-library soft limit 8 GiB (UI), global hard limit env `TOTAL_BYTES_LIMIT` default `9663676416` (9 GiB) enforced at `complete`.
- Keys live in `sessionStorage` key `memcard.cloud.kroot` (base64) only after a successful open; "Close library" removes it.
- Content rules of spec §3 unchanged: no commercial content or BIOS in repo, fixtures or tests. E2E uses the M1 fixture ISO.
- UI strings in `i18n/locales/en.json`; colours from tokens (the tokens-lint test stays green); conventional commits; commit per task.

## Review Focus

1. **Wrong password** → "No library found for this password" (not an error page), no library created, nothing written. (Task 6)
2. **Tab closed mid-upload, reopened** → the upload resumes from the last completed part without re-encrypting earlier parts into a *different* ciphertext (same `K_game`, same object key, parts already uploaded are kept). (Task 7)
3. **Tampered or truncated object** (bit flip, missing last chunk) → playback refuses with a clear message; no partial game is handed to the emulator. (Tasks 2, 8)
4. **Quota exceeded during `complete`** → upload is aborted server-side, nothing appears in the manifest, UI explains the limit. (Tasks 4, 7)
5. **Two tabs editing the manifest** → the second save gets a 412, reloads, and retries once; no game entry is lost. (Tasks 4, 6)

---

## File structure

```
wrangler.jsonc                         bindings + migrations_dir for wrangler CLI (d1/r2 mgmt, dev)
migrations/0001_libraries.sql
nuxt.config.ts                         + nitro-cloudflare-dev, nitro.cloudflare.wrangler bindings mirror
shared/types/library.ts                CloudFileRef, CloudGame, LibraryManifest, api DTOs
shared/utils/base32.ts                 Crockford base32 encode/decode
shared/utils/libraryKeys.ts            deriveRootKey, deriveLibraryKeys, authVerifierHex, recovery key format
shared/utils/chunkCrypto.ts            deriveObjectKey, encrypt/decryptChunk, encrypt/decryptJson, sizes
shared/utils/passphrase.ts             generatePassphrase(words), isStrongSecret
app/assets/wordlist/eff-short-1.json   1296 words (CC BY 3.0 US, attribution file next to it)
server/utils/bindings.ts               useBindings(event)
server/utils/libraryStore.ts           LibraryStore interface + createD1Store + createMemoryStore
server/utils/libraryAuth.ts            requireOwner, requireInvite, notFound
server/api/lib/index.post.ts           create
server/api/lib/[id]/index.get.ts       usage
server/api/lib/[id]/manifest.get.ts / manifest.put.ts
server/api/lib/[id]/objects/[key]/index.get.ts / index.delete.ts
server/api/lib/[id]/objects/[key]/mpu/index.post.ts
server/api/lib/[id]/objects/[key]/mpu/[uploadId]/[part].put.ts
server/api/lib/[id]/objects/[key]/mpu/[uploadId]/complete.post.ts
server/api/lib/[id]/objects/[key]/mpu/[uploadId]/index.delete.ts
app/utils/cloudApi.ts                  typed client, Bearer K_auth
app/utils/cloudUpload.ts               encrypt + multipart with resume state
app/utils/cloudDownload.ts             ranged fetch + decrypt → Uint8Array[]
app/composables/useCloudLibrary.ts     open/create/close, manifest CRUD, upload/download/delete
app/components/shelf/CloudPanel.vue    closed state: secret box, create flow, passphrase + recovery key
app/components/shelf/CloudLibrary.vue  open state: grid, upload picker, quota, close
app/pages/index.vue                    + Online library section
app/pages/play/[source]/[id].vue       + source = cloud
app/utils/localDb.ts                   DB v2: `uploads` store
tests/unit/{base32,libraryKeys,chunkCrypto,passphrase,libraryStore,cloudUpload,cloudDownload}.test.ts
tests/components/{CloudPanel,CloudLibrary}.test.ts
tests/e2e/m3a-cloud-library.spec.ts
docs/manual-tests/m3a.md
```

---

### Task 1: Cloudflare resources, bindings, dev wiring, migration

**Files:**
- Create: `wrangler.jsonc`, `migrations/0001_libraries.sql`, `server/utils/bindings.ts`, `.dev.vars.example`
- Modify: `nuxt.config.ts`, `package.json` (scripts), `.gitignore` (`.dev.vars`, `.wrangler/state`)

**Interfaces:**
- Produces: `useBindings(event: H3Event): { db: D1Database; r2: R2Bucket; rlCreate?: RateLimit; env: { MEMCARD_INVITES?: string; TOTAL_BYTES_LIMIT?: string } }` throwing 500 `"Cloudflare bindings unavailable"` when absent.
- Bindings: `DB` (D1 `memcard`), `R2` (bucket `memcard-libraries`), `RL_CREATE` (`ratelimits`, `namespace_id: "1001"`, `simple: { limit: 5, period: 60 }`).
- Schema (migration 0001):
```sql
CREATE TABLE libraries (id TEXT PRIMARY KEY, auth_verifier TEXT NOT NULL, manifest_etag TEXT, bytes_used INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE objects (library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE, key TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (library_id, key));
CREATE TABLE uploads (id TEXT PRIMARY KEY, library_id TEXT NOT NULL, key TEXT NOT NULL, upload_id TEXT NOT NULL, created_at INTEGER NOT NULL);
```

- [ ] **Step 1:** `pnpm add -D nitro-cloudflare-dev @cloudflare/workers-types`. Create resources (owner's account): `CLOUDFLARE_ACCOUNT_ID=90d0d0660f1b886cb169bb7c376981c7 npx wrangler d1 create memcard` (note the `database_id`) and `… wrangler r2 bucket create memcard-libraries`.
- [ ] **Step 2: `wrangler.jsonc`** at repo root: `name: "memcard"`, `compatibility_date: "2025-07-15"`, `compatibility_flags: ["nodejs_compat"]`, `d1_databases: [{ binding: "DB", database_name: "memcard", database_id: "<id>", migrations_dir: "migrations" }]`, `r2_buckets: [{ binding: "R2", bucket_name: "memcard-libraries" }]`, `ratelimits: [{ name: "RL_CREATE", namespace_id: "1001", simple: { limit: 5, period: 60 } }]`. Write `migrations/0001_libraries.sql` as above.
- [ ] **Step 3: `nuxt.config.ts`:** add `'nitro-cloudflare-dev'` to `modules`; mirror the three bindings under `nitro.cloudflare.wrangler` (`d1_databases`, `r2_buckets`, `ratelimits`) so the generated deploy config carries them; keep `routes`.
- [ ] **Step 4: `server/utils/bindings.ts`** per the interface, reading `event.context.cloudflare?.env`. Add `.dev.vars.example` with `MEMCARD_INVITES=dev-invite` and `TOTAL_BYTES_LIMIT=9663676416`; gitignore `.dev.vars`.
- [ ] **Step 5:** Scripts: `"d1:migrate:local": "wrangler d1 migrations apply memcard --local"`, `"d1:migrate": "wrangler d1 migrations apply memcard --remote"`. Run the local one → `0001_libraries.sql` applied. Run remote one → applied on the owner's D1.
- [ ] **Step 6: Verify.** Add a temporary route `server/api/_health.get.ts` returning `{ d1: await db.prepare('SELECT 1 AS ok').first(), r2: (await r2.list({ limit: 1 })).objects.length >= 0 }`; `pnpm dev` → `curl localhost:3000/api/_health` → `{"d1":{"ok":1},"r2":true}`. Delete the route. `pnpm build` → `.output/server/wrangler.json` contains the three bindings.
- [ ] **Step 7: Commit** `chore: Cloudflare D1, R2 and rate-limit bindings with local dev wiring and first migration`.

---

### Task 2: Crypto primitives (pure, shared)

**Files:**
- Create: `shared/utils/base32.ts`, `shared/utils/libraryKeys.ts`, `shared/utils/chunkCrypto.ts`, `shared/types/library.ts`
- Test: `tests/unit/base32.test.ts`, `tests/unit/libraryKeys.test.ts`, `tests/unit/chunkCrypto.test.ts` (all `// @vitest-environment node`)

**Interfaces:**
```ts
// base32.ts — Crockford alphabet 0123456789abcdefghjkmnpqrstvwxyz (lowercase out, case-insensitive in; i/l→1, o→0)
export function encodeBase32(bytes: Uint8Array): string
export function decodeBase32(text: string): Uint8Array
export function randomBase32(bytes: number): string

// libraryKeys.ts
export const APP_SALT = 'memcard-v1'; export const PBKDF2_ITERATIONS = 600_000
export const RECOVERY_PREFIX = 'MCKEY-'
export async function deriveRootKey(password: string): Promise<Uint8Array>          // 32 bytes
export interface LibraryKeys { libraryId: string; kAuth: Uint8Array; kLib: CryptoKey }
export async function deriveLibraryKeys(kRoot: Uint8Array): Promise<LibraryKeys>
export async function authVerifierHex(kAuth: Uint8Array): Promise<string>              // sha256 hex
export function toAuthHeader(kAuth: Uint8Array): string                                // base64url
export function formatRecoveryKey(kRoot: Uint8Array): string                           // 'MCKEY-' + base64url
export function parseSecret(input: string): { kind: 'recovery'; kRoot: Uint8Array } | { kind: 'password'; password: string }

// chunkCrypto.ts
export const CHUNK_SIZE = 4 * 1024 * 1024; export const GCM_TAG = 16; export const IV_BYTES = 12
export function chunkCount(plainSize: number): number
export function encryptedSize(plainSize: number): number            // plain + chunkCount*16
export function plainSizeOfChunk(index: number, plainSize: number): number
export async function importGameKey(kGame: Uint8Array): Promise<CryptoKey>           // HKDF base key
export async function deriveObjectKey(kGame: Uint8Array, objectKey: string): Promise<CryptoKey>  // AES-GCM
export function nonceFor(index: number): Uint8Array                  // 12 bytes, big-endian counter
export function aadFor(objectKey: string, index: number): Uint8Array
export async function encryptChunk(key: CryptoKey, objectKey: string, index: number, plain: Uint8Array): Promise<Uint8Array>
export async function decryptChunk(key: CryptoKey, objectKey: string, index: number, cipher: Uint8Array): Promise<Uint8Array>  // throws on tamper
export async function encryptJson(key: CryptoKey, value: unknown): Promise<Uint8Array>   // iv || ciphertext
export async function decryptJson<T>(key: CryptoKey, bytes: Uint8Array): Promise<T>
export function newObjectKey(): string                              // randomBase32(14)
export function newGameKey(): Uint8Array                            // 32 random bytes

// shared/types/library.ts
export interface CloudFileRef { name: string; size: number; objectKey: string; chunks: number }
export interface CloudGame { id: string; title: string; kind: GameKind; primaryName: string; files: CloudFileRef[]; generatedM3u?: string; coverObjectKey?: string; coverSize?: number; sizeBytes: number; createdAt: number; lastPlayedAt: number | null; kGame: string /* base64 */ }
export interface LibraryManifest { version: 1; games: CloudGame[] }
export interface LibraryUsage { bytesUsed: number; softLimit: number; hardLimit: number }
```

- [ ] **Step 1: Write failing tests.**
```ts
// base32: round-trips random bytes; decodes 'O'/'I'/'L' leniently; rejects 'u' and '!'
// libraryKeys: deriveRootKey('correct horse battery staple') is 32 bytes and deterministic; two passwords → different libraryId;
//   libraryId is 26 chars of the Crockford alphabet; authVerifierHex is 64 hex chars and differs from toAuthHeader;
//   parseSecret('MCKEY-'+formatRecoveryKey(k).slice(6)).kRoot equals k; parseSecret('hunter2') is password.
//   PIN A VECTOR: const id = (await deriveLibraryKeys(await deriveRootKey('memcard test vector'))).libraryId; snapshot the value
//   you observe at RED time into the test as a literal so future refactors cannot silently change derivation.
// chunkCrypto: encrypt/decrypt round-trip of 9 MiB (3 chunks: 4,4,1); encryptedSize = plain + 3*16;
//   flipping one byte of chunk 1 → decryptChunk rejects; decrypting chunk 1's bytes with index 0 → rejects (AAD/nonce);
//   decrypting under a key derived for another objectKey → rejects; encryptJson/decryptJson round-trip and IV differs between two calls.
```
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/base32.test.ts tests/unit/libraryKeys.test.ts tests/unit/chunkCrypto.test.ts` → FAIL (modules missing).
- [ ] **Step 3: Implement** with `globalThis.crypto.subtle` (PBKDF2 `deriveBits` 256; HKDF `deriveBits`/`deriveKey`; AES-GCM `encrypt` with `additionalData`). `deriveLibraryKeys`: `libraryId = encodeBase32(hkdf(kRoot,'id',16))`; `kAuth = hkdf(kRoot,'auth',32)`; `kLib = deriveKey(hkdf 'lib') as AES-GCM 256`. 600k PBKDF2 in Node takes ~0.5–1 s; run that test once per file, not per case.
- [ ] **Step 4: Run** → PASS (note the PBKDF2 timing). Record the observed vector literal in the test (Step 1 note).
- [ ] **Step 5: Commit** `feat: library key derivation, chunked AES-GCM and base32 primitives`.

---

### Task 3: Passphrase generator and strength rule

**Files:**
- Create: `shared/utils/passphrase.ts`, `app/assets/wordlist/eff-short-1.json`, `app/assets/wordlist/LICENSE-EFF.txt`, `scripts/fetch-wordlist.mjs`
- Test: `tests/unit/passphrase.test.ts`

**Interfaces:**
- `generatePassphrase(words: string[], count = 4): string` — `crypto.getRandomValues`, joined by `-`.
- `isStrongSecret(input: string): boolean` — true if `parseSecret` says recovery, or ≥ 16 chars, or ≥ 4 `-`/space-separated words each ≥ 3 chars.
- `WORDLIST_URL = 'https://www.eff.org/files/2016/09/08/eff_short_wordlist_1.txt'`; the JSON is `string[]` of 1296 words; `LICENSE-EFF.txt` states CC BY 3.0 US and the source URL.

- [ ] **Step 1: Tests:** generator returns 4 words from the list joined by `-`, two calls differ; `isStrongSecret('abc')` false, `'otter-pencil-river-mango'` true, `'x'.repeat(16)` true, `'MCKEY-…'` true; wordlist JSON has exactly 1296 unique entries.
- [ ] **Step 2: Run** → FAIL. **Step 3:** `scripts/fetch-wordlist.mjs` downloads the EFF file, strips dice numbers, writes the JSON; run it once and commit the JSON + licence note. Implement the utils.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat: passphrase generator with EFF short wordlist`.

---

### Task 4: Library store and server routes

**Files:**
- Create: `server/utils/libraryStore.ts`, `server/utils/libraryAuth.ts`, all `server/api/lib/**` routes listed in the file structure
- Test: `tests/unit/libraryStore.test.ts` (memory store contract), `tests/unit/libraryAuth.test.ts`

**Interfaces:**
```ts
// libraryStore.ts
export interface LibraryRow { id: string; authVerifier: string; manifestEtag: string | null; bytesUsed: number }
export interface LibraryStore {
  createLibrary(id: string, authVerifier: string): Promise<'created' | 'exists'>
  getLibrary(id: string): Promise<LibraryRow | null>
  setManifestEtag(id: string, etag: string): Promise<void>
  totalBytes(): Promise<number>
  addObject(libraryId: string, key: string, size: number): Promise<void>       // also bytes_used += size
  removeObject(libraryId: string, key: string): Promise<number>                 // returns size removed, bytes_used -= size
  listObjects(libraryId: string): Promise<{ key: string; size: number }[]>
  putUpload(id: string, libraryId: string, key: string, uploadId: string): Promise<void>
  getUpload(id: string): Promise<{ libraryId: string; key: string; uploadId: string } | null>
  deleteUpload(id: string): Promise<void>
}
export function createMemoryStore(): LibraryStore
export function createD1Store(db: D1Database): LibraryStore
export function useLibraryStore(event: H3Event): LibraryStore   // D1 in prod/dev; MEMORY when process.env.MEMCARD_MEMORY_STORE==='1' (unit tests)

// libraryAuth.ts
export function notFound(): never                                   // createError 404 'Not found'
export async function requireOwner(event: H3Event, store: LibraryStore, libraryId: string): Promise<LibraryRow>
//   Authorization: 'Bearer <base64url K_auth>' → sha256 hex → timingSafeEqual with row.authVerifier, else notFound()
export function requireInvite(event: H3Event, body: { invite?: string }): void   // env MEMCARD_INVITES split(',') includes, else notFound()
export function readIfMatch(event: H3Event): string | null
```
Routes (all JSON unless noted; `id` validated as `/^[0-9a-hjkmnp-tv-z]{26}$/`, `key` as 22 chars same alphabet):
- `POST /api/lib` body `{ id, authVerifier, invite }` → rate-limit `RL_CREATE` by IP (`cf-connecting-ip`) → `requireInvite` → `createLibrary`; `201 {}` or `409` if exists.
- `GET /api/lib/:id` (owner) → `LibraryUsage` (`softLimit` 8 GiB, `hardLimit` env).
- `GET /api/lib/:id/manifest` (owner) → `R2.get('lib/{id}/manifest')` body as `application/octet-stream` with header `ETag: <r2 etag>`; 204 when none yet.
- `PUT /api/lib/:id/manifest` (owner) body bytes; `If-Match` must equal the stored `manifest_etag` when one exists else `412`; after `R2.put`, store new etag; respond `{ etag }`.
- `POST …/objects/:key/mpu` (owner) → `R2.createMultipartUpload('lib/{id}/obj/{key}')` → `putUpload` → `{ uploadId }`.
- `PUT …/mpu/:uploadId/:part` (owner; `part` 1–10000; body stream) → `resumeMultipartUpload(...).uploadPart(part, body)` → `{ etag }`.
- `POST …/mpu/:uploadId/complete` (owner) body `{ parts: [{ partNumber, etag }], size }` → check `totalBytes() + size <= hardLimit` else abort + `413 { code: 'quota' }`; `complete(parts)`; `addObject`; `deleteUpload`; `{ size }`.
- `DELETE …/mpu/:uploadId` (owner) → `abort()`; `deleteUpload`.
- `GET …/objects/:key` (owner) → passes `Range` to `R2.get(key, { range })`; responds 206/200 with `Content-Range`, `Content-Length`, `Accept-Ranges: bytes`, body stream; 404 when missing.
- `DELETE …/objects/:key` (owner) → `R2.delete`; `removeObject`; `{}`.

- [ ] **Step 1: Tests.** `libraryStore.test.ts`: contract on `createMemoryStore()` — create twice → 'exists'; add/remove object adjusts `bytesUsed` and `totalBytes` across two libraries; upload put/get/delete. `libraryAuth.test.ts`: `requireOwner` with the right bearer returns the row; wrong bearer, missing header and unknown id all throw `statusCode 404`; `requireInvite` with `MEMCARD_INVITES='a,b'` accepts `'b'`, rejects `'c'` with 404.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** store + auth + routes. D1 store uses `db.prepare(...).bind(...).run()/first()/all()` and `db.batch` for add/remove+bytes_used. Constant-time compare via `crypto.subtle.timingSafeEqual` when available, else manual XOR loop.
- [ ] **Step 4: Run** → PASS. Manual with `pnpm dev` + `.dev.vars`: `curl -X POST localhost:3000/api/lib -d '{"id":"<26 chars>","authVerifier":"<64 hex>","invite":"dev-invite"}'` → 201; again → 409; without invite → 404.
- [ ] **Step 5: Commit** `feat: encrypted library API — create, manifest, multipart objects, quota`.

---

### Task 5: Client API, upload and download pipelines

**Files:**
- Create: `app/utils/cloudApi.ts`, `app/utils/cloudUpload.ts`, `app/utils/cloudDownload.ts`
- Modify: `app/utils/localDb.ts` (DB_VERSION 2, store `uploads` keyPath `id`)
- Test: `tests/unit/cloudUpload.test.ts`, `tests/unit/cloudDownload.test.ts` (node env, fake `CloudApi`), `tests/unit/localDb.test.ts` (+ uploads store)

**Interfaces:**
```ts
// cloudApi.ts
export interface CloudApi {
  createLibrary(id: string, authVerifier: string, invite: string): Promise<void>            // throws ApiError(409|404)
  usage(): Promise<LibraryUsage>
  getManifest(): Promise<{ bytes: Uint8Array; etag: string } | null>
  putManifest(bytes: Uint8Array, ifMatch: string | null): Promise<string>                   // new etag; throws ApiError(412)
  createUpload(key: string): Promise<string>                                                // uploadId
  uploadPart(key: string, uploadId: string, part: number, body: Uint8Array): Promise<string> // etag
  completeUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[], size: number): Promise<void>  // ApiError(413,'quota')
  abortUpload(key: string, uploadId: string): Promise<void>
  getRange(key: string, start: number, endInclusive: number): Promise<Uint8Array>
  deleteObject(key: string): Promise<void>
}
export class ApiError extends Error { constructor(public status: number, public code?: string) }
export function createCloudApi(opts: { libraryId: string; kAuth: Uint8Array; baseUrl?: string }): CloudApi

// cloudUpload.ts
export const PART_SIZE = 16 * 1024 * 1024  // = 4 chunks
export interface UploadState { id: string; libraryId: string; objectKey: string; uploadId: string; parts: { partNumber: number; etag: string }[]; fileName: string; fileSize: number; fileLastModified: number }
export async function uploadObject(api: CloudApi, blob: Blob, kGame: Uint8Array, objectKey: string, opts: {
  resume?: UploadState; onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  saveState: (s: UploadState) => Promise<void>; clearState: (id: string) => Promise<void>; libraryId: string
}): Promise<{ objectKey: string; chunks: number; size: number }>
//   reads the blob in PART_SIZE slices, encrypts 4 chunks each (last part may be shorter), PUTs parts sequentially, saveState after each etag,
//   on resume skips parts already in state.parts; completes with the encrypted total size; clearState at the end.

// cloudDownload.ts
export async function downloadObject(api: CloudApi, ref: CloudFileRef, kGame: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<Uint8Array>
//   fetches PART_SIZE-aligned ranges of the encrypted object, decrypts chunk by chunk, verifies chunk count; throws DecryptError on tamper/truncation.
export class DecryptError extends Error {}
```

- [ ] **Step 1: Tests.** Fake `CloudApi` backed by a `Map<string, Uint8Array>` that records parts and assembles on complete. `cloudUpload`: 9 MiB blob → 1 part of 9 MiB + 3×16 tag; state saved after each part; resume with `parts:[{1,…}]` on a 40 MiB blob skips part 1 (assert `uploadPart` called for 2 and 3 only) and completes with the same final bytes as a fresh upload. `cloudDownload`: round-trip from the fake store equals the plaintext; flipping a byte → `DecryptError`; dropping the last chunk → `DecryptError` mentioning truncation. `localDb`: `uploads` store put/get/delete survive `openDb` v2 upgrade from v1 data (seed v1 DB with a game, open v2, game still there).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat: encrypted multipart upload with resume and ranged download`.

---

### Task 6: `useCloudLibrary` — open / create / close / manifest

**Files:**
- Create: `app/composables/useCloudLibrary.ts`, `app/components/shelf/CloudPanel.vue`
- Modify: `app/pages/index.vue`, `i18n/locales/en.json`
- Test: `tests/components/CloudPanel.test.ts`, `tests/unit/useCloudLibrary.test.ts` (fake `CloudApi` + fake `fetch` for create)

**Interfaces:**
```ts
export type CloudStatus = 'closed' | 'opening' | 'open' | 'error'
export function useCloudLibrary(): {
  status: Ref<CloudStatus>; libraryId: Ref<string | null>; games: Ref<CloudGame[]>; usage: Ref<LibraryUsage | null>
  notice: Ref<LibraryNotice | null>; busy: Ref<string | null>
  open(secret: string): Promise<boolean>              // password or MCKEY-; false + notice 'cloud.noLibrary' when 404
  create(password: string, invite: string): Promise<{ recoveryKey: string } | null>  // 409 → 'cloud.exists', 404 → 'cloud.badInvite'
  close(): void                                        // forget keys, sessionStorage.removeItem
  restore(): Promise<void>                             // on mount: sessionStorage K_root → open without PBKDF2
  saveManifest(mutate: (m: LibraryManifest) => void): Promise<void>  // encrypt, PUT with If-Match; on 412 reload + retry once
  // Task 7/8 add: uploadGame, deleteGame, downloadToLocal, playParams
}
```
- Module-level singleton state (like `useTheme`), `sessionStorage` key `memcard.cloud.kroot`.
- `CloudPanel` (closed state): secret input (show/hide), buttons **Open** and **Create new library**; create flow: generated passphrase shown large with Copy, "I wrote it down" checkbox, invite input, submit → shows recovery key with Download; strength rule from Task 3 for custom passwords; copy keys `cloud.*`.

- [ ] **Step 1: Tests.** `useCloudLibrary`: `create` posts `{id, authVerifier, invite}` where `authVerifierHex(kAuth)` matches and `id` is 26 chars, then `status === 'open'`, empty manifest saved; `open` with wrong password → 404 → `false`, notice `cloud.noLibrary`, nothing written; `saveManifest` on 412 reloads and retries once (fake returns 412 first). `CloudPanel`: Create without checking "wrote it down" is disabled; weak custom password shows `cloud.weak`; Open calls `open(secret)`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; home page renders `<CloudPanel>` when `status !== 'open'` under a new "Online library" `SectionLabel`, `<CloudLibrary>` (Task 7) otherwise.
- [ ] **Step 4: Run** → PASS; manual: create in dev with invite `dev-invite`, reload → still open (sessionStorage), close → panel.
- [ ] **Step 5: Commit** `feat: password-derived online library — create, open, close, encrypted manifest`.

---

### Task 7: Upload from local library, grid, delete, quota

**Files:**
- Create: `app/components/shelf/CloudLibrary.vue`
- Modify: `app/composables/useCloudLibrary.ts`, `i18n/locales/en.json`
- Test: `tests/components/CloudLibrary.test.ts`, `tests/unit/useCloudLibrary.test.ts` (+ upload/delete)

**Interfaces:**
- `uploadGame(local: LocalGame): Promise<void>` — new `kGame`; for each `local.files[i]` a new object key, `uploadObject` (state saved in `localDb.uploads`), cover too if present; then `saveManifest(m => m.games.push(entry))`; progress in `uploadProgress: Ref<{ gameId: string; done: number; total: number } | null>`; on `ApiError 413 quota` → abort remaining uploads, delete already-uploaded objects of that game, notice `cloud.quota`.
- `resumeUploads(): Promise<void>` — on open: for every `uploads` row of this library, ask the user to re-pick the file (name/size shown), match by `fileName/fileSize/fileLastModified`, continue.
- `deleteGame(id)` — delete objects then `saveManifest`.
- `CloudLibrary.vue`: grid of `GameTile` (cover decrypted lazily into object URLs) with actions *Play · Download to this PC · Rename · Delete*; **Upload** button opens a picker listing local games not yet uploaded (by title) with sizes; usage bar `usage.bytesUsed / softLimit` + copy `cloud.freeTier`; **Close library**.

- [ ] **Step 1: Tests.** `uploadGame` for a 2-file local game creates 2 objects + manifest entry with `files.length 2`, `kGame` base64 of 32 bytes; 413 on the second object → first object deleted, manifest unchanged, notice `cloud.quota`. `CloudLibrary`: renders tiles from `games`, usage text, Upload picker lists only local games not in the cloud.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: PASS.** Manual: upload the fixture ISO from "My games", see tile, quota moves.
- [ ] **Step 5: Commit** `feat: upload local games to the encrypted library, list, delete, quota`.

---

### Task 8: Play from cloud, download to this PC

**Files:**
- Modify: `app/pages/play/[source]/[id].vue`, `app/composables/useCloudLibrary.ts`, `app/components/shelf/CloudLibrary.vue`, `i18n/locales/en.json`
- Test: `tests/components/PlayPage.test.ts` (+ cloud), `tests/unit/useCloudLibrary.test.ts` (+ downloadToLocal)

**Interfaces:**
- `/play/cloud/[gameId]`: `useCloudLibrary().restore()`; no key → "Library is closed" + link home; game missing → not found; else phase `reading` while `downloadObject` per file (progress = bytes), build `GamePayload` (primary File from bytes, `extraFiles` from the rest), `start(...)`. `DecryptError` → `fail(t('cloud.corrupt'))`. `ApiError 404` on object → `fail(t('cloud.missingObject'))`.
- `downloadToLocal(gameId): Promise<LocalGame>` — downloads all files, builds `ClassifiedGame`-shaped input, `addGame` into `localDb`, copies cover via `setCover`; progress ref; the tile then shows "In My games".

- [ ] **Step 1: Tests.** PlayPage with `source='cloud'`, fake cloud state holding one game and a fake `downloadObject` → phases `reading → loading`, `EJS_gameUrl.name === primaryName`; with no key → text `cloud.closed` and no loader. `downloadToLocal` → `addGame` called with files whose names/sizes match and bytes equal the plaintext.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: PASS.** Manual: play the uploaded fixture from the cloud (boot shows "Downloading · 37%"); Download to this PC → appears in My games; delete from cloud → gone.
- [ ] **Step 5: Commit** `feat: play games from the encrypted library and download them to the local library`.

---

### Task 9: E2E, manual checklist, deploy

**Files:**
- Create: `tests/e2e/m3a-cloud-library.spec.ts`, `docs/manual-tests/m3a.md`
- Modify: `playwright.config.ts` (env `MEMCARD_INVITES=e2e-invite` for the dev server; `MEMCARD_MEMORY_STORE` **not** set — real local D1/R2 via nitro-cloudflare-dev)

- [ ] **Step 1: E2E** (skips without the fixture): context A: add fixture locally → create library with invite `e2e-invite` (capture the passphrase from the page) → Upload → tile appears → Play from cloud → `data-phase=running` → back. Context B (fresh): open with the passphrase → tile visible → Download to this PC → appears in My games → Play. Negative: open with `wrong-password-xyz-1234` → `cloud.noLibrary` text. Network assertion in both contexts: no request to `/api/` carries the fixture file name or the passphrase in URL or body (bodies are ciphertext; check `postData()` does not contain `controllers` and no URL contains it).
- [ ] **Step 2:** `pnpm test && pnpm test:e2e` → all pass.
- [ ] **Step 3: `docs/manual-tests/m3a.md`:** second real PC + phone: open with passphrase, play a 600 MB game from the cloud (time it), download to PC, resume an interrupted upload (close tab at 40 %, reopen, re-pick file), forget-password warning readable, recovery key works, quota bar, Close library forgets keys (reload → panel).
- [ ] **Step 4: Deploy:** `wrangler secret put MEMCARD_INVITES` (owner types the invite), `pnpm d1:migrate`, `pnpm build`, `CLOUDFLARE_ACCOUNT_ID=… npx wrangler deploy`. Verify on `memcard.devffice.com`: create a library, upload the fixture, open on a phone.
- [ ] **Step 5: Commit** `test: M3a end-to-end cloud library flow and manual checklist`.

---

## Self-review notes

- Design §3 covered: PBKDF2/HKDF/ids (T2), ownership proof (T4), manifest + ETag (T4, T6), per-object subkeys + chunks + AAD (T2, T5), recovery key (T2, T6), key lifetime (T6). Shares deliberately absent (M3b).
- Design §4: D1 tables (T1), routes (T4), quota (T4, T7), invite gate + rate limit (T4), Worker-streamed R2 (T4, T5).
- Design §5: Online library section (T6, T7), play/download (T8), passphrase generator (T3, T6).
- Type check: `CloudApi` methods used in T5–T8 match T5's declaration; `UploadState` stored in `localDb.uploads` (T5) and read in T7 `resumeUploads`; `LibraryUsage` from T2 used by T4 route and T7 UI.
- Review Focus 1–5 each have a pinned test (T6, T5/T7, T5/T8, T4/T7, T6).
