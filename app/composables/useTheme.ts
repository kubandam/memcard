import { ref, type Ref } from 'vue'

export type Theme = 'dark' | 'grey'

export const THEME_STORAGE_KEY = 'memcard.theme'
const THEMES: readonly Theme[] = ['dark', 'grey']

let themeRef: Ref<Theme> | null = null

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(stored) ? stored : 'dark'
  } catch {
    return 'dark'
  }
}

function applyTheme(theme: Theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Storage unavailable (private mode, quota): theme stays for this page only.
    }
  }
}

export function useTheme() {
  if (!themeRef) {
    themeRef = ref<Theme>(readStoredTheme())
  }
  const theme = themeRef

  function setTheme(next: Theme) {
    theme.value = next
    applyTheme(next)
  }

  function toggle() {
    setTheme(theme.value === 'dark' ? 'grey' : 'dark')
  }

  return { theme, setTheme, toggle, themes: THEMES }
}

/** Test helper: drop the shared state so each test starts fresh. */
export function __resetThemeForTests() {
  themeRef = null
}
