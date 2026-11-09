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
}))

vi.mock('../../app/utils/localDb', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../app/utils/localDb')>()
  return {
    ...mod,
    listGames: vi.fn(async () => state.games),
    addGame: state.addGame,
    estimateStorage: vi.fn(async () => ({ usage: 1.2e9, quota: 40e9 })),
    requestPersist: vi.fn(async () => true),
  }
})

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
    expect(wrapper.find('[role=status]').text()).toMatch(/memory/i)
    expect(state.addGame).toHaveBeenCalledTimes(1)
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
