# Design: memory-card save sync (M4)

Date: 2026-11-10. Builds on the [encrypted libraries design](2026-11-09-encrypted-libraries-design.md) (§6 deferred M4 "saves are encrypted under K_game and stored as objects like covers") and the M1/M3 code.

## 1. Intent

The owner starts a game on one computer and continues on another (or on the phone) from the same in-game save. Today the memory card lives only in the browser where it was written.

## 2. Scope

- **In:** in-game **memory-card saves** (`.srm`) of games in the owner's **online library** (`/play/cloud/…`).
- **Out (for now):** save **states** (emulator snapshots, larger, slot UI — later milestone); games only in My games (local) — they have no cloud identity; games played through someone else's **share code** (read-only access, no K_auth).
- Anti-goal: a plaintext save, game title or file name reaching the server; a sync that silently destroys a newer save.

## 3. How EmulatorJS 4.2.3 handles the memory card (verified in source)

- Path `/data/saves/PCSX-ReARMed/<base of EJS_gameName>.srm` in the emulator FS, mounted as IDBFS (persists in the browser).
- `gameManager.saveSaveFiles()` flushes the core's card to that file and fires the `saveSaveFiles` event with the bytes (we already flush every 30 s and on leave/pagehide/hidden).
- Import = write the file at `getSaveFilePath()` and call `gameManager.loadSaveFiles()`.

## 4. Design (proposed)

- **Where it is stored:** one R2 object per game, `lib/{libraryId}/save/{saveKey}`, where `saveKey` = first 14 bytes of HKDF(K_game, `"save:memcard"`) in base32. The server cannot link it to a game object; only the owner can derive it.
- **Encryption:** AES-256-GCM under HKDF(K_game, `"save-key"`), **random 96-bit IV per write** (the object is overwritten many times, so counter nonces are not allowed), AAD = `saveKey`. Plaintext = 8-byte big-endian `updatedAt` (ms) + 32-byte SHA-256 of the card + card bytes.
- **Server:** two owner-only routes — `GET /api/lib/:id/saves/:saveKey` (404 when none) and `PUT` (body ≤ 1 MiB, overwrite, counts toward `bytes_used`), `DELETE` when the game is deleted. No share access.
- **On game start (cloud game):** fetch the cloud save; compare with the last version this browser synced (`saveSync.<saveKey>` in local settings: `{ updatedAt, hash }`) and with the card already in the browser.
  - cloud newer than what this browser last synced, and the local card unchanged since that sync → **inject the cloud card** before the core boots (write it into the FS in the `saveDatabaseLoaded` hook).
  - local card changed since the last sync **and** cloud also moved on → **conflict**: keep both — the cloud card is used, the local one is downloaded as `<title> (this PC, <date>).srm` and a notice says so. (Last-write-wins, but nothing is silently lost.)
  - no cloud save → upload the local one if any.
- **While playing:** on every `saveSaveFiles` event, if the card's hash differs from the last uploaded one → encrypt and `PUT` (at most one request in flight, latest wins). Indicator in the player overlay: "Saved to cloud · 12:41" / "Not synced (offline)".
- **Delete game** removes its save object too.

## 5. Decisions for the owner

1. Scope as in §2: memory cards only now, save states later. 
2. Conflict rule in §4: cloud wins, the other card is downloaded as a file — rather than asking every time.
