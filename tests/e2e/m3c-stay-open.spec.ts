import { expect, test } from '@playwright/test'

const INVITE = process.env.E2E_INVITE ?? 'dev-invite'

test('Stay open on this PC survives a new tab; Close library forgets it', async ({ browser }) => {
  const ctx = await browser.newContext()
  const a = await ctx.newPage()
  await a.goto('/')
  await expect(a.locator('[data-hydrated]')).toBeAttached()
  await a.locator('[data-start-create]').click()
  await a.locator('[data-invite]').fill(INVITE)
  await a.locator('[data-wrote]').check()
  await a.locator('.cloud-panel input[type=checkbox]').last().check()
  await a.locator('[data-create]').click()
  await a.locator('[data-recovery-done]').click({ timeout: 30_000 })
  await expect(a.getByText(/stays open on this pc/i)).toBeVisible()

  // A new tab has an empty sessionStorage: only the device copy can reopen it.
  const b = await ctx.newPage()
  await b.goto('/')
  await expect(b.locator('.cloud-library')).toBeVisible({ timeout: 30_000 })
  await b.locator('[data-close]').click()

  const c = await ctx.newPage()
  await c.goto('/')
  await expect(c.locator('[data-hydrated]')).toBeAttached()
  await expect(c.locator('.cloud-panel')).toBeVisible()
  await expect(c.locator('.cloud-library')).toHaveCount(0)
  await ctx.close()
})
