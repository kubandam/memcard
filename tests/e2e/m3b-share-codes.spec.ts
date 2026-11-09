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

async function redeem(page: Page, code: string) {
  await page.locator('input[data-code]').fill(code)
  await page.locator('form[data-redeem]').evaluate((f: HTMLFormElement) => f.requestSubmit())
}

test('owner shares a game and the library; recipient downloads, plays shared, then loses access on revoke', async ({ browser }) => {
  const secrets: string[] = []
  const leaks: string[] = []
  const watch = (p: Page) =>
    p.on('request', (r) => {
      if (!r.url().includes('/api/')) return
      const body = r.postDataBuffer()?.toString('latin1') ?? ''
      const hay = r.url() + body
      if (hay.includes('controllers') || secrets.some((s) => s && hay.toUpperCase().includes(s.replace(/^MC-/, '').replace(/-/g, '')))) leaks.push(r.url())
    })

  // Owner
  const ownerCtx = await browser.newContext()
  const owner = await ownerCtx.newPage()
  watch(owner)
  await openHome(owner)
  await owner.setInputFiles('input[type=file][multiple]', FIXTURE)
  await expect(owner.getByRole('link', { name: /controllers/i }).first()).toBeVisible()
  await owner.locator('[data-start-create]').click()
  await owner.locator('[data-invite]').fill(INVITE)
  await owner.locator('[data-wrote]').check()
  await owner.locator('[data-create]').click()
  await owner.locator('[data-recovery-done]').click({ timeout: 30_000 })
  await owner.locator('[data-open-upload]').click()
  await owner.locator('[data-upload-candidate]').filter({ hasText: /controllers/i }).click()
  await expect(owner.locator('.cloud-library .tile')).toHaveCount(1, { timeout: 60_000 })
  await owner.locator('.cloud-library .tile [data-share]').click()
  const gameCode = (await owner.locator('[data-share-code]').innerText()).trim()
  await owner.locator('[data-share-library]').click()
  await expect(owner.locator('[data-share-code]')).not.toHaveText(gameCode)
  const libCode = (await owner.locator('[data-share-code]').innerText()).trim()
  secrets.push(gameCode, libCode)
  expect(gameCode).toMatch(/^MC-/)

  // Recipient (fresh profile, no library, no invite)
  const friendCtx = await browser.newContext()
  const friend = await friendCtx.newPage()
  watch(friend)
  await openHome(friend)
  await redeem(friend, gameCode.toLowerCase().replace(/-/g, ' '))
  await friend.locator('[data-download-shared]').click()
  await expect(friend.getByText(/added to my games/i)).toBeVisible({ timeout: 60_000 })
  await expect(friend.locator('a[href^="/play/local/"]')).toHaveCount(1)

  await redeem(friend, libCode)
  await expect(friend.locator('a[href^="/play/shared/"]')).toHaveCount(1, { timeout: 30_000 })
  await friend.locator('a[href^="/play/shared/"]').click()
  await friend.waitForFunction(() => document.documentElement.dataset.phase === 'running', null, { timeout: 90_000 })

  // Owner revokes the library code.
  await owner.locator('details.issued summary').click()
  const row = owner.locator('[data-share-row]').filter({ hasText: /whole library/i })
  await row.locator('[data-revoke]').click()
  await row.locator('[data-revoke]').click()
  await expect(owner.locator('[data-share-row]').filter({ hasText: /whole library/i })).toHaveCount(0)

  // Recipient: shared library now shows revoked, no play links; game already downloaded stays.
  await openHome(friend)
  await expect(friend.getByText(/no longer valid/i)).toBeVisible({ timeout: 30_000 })
  await expect(friend.locator('a[href^="/play/shared/"]')).toHaveCount(0)
  await expect(friend.locator('a[href^="/play/local/"]')).toHaveCount(1)

  await ownerCtx.close()
  await friendCtx.close()
  expect(leaks).toEqual([])
})
