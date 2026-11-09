import { beforeEach, describe, expect, it } from 'vitest'
import { useTheme, __resetThemeForTests } from '../../app/composables/useTheme'

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
    __resetThemeForTests()
  })

  it('defaults to dark and persists toggle', () => {
    const { theme, toggle } = useTheme()
    expect(theme.value).toBe('dark')
    toggle()
    expect(theme.value).toBe('grey')
    expect(localStorage.getItem('memcard.theme')).toBe('grey')
    expect(document.documentElement.dataset.theme).toBe('grey')
  })

  it('reads stored theme on init', () => {
    localStorage.setItem('memcard.theme', 'grey')
    expect(useTheme().theme.value).toBe('grey')
  })

  it('ignores unknown stored values', () => {
    localStorage.setItem('memcard.theme', 'neon')
    expect(useTheme().theme.value).toBe('dark')
  })
})
