# M3c — Online library polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Finish M3: optional "Stay open on this PC", covers in shared libraries, the two deferred share-flow races, and a CHD nudge with conversion help.

**Spec:** [encrypted-libraries design](../specs/2026-11-09-encrypted-libraries-design.md) §5 (key lifetime, CHD nudge), M3b review deferred minors.

## Global Constraints
- "Stay open on this PC" is **off by default**; when on, `K_root` (base64url) is stored in IndexedDB setting `cloudKeyRemembered`; Close library removes it and the session copy. UI copy says anyone using this browser profile can open the library.
- Restore order: sessionStorage → IndexedDB → closed.
- No new server routes. Strings in `en.json`, colours via tokens, conventional commits, TDD per task.

## Review Focus
1. Close library on a PC with "Stay open" → reload → library closed (both copies gone).
2. Remembered key for a library that no longer exists → panel shows "No library found", remembered key removed.
3. Redeeming a library code while the home page is still restoring → the new section stays.
4. Shared tile covers fail (revoked mid-way) → tile shows placeholder, no error banner.

### Task 1: Stay open on this PC
- `useCloudLibrary.open(secret, { remember?: boolean })`, `create(password, invite, { remember?: boolean })`; `restore()` falls back to `getSetting('cloudKeyRemembered')`; on 404 during restore from the remembered key → `deleteSetting`; `close()` also deletes it. `remembered: Ref<boolean>`.
- CloudPanel: checkbox `data-remember` under the secret field and in the create flow; CloudLibrary shows `cloud.rememberedHint` when remembered.
- Tests (unit): remember → new composable instance with empty sessionStorage restores; close clears setting; stale remembered key → closed + setting removed. Component: checkbox passes `{ remember: true }`.

### Task 2: Shared covers and share-flow races
- `useSharedLibraries.coverUrl(shareId, game)` (cached object URL; failures → undefined). SharedLibrary tiles use it.
- `restore()` merges instead of overwriting: libraries redeemed while it runs are kept (generation counter or merge by shareId).
- `restoreOne(shareId)` used by the player instead of `restore()`.
- Tests: coverUrl decrypts the owner's cover through the share; restore/redeem race keeps both; player calls `restoreOne`.

### Task 3: CHD nudge
- `useLocalLibrary.addFiles`: when the classified game has `.bin`/`.iso`/`.img` files totalling > 100 MB, set info notice `warnings.chdNudge` (unless the large-file warning applies — then append). Upload picker marks such games with `cloud.chdHint`.
- About page: section "Make games smaller (CHD)" with `chdman createcd -i game.cue -o game.chd` and a note that it is lossless.
- Tests: IndexPage shows the nudge for a 200 MB `.iso`, not for a `.chd`; picker shows the hint.

### Task 4: Verify and deploy
- `pnpm test`, `pnpm test:e2e`, build, deploy, browser check of Stay open across a reload with a closed tab (new context with stored IndexedDB).
