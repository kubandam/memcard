import { assignKnownPads, repairGamepads, usePlayStationLayout, type GamepadEmulatorLike } from '~/utils/gamepadFix'
import { ref } from 'vue'
import { buildEjsGlobals, type EjsOptions } from '~/utils/emulatorjs'
import type { ExtraFile } from '~/utils/gamePayload'
import { isSafeFileName } from '~~/shared/utils/validateGame'
import { watchVirtualGamepad, type VirtualPadEmulatorLike } from '~/utils/touchPlay'

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
  gameManager?: {
    saveSaveFiles?: () => void
    FS?: { writeFile: (path: string, data: Uint8Array) => void }
    getState?: () => Uint8Array
    screenshot?: () => Promise<Uint8Array>
  }
  paused?: boolean
}

/** Longest wait for the core's screenshot; a state without a picture is still worth saving. */
const SHOT_TIMEOUT_MS = 3000

interface FsLike {
  writeFile: (path: string, data: Uint8Array) => void
}

export interface StartOptions extends EjsOptions {
  /** Raw BIOS bytes; written to the FS as scph5501.bin, never passed as EJS_biosUrl. */
  bios?: Uint8Array
  /** Discs / tracks referenced by the primary file; written to the FS before the ROM loads. */
  extraFiles?: ExtraFile[]
  /** Runs synchronously once the FS (incl. saved cards) is mounted, before the core boots. */
  onFsReady?: (fs: unknown, cardPath: string) => void
  /** Receives the memory card bytes every time EmulatorJS flushes it. */
  onCardSaved?: (card: Uint8Array) => void
  /** Takes over the menu's Save State (EmulatorJS's own storage is skipped). */
  onStateSaved?: (s: { state: Uint8Array; screenshot: Uint8Array | null }) => void
  /** Takes over the menu's Load State; call `loadState(bytes)` with the state to load. */
  onStateLoadRequested?: () => void
  /** Runs once the game is running. */
  onStarted?: () => void
  /** EmulatorJS shader to switch on at start ('disabled' = sharp pixels); undefined leaves the emulator's own choice. */
  shader?: string
}

/** Where pcsx_rearmed keeps the memory card for a given EJS_gameName. */
export function cardPathFor(gameName: string): string {
  const base = gameName.replace(/\.[^.]+$/, '')
  return `/data/saves/PCSX-ReARMed/${base}.srm`
}

/**
 * Drives one EmulatorJS session on the page. EmulatorJS keeps global state and has no
 * teardown, so a page hosting it must be left with a full-page navigation.
 */
