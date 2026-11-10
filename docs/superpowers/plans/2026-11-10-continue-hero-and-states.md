# Continue hero (variant C) + synced save states — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The library opens with a "Boot hero" for the last-played game (blurred cover — or its latest in-game snapshot — glass blocks, glowing title, ▶ Continue). Save states from the emulator menu are stored encrypted in the online library (one synced slot per game, with screenshot), load on any device, and Continue resumes from them.

**Decisions (owner, 2026-11-10):** hero = variant C from `home-continue.html`; save states = one cloud slot per game, menu Save/Load State use it, Continue resumes from it.

## Global Constraints
- Generic encrypted blob storage per game, kinds `save` (memory card, ≤1 MiB), `state` (≤32 MiB), `shot` (≤1 MiB): route `GET|PUT|DELETE /api/lib/:id/blobs/:kind/:key`, R2 path `lib/{id}/{kind}/{key}` (so existing `save` objects keep their path), quota accounting key `{kind}:{key}`, ≤500 per kind per library, post-write quota re-check. Owner-only.
- Keys from K_game via HKDF: `save:memcard` (existing), `state:latest`, `state:shot`; AES key per kind (`save-key` existing, `state-key`). Sealed format = existing `sealSave` (iv ‖ GCM(u64 updatedAt ‖ 16-hex fingerprint ‖ bytes), AAD = key).
- `fingerprint` becomes a fast non-BigInt 64-bit FNV-1a (two 32-bit lanes) — states are MBs.
- Starting a game never waits on states except when `?resume=1`; any state/shot failure leaves the game running with a notice.
- Hero shows only when the open library (or local games) has a played game; uses tokens (`--boot-*`), respects reduced motion.

## Review Focus
1. Save State while offline → message "Snapshot not saved to cloud", game keeps running.
2. Continue on a game without a state → plain start (no error).
3. A state from another game can never be loaded (AAD/key per game).
4. Hero on a phone width: no horizontal scroll; title wraps.
5. Deleting a game deletes its state and shot.

### Task 1: Generic blob kinds on the server (+ fast fingerprint)
### Task 2: Client blob API + state crypto + `useEmulator` state hooks (`onStateSaved`, `onStateLoadRequested`, `loadState`)
### Task 3: Player: cloud state save/load via menu, `?resume=1`, notices
### Task 4: `ContinueHero` (variant C) on the home page, snapshot thumbnail fetch, delete cascade
### Task 5: E2E (state saved on PC 1, Continue on PC 2 resumes), deploy
