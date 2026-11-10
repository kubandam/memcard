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

  test('the game starts clean: no emulator bar, no buttons, no touch pad', async ({ page }) => {
    await playFixture(page)
    await page.waitForTimeout(1000)
    await expect(page.locator('.ejs_menu_bar')).toHaveClass(/ejs_menu_bar_hidden/)
    await expect(page.locator('[data-player-overlay]')).toHaveClass(/overlay--hidden/)
    await expect(page.locator('.ejs_virtualGamepad_open')).toBeHidden()
    await expect(page.locator('.ejs_virtualGamepad_parent').getByText('✕', { exact: true })).toBeHidden()
  })

  test('touching the game without a controller brings up the PlayStation pad; a controller removes it', async ({ page }) => {
    await playFixture(page)
    // The pad's container has no size of its own; its buttons are what shows.
    const pad = page.locator('.ejs_virtualGamepad_parent')
    const vp = page.viewportSize()!
    await page.touchscreen.tap(vp.width / 2, vp.height / 2)
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
