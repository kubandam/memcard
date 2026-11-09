// @vitest-environment nuxt
import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ThemeToggle from '../../app/components/shelf/ThemeToggle.vue'
import { __resetThemeForTests } from '../../app/composables/useTheme'

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
    __resetThemeForTests()
  })

  it('renders the stored theme as pressed on first paint (no SSR default leaking through)', async () => {
    localStorage.setItem('memcard.theme', 'grey')
    document.documentElement.dataset.theme = 'grey'
    const wrapper = await mountSuspended(ThemeToggle)
    const buttons = wrapper.findAll('button')
    expect(buttons[1]!.attributes('aria-pressed')).toBe('true')
    expect(buttons[0]!.attributes('aria-pressed')).toBe('false')
  })

  it('switches the document theme and reflects pressed state', async () => {
    const wrapper = await mountSuspended(ThemeToggle)
    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]!.attributes('aria-pressed')).toBe('true')
    await buttons[1]!.trigger('click')
    expect(document.documentElement.dataset.theme).toBe('grey')
    expect(buttons[1]!.attributes('aria-pressed')).toBe('true')
    expect(buttons[0]!.attributes('aria-pressed')).toBe('false')
  })
})
