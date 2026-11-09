// @vitest-environment nuxt
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import type { LocalGame } from '../../shared/types/game'
import CloudLibrary from '../../app/components/shelf/CloudLibrary.vue'

const local = (id: string, title: string, sizeBytes: number): LocalGame => ({ id, title, source: 'local', kind: 'single', primaryName: `${title}.chd`, files: [], sizeBytes, createdAt: 1, lastPlayedAt: null })

const cloud = vi.hoisted(() => ({} as Record<string, unknown>))
const lib = vi.hoisted(() => ({ games: [] as unknown[] }))

mockNuxtImport('useCloudLibrary', () => () => cloud)
vi.mock('../../app/utils/localDb', async (orig) => ({ ...(await orig<object>()), listGames: vi.fn(async () => lib.games) }))

describe('CloudLibrary', () => {
  beforeEach(() => {
    Object.assign(cloud, {
      recoveryKey: ref(null),
      games: ref([{ id: 'c1', title: 'Crash', kind: 'single', primaryName: 'c.chd', files: [], sizeBytes: 100, createdAt: 1, lastPlayedAt: null, kGame: 'k' }]),
      usage: ref({ bytesUsed: 2e9, softLimit: 8 * 1024 ** 3, hardLimit: 9 * 1024 ** 3 }),
      uploadProgress: ref(null),
      notice: ref(null),
      close: vi.fn(),
      uploadGame: vi.fn(async () => {}),
      deleteGame: vi.fn(async () => {}),
      renameGame: vi.fn(async () => {}),
      resumeUploads: vi.fn(async () => {}),
      coverUrl: vi.fn(async () => undefined),
      isInCloud: (g: LocalGame) => g.title === 'Crash' && g.sizeBytes === 100,
      downloadToLocal: vi.fn(async () => local('l9', 'Spyro', 200)),
      downloadProgress: ref(null),
      shareGame: vi.fn(async () => 'MC-AAAA-BBBB-CCCC-DDDD'),
      shareLibrary: vi.fn(async () => 'MC-LLLL-BBBB-CCCC-DDDD'),
      issuedShares: ref([]),
      loadIssuedShares: vi.fn(async () => {}),
      revokeShare: vi.fn(async () => {}),
    })
    lib.games = [local('l1', 'Crash', 100), local('l2', 'Spyro', 200)]
  })

  it('shows the recovery key right after creation until dismissed', async () => {
    ;(cloud.recoveryKey as { value: unknown }).value = 'MCKEY-xyz'
    const w = await mountSuspended(CloudLibrary)
    expect(w.text()).toContain('MCKEY-xyz')
    await w.find('[data-recovery-done]').trigger('click')
    expect((cloud.recoveryKey as { value: unknown }).value).toBeNull()
  })

  it('lists cloud games with play links and the space used', async () => {
    const w = await mountSuspended(CloudLibrary)
    expect(w.text()).toContain('Crash')
    expect(w.find('a[href="/play/cloud/c1"]').exists()).toBe(true)
    expect(w.text()).toMatch(/2 GB used of 8\.6 GB/)
  })

  it('upload picker offers only local games not yet online and uploads the chosen one', async () => {
    const w = await mountSuspended(CloudLibrary)
    await w.find('[data-open-upload]').trigger('click')
    await flushPromises()
    const options = w.findAll('[data-upload-candidate]')
    expect(options.map((o) => o.text())).toEqual([expect.stringContaining('Spyro')])
    await options[0]!.trigger('click')
    expect(cloud.uploadGame).toHaveBeenCalledWith(expect.objectContaining({ id: 'l2' }))
  })

  it('marks games already in My games and downloads the others', async () => {
    ;(cloud.games as { value: unknown[] }).value.push({ id: 'c2', title: 'Spyro', kind: 'single', primaryName: 's.chd', files: [], sizeBytes: 999, createdAt: 1, lastPlayedAt: null, kGame: 'k' })
    const w = await mountSuspended(CloudLibrary)
    await flushPromises()
    const tiles = w.findAll('.tile')
    expect(tiles[0]!.text()).toMatch(/in my games/i)
    const btn = tiles[1]!.find('[data-download]')
    await btn.trigger('click')
    expect(cloud.downloadToLocal).toHaveBeenCalledWith('c2')
  })

  it('Share on a tile creates a game code and shows it', async () => {
    const w = await mountSuspended(CloudLibrary)
    await w.find('.tile [data-share]').trigger('click')
    await flushPromises()
    expect(cloud.shareGame).toHaveBeenCalledWith('c1')
    expect(w.find('[data-share-code]').text()).toBe('MC-AAAA-BBBB-CCCC-DDDD')
    expect(w.text()).toMatch(/download this game/i)
  })

  it('Share library shows a library code and warns it includes games added later', async () => {
    const w = await mountSuspended(CloudLibrary)
    await w.find('[data-share-library]').trigger('click')
    await flushPromises()
    expect(w.find('[data-share-code]').text()).toBe('MC-LLLL-BBBB-CCCC-DDDD')
    expect(w.text()).toMatch(/you add later/i)
  })

  it('resumes interrupted uploads when shown', async () => {
    await mountSuspended(CloudLibrary)
    expect(cloud.resumeUploads).toHaveBeenCalled()
  })
})
