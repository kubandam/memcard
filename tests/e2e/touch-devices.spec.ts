import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { devices, expect, test, type Page } from '@playwright/test'

const FIXTURE = join(process.cwd(), 'tests/fixtures/controllers.iso')
test.skip(!existsSync(FIXTURE), 'Fixture missing: run `pnpm fixture` first (see tests/fixtures/README.md)')

/** Controllers are faked: the page sees none until `__plug()` connects a DualSense. */
function fakeGamepads() {
  const w = window as unknown as { __pads: unknown[]; __plug: () => void }
  w.__pads = [null]
  navigator.getGamepads = () => w.__pads as ReturnType<Navigator['getGamepads']>
  w.__plug = () => {
    w.__pads = [{ index: 0, id: 'DualSense Wireless Controller', connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) }]
    window.dispatchEvent(new Event('gamepadconnected'))
  }
}

async function playFixture(page: Page) {
  await page.addInitScript(fakeGamepads)
  await page.goto('/')
  await expect(page.locator('[data-hydrated]')).toBeAttached()
  await page.setInputFiles('input[type=file]', FIXTURE)
  const href = await page.locator('a[href^="/play/local/"]').first().getAttribute('href')
  await page.goto(href!)
  await page.waitForFunction(() => document.documentElement.dataset.phase === 'running', null, { timeout: 90_000 })
}

test.describe('tablet held sideways', () => {
  const { defaultBrowserType: _a, ...tablet } = devices['Galaxy Tab S4 landscape']
  test.use(tablet)

  test('on-screen PlayStation pad without a controller, gone once one connects', async ({ page }) => {
    await playFixture(page)
    // The pad's container has no size of its own; its buttons are what shows.
    const pad = page.locator('.ejs_virtualGamepad_parent')
    for (const symbol of ['✕', '○', '□', '△', 'L1', 'R2']) await expect(pad.getByText(symbol, { exact: true })).toBeVisible()
    await expect(pad.getByText('Fast', { exact: true })).toHaveCount(0)

    await page.evaluate(() => (window as unknown as { __plug: () => void }).__plug())
    await expect(pad.getByText('✕', { exact: true })).toBeHidden()
    // The picture keeps the whole screen.
    const box = await page.locator('#game canvas').boundingBox()
    expect(box!.height).toBeGreaterThan(page.viewportSize()!.height - 2)
  })
})

test.describe('phone held upright', () => {
  const { defaultBrowserType: _b, ...phone } = devices['Pixel 7']
  test.use(phone)

  test('with a controller the picture sits centred, not stuck to the top', async ({ page }) => {
    await playFixture(page)
    await page.evaluate(() => (window as unknown as { __plug: () => void }).__plug())
    await expect(page.locator('.ejs_virtualGamepad_parent').getByText('✕', { exact: true })).toBeHidden()
    await expect.poll(async () => (await page.locator('#game canvas').boundingBox())!.y).toBeGreaterThan(100)
    const box = (await page.locator('#game canvas').boundingBox())!
    const vh = page.viewportSize()!.height
    expect(Math.abs(box.y + box.height / 2 - vh / 2)).toBeLessThan(4)
    expect(box.width / box.height).toBeCloseTo(4 / 3, 1)
  })
})

test('home-screen install: manifest, icons and viewport for notched screens', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.locator('meta[name=viewport]')).toHaveAttribute('content', /viewport-fit=cover/)
  await expect(page.locator('meta[name=apple-mobile-web-app-capable]')).toHaveAttribute('content', 'yes')
  const manifest = await (await request.get('/manifest.webmanifest')).json()
  expect(manifest.display).toBe('fullscreen')
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200)
  expect((await request.get('/apple-touch-icon.png')).status()).toBe(200)
})
