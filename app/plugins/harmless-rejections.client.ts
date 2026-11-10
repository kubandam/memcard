import { isHarmlessRejection } from '~/utils/harmlessRejections'

export default defineNuxtPlugin(() => {
  // EmulatorJS asks for a screen Wake Lock; when the browser says no (battery saver, headless, iframe)
  // the rejection is harmless, so answer with an inert sentinel instead of an error.
  const wl = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<unknown> } }).wakeLock
  if (wl?.request) {
    const original = wl.request.bind(wl)
    wl.request = (type) =>
      original(type).catch(() => ({ released: true, type, release: async () => {}, addEventListener() {}, removeEventListener() {}, onrelease: null }))
  }
  window.addEventListener('unhandledrejection', (event) => {
    if (isHarmlessRejection(event.reason)) event.preventDefault()
  })
})
