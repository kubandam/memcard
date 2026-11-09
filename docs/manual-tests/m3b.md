# M3b manual test checklist — share codes

On https://memcard.devffice.com. Owner = you with an online library; friend = another real computer or phone.

## Owner
- [ ] Share on a game tile → code `MC-XXXX-XXXX-XXXX-XXXX` shown with Copy; note says "download this game".
- [ ] Share library → code; note says it includes games added later.
- [ ] Codes you issued lists both with dates; Revoke needs two clicks.

## Friend (no library, no invite)
- [ ] Type the game code with lowercase letters and without dashes → game title and size shown → Download to My games → plays offline.
- [ ] Mistype one character → "This code is no longer valid" (or the format message if a character is missing).
- [ ] Enter the library code → Shared library section appears (read-only) with covers → Play a 600 MB game directly (time to start: ____).
- [ ] Reload the page → Shared library still there. Remove → gone.

## Revoke and delete
- [ ] Friend has the shared library open; owner revokes the code; friend presses Play → "This code is no longer valid", no emulator starts. Reload → revoked notice, Remove only.
- [ ] Owner deletes a game that has a game code; friend redeems that code → "no longer valid".
- [ ] Games the friend already downloaded keep working.

## Privacy spot-check
- [ ] DevTools → Network on the friend's side: no request URL or body contains the code or a game title; `/api/share/…` returns only ids and an unreadable `wrapped` string.
