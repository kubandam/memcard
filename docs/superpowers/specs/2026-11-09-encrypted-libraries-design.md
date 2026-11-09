# Design: encrypted online libraries with share codes (replaces M3/M4)

Date: 2026-11-09. Supersedes spec.md §4 (single owner account), §5.4 (owner-only private library) and §6.3 (Supabase). Everything else in [spec.md](../../../spec.md) and the [M1 design](2026-11-09-ps1-player-design.md) stands: EmulatorJS 4.2.3 client-side, Boot→Shelf look, hard content rules (spec §3).

## 1. Intent

The owner wants their PS1 library on any PC they sit at, wants to hand a friend either the whole library or one game with a short code, and does not want to pay for or manage storage. Nothing readable may sit on the server: the server stores ciphertext and never learns passwords, keys, titles or file names.

## 2. Goals, non-goals, anti-goals

Goals

- A library is a **password**, not an account: enter the same password on another PC and the library appears.
- Owner can upload games (resumable), rename, set covers, delete; play directly from the cloud (streamed into memory) or **Download to this PC** (into the existing local IndexedDB library, plays offline).
- **Library code**: a recipient enters it and sees the library read-only as an extra section ("Shared library"): play online or download.
- **Game code**: a recipient enters it and the game is added (downloaded) to their local library.
- Codes are **revocable**: after revocation the recipient can no longer fetch anything new; what they already downloaded stays theirs.
- End-to-end encryption: server, R2 and Cloudflare see only ciphertext and sizes.
- Free at the owner's scale: Cloudflare R2 free tier (10 GB, zero egress) + D1 free tier + the Workers plan already paid.

Non-goals

- Accounts, e-mail, password reset. **A forgotten password means the library is unreadable by anyone, including us.** The UI says so and offers a downloadable recovery key.
- Multi-writer libraries, comments, social anything.
- Hiding file *sizes* or access *times* from the server.

Anti-goals

- Any plaintext game byte, title, file name or cover on the server or in logs.
- A code that keeps working after the owner revoked it (for *new* fetches).
- Public URLs that resolve to any library object.

Legal note recorded for the owner: sharing a commercial game's image with another person is distribution regardless of encryption; the software does not prevent it, and the owner takes that risk knowingly. Free/homebrew sharing is fine.

## 3. Cryptographic design (decided)

All crypto runs in the browser with WebCrypto; no server-side keys.

- **Password → root key.** PBKDF2-SHA256, 600 000 iterations (OWASP 2023), with a **fixed application salt** (`"memcard-v1"`) → 32-byte `K_root`. A per-library random salt is impossible here: the server could only hand it out for a `libraryId`, and `libraryId` is itself derived from the password (builder-check finding A). Consequence: `libraryId` is an unsalted-but-slow password hash, so anyone with a D1/R2 dump can guess passwords offline, bounded by PBKDF2 cost and password strength. Mitigation (decided): the UI **generates a 4-word passphrase by default** (EFF short list, ~41 bits + the 600k-iteration cost ≈ infeasible) and enforces ≥ 16 characters or ≥ 4 words for a self-chosen one, with the explicit warning that a weak password is the only thing protecting the library. HKDF-SHA256 from `K_root` yields:
  - `K_auth` (info `"auth"`) — proves ownership to the server.
  - `K_lib` (info `"lib"`) — encrypts the library manifest.
  - `libraryId` = base32(HKDF(info `"id"`))[0..26] — the server-side identifier. Lookup by `libraryId` is how "same password on another PC" finds the library.
