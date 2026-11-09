// @vitest-environment nuxt
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import type { LocalGame } from '../../shared/types/game'
import PlayPage from '../../app/pages/play/[source]/[id].vue'

const state = vi.hoisted(() => ({
  game: undefined as LocalGame | undefined,
  biosKey: undefined as string | undefined,
  route: { params: { source: 'local', id: 'g1' }, query: {} as Record<string, string> },
}))

vi.mock('../../app/utils/localDb', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../app/utils/localDb')>()
  return {
    ...mod,
    getGame: vi.fn(async () => state.game),
    getBlob: vi.fn(async () => new Blob([new Uint8Array(4)])),
    getSetting: vi.fn(async (k: string) => (k === 'bios' ? state.biosKey : k === 'biosName' ? 'SCPH1001.BIN' : undefined)),
    touchLastPlayed: vi.fn(async () => {}),
  }
})

mockNuxtImport('useRoute', () => () => state.route)

const cloudMock = vi.hoisted(() => ({
  status: { value: 'closed' as string },
  games: { value: [] as unknown[] },
  restore: async () => {},
  downloadGameFiles: async (_g: unknown, _p?: (d: number, t: number) => void) => [new File([new Uint8Array(4)], 'Cloud Game.chd')] as File[],
}))
mockNuxtImport('useCloudLibrary', () => () => cloudMock)

const game: LocalGame = {
  id: 'g1',
  title: 'Magic Castle',
  source: 'local',
  kind: 'single',
  primaryName: 'Magic Castle.chd',
  files: [{ name: 'Magic Castle.chd', size: 4, blobKey: 'b1' }],
  sizeBytes: 4,
  createdAt: 0,
  lastPlayedAt: null,
}

// happy-dom fires `error` on any external <script>, so capture the loader instead of appending it.
const injected = vi.hoisted(() => ({ scripts: [] as HTMLScriptElement[] }))
const originalAppend = document.body.appendChild.bind(document.body)
vi.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
  if (node instanceof HTMLScriptElement && node.dataset.ejsLoader !== undefined) {
    injected.scripts.push(node)
    return node
  }
  return originalAppend(node)
})

/** Records every data-phase value in order (mutation records are batched, so rebuild from oldValue). */
function observePhases() {
  const olds: (string | null)[] = []
  const observer = new MutationObserver((records) => records.forEach((r) => olds.push(r.oldValue)))
  observer.observe(document.documentElement, { attributes: true, attributeOldValue: true, attributeFilter: ['data-phase'] })
  return () => {
    observer.takeRecords().forEach((r) => olds.push(r.oldValue))
    observer.disconnect()
    return [...olds.slice(1), document.documentElement.dataset.phase ?? '']
  }
}

describe('play page', () => {
  beforeEach(() => {
    state.game = undefined
    state.biosKey = undefined
    injected.scripts.length = 0
    delete document.documentElement.dataset.phase
    for (const key of Object.keys(window).filter((k) => k.startsWith('EJS_'))) delete (window as unknown as Record<string, unknown>)[key]
  })

  it('shows not found and never injects the loader for an unknown id', async () => {
    const wrapper = await mountSuspended(PlayPage)
    await flushPromises()
    expect(wrapper.text()).toMatch(/not found/i)
    expect(wrapper.find('a[href="/"]').exists()).toBe(true)
    expect(injected.scripts).toHaveLength(0)
  })

  it('walks through the boot phases and injects loader.js for a stored game', async () => {
    state.game = game
    const phases = observePhases()
    const wrapper = await mountSuspended(PlayPage)
    await flushPromises()
    await flushPromises()
    expect(phases()).toEqual(['reading', 'loading'])
    expect(wrapper.text()).toContain('Magic Castle')
    // An exit is always offered, even before the game runs.
    expect(wrapper.find('a[href="/"]').exists()).toBe(true)
    expect(injected.scripts).toHaveLength(1)
    expect(injected.scripts[0]!.src.endsWith('/loader.js')).toBe(true)
    expect((window as unknown as Record<string, unknown>).EJS_core).toBe('psx')
    expect(((window as unknown as Record<string, unknown>).EJS_gameUrl as File).name).toBe('Magic Castle.chd')
    expect(document.documentElement.dataset.phase).toBe('loading')
    ;(window as unknown as { EJS_onGameStart: () => void }).EJS_onGameStart()
    await flushPromises()
    expect(document.documentElement.dataset.phase).toBe('running')
  })

  it('reads a stored BIOS and hands its bytes (not a File) to the emulator', async () => {
    state.game = game
    state.biosKey = 'bios-blob'
    await mountSuspended(PlayPage)
    await flushPromises()
    await flushPromises()
    expect(window).not.toHaveProperty('EJS_biosUrl')
    // The BIOS reaches the FS through the saveDatabaseLoaded hook registered in EJS_ready.
    const writes: [string, Uint8Array][] = []
    const handlers: Record<string, (fs: unknown) => void> = {}
    const emu = { on: (ev: string, fn: (fs: unknown) => void) => (handlers[ev] = fn) }
    ;(window as unknown as { EJS_emulator: unknown }).EJS_emulator = emu
    ;(window as unknown as { EJS_ready: (e: unknown) => void }).EJS_ready(emu)
    handlers.saveDatabaseLoaded!({ writeFile: (p: string, d: Uint8Array) => writes.push([p, d]) })
    expect(writes.map(([p]) => p)).toEqual(['/scph5501.bin'])
    expect(writes[0]![1]).toBeInstanceOf(Uint8Array)
  })

  it('cloud: with the library closed it says so and never loads the emulator', async () => {
    state.route = { params: { source: 'cloud', id: 'c1' }, query: {} }
    cloudMock.status.value = 'closed'
    const wrapper = await mountSuspended(PlayPage)
    await flushPromises()
    expect(wrapper.text()).toMatch(/library is closed/i)
    expect(injected.scripts).toHaveLength(0)
    state.route = { params: { source: 'local', id: 'g1' }, query: {} }
  })

  it('cloud: downloads, decrypts and boots the game', async () => {
    state.route = { params: { source: 'cloud', id: 'c1' }, query: {} }
    cloudMock.status.value = 'open'
    cloudMock.games.value = [{ id: 'c1', title: 'Cloud Game', kind: 'single', primaryName: 'Cloud Game.chd', files: [{ name: 'Cloud Game.chd', size: 4, objectKey: 'k', chunks: 1 }], sizeBytes: 4, createdAt: 1, lastPlayedAt: null, kGame: 'x' }]
    const phases = observePhases()
    const wrapper = await mountSuspended(PlayPage)
    await flushPromises()
    await flushPromises()
    expect(phases()).toEqual(['reading', 'loading'])
    expect(wrapper.text()).toContain('Cloud Game')
    expect(((window as unknown as Record<string, unknown>).EJS_gameUrl as File).name).toBe('Cloud Game.chd')
    state.route = { params: { source: 'local', id: 'g1' }, query: {} }
  })

  it('packs a multi-disc game as playlist + extra files', async () => {
    state.game = { ...game, kind: 'multi', primaryName: 'Magic Castle.m3u', generatedM3u: 'Magic Castle (Disc 1).chd\n', files: [{ name: 'Magic Castle (Disc 1).chd', size: 4, blobKey: 'b1' }] }
    const phases = observePhases()
    await mountSuspended(PlayPage)
    await flushPromises()
    await flushPromises()
    expect(phases()).toEqual(['reading', 'packing', 'loading'])
    expect(((window as unknown as Record<string, unknown>).EJS_gameUrl as File).name).toBe('Magic Castle.m3u')
  })
})
