# Test fixtures

No commercial game or BIOS is used anywhere in this repository. The end-to-end tests boot a
homebrew program with an explicit, permissive licence.

## `example11_controllers.psexe`

| | |
|---|---|
| Title | Example 11 — Controllers (shows which PS1 buttons are pressed on screen) |
| Author | spicyjpeg |
| Licence | MIT — see `LICENSE-ps1-bare-metal.txt` (copied from the repository) |
| Source | https://github.com/spicyjpeg/ps1-bare-metal — `src/11_controllers/main.c` |
| Build | GitHub Actions artifact `build` of commit `01c20e130ad028ba5adb555a681b6a7bf414b27a` (2026-11-05) |
| SHA-256 | `052ed0fcefd236042d5c0e8447b7484d0d05fc90bd39d12124c29d55a8c8d7ae` |

It contains no Sony code: ps1-bare-metal targets the hardware directly without the official SDK.

## `controllers.iso` (generated, git-ignored)

`pnpm fixture` runs `scripts/build-fixture.mjs`, which wraps the executable and a `SYSTEM.CNF`
into a 2048-byte-per-sector ISO 9660 image with `;1` file versions — the layout `pcsx_rearmed`
expects. The writer lives in `scripts/iso9660.mjs` and is unit-tested.
