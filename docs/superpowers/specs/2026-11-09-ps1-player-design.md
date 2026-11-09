# Design: browser PS1 player — "Boot → Shelf"

Date: 2026-11-09. Companion to [spec.md](../../../spec.md), which stays the source of truth for functional requirements, content rules, Supabase schema, milestones and acceptance criteria. This document records what was decided on top of the spec in the brainstorming session and what is left to the builder. Where the two disagree, this document wins (it is newer); the deviations are listed explicitly in section 5.

## 1. Intent

A website where anyone opens a page and plays a PS1 game in the browser: free homebrew with one click, their own disc image dropped in once and kept in the browser, and — for the single owner account — a private cloud library of their own discs. The product should *feel* like switching on a 1990s grey console, while behaving like a modern web app.

## 2. Goals, non-goals, anti-goals

Goals

- Zero-install play: keyboard works immediately, DualSense via Gamepad API, touch on phones.
- Local games and in-game saves survive browser restarts.
- Owner can play their discs from any logged-in device.
- Nostalgic PS1-era look that still reads as a current, fast site.

Non-goals (from spec §11, unchanged)

- No emulator work, no other consoles, no public accounts, no social/netplay.

Anti-goals (would make it a failure even if it "works")

- Any commercial game or BIOS reachable publicly, even by accident.
- A visitor's file or filename leaving their browser.
- A private-library URL that resolves without the owner's session.
- Sony logos, wordmarks or the △○×□ glyphs in the site's own branding/UI artwork (trademark risk). Plain text "plays PS1 games" is fine.

## 3. Constraints

All of spec §2 and §3 apply unchanged: EmulatorJS (pinned 4.2.3, GPL-3.0; 4.3.0 is pre-release only and not to be used), `pcsx_rearmed` default core, no DuckStation, Nuxt + TypeScript, everything emulator-related client-side, no COOP/COEP, GPL-3.0 for this repo.

Additional constraints decided in the session:

- **UI language at launch: English only.** Strings still centralised (Nuxt i18n or a plain `locales/en.json`) so Slovak can be added later.
- **Hosting: Cloudflare.** Nuxt deployed with the Nitro `cloudflare_module` preset (Workers with static assets; Cloudflare now recommends this over Pages for new projects). Compatibility date ≥ 2024-09-19.
- **File storage: Cloudflare R2**, not Supabase Storage. Reasons: Supabase Free caps files at 50 MB and PS1 images are 300–700 MB; R2 has no egress fees, S3-compatible presigned URLs, and sits on the same platform as the app. Supabase stays for **Auth and Postgres only**. The owner also has a home server; it is kept as a fallback (MinIO behind a Cloudflare Tunnel behind the same storage interface) and not used in v1.
- Cloudflare Workers static-asset limit is 25 MiB per file. EmulatorJS cores fit (ship only the two PS1 cores, not the whole `data/cores` folder); game files never ship as app assets — free games live in a **public R2 bucket** behind a custom domain, private games in a **private R2 bucket** reachable only via presigned URLs issued by a Nuxt server route.
- **Cloudflare plan: Workers Paid** (owner already pays). Per-request SSR of `/` with the owner check (`serverSupabaseUser`) is fine; no need to prerender around the Free-plan 10 ms CPU cap.
- **Domain: `devffice.com` zone on Cloudflare** (owner's). App at `memcard.devffice.com`; public free-games bucket at `games.memcard.devffice.com` (R2 custom domain, CORS exposing `Content-Length` so EmulatorJS progress and ROM cache work). Manifest `file`/`cover` are absolute URLs on that host (deviation from spec §6.1's site-relative paths). Supabase Auth redirect URLs and cookie domain configured for `memcard.devffice.com`.
- **EmulatorJS input facts (checked in 4.2.3 source)** that shape the design:
  - `EJS_gameUrl` takes exactly one URL or one `File`. Multi-file games (`.bin+.cue`, several discs) must either be delivered as a single archive EmulatorJS extracts client-side (it then picks the `.m3u`/`.cue`) or mounted via `EJS_externalFiles`. Local multi-file games are therefore packed client-side into a `.zip` (store, no compression) with a generated `.m3u` at pack time, and that single `File` is passed in. Peak memory ≈ 3× total size during pack+load; the UI warns above ~1.5 GB total.
  - EmulatorJS issues a HEAD before the GET. A SigV4 presigned URL is method-specific, so a presigned GET URL **cannot** be passed as `EJS_gameUrl`. The app fetches the private file itself (with progress, retrying once on 403 to refresh an expired URL) and hands EmulatorJS a `File`. Consequently "cache private games on this device" is an app-owned IndexedDB cache (same store as local games, flagged `source: 'cloud'`), not `EJS_CacheLimit`.
