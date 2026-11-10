import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const FIXTURE = join(process.cwd(), 'tests/fixtures/controllers.iso')
const INVITE = process.env.E2E_INVITE ?? 'dev-invite'
test.skip(!existsSync(FIXTURE), 'Fixture missing: run `pnpm fixture` first')
test.setTimeout(240_000)

async function openHome(page: Page) {
  await page.goto('/')
  await expect(page.locator('[data-hydrated]')).toBeAttached()
}

test('save state on one PC, Continue on another resumes from it', async ({ browser }) => {
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
  await expect(a.locator('.cloud-library a[href^="/play/cloud/"]')).toHaveCount(1, { timeout: 60_000 })
  await a.locator('.cloud-library a[href^="/play/cloud/"]').click()
  await a.waitForFunction(() => document.documentElement.dataset.phase === 'running', null, { timeout: 90_000 })
  // Same as the emulator menu's "Save State".
  await a.evaluate(async () => {
    const emu = (window as unknown as { EJS_emulator: { gameManager: { getState(): Uint8Array }; callEvent(n: string, d: unknown): number } }).EJS_emulator
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])
    emu.callEvent('saveState', { state: emu.gameManager.getState(), screenshot: png, format: 'png' })
  })
  await a.mouse.move(300, 30)
  await expect(a.getByText(/snapshot saved to the cloud/i)).toBeVisible({ timeout: 30_000 })
  await pc1.close()

  const pc2 = await browser.newContext()
  const b = await pc2.newPage()
  await openHome(b)
  await b.locator('[data-secret]').fill(passphrase)
  await b.locator('form[data-open]').evaluate((f: HTMLFormElement) => f.requestSubmit())
  const cont = b.locator('a[data-continue]')
  await expect(cont).toHaveAttribute('href', /\?resume=1$/, { timeout: 30_000 })
  await expect(b.locator('[data-start-over]')).toBeVisible()
  await cont.click()
  await b.waitForFunction(() => document.documentElement.dataset.phase === 'running', null, { timeout: 90_000 })
  await b.mouse.move(300, 30)
  await expect(b.getByText(/continuing from your last snapshot/i)).toBeVisible({ timeout: 30_000 })
  await pc2.close()
})