- **Ownership proof.** Server stores `authVerifier = SHA-256(K_auth)`. Every write request carries `Authorization: Bearer <K_auth hex>` over TLS; the server hashes and compares (constant time). No sessions, no cookies. Reads of the manifest also require it (or a share token, below).
- **Manifest.** One JSON document: `{ games: [{ id, title, primaryName, kind, files: [{ name, size, objectKey, chunkSize, chunks }], generatedM3u?, coverObjectKey?, sizeBytes, createdAt, lastPlayedAt, K_game (base64) }] }` encrypted with AES-256-GCM under `K_lib`, stored as an R2 object `lib/{libraryId}/manifest`. Every change rewrites the whole manifest (small). Optimistic concurrency via an ETag the server returns and the client sends back (`If-Match`); a mismatch reloads and retries once.
- **Games.** Each game has its own random `K_game`. Each object (file or cover) gets its own subkey `K_obj = HKDF(K_game, info = "obj" || objectKey)` (builder-check finding B: a counter nonce under one key across several files would reuse nonces). Each file is encrypted with AES-256-GCM in **4 MiB chunks**; chunk `n` uses nonce = 96-bit counter `n` and AAD = `objectKey || n`, so chunks cannot be reordered or swapped between files; the manifest records `chunks` so truncation is detected. The manifest and every `wrapped` blob use a fresh random 96-bit IV stored in front of the ciphertext. Chunks are concatenated into one R2 object per file (`lib/{libraryId}/obj/{objectKey}`), uploaded with S3 multipart (parts of 16 MiB = 4 chunks). Covers are one-chunk objects under the same `K_game`.
- **Playing from the cloud.** The client fetches the object (presigned GET, 5 min, Range requests per 16 MiB), decrypts chunk by chunk into memory, builds the same `GamePayload` M1 uses, and starts EmulatorJS. Memory ≈ file size + EmulatorJS's own copy (as today for local games).
- **Share codes.** A code is 80 random bits shown as `MC-XXXX-XXXX-XXXX-XXXX` (Crockford base32). From it: `shareId = base32(SHA-256("id" || S))`, `K_share = HKDF(S, info "share")`. The server stores `shares(shareId, libraryId, gameId | null, wrapped, expiresAt?, revokedAt?)` where `wrapped` = AES-GCM under `K_share` of either `{ K_lib }` (library code) or `{ K_game, gameEntry }` (game code). The recipient's browser derives `shareId` and `K_share` from the code, fetches `wrapped`, decrypts locally, and uses the resulting key(s). Reads under a share carry `Authorization: Share <shareId>`; the server checks the row exists, is not revoked/expired, and only signs objects of that `libraryId` (and only that `gameId` for a game code). **Revocation = set `revokedAt`**: the server stops signing; the server never had the keys.
- **Recovery key.** Optional: the owner can download `memcard-recovery-<libraryId>.txt` containing `MCKEY-` + base64(`K_root`). The `MCKEY-` prefix lets the login box tell a recovery key from a password; everything derives from `K_root` as usual.
- **Key lifetime (decided).** Opening a library puts `K_root` in `sessionStorage` (cleared when the tab closes, or by "Close library"); it must survive the full-page navigations into and out of `/play`, which EmulatorJS forces. "Stay open on this PC" additionally stores it in IndexedDB `settings` (off by default). Redeemed share codes are kept in IndexedDB so a shared library survives reloads until "Remove".

What the server learns: `libraryId`, object sizes, request timing, share graph (which shareId maps to which libraryId). Nothing else.

## 4. Storage and backend (decided)

- **R2** bucket `memcard-libraries` (private, no public access, no custom domain). Objects: `lib/{libraryId}/manifest`, `lib/{libraryId}/obj/{objectKey}`. CORS: `GET, PUT, HEAD` from `https://memcard.devffice.com` (and `http://localhost:3000` in dev), `ExposeHeaders: ETag, Content-Length, Content-Range`.
- **D1** database `memcard`: 
  - `libraries(id TEXT PK, salt BLOB, auth_verifier BLOB, manifest_etag TEXT, bytes_used INTEGER, created_at, updated_at)`
  - `objects(library_id, key TEXT, size INTEGER, PRIMARY KEY (library_id, key))` — for quota accounting and orphan cleanup.
  - `shares(id TEXT PK, library_id, game_id TEXT NULL, wrapped BLOB, created_at, expires_at NULL, revoked_at NULL)`
  - `uploads(id TEXT PK, library_id, key, upload_id TEXT, parts JSON, created_at)` — resumable multipart state (the client also keeps it in IndexedDB).
- **Worker routes** (Nuxt server, bindings `R2`, `DB`): `POST /api/lib` (create: salt, verifier) · `GET /api/lib/:id` (salt + manifest presigned GET; owner or share) · `PUT /api/lib/:id/manifest` (owner; `If-Match`) · `POST /api/lib/:id/upload/{create,part,complete,abort}` (owner; presigned part URLs) · `GET /api/lib/:id/obj/:key` (presigned GET 300 s; owner or share scoped to that game) · `DELETE /api/lib/:id/obj/:key` (owner) · `POST /api/lib/:id/share` (owner; body `wrapped`, `gameId?`, `expiresAt?`) · `GET /api/share/:shareId` (anyone: returns `libraryId`, `gameId`, `wrapped` if active) · `DELETE /api/lib/:id/share/:shareId` (owner) · `GET /api/lib/:id/shares` (owner).
- **Presigned URLs** via `aws4fetch` against the R2 S3 endpoint; R2 credentials are Worker secrets. Alternatively the Worker streams through the `R2` binding — not chosen: presigned URLs keep large bodies off the Worker's CPU budget.
- **Library creation** is gated: `POST /api/lib` requires an **invite code** (env `MEMCARD_INVITES`, comma-separated; the owner can hand one to a friend who wants a library of their own). Redeeming share codes needs no invite. *Owner's decision, 2026-11-09 — see §9.*
- **Quota:** `bytes_used` per library; soft limit 8 GiB shown in the UI with the R2 free-tier explanation and a "more needs the paid tier" line. Hard limit `TOTAL_BYTES_LIMIT` (default 9 GiB) across all libraries until the owner decides to pay. Note: the owner's other R2 buckets (`tally-pdf-cache`, `tv-frames`, `workshop-releases`) share the same 10 GB free tier.
- **Abuse limits:** `POST /api/lib` max 5/hour/IP; `GET /api/share/:id` max 30/min/IP (Cloudflare rate-limiting rule or in-Worker KV counter). Unknown `shareId` and revoked share return the same 404.
- Supabase is dropped entirely. `OWNER_USER_ID` and `/login` from spec.md are replaced by the password box.