- **Cloud library disc model (M3):** cloud accepts **single-file images only** (`.chd` or `.pbp`). A multi-disc game is N `.chd` objects listed in `games.discs[]`; the player loads one disc at a time; switching disc = full-page reload of `/play/cloud/[id]?disc=2`. Memory-card saves persist across the reload, in-RAM state does not. Chosen over assembling an archive in memory (disc-count × 700 MB would rule out phones). *My call, proposed to the owner without objection; revisit in M3 if real multi-disc play needs seamless swap.*

## 4. The look: "Boot → Shelf" (decided)

Two visual worlds, split cleanly by route. No mixing inside a page.

### 4.1 Shelf — library pages (`/`, `/settings`, `/about`, `/login`)

Reference: a black-label PS1 jewel-case shelf.

- Background: near-black `#0e0e0e`, hairline `#2a2a2a` dividers. No gradients, no floating objects.
- Game tiles: cover art fills the tile; 6 px black "spine" on the left; 1 px `#333` outline; title in small uppercase white-on-black label. Missing cover → generated dark duotone placeholder from the title (deterministic hash → hue).
- Typography: headings/titles **Archivo Narrow 700**, uppercase, tight tracking. Labels/meta **Inter 300**, 10–11 px, wide tracking (`.18em`), 65 % opacity. Body Inter 400.
- Accent: a small red square `#e2231a` before the wordmark; a row of four dots (red `#e2231a`, yellow `#f5c518`, blue `#1d6fd1`, green `#1fa84a`) as the *only* decorative element (footer / section ends). Dots, never shape glyphs.
- Sections in order: Free games → My games (local) → drop zone → My library (owner only, rendered only when session is owner; no placeholder, no "log in to see more").
- Drop zone: flat `#161616` panel, 1 px `#333` border, grey text "Drop .chd / .bin+.cue / .pbp here — nothing is uploaded". On touch devices it becomes an "Add file" button.
- Grid: 6 tiles/row desktop, 3 tablet, 2 phone. Tiles 3:4 portrait aspect (jewel case).

### 4.2 Boot — player route (`/play/[source]/[id]`)

Reference: the PS1 boot sequence.

- Background: radial gradient `#26262e` → `#0b0b10` → `#000`.
- While loading: 2–3 translucent glass blocks (1 px white 22 % border, faint blue glow, rotated/skewed) drifting slowly; game title in **Inter 300**, letter-spacing `.4em`, white glow; thin progress bar driven by EmulatorJS's loading callbacks; status label (LOADING CORE · 62 %).
- Once the core starts: blocks fade out, canvas fills the stage, EmulatorJS's own UI is themed via `EJS_color` to white/neutral. Our own overlay bar (hidden until hover/tap): FULLSCREEN · CONTROLS · SETTINGS · ← LIBRARY. "Library" is a full-page navigation (`<a href>`), never a client-side route change, so EmulatorJS state is dropped.
- Controls overlay: table read from `EJS_defaultControllers`, same Inter 300 spaced typography.

### 4.3 Second theme: "Grey" (console shell)

A user-selectable theme toggled in the header (DARK · GREY), persisted in `localStorage`, applied as `data-theme` on `<html>` before first paint (inline script) to avoid flash.

