// @vitest-environment nuxt
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import type { LocalGame } from '../../shared/types/game'
import PlayPage from '../../app/pages/play/[source]/[id].vue'

const state = vi.hoisted(() => ({
  game: undefined as LocalGame | undefined,
  route: { params: { source: 'local', id: 'g1' }, query: {} as Record<string, string> },
}))

vi.mock('../../app/utils/localDb', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../app/utils/localDb')>()
  return {
    ...mod,
    getGame: vi.fn(async () => state.game),
    getBlob: vi.fn(async () => new Blob([new Uint8Array(4)])),
    getSetting: vi.fn(async () => undefined),
    touchLastPlayed: vi.fn(async () => {}),
  }
})

mockNuxtImport('useRoute', () => () => state.route)

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

describe('play page', () => {
  beforeEach(() => {
    state.game = undefined
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
    const wrapper = await mountSuspended(PlayPage)
    await flushPromises()
    await flushPromises()
    expect(wrapper.text()).toContain('Magic Castle')
    expect(injected.scripts).toHaveLength(1)
    expect(injected.scripts[0]!.src.endsWith('/loader.js')).toBe(true)
    expect((window as unknown as Record<string, unknown>).EJS_core).toBe('psx')
    expect(((window as unknown as Record<string, unknown>).EJS_gameUrl as File).name).toBe('Magic Castle.chd')
    expect(document.documentElement.dataset.phase).toBe('loading')
    ;(window as unknown as { EJS_onGameStart: () => void }).EJS_onGameStart()
    await flushPromises()
    expect(document.documentElement.dataset.phase).toBe('running')
  })
})
