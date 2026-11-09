// @vitest-environment nuxt
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import type { ClassifiedGame, LocalGame } from '../../shared/types/game'
import { StorageError } from '../../app/utils/localDb'
import IndexPage from '../../app/pages/index.vue'

const state = vi.hoisted(() => ({
  games: [] as LocalGame[],
  addGame: vi.fn(),
  setCover: vi.fn(async () => {}),
  settings: new Map<string, unknown>(),
}))

vi.mock('../../app/utils/localDb', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../app/utils/localDb')>()
  return {
    ...mod,
    listGames: vi.fn(async () => state.games),
    addGame: state.addGame,
    estimateStorage: vi.fn(async () => ({ usage: 1.2e9, quota: 40e9 })),
    requestPersist: vi.fn(async () => true),
    setCover: state.setCover,
    getBlob: vi.fn(async () => new Blob([new Uint8Array(2)], { type: 'image/png' })),
    getSetting: vi.fn(async (k: string) => state.settings.get(k)),
    setSetting: vi.fn(async (k: string, v: unknown) => void state.settings.set(k, v)),
  }
})

function mockCoverFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/api/covers')) return new Response(JSON.stringify({ names: ['Crash Bandicoot (USA).png', 'Spyro the Dragon (USA).png'] }), { headers: { 'content-type': 'application/json' } })
    return new Response(new Uint8Array(8), { headers: { 'content-type': 'image/png' } })
  })
}

const file = (name: string, size = 16) => {
  const f = new File([new Uint8Array(Math.min(size, 16))], name)
  if (size > 16) Object.defineProperty(f, 'size', { value: size })
  return f
}

async function dropFiles(wrapper: Awaited<ReturnType<typeof mountSuspended>>, files: File[]) {
  const input = wrapper.find('input[type=file]')
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
  await flushPromises()
}

