import { ref } from 'vue'
import { buildEjsGlobals, type EjsOptions } from '~/utils/emulatorjs'

export type EmulatorPhase = 'idle' | 'reading' | 'packing' | 'loading' | 'starting' | 'running' | 'error'

export const PHASE_PROGRESS: Readonly<Record<EmulatorPhase, number>> = {
  idle: 0,
  reading: 0.1,
  packing: 0.4,
  loading: 0.7,
  starting: 0.9,
  running: 1,
  error: 0,
}

type SaveExportHandler = (save: Uint8Array) => void

interface SaveSaveEvent {
  save?: ArrayBuffer | Uint8Array
  screenshot?: unknown
  format?: string
}

/**
 * Drives one EmulatorJS session on the page. EmulatorJS keeps global state and has no
 * teardown, so a page hosting it must be left with a full-page navigation.
 */
export function useEmulator() {
  const phase = ref<EmulatorPhase>('idle')
  const progress = ref(0)
  const error = ref<string | null>(null)
  let saveHandler: SaveExportHandler | null = null

  function setPhase(next: EmulatorPhase, fraction?: number) {
    phase.value = next
    progress.value = fraction ?? PHASE_PROGRESS[next]
    if (typeof document !== 'undefined') document.documentElement.dataset.phase = next
  }

  /** Reports sub-progress inside the reading/packing phases. */
  function setSubProgress(from: EmulatorPhase, to: EmulatorPhase, fraction: number) {
    progress.value = PHASE_PROGRESS[from] + (PHASE_PROGRESS[to] - PHASE_PROGRESS[from]) * Math.min(1, Math.max(0, fraction))
  }

  function fail(message: string) {
    error.value = message
    setPhase('error')
  }

  function onSaveExport(cb: SaveExportHandler) {
    saveHandler = cb
  }

  function start(opts: EjsOptions) {
    const w = window as unknown as Record<string, unknown>
    if (w.EJS_emulator) {
      fail('An emulator is already running on this page. Reload to start another game.')
      return
    }
    Object.assign(w, buildEjsGlobals(opts))
    w.EJS_ready = () => setPhase('starting')
    w.EJS_onGameStart = () => setPhase('running')
    w.EJS_onSaveSave = (e: SaveSaveEvent) => {
      if (!saveHandler || !e?.save) return
      saveHandler(e.save instanceof Uint8Array ? e.save : new Uint8Array(e.save))
    }
    setPhase('loading')
    const script = document.createElement('script')
    script.src = `${opts.base}loader.js`
    script.async = true
    script.dataset.ejsLoader = ''
    script.onerror = () => fail('The emulator could not be downloaded. Check your connection and reload.')
    document.body.appendChild(script)
  }

  return { phase, progress, error, setPhase, setSubProgress, fail, start, onSaveExport }
}