export function useEmulator() {
  const phase = ref<EmulatorPhase>('idle')
  const progress = ref(0)
  const error = ref<string | null>(null)
  /** True while EmulatorJS's on-screen pad is up (touch screen, no controller). */
  const virtualPad = ref(false)
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
    const { bios, extraFiles = [], onFsReady, onCardSaved, onStateSaved, onStateLoadRequested, onStarted, shader, ...ejs } = opts
    // Defense in depth: only plain files directly in the FS root (never ../ or nested paths).
    if (extraFiles.some((f) => !f.path.startsWith('/') || !isSafeFileName(f.path.slice(1)))) {
      fail('This game contains a file name that is not allowed, so it was not started.')
      return
    }
    const globals = buildEjsGlobals(ejs)
    globals.EJS_defaultOptions = { ...(globals.EJS_defaultOptions as object), 'save-save-interval': '30' }
    globals.EJS_CacheLimit = 0 // local games already live in the app's own IndexedDB
    Object.assign(w, globals)

    const pending: ExtraFile[] = [...extraFiles]
    if (bios) pending.push({ path: BIOS_FS_PATH, data: bios })

    w.EJS_ready = (emu: unknown) => {
      const instance = (emu as EmulatorInstance) ?? emulator()
      if (pending.length || onFsReady || onCardSaved) {
        if (!instance?.on || instance.gameManager) {
          fail('The emulator initialised before extra files could be attached. Reload to try again.')
          return
        }
        instance.on('saveDatabaseLoaded', (fs) => {
          for (const f of pending) (fs as FsLike).writeFile(f.path, f.data)
          try {
            onFsReady?.(fs, cardPathFor(opts.gameName))
          } catch {
            // Save sync must never stop the game from starting.
          }
        })
        if (onCardSaved) {
          instance.on('saveSaveFiles', (bytes) => {
            if (bytes instanceof Uint8Array && bytes.length) onCardSaved(bytes)
          })
        }
      }
      if (instance?.on && onStateSaved) {
        instance.on('saveState', (e) => {
          const ev = e as { state?: Uint8Array; screenshot?: Uint8Array | ArrayBuffer | null }
          if (!(ev?.state instanceof Uint8Array)) return
          const state = ev.state
          // EmulatorJS 4.2.3 reads `screenshot` from takeScreenshot(), which returns `blob`: it is always
          // undefined here, so take the picture from the core ourselves.
          const given = ev.screenshot instanceof Uint8Array ? ev.screenshot : ev.screenshot ? new Uint8Array(ev.screenshot) : null
          void (given ? Promise.resolve(given) : captureShot()).then((screenshot) => onStateSaved({ state, screenshot }))
        })
      }
      if (instance?.on && onStateLoadRequested) instance.on('loadState', () => onStateLoadRequested())
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
      if (instance) repairGamepads(instance as GamepadEmulatorLike)
      setPhase('starting')
    }
    w.EJS_onGameStart = () => {
      setPhase('running')
      const running = emulator() as GamepadEmulatorLike | undefined
      if (running) {
        repairGamepads(running)
        assignKnownPads(running)
        try {
          usePlayStationLayout(running)
        } catch {
          // Never let the controller layout stop the game.
        }
        // The page is left with a full navigation, so the watcher never needs stopping.
        watchVirtualGamepad(running as VirtualPadEmulatorLike, (shown) => (virtualPad.value = shown))
      }
      if (shader) {
        try {
          const emu = emulator() as { changeSettingOption?: (k: string, v: string) => void } | undefined
          emu?.changeSettingOption?.('shader', shader)
        } catch {
          // A picture filter is never worth stopping the game for.
        }
      }
      try {
        onStarted?.()
      } catch {
        // Never let an add-on stop the game.
      }
    }
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

  /** Loads a save state into the running core. Returns false when the core is not ready. */
  /** The core's own PNG of the current frame (native resolution, small), or null. */
  async function captureShot(): Promise<Uint8Array | null> {
    const gm = emulator()?.gameManager
    if (!gm?.screenshot) return null
    try {
      const shot = await Promise.race([gm.screenshot(), new Promise<null>((r) => setTimeout(() => r(null), SHOT_TIMEOUT_MS))])
      return shot instanceof Uint8Array && shot.length ? shot : null
    } catch {
      return null
    }
  }

  /** Snapshot of the running game for auto-save, or null when there is nothing to save. */
  async function captureState(): Promise<{ state: Uint8Array; screenshot: Uint8Array | null } | null> {
    const emu = emulator()
    if (phase.value !== 'running' || !emu?.started || !emu.gameManager?.getState) return null
    let state: Uint8Array
    try {
      state = emu.gameManager.getState()
    } catch {
      return null
    }
    if (!(state instanceof Uint8Array) || !state.length) return null
    return { state, screenshot: await captureShot() }
  }

  function loadState(state: Uint8Array): boolean {
    const gm = emulator()?.gameManager as { loadState?: (s: Uint8Array) => void } | undefined
    if (!gm?.loadState) return false
    try {
      gm.loadState(state)
      return true
    } catch {
      return false
    }
  }

  return { phase, progress, error, virtualPad, setPhase, setSubProgress, fail, start, onSaveExport, flushSaves, loadState, captureState }
}
