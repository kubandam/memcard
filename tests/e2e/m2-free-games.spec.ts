import { expect, test } from '@playwright/test'

test.setTimeout(180_000)

test('a visitor plays a free game in one click; unlisted files are not served', async ({ page, request }) => {
  const cover = await request.get('/api/free/yarmico2/cover')
  test.skip(cover.status() !== 200, 'Free games not published to the local bucket (scripts/publish-free-games.mjs --local)')
  expect((await request.get('/api/free/not-listed/file')).status()).toBe(404)
  expect((await request.get('/api/free/yarmico2/manifest')).status()).toBe(404)

  await page.goto('/')
  await expect(page.locator('[data-hydrated]')).toBeAttached()
  await expect(page.getByRole('heading', { name: /free games/i })).toBeVisible()
  await expect(page.locator('img[src="/api/free/yarmico2/cover"]')).toBeVisible()
  await page.locator('a[href="/play/free/yarmico2"]').click()
  await page.waitForFunction(() => document.documentElement.dataset.phase === 'running', null, { timeout: 90_000 })
  await expect(page.locator('#game canvas')).toBeVisible()
})