describe('index page', () => {
  beforeEach(() => {
    state.games = []
    state.settings.clear()
    state.setCover.mockClear()
    state.addGame.mockReset()
    state.addGame.mockImplementation(async (g: ClassifiedGame): Promise<LocalGame> => ({
      id: 'new',
      title: g.title,
      source: 'local',
      kind: g.kind,
      primaryName: g.primaryName,
      files: [],
      sizeBytes: g.totalBytes,
      createdAt: 1,
      lastPlayedAt: null,
    }))
  })

  it('lets the user set a cover from an image file', async () => {
    state.games = [{ id: 'a', title: 'Alpha', source: 'local', kind: 'single', primaryName: 'a.chd', files: [], sizeBytes: 5e6, createdAt: 1, lastPlayedAt: null }]
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()
    const input = wrapper.find('input[type=file][accept^="image/"]')
    expect(input.exists()).toBe(true)
    const img = new File([new Uint8Array(4)], 'cover.png', { type: 'image/png' })
    Object.defineProperty(input.element, 'files', { value: [img], configurable: true })
    await input.trigger('change')
    await flushPromises()
    expect(state.setCover).toHaveBeenCalledWith('a', img)
  })

  it('finds a cover online only on explicit request and says what it sends', async () => {
    state.games = [{ id: 'a', title: 'Crash Bandicoot', source: 'local', kind: 'single', primaryName: 'Crash Bandicoot (USA).chd', files: [], sizeBytes: 5e6, createdAt: 1, lastPlayedAt: null }]
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/covers')) return new Response(JSON.stringify({ names: ['Crash Bandicoot (USA).png'] }), { headers: { 'content-type': 'application/json' } })
      return new Response(new Uint8Array(8), { headers: { 'content-type': 'image/png' } })
    })
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()
    expect(fetchSpy).not.toHaveBeenCalled()
    const button = wrapper.find('[data-find-cover]')
    expect(button.attributes('title')).toMatch(/libretro/i)
    await button.trigger('click')
    await flushPromises()
    await flushPromises()
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('Crash%20Bandicoot%20(USA).png'))).toBe(true)
    const [id, blob] = state.setCover.mock.calls[0]! as unknown as [string, Blob]
    expect(id).toBe('a')
    expect(blob.size).toBe(8)
    expect(blob.type).toBe('image/png')
    fetchSpy.mockRestore()
  })

  it('asks once before fetching covers automatically, then does it on every add', async () => {
    const fetchSpy = mockCoverFetch()
    const wrapper = await mountSuspended(IndexPage)
    await dropFiles(wrapper, [file('Crash Bandicoot (USA).chd')])
    // Not yet decided → nothing fetched, a consent prompt is shown.
    expect(fetchSpy).not.toHaveBeenCalled()
    const consent = wrapper.find('[data-auto-covers]')
    expect(consent.text()).toMatch(/libretro/i)
    await consent.find('[data-accept]').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(state.settings.get('autoCovers')).toBe(true)
    // Accepting fetches the cover for the game that was just added…
    expect(state.setCover).toHaveBeenCalledTimes(1)
    // …and later adds fetch without asking.
    state.games = [{ id: 'new', title: 'Crash Bandicoot', source: 'local', kind: 'single', primaryName: 'Crash Bandicoot (USA).chd', files: [], sizeBytes: 1, createdAt: 1, lastPlayedAt: null }]
    await dropFiles(wrapper, [file('Spyro the Dragon (USA).chd')])
    await flushPromises()
    expect(state.setCover).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-auto-covers]').exists()).toBe(false)
    fetchSpy.mockRestore()
  })

  it('declining auto covers is remembered and nothing is fetched', async () => {
    const fetchSpy = mockCoverFetch()
    const wrapper = await mountSuspended(IndexPage)
    await dropFiles(wrapper, [file('Crash Bandicoot (USA).chd')])
    await wrapper.find('[data-auto-covers] [data-decline]').trigger('click')
    await flushPromises()
    expect(state.settings.get('autoCovers')).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(wrapper.find('[data-auto-covers]').exists()).toBe(false)
    fetchSpy.mockRestore()
  })

  it('offers to find all missing covers at once', async () => {
    state.settings.set('autoCovers', true)
    state.games = [
      { id: 'a', title: 'Crash Bandicoot', source: 'local', kind: 'single', primaryName: 'Crash Bandicoot (USA).chd', files: [], sizeBytes: 1, createdAt: 1, lastPlayedAt: null },
      { id: 'b', title: 'Spyro the Dragon', source: 'local', kind: 'single', primaryName: 'Spyro.chd', files: [], sizeBytes: 1, createdAt: 1, lastPlayedAt: null },
      { id: 'c', title: 'Has Cover', source: 'local', kind: 'single', primaryName: 'x.chd', files: [], sizeBytes: 1, createdAt: 1, lastPlayedAt: null, coverBlobKey: 'k' },
    ]
    const fetchSpy = mockCoverFetch()
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()
    await wrapper.find('[data-find-all-covers]').trigger('click')
    await flushPromises()
    await flushPromises()
    await flushPromises()
    expect(state.setCover.mock.calls.map(([id]) => id).sort()).toEqual(['a', 'b'])
    fetchSpy.mockRestore()
  })

  it('hides the free games section when the manifest is empty', async () => {
    const wrapper = await mountSuspended(IndexPage)
    expect(wrapper.text()).not.toContain('Free games')
    expect(wrapper.text()).toContain('My games')
  })

  it('lists stored games and the storage meter', async () => {
    state.games = [{ id: 'a', title: 'Alpha', source: 'local', kind: 'single', primaryName: 'a.chd', files: [], sizeBytes: 5e6, createdAt: 1, lastPlayedAt: null }]
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()
    expect(wrapper.text()).toContain('Alpha')
    expect(wrapper.text()).toContain('1.2 GB')
    expect(wrapper.find('a[href="/play/local/a"]').exists()).toBe(true)
  })

  it('shows the missing-cue notice after dropping a lone .bin', async () => {
    const wrapper = await mountSuspended(IndexPage)
    await dropFiles(wrapper, [file('g.bin')])
    expect(wrapper.find('[role=alert]').text()).toContain('.cue')
    expect(state.addGame).not.toHaveBeenCalled()
  })

  it('offers to play this session when storage is full', async () => {
    state.addGame.mockRejectedValue(new StorageError('quota', 'full'))
    const wrapper = await mountSuspended(IndexPage)
    await dropFiles(wrapper, [file('g.chd')])
    expect(wrapper.find('[role=alert]').text()).toMatch(/could not be saved/i)
    expect(wrapper.find('a[href="/play/session/current"]').exists()).toBe(true)
  })

  it('warns about large files before saving them, and still adds them', async () => {
    let noticeWhenSaving = ''
    const wrapper = await mountSuspended(IndexPage)
    state.addGame.mockImplementationOnce(async (g: ClassifiedGame): Promise<LocalGame> => {
      noticeWhenSaving = wrapper.find('[role=status]').text()
      return { id: 'new', title: g.title, source: 'local', kind: g.kind, primaryName: g.primaryName, files: [], sizeBytes: g.totalBytes, createdAt: 1, lastPlayedAt: null }
    })
    await dropFiles(wrapper, [file('big.chd', 800 * 1024 * 1024)])
    expect(noticeWhenSaving).toMatch(/memory/i)
    expect(wrapper.findAll('[role=status]').map((n) => n.text()).join(' | ')).toMatch(/memory/i)
    expect(state.addGame).toHaveBeenCalledTimes(1)
  })

  it('nudges towards CHD for a big uncompressed image, not for a .chd', async () => {
    const wrapper = await mountSuspended(IndexPage)
    await dropFiles(wrapper, [file('big.iso', 200 * 1024 * 1024)])
    expect(wrapper.findAll('[role=status]').map((n) => n.text()).join(' ')).toMatch(/\.chd/i)
    const w2 = await mountSuspended(IndexPage)
    await dropFiles(w2, [file('small.chd', 200 * 1024 * 1024)])
    expect(w2.findAll('[role=status]').map((n) => n.text()).join(' ')).not.toMatch(/smaller/i)
  })

  it('shows a saving state while a game is being stored', async () => {
    let busyWhileSaving = false
    const wrapper = await mountSuspended(IndexPage)
    state.addGame.mockImplementationOnce(async (g: ClassifiedGame): Promise<LocalGame> => {
      busyWhileSaving = wrapper.find('[data-saving]').exists()
      return { id: 'new', title: g.title, source: 'local', kind: g.kind, primaryName: g.primaryName, files: [], sizeBytes: g.totalBytes, createdAt: 1, lastPlayedAt: null }
    })
    await dropFiles(wrapper, [file('g.chd')])
    expect(busyWhileSaving).toBe(true)
    expect(wrapper.find('[data-saving]').exists()).toBe(false)
  })

  it('offers to play this session when storage is unavailable', async () => {
    state.addGame.mockRejectedValue(new StorageError('unavailable', 'no idb'))
    const wrapper = await mountSuspended(IndexPage)
    await dropFiles(wrapper, [file('g.chd')])
    expect(wrapper.find('[role=alert]').text()).toMatch(/unavailable/i)
    expect(wrapper.find('a[href="/play/session/current"]').exists()).toBe(true)
  })
})
