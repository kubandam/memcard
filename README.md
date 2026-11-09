# Memcard

Memcard is a website that plays PS1 games in the browser with nothing to install: open the page, drop your own disc image (it stays in your browser), use the keyboard or plug in a controller, play. Free homebrew titles start with one click.

Emulation is done entirely client-side by [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) (GPL-3.0), which wraps the RetroArch `pcsx_rearmed` core. The server never receives, stores or transcodes a visitor's game files.

## Content rules

- Only freely redistributable homebrew, freeware and demos are hosted. No commercial games, no BIOS files.
- Files you add yourself are stored in your browser's IndexedDB only. Nothing is uploaded.

## Development

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # unit + component tests (Vitest)
pnpm test:e2e     # Playwright (needs the fixture, see tests/fixtures/README.md)
pnpm build        # Cloudflare Workers build
pnpm deploy       # build + wrangler deploy (needs `wrangler login`)
```

## Licence

GPL-3.0-only. See [LICENSE](LICENSE). EmulatorJS and the libretro cores it loads carry their own GPL licences; fonts are under the SIL Open Font License (see `public/fonts/LICENSE-OFL.txt`).