- Same layout and components; only design tokens change.
- Tokens: background `#d9d6cd → #c6c3b9`, panels `#f1efe8 → #d9d6cd` with soft bevel (`inset 0 1px 0 #fff, 0 3px 0 #9b988f`), text `#1f1f1f`, header bar `#b9b6ad`.
- Font swap: headings **Chakra Petch 700 italic**, labels Chakra Petch 600.
- The four colours appear as dots in the header. The player route stays "Boot" in both themes (it's a different world by design), only the overlay bar picks up Grey tokens.

Implementation implication: every colour, radius, shadow and font is a CSS custom property on `:root` / `[data-theme="grey"]`. Components never hard-code colours.

### 4.4 Name

**Memcard** (owner's choice, 2026-11-09). Wordmark set in Archivo Narrow 700 uppercase with the red square before it; no logo artwork beyond that. The name lives in one constant (`app.config.ts` → `siteName`) and one locale string. Domain not yet chosen.

## 5. Deviations from spec.md

| spec.md | this design | why |
|---|---|---|
| §2 "Supabase (Auth, Postgres, Storage)" | Supabase Auth + Postgres; **R2 for storage** | 50 MB file cap on Supabase Free; §6.3 already asks for a swappable storage interface |
| §6.3 "Private bucket `games` (and `saves`)… storage policies" | R2 buckets `games-private`, `saves-private`, `games-public`; access enforced in Nuxt server routes (session + `OWNER_USER_ID`) issuing presigned URLs; Postgres RLS still protects metadata | R2 has no RLS; the server route is the gate |
| §5.4 "resumable upload with progress" | S3 multipart via presigned part URLs, parts 16 MiB, part list kept in IndexedDB for resume; server route creates/completes/aborts the multipart upload | large files, flaky phone uploads |
| §6.2 cache for private games "default disabled with per-device opt-in" | unchanged, but opt-in lives in `/settings` under the Grey/Dark toggle | nothing new |
| §7 pages | `/settings` gains theme toggle and "cache private games on this device" | this design |

Everything else in spec.md stands.

## 6. Architecture summary (for the planner)

- **Nuxt 4.x** (current 4.6.x), TypeScript, `cloudflare_module` preset, `wrangler.jsonc` generated by Nitro `deployConfig`.
- **Client**: `/play` page is `ssr: false`; loads self-hosted `/emulatorjs/4.2.3/data/loader.js` only on that route; `.wasm` served with `application/wasm` and `Cache-Control: public, max-age=31536000, immutable` via Nitro route rules.
- **Local storage**: IndexedDB (`idb` library), stores `games` (metadata) and `blobs` (one Blob per original file), plus `bios`. `navigator.storage.persist()` on first add. Multi-file / multi-disc → packed client-side into one store-only `.zip` with a generated `.m3u` (see §3) and passed as a single `File`; the original files stay in `blobs` so the pack can be rebuilt.
- **Server routes** (`server/api/…`): `library/list|rename|delete`, `library/upload/{create,sign-part,complete,abort}`, `library/play-url` (presigned GET, 5 min), `free-games` (reads manifest). Every route: verify Supabase session server-side, compare `user.id === OWNER_USER_ID`, else 404 (not 403 — no hint the resource exists). Covers for private games: private bucket, presigned on list. M4 saves go through the Worker (small files), not presigned PUT.
- **Upload resume**: multipart parts 16 MiB; `uploadId` + completed part ETags in IndexedDB; on resume the owner re-picks the file, matched by name/size/mtime; bucket CORS exposes `ETag`.
- **Storage interface** `server/utils/storage.ts`: `createMultipart`, `signPart`, `completeMultipart`, `abortMultipart`, `getSignedUrl`, `delete`. R2 implementation via `aws4fetch` (small, Workers-friendly) — no AWS SDK.
- **Supabase**: tables per spec §6.3, RLS `auth.uid() = user_id`; sign-up disabled in dashboard; `@nuxtjs/supabase` for session cookies.
- **Theming**: tokens in `assets/css/tokens.css`, `useTheme()` composable, inline pre-paint script in `app.vue` head.
- **i18n**: `@nuxtjs/i18n` with `en` only; all strings in `i18n/locales/en.json`.
- **Fonts** (Archivo Narrow, Inter, Chakra Petch) self-hosted as static assets — no Google Fonts request at runtime.
- **Auth**: `@nuxtjs/supabase` with `redirect: false`; email + password for the owner, magic link optional.
- **Tests**: Vitest unit (IndexedDB store with `fake-indexeddb`, m3u generation, manifest validation), Playwright e2e for M1 flow with a homebrew `.chd` test fixture whose source and licence are recorded in `tests/fixtures/README.md`; RLS/policy tests against a local Supabase (`supabase start`) in M3.

## 7. Left to the builder

- Exact component breakdown, file layout, composable names.
- Choice of `idb` vs raw IndexedDB; `aws4fetch` vs another signer (must run on Workers).
- Cover placeholder algorithm details.
- Loading-progress mapping from EmulatorJS callbacks to the bar.
- How "My games" handles a `.bin+.cue` pair when only one file was dropped (sensible: refuse with a clear message listing what's missing).
- Which homebrew title is the e2e fixture (must be freely redistributable; document source + licence).
- Playwright vs Vitest browser mode for e2e.

## 8. Milestone order

Unchanged from spec §9: M1 player + local files → M2 free games → M3 owner login + R2 library → M4 save sync → M5 polish. Theming (Dark + Grey) and the Boot/Shelf split are built in M1 from the start because they are tokens, not features; mobile polish and self-hosted EmulatorJS data stay in M5 (CDN allowed for the M1 prototype only).
