# Task spec: browser-based PS1 player (web app)

## 1. Goal

Build a website where anyone can play PS1 games directly in the browser with zero installation: open the page, use the keyboard or connect a controller, play.

The site has three ways to get a game running:

1. **Free games (public):** games that may legally be redistributed (homebrew, freeware, demos) are hosted on the site and start with one click.
2. **Bring your own file (public):** a visitor drops their own game file into the page once. It is stored in their browser only and is one click away on every later visit. Nothing is uploaded to the server.
3. **Private cloud library (owner only):** the site owner logs in and plays games from his own discs that are stored on the server. This is available to exactly one account and is invisible to everyone else.

## 2. Decisions already made (do not revisit)

- **Do not write an emulator.** Use an existing emulator core compiled to WebAssembly.
- **Use EmulatorJS** (https://github.com/EmulatorJS/EmulatorJS, GPL-3.0, current version 4.2.3). It wraps RetroArch cores and already handles rendering, audio, keyboard, gamepads, touch controls, save states and memory-card saves.
- **Do not use DuckStation code.** Its licence (CC-BY-NC-ND) forbids derivative works and it has no web build.
- **Default core: `pcsx_rearmed`.** It has a built-in HLE BIOS, so games start without any BIOS file. `mednafen_psx_hw` is the optional second core (more accurate, requires a real BIOS).
- **Stack: Nuxt (current stable) + Supabase** (Auth, Postgres, Storage). TypeScript.
- **Everything emulator-related runs client-side.** The server never executes or transcodes games.

## 3. Hard content rules

These are requirements, not suggestions.

- The public part of the site must never serve commercial games or BIOS files. Only files listed in the free-games manifest (section 6.1) are publicly downloadable.
- Do not download, bundle, link to or seed any commercial game image or BIOS, including as test fixtures. For testing use freely redistributable homebrew, and document where each test file came from and its licence.
- Files a visitor adds in "bring your own file" mode must stay in that visitor's browser. No upload, no telemetry containing file contents or file names.
- The private library must be unreachable without the owner's session: private bucket, row-level security, short-lived signed URLs. No public URL may ever resolve to a private game.
- No Sony trademarks or logos in the site's name, logo or UI artwork. Describing compatibility in plain text ("plays PS1 games") is fine.

## 4. Users and access

| Role                   | Free games | Own files (local) | Private cloud library |
| ---------------------- | ---------- | ----------------- | --------------------- |
| Visitor (no account)   | yes        | yes               | no, not visible       |
| Owner (single account) | yes        | yes               | yes                   |

- There is exactly one account. Public sign-up is disabled in Supabase Auth; the owner user is created manually.
- A `/login` route exists but is not advertised in the public UI.
- Server-side checks compare the session's user id with an `OWNER_USER_ID` environment variable in addition to RLS.

## 5. Functional requirements

### 5.1 Player

- Dedicated route, e.g. `/play/[source]/[id]`, rendered client-only.
- EmulatorJS keeps global state and has no clean teardown. Leave the player with a full page navigation (or host it in an iframe) so each game starts from a clean page.
- Starts automatically after load, offers fullscreen, shows loading progress.
- Keyboard works immediately. Gamepads work through the browser Gamepad API with no setup; a DualSense over Bluetooth or USB is the reference controller.
- A "Controls" overlay shows the current keyboard mapping (read the defaults from EmulatorJS `defaultControllers` instead of hard-coding them) and lets the user remap through EmulatorJS's own settings menu.
- Touch controls on phones and tablets (EmulatorJS virtual gamepad).
- Save states and memory-card saves persist in the browser between visits. Offer export and import of the memory-card save file.
- Optional BIOS: the user can add their own BIOS file in settings. It is stored locally like a game and passed to the emulator when present. The app must work without one.

### 5.2 Free games

- Grid of cards (title, author, licence, cover if available) on the home page. Click starts the game.
- Entries come from a manifest file in the repo (section 6.1). If the manifest is empty, the section is hidden.

### 5.3 Bring your own file

- Drop zone plus file picker on the home page.
- Accepted formats: `.chd`, `.pbp`, `.iso`, `.img`, `.bin` + `.cue` (multi-file selection), `.m3u` with its discs, and `.zip` / `.7z` archives of those. Recommend CHD in the UI because it is the smallest.
- Multi-disc games are kept together as one library entry. EmulatorJS prefers an `.m3u` playlist for PS1; generate one when the user adds several discs without it.
- Files are stored in IndexedDB as Blobs (metadata and blobs in separate object stores). Call `navigator.storage.persist()` and show used and available space.
- "My games" grid lists stored games with size, last played, rename and delete.
- Everything degrades gracefully when storage is unavailable or full: the game still plays for the current session and the UI says it could not be saved.

### 5.4 Private cloud library (owner only)

- After login the home page gains an "My library" section; visitors never see it or any hint of it.
- Owner can upload a game (resumable upload with progress), rename, delete, and set a cover image.
- Playing fetches the file through a signed URL valid for a few minutes.
- Works from any device the owner logs in on (Mac, phone, TV browser).
- Later milestone: sync memory-card saves and save states to the server per game, using the EmulatorJS hooks `EJS_onSaveSave`, `EJS_onLoadSave`, `EJS_onSaveState`, `EJS_onLoadState`. Last-write-wins with a timestamp is acceptable.

## 6. Technical notes

### 6.1 Free-games manifest

`content/free-games.json`, array of:

```json
{
	"id": "slug",
	"title": "Game title",
	"author": "Author",
	"license": "e.g. MIT / CC-BY / freeware with permission",
	"sourceUrl": "where the file and its licence statement were obtained",
	"file": "/free-games/slug.chd",
	"cover": "/free-games/slug.png"
}
```

`license` and `sourceUrl` are mandatory. Do not add an entry without an explicit redistribution permission. Ship the manifest empty if nothing has been approved by the owner yet.

### 6.2 EmulatorJS integration (checked against the 4.2.3 source)

- Configuration is done with globals set before `data/loader.js` is loaded: `EJS_player`, `EJS_core`, `EJS_gameUrl`, `EJS_gameName`, `EJS_biosUrl`, `EJS_pathtodata`, `EJS_startOnLoaded`, `EJS_defaultOptions`, `EJS_color`, `EJS_language`.
- `EJS_core = "psx"` maps to `["pcsx_rearmed", "mednafen_psx_hw"]`, first one is the default.
- `EJS_gameUrl` accepts a URL **or a `File` object**. Pass the `File` (or a `File` built from the stored Blob with its original name) for local games: with a bare `blob:` URL the name becomes `"game"` and the extension is lost, which breaks format detection.
- EmulatorJS reads the whole game into memory and writes it to its virtual file system, so peak RAM is roughly twice the file size. Warn on low-memory devices and prefer CHD.
- EmulatorJS has its own ROM cache for URL-loaded games (limit `EJS_CacheLimit`, default 1 GiB). It does not cache `File` inputs, which is why local games need the app's own IndexedDB store. For private-library games decide deliberately whether to allow that cache (faster replays) or disable it (nothing private left on shared devices); default to disabled with a per-device opt-in.
- PS1 cores do not need threads. Only `ppsspp` and `dosbox_pure` do. **Do not enable COOP/COEP cross-origin isolation**: it is unnecessary here and would complicate loading files from storage via signed URLs.
- Self-host the EmulatorJS `data/` folder at a pinned version, including the two PS1 cores, instead of depending on `cdn.emulatorjs.org` at runtime. The CDN is acceptable for the first prototype only.
- Serve `.wasm` with `application/wasm` and long cache headers for the versioned `data/` folder.

### 6.3 Supabase

Tables (RLS enabled on all, policy `auth.uid() = user_id` for every operation):

- `games`: `id`, `user_id`, `title`, `storage_path`, `size_bytes`, `discs` (jsonb, ordered list for multi-disc), `cover_path`, `created_at`, `last_played_at`
- `saves` (later milestone): `id`, `user_id`, `game_id`, `kind` (`memcard` | `state`), `slot`, `storage_path`, `updated_at`

Storage:

- Private bucket `games` (and `saves`), path prefix `{user_id}/…`, storage policies matching the table policies.
- Signed URLs are created in a Nuxt server route that verifies the session and the owner id; expiry 5 minutes.
- **File-size limit:** on the Supabase Free plan a single file cannot exceed 50 MB; on Pro the limit is configurable up to 500 GB. PS1 images are typically 300 to 700 MB, so the private library needs either Supabase Pro or another S3-compatible store. Put storage behind a small interface (`upload`, `getSignedUrl`, `delete`) so the backend can be swapped (for example Cloudflare R2 with presigned URLs issued by the same server route).

### 6.4 Licensing of this project

EmulatorJS is GPL-3.0 and the cores carry their own GPL licences. Licence this repository as GPL-3.0, keep the upstream licence files, and put a "Source code" link in the site footer.

## 7. Pages

- `/` home: free games, "My games" (local), drop zone, and for the owner "My library".
- `/play/...` player.
- `/settings`: optional BIOS, storage usage, clear local data, controls help.
- `/login`: owner sign-in (email + password or magic link).
- `/about`: what the site is, the content rules in plain language, licences, source link.

## 8. Non-functional

- Browsers: current Chrome, Safari, Firefox, Edge on desktop; Safari on iOS and Chrome on Android. Reference device: Apple-silicon Mac with a DualSense.
- Home page is fast and server-rendered; emulator assets load only on the player route.
- Clear, human error messages for: unsupported file, out of storage, out of memory, network failure, expired signed URL (re-request silently once).
- UI strings centralised so a second language can be added.
- No analytics that record file names or game titles of local or private games.

## 9. Milestones and acceptance criteria

**M1: Player + bring your own file**

- A homebrew game added via drop zone plays with sound, keyboard and gamepad.
- After a browser restart the game is still in "My games" and starts in one click; the in-game save is still there.
- Network tab shows no request containing the game data.

**M2: Free games**

- Manifest-driven grid; an approved entry starts in one click on a clean browser profile.
- Empty manifest hides the section.

**M3: Owner login + private library**

- Sign-up is impossible; the owner can log in.
- Upload, list, play, rename, delete work for a file larger than 500 MB.
- Logged out or as any other identity: the library is not shown, table queries return nothing, and a copied signed URL stops working after expiry. Add automated tests for the RLS and storage policies.

**M4: Save sync for the owner**

- A memory-card save made on one device is present on a second device after login.

**M5: Polish**

- Mobile layout and touch controls, controls overlay, storage usage UI, about page, self-hosted pinned EmulatorJS data.

Each milestone ends with a short manual test checklist for the owner covering what cannot be automated (real controller, audio, fullscreen, a TV browser).

## 10. Open questions for the owner (ask before the relevant milestone)

1. Storage backend for the private library: Supabase Pro, or Cloudflare R2 / other S3-compatible store? (needed for M3)
2. Hosting target for the Nuxt app?
3. Site name and domain?
4. UI language(s) at launch?
5. Which free games, if any, has the owner approved for the manifest? (needed for M2)

## 11. Out of scope

- Writing or modifying an emulator core.
- Hosting or sourcing commercial games or BIOS files.
- Public accounts, social features, netplay, achievements.
- Other consoles (the structure should not prevent adding them later, but nothing is built for it now).
