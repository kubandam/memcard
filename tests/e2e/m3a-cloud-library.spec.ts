import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const FIXTURE = join(process.cwd(), 'tests/fixtures/controllers.iso')
const INVITE = process.env.E2E_INVITE ?? 'dev-invite' // must be listed in MEMCARD_INVITES (.dev.vars)

test.skip(!existsSync(FIXTURE), 'Fixture missing: run `pnpm fixture` first')
test.setTimeout(180_000)

async function openHome(page: Page) {
  await page.goto('/')
  await expect(page.locator('[data-hydrated]')).toBeAttached()
}

test('create, upload, open on a second PC, play from cloud, download, wrong password', async ({ browser }) => {
  const leaks: string[] = []
  const watch = (p: Page, secret: () => string) =>
    p.on('request', (r) => {
      if (!r.url().includes('/api/lib')) return
      const body = r.postDataBuffer()?.toString('latin1') ?? ''
      const s = secret()
      if (r.url().includes('controllers') || body.includes('controllers') || (s && (r.url().includes(s) || body.includes(s)))) leaks.push(r.url())
    })

  // PC 1: add the game locally, create a library, upload it.
  const pc1 = await browser.newContext()
  const a = await pc1.newPage()
  let passphrase = ''
  watch(a, () => passphrase)
  await openHome(a)
  await a.setInputFiles('input[type=file][multiple]', FIXTURE)
  await expect(a.getByRole('link', { name: /controllers/i }).first()).toBeVisible()
  await a.locator('[data-start-create]').click()
  passphrase = (await a.locator('[data-passphrase]').innerText()).trim()
  expect(passphrase.split('-')).toHaveLength(5)
  await a.locator('[data-invite]').fill(INVITE)
  await a.locator('[data-wrote]').check()
  await a.locator('[data-create]').click()
  await expect(a.getByText(/MCKEY-/)).toBeVisible({ timeout: 30_000 })
  await a.locator('[data-recovery-done]').click()
  await a.locator('[data-open-upload]').click()
  await a.locator('[data-upload-candidate]').filter({ hasText: /controllers/i }).click()
  await expect(a.locator('a[href^="/play/cloud/"]')).toHaveCount(1, { timeout: 60_000 })

  // Play straight from the cloud.
  await a.locator('a[href^="/play/cloud/"]').click()
  await a.waitForFunction(() => document.documentElement.dataset.phase === 'running', null, { timeout: 90_000 })
  await pc1.close()

  // PC 2: fresh browser profile — nothing local, open with the passphrase.
  const pc2 = await browser.newContext()
  const b = await pc2.newPage()
  watch(b, () => passphrase)
  await openHome(b)
  await b.locator('[data-secret]').fill('wrong-password-xyz-1234')
  await b.locator('form[data-open]').evaluate((f: HTMLFormElement) => f.requestSubmit())
  await expect(b.getByText(/no library found/i)).toBeVisible({ timeout: 30_000 })
  await b.locator('[data-secret]').fill(passphrase)
  await b.locator('form[data-open]').evaluate((f: HTMLFormElement) => f.requestSubmit())
  await expect(b.locator('a[href^="/play/cloud/"]')).toHaveCount(1, { timeout: 30_000 })
  await b.locator('.cloud-library .tile details summary').first().click()
  await b.locator('[data-download]').click()
  await expect(b.locator('a[href^="/play/local/"]')).toHaveCount(1, { timeout: 60_000 })
  await b.locator('a[href^="/play/local/"]').click()
  await b.waitForFunction(() => document.documentElement.dataset.phase === 'running', null, { timeout: 90_000 })
  await pc2.close()

  expect(leaks).toEqual([])
})