## 5. UI (Shelf style, decided)

- **Home** gains a section **Online library** above "My games": when no library is open → one panel with a password field, "Open or create", and "Have a code? Enter it". Creating asks the password twice, shows the forgotten-password warning and the recovery-key download.
- When open: a grid like "My games" with per-tile actions *Play · Download to this PC · Share · Rename · Cover · Delete*, plus **Upload a game** (picks local-library games or files; progress bar; resumable; CHD nudge with size estimate), **Share library** (shows the code, copy button, "codes you issued" with revoke), **Close library** (forgets keys in memory).
- Keys live only in memory (page session). Optional "Stay open on this PC" stores `K_root` in IndexedDB `settings` — off by default, explained.
- **Shared library** (entered via library code): same grid, read-only, title "Shared library", "Remove" forgets the code.
- **Game code** entry: shows title + size (decrypted from the wrapped entry) and a "Download to my games" button; after download the game is an ordinary local game.
- Player route gains `source = cloud` (`/play/cloud/[libraryId]/[gameId]`) and `source = shared`; both stream + decrypt into the existing `useEmulator` path, with a "re-request URL once on 403" retry.
- Mobile: codes are easy to type (no ambiguous chars), password field has show/hide.

### Disc model (decided, supersedes the M1 design's "single-file-only cloud" ruling)

The cloud library mirrors `LocalGame`: a game is uploaded exactly as the local library stores it (one object per file, `.cue`+`.bin` and m3u multi-disc included), and playback reuses `buildGamePayload` → `extraFiles` → the `saveDatabaseLoaded` FS hook that M1 already proved. Disc switching therefore works in the emulator's own Disk menu with no reload. Cost: N objects per game and per-file resume in the uploader; memory for multi-disc is all discs at once, exactly as local play does today.

## 6. Deviations from spec.md

| spec.md | this design | why |
|---|---|---|
| §4 single owner account, Supabase Auth, `OWNER_USER_ID` | password-derived libraries, no accounts | owner wants sharing and multi-PC without accounts |
| §5.4 owner-only library, invisible to visitors | any visitor can create a library or redeem a code | sharing requirement |
| §6.3 Supabase Postgres + RLS | Cloudflare D1 + R2, auth by key proof | all on one platform, zero-knowledge |
| M4 save sync via Supabase | **deferred**; when done, saves are encrypted under `K_game` and stored as objects like covers | same crypto, later |
| §8 "expired signed URL → re-request once" | kept | — |

## 7. Left to the builder

- Streaming decrypt implementation (WebCrypto `AES-GCM` per chunk; whether to use a `ReadableStream` or a loop).
- Exact base32 alphabet handling and code formatting/validation UX.
- D1 migration tooling (`wrangler d1 migrations`).
- Upload pipeline details: read file → encrypt chunk → accumulate 16 MiB part → PUT presigned part; concurrency 2–3; resume by `uploadId` + part ETags from IndexedDB.
- Rate limiting mechanism (CF rule vs KV).
- Test strategy: Vitest for crypto primitives (round-trip, AAD tamper → failure, chunk reorder → failure, share code derivation vectors), Miniflare/`wrangler dev` for routes (owner vs share vs nobody, revoked share → 404, cross-library key refused), Playwright for create → upload → open on a second context → share code → download.

## 9. Owner decisions

1. **Who may create a library?** (a) invite code held by the owner — **approved by the owner 2026-11-09**, together with the crypto fixes, the `LocalGame` disc model and the sessionStorage key lifetime above.

## 8. Milestones

- **M3a — Library core:** crypto module, create/open library, manifest, upload one game (resumable), list, play from cloud, download to this PC, delete, quota display, deploy with R2 + D1.
- **M3b — Sharing:** library codes, game codes, revoke list, shared-library section, player `source = shared`.
- **M3c — Polish:** recovery key, "stay open on this PC", CHD nudge with size estimate, rate limits, manual checklist on a second PC and a phone.
- M4 (save sync) and M5 (polish, self-hosted EmulatorJS) follow as in the roadmap.
