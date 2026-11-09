import { ref } from 'vue'
import { buildEjsGlobals, type EjsOptions } from '~/utils/emulatorjs'
import type { ExtraFile } from '~/utils/gamePayload'

export type EmulatorPhase = 'idle' | 'reading' | 'packing' | 'loading' | 'starting' | 'running' | 'error'

export const PHASE_PROGRESS: Readonly<Record<EmulatorPhase, number>> = {
  idle: 0,
  reading: 0.1,
  packing: 0.4,
  loading: 0.7,
  starting: 0.85,
  running: 1,
  error: 0,
}

/** If the game has not started this long after the loader was injected, give up with a message. */
export const WATCHDOG_MS = 120_000

/** pcsx_rearmed only picks up BIOS files with canonical names; this is the NTSC-U one. */
export const BIOS_FS_PATH = '/scph5501.bin'

type SaveExportHandler = (save: Uint8Array) => void

interface SaveSaveEvent {
  save?: ArrayBuffer | Uint8Array | null
  screenshot?: unknown
  format?: string
}

interface EmulatorInstance {
  allSettings?: Record<string, unknown>
  on?: (event: string, fn: (...args: unknown[]) => void) => void
  startGameError?: (message: string) => void
  started?: boolean
  gameManager?: { saveSaveFiles?: () => void; FS?: { writeFile: (path: string, data: Uint8Array) => void } }
}

interface FsLike {
  writeFile: (path: string, data: Uint8Array) => void
}

export interface StartOptions extends EjsOptions {
  /** Raw BIOS bytes; written to the FS as scph5501.bin, never passed as EJS_biosUrl. */
  bios?: Uint8Array
  /** Discs / tracks referenced by the primary file; written to the FS before the ROM loads. */
  extraFiles?: ExtraFile[]
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
  let watchdog: ReturnType<typeof setTimeout> | undefined

  function setPhase(next: EmulatorPhase, fraction?: number) {
    phase.value = next
    progress.value = fraction ?? PHASE_PROGRESS[next]
    if (typeof document !== 'undefined') document.documentElement.dataset.phase = next
    if (next === 'running' || next === 'error') clearTimeout(watchdog)
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

  function emulator(): EmulatorInstance | undefined {
    return (window as unknown as { EJS_emulator?: EmulatorInstance }).EJS_emulator
  }

  /** Ask EmulatorJS to write pending memory-card data to its database (safe to call any time). */
  function flushSaves() {
    const emu = emulator()
    if (emu?.gameManager?.saveSaveFiles) {
      try {
        emu.gameManager.saveSaveFiles()
      } catch {
        // The core may not be ready yet; nothing to flush.
      }
    }
  }

  function start(opts: StartOptions) {
    const w = window as unknown as Record<string, unknown>
    if (w.EJS_emulator) {
      fail('An emulator is already running on this page. Reload to start another game.')
      return
    }
    const { bios, extraFiles = [], ...ejs } = opts
    const globals = buildEjsGlobals(ejs)
    globals.EJS_defaultOptions = { ...(globals.EJS_defaultOptions as object), 'save-save-interval': '30' }
    globals.EJS_CacheLimit = 0 // local games already live in the app's own IndexedDB
    Object.assign(w, globals)

    const pending: ExtraFile[] = [...extraFiles]
    if (bios) pending.push({ path: BIOS_FS_PATH, data: bios })

    w.EJS_ready = (emu: unknown) => {
      const instance = (emu as EmulatorInstance) ?? emulator()
      if (pending.length) {
        if (!instance?.on || instance.gameManager) {
          fail('The emulator initialised before extra files could be attached. Reload to try again.')
          return
        }
        instance.on('saveDatabaseLoaded', (fs) => {
          for (const f of pending) (fs as FsLike).writeFile(f.path, f.data)
        })
      }
      // EmulatorJS 4.2.3 bug: startGame() runs setupDisksMenu() before setupSettingsMenu() creates
      // `allSettings`, so any game with more than one disc throws "Cannot set properties of undefined
      // (setting 'disk')". Pre-creating the object is harmless: setupSettingsMenu() replaces it.
      if (instance && !instance.allSettings) instance.allSettings = {}
      if (instance?.startGameError) {
        const original = instance.startGameError.bind(instance)
        instance.startGameError = (message: string) => {
          fail(message)
          original(message)
        }
      }
      setPhase('starting')
    }
    w.EJS_onGameStart = () => setPhase('running')
    w.EJS_onSaveSave = (e: SaveSaveEvent) => {
      if (!saveHandler || !e?.save) return
      saveHandler(e.save instanceof Uint8Array ? e.save : new Uint8Array(e.save))
    }

    setPhase('loading')
    watchdog = setTimeout(() => {
      if (phase.value !== 'running' && phase.value !== 'error') {
        fail('The game took too long to start. Check your connection, then reload to try again.')
      }
    }, WATCHDOG_MS)

    const script = document.createElement('script')
    script.src = `${opts.base}loader.js`
    script.async = true
    script.dataset.ejsLoader = ''
    script.onerror = () => fail('The emulator could not be downloaded. Check your connection and reload.')
    document.body.appendChild(script)
  }

  return { phase, progress, error, setPhase, setSubProgress, fail, start, onSaveExport, flushSaves }
}
