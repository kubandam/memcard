import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const FIXTURE = join(process.cwd(), 'tests/fixtures/controllers.iso')
const FIXTURE_BASENAME = 'controllers.iso'
const FIXTURE_TITLE = /controllers/i

test.skip(!existsSync(FIXTURE), 'Fixture missing: run `pnpm fixture` first (see tests/fixtures/README.md)')

/** The storage meter only renders after onMounted, so its presence proves the page is hydrated. */
async function openLibrary(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page.locator('[data-hydrated]')).toBeAttached()
}

test('add a local game, keep it across visits, play it without any network upload', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await openLibrary(page)
  await page.setInputFiles('input[type=file]', FIXTURE)
  await expect(page.getByRole('link', { name: FIXTURE_TITLE })).toBeVisible()

  // Persistence: a fresh page in the same browser profile still lists the game.
  const page2 = await context.newPage()
  await page2.goto('/')
  await expect(page2.getByRole('link', { name: FIXTURE_TITLE })).toBeVisible()

  // Privacy: no request carries the game's name or bytes.
  const requests: string[] = []
  page2.on('request', (r) => requests.push(r.url() + (r.postData() ?? '')))

  await page2.getByRole('link', { name: FIXTURE_TITLE }).click()
  await page2.waitForFunction(() => document.documentElement.dataset.phase === 'running', null, { timeout: 90_000 })
  await expect(page2.locator('#game canvas')).toBeVisible()

  expect(requests.some((r) => r.includes(FIXTURE_BASENAME))).toBe(false)
  expect(requests.some((r) => r.includes('/play/local/'))).toBe(true) // the page itself was requested…
  expect(requests.filter((r) => r.includes('cdn.emulatorjs.org')).length).toBeGreaterThan(0) // …and the emulator

  // Leaving the player is a full navigation back to the library.
  await page2.mouse.move(400, 20)
  await page2.locator('.overlay').getByRole('link', { name: /library/i }).click()
  await expect(page2).toHaveURL(/\/$/)
  await expect(page2.getByRole('link', { name: FIXTURE_TITLE })).toBeVisible()
  await context.close()
})

test('refuses a lone .bin with a message naming the .cue', async ({ page }) => {
  await openLibrary(page)
  await page.setInputFiles('input[type=file]', { name: 'lonely.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(16) })
  await expect(page.getByRole('alert')).toContainText('.cue')
})

test('unknown game id shows not found without loading the emulator', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  await page.goto('/play/local/does-not-exist')
  await expect(page.getByText(/game not found/i)).toBeVisible()
  expect(requests.some((r) => r.includes('loader.js'))).toBe(false)
})
