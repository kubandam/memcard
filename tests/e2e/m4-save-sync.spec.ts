import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const FIXTURE = join(process.cwd(), 'tests/fixtures/controllers.iso')
const INVITE = process.env.E2E_INVITE ?? 'dev-invite'
test.skip(!existsSync(FIXTURE), 'Fixture missing: run `pnpm fixture` first')
test.setTimeout(240_000)

async function openHome(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('progressbar').first()).toBeVisible()
}

async function playCloud(page: Page) {
  await page.locator('a[href^="/play/cloud/"]').first().click()
  await page.waitForFunction(() => document.documentElement.dataset.phase === 'running', null, { timeout: 90_000 })
}

test('a memory card saved on one PC is loaded on another', async ({ browser }) => {
  const pc1 = await browser.newContext()
  const a = await pc1.newPage()
  await openHome(a)
  await a.setInputFiles('input[type=file][multiple]', FIXTURE)
  await expect(a.getByRole('link', { name: /controllers/i }).first()).toBeVisible()
  await a.locator('[data-start-create]').click()
  const passphrase = (await a.locator('[data-passphrase]').innerText()).trim()
  await a.locator('[data-invite]').fill(INVITE)
  await a.locator('[data-wrote]').check()
  await a.locator('[data-create]').click()
  await a.locator('[data-recovery-done]').click({ timeout: 30_000 })
  await a.locator('[data-open-upload]').click()
  await a.locator('[data-upload-candidate]').filter({ hasText: /controllers/i }).click()
  await expect(a.locator('a[href^="/play/cloud/"]')).toHaveCount(1, { timeout: 60_000 })
  await playCloud(a)

  // Put a recognisable card into the emulator (its own "Import save" path) and flush it.
  const written = await a.evaluate(() => {
    const emu = (window as unknown as { EJS_emulator: { gameManager: { FS: { writeFile(p: string, d: Uint8Array): void; analyzePath(p: string): { exists: boolean }; unlink(p: string): void }; getSaveFilePath(): string; loadSaveFiles(): void; saveSaveFiles(): void } } }).EJS_emulator
    const gm = emu.gameManager
    const card = new Uint8Array(128 * 1024)
    for (let i = 0; i < card.length; i++) card[i] = (i * 7) % 251
    const path = gm.getSaveFilePath()
    if (gm.FS.analyzePath(path).exists) gm.FS.unlink(path)
    gm.FS.writeFile(path, card)
    gm.loadSaveFiles()
    gm.saveSaveFiles()
    return { path, sum: card.reduce((n, b) => (n + b) % 65521, 0) }
  })
  await a.mouse.move(300, 30)
  await expect(a.locator('[data-save-status]')).toContainText(/saved to cloud/i, { timeout: 30_000 })
  await pc1.close()

  // PC 2: fresh profile, open with the passphrase, play the same game.
  const pc2 = await browser.newContext()
  const b = await pc2.newPage()
  await openHome(b)
  await b.locator('[data-secret]').fill(passphrase)
  await b.locator('form[data-open]').evaluate((f: HTMLFormElement) => f.requestSubmit())
  await expect(b.locator('a[href^="/play/cloud/"]')).toHaveCount(1, { timeout: 30_000 })
  await playCloud(b)
  const got = await b.evaluate(() => {
    const gm = (window as unknown as { EJS_emulator: { gameManager: { FS: { readFile(p: string): Uint8Array; analyzePath(p: string): { exists: boolean } }; getSaveFilePath(): string } } }).EJS_emulator.gameManager
    const path = gm.getSaveFilePath()
    if (!gm.FS.analyzePath(path).exists) return { path, sum: -1 }
    return { path, sum: gm.FS.readFile(path).reduce((n: number, x: number) => (n + x) % 65521, 0) }
  })
  expect(got).toEqual(written)
  await pc2.close()
})
