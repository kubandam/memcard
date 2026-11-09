# M3a manual test checklist — encrypted online library

On https://memcard.devffice.com with an invite code. Use a real second computer and a phone.

## Create (PC 1)
- [ ] Online library → Create one: a 5-word passphrase is shown; Create stays disabled until "written down" is ticked and an invite is entered.
- [ ] Own password "abc123" shows the weak warning and cannot be used.
- [ ] After Create: recovery key box (Download / Copy / I saved it). The downloaded .txt contains the `MCKEY-…` line.
- [ ] Reload the page → library still open. Close library → panel again; reload → still closed.

## Upload
- [ ] Upload a game → picker lists only My games not yet online → choose a ~600 MB game: progress bar moves; time it: ____ min.
- [ ] Close the tab at ~40 %, reopen, open the library → the upload continues (does not restart from 0) and finishes.
- [ ] Space bar shows the used size; a second upload of the same game is not offered.

## Second PC / phone
- [ ] Open with the passphrase → same games, covers visible.
- [ ] Open with the recovery key instead → works the same.
- [ ] Wrong passphrase → "No library found for this passphrase."
- [ ] Play from the online library: boot screen shows progress while downloading, game runs (time to start for 600 MB: ____).
- [ ] Download to this PC → appears in My games, plays offline (disconnect Wi-Fi and start it).
- [ ] Multi-disc game uploaded online → emulator menu shows Disk with all discs.

## Privacy spot-check
- [ ] DevTools → Network on upload: request bodies to `/api/lib/…` are binary (no readable title or file name); URLs contain only random ids.
- [ ] Cloudflare dashboard → R2 → memcard-libraries: object names are `lib/<random>/obj/<random>`; downloading one gives unreadable bytes.

## Delete / rename
- [ ] Rename online game → new title after reload on the other PC.
- [ ] Delete (two clicks) → gone on both PCs; space bar drops.
