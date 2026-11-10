import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEmulator, WATCHDOG_MS } from '../../app/composables/useEmulator'

type W = Record<string, unknown> & { EJS_ready?: (emu: unknown) => void; EJS_onGameStart?: () => void }
const w = () => window as unknown as W

function fakeEmulator() {
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {}
  const FS = { writeFile: vi.fn() }
  const emu = {
    on: (ev: string, fn: (...a: unknown[]) => void) => ((handlers[ev] ??= []).push(fn)),
    fire: (ev: string, ...a: unknown[]) => handlers[ev]?.forEach((fn) => fn(...a)),
    startGameError: vi.fn(),
    started: true,
    // In EmulatorJS the gameManager only exists once the core has loaded (after EJS_ready).
    gameManager: undefined as undefined | { saveSaveFiles: ReturnType<typeof vi.fn>; FS: typeof FS },
    FS,
  }
  return emu
}

const base = { file: new File(['x'], 'g.chd'), gameName: 'g.chd', base: 'https://cdn.example/data/', color: '#fff' }

describe('useEmulator', () => {
  let appended: HTMLScriptElement[]
  beforeEach(() => {
    vi.useFakeTimers()
    appended = []
    vi.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(n: T): T => (appended.push(n as unknown as HTMLScriptElement), n))
    for (const k of Object.keys(window).filter((k) => k.startsWith('EJS_'))) delete w()[k]
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('never passes the BIOS as EJS_biosUrl; writes it and extra files into the FS when the database is ready', () => {
    const { start } = useEmulator()
    const bios = new Uint8Array(4).fill(1)
    const disc = new Uint8Array(2).fill(2)
    start({ ...base, bios, extraFiles: [{ path: '/g (Disc 2).chd', data: disc }] })
    expect(w()).not.toHaveProperty('EJS_biosUrl')
    const emu = fakeEmulator()
    w().EJS_emulator = emu
    w().EJS_ready!(emu)
    emu.fire('saveDatabaseLoaded', emu.FS)
    expect(emu.FS.writeFile).toHaveBeenCalledWith('/scph5501.bin', bios)
    expect(emu.FS.writeFile).toHaveBeenCalledWith('/g (Disc 2).chd', disc)
  })

  it('pre-initialises allSettings so multi-disc games survive the 4.2.3 setupDisksMenu bug', () => {
    const { start } = useEmulator()
    start(base)
    const emu = fakeEmulator() as ReturnType<typeof fakeEmulator> & { allSettings?: unknown }
    w().EJS_emulator = emu
    w().EJS_ready!(emu)
    expect(emu.allSettings).toEqual({})
  })

  it('refuses to write unsafe extra-file paths into the emulator FS', () => {
    const { start, phase } = useEmulator()
    start({ ...base, extraFiles: [{ path: '/../data/saves/x.srm', data: new Uint8Array(1) }] })
    expect(phase.value).toBe('error')
    expect(document.querySelector('script[data-ejs-loader]')).toBeNull()
  })

  it('calls onFsReady with the FS and the card path, and forwards flushed cards', () => {
    const fsCalls: [unknown, string][] = []
    const cards: Uint8Array[] = []
    const { start } = useEmulator()
    start({ ...base, gameName: 'Crash Bandicoot.chd', onFsReady: (fs, path) => void fsCalls.push([fs, path]), onCardSaved: (b) => void cards.push(b) })
    const emu = fakeEmulator()
    w().EJS_emulator = emu
    w().EJS_ready!(emu)
    emu.fire('saveDatabaseLoaded', emu.FS)
    expect(fsCalls).toEqual([[emu.FS, '/data/saves/PCSX-ReARMed/Crash Bandicoot.srm']])
    emu.fire('saveSaveFiles', new Uint8Array([1, 2]))
    emu.fire('saveSaveFiles', null)
    expect(cards).toEqual([new Uint8Array([1, 2])])
  })

  it('sets a 30 s save interval by default and no ROM cache', () => {
    useEmulator().start(base)
    expect((w().EJS_defaultOptions as Record<string, string>)['save-save-interval']).toBe('30')
    expect(w().EJS_CacheLimit).toBe(0)
  })

  it('surfaces EmulatorJS startGameError as a failed phase', () => {
    const { start, phase, error } = useEmulator()
    start(base)
    const emu = fakeEmulator()
    w().EJS_emulator = emu
    w().EJS_ready!(emu)
    emu.startGameError('Network Error')
    expect(phase.value).toBe('error')
    expect(error.value).toContain('Network Error')
  })

  it('fails with a timeout when the game never starts', () => {
    const { start, phase, error } = useEmulator()
    start(base)
    vi.advanceTimersByTime(WATCHDOG_MS + 1)
    expect(phase.value).toBe('error')
    expect(error.value).toMatch(/took too long/i)
  })

  it('does not time out once running', () => {
    const { start, phase } = useEmulator()
    start(base)
    w().EJS_onGameStart!()
    vi.advanceTimersByTime(WATCHDOG_MS + 1)
    expect(phase.value).toBe('running')
  })

  it('flushSaves asks the running emulator to write its save files', () => {
    const { start, flushSaves } = useEmulator()
    start(base)
    const emu = fakeEmulator()
    emu.gameManager = { saveSaveFiles: vi.fn(), FS: emu.FS }
    w().EJS_emulator = emu
    flushSaves()
    expect(emu.gameManager.saveSaveFiles).toHaveBeenCalledTimes(1)
  })

  it('reports the phase on <html data-phase> and injects the loader once', () => {
    const { start } = useEmulator()
    start(base)
    expect(document.documentElement.dataset.phase).toBe('loading')
    expect(appended.filter((s) => s.dataset?.ejsLoader !== undefined)).toHaveLength(1)
  })
})

describe('useEmulator — save states', () => {
  beforeEach(() => {
    vi.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(n: T): T => n)
    for (const k of Object.keys(window).filter((k) => k.startsWith('EJS_'))) delete (window as unknown as Record<string, unknown>)[k]
  })
  afterEach(() => vi.restoreAllMocks())

  it('takes over Save/Load State, runs onStarted, and loadState feeds the core', () => {
    const saved: unknown[] = []
    let loadRequested = 0
    let started = 0
    const { start, loadState } = useEmulator()
    start({ ...base, onStateSaved: (s) => void saved.push(s), onStateLoadRequested: () => void loadRequested++, onStarted: () => void started++ })
    const emu = fakeEmulator() as ReturnType<typeof fakeEmulator> & { gameManager?: { loadState: ReturnType<typeof vi.fn> } }
    w().EJS_emulator = emu
    w().EJS_ready!(emu)
    emu.fire('saveState', { state: new Uint8Array([1]), screenshot: new Uint8Array([2]), format: 'png' })
    emu.fire('loadState')
    w().EJS_onGameStart!()
    expect(saved).toEqual([{ state: new Uint8Array([1]), screenshot: new Uint8Array([2]) }])
    expect(loadRequested).toBe(1)
    expect(started).toBe(1)
    emu.gameManager = { saveSaveFiles: vi.fn(), FS: emu.FS, loadState: vi.fn() } as never
    expect(loadState(new Uint8Array([9]))).toBe(true)
    expect(emu.gameManager!.loadState).toHaveBeenCalledWith(new Uint8Array([9]))
  })
})
