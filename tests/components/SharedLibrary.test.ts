// @vitest-environment nuxt
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import SharedLibrary from '../../app/components/shelf/SharedLibrary.vue'

const shared = vi.hoisted(() => ({} as Record<string, unknown>))
mockNuxtImport('useSharedLibraries', () => () => shared)
const game = { id: 'g1', title: 'Spyro', kind: 'single', primaryName: 's.chd', files: [], sizeBytes: 100, createdAt: 1, lastPlayedAt: null, kGame: 'k' }

describe('SharedLibrary', () => {
  it('lists games with shared play links and a download action', async () => {
    Object.assign(shared, { progress: ref(null), downloadToLocal: vi.fn(async () => null), remove: vi.fn(), coverUrl: vi.fn(async () => undefined) })
    const w = await mountSuspended(SharedLibrary, { props: { library: { shareId: 'sid', code: 'MC-X', libraryId: 'lib', games: [game], status: 'ok' } } })
    expect(w.text()).toContain('Spyro')
    expect(w.find('a[href="/play/shared/g1?share=sid"]').exists()).toBe(true)
    expect(w.find('[data-download]').exists()).toBe(true)
  })

  it('revoked: shows the notice, no play links, Remove forgets it', async () => {
    Object.assign(shared, { progress: ref(null), downloadToLocal: vi.fn(), remove: vi.fn(async () => {}), coverUrl: vi.fn(async () => undefined) })
    const w = await mountSuspended(SharedLibrary, { props: { library: { shareId: 'sid', code: 'MC-X', libraryId: 'lib', games: [], status: 'revoked' } } })
    expect(w.text()).toMatch(/no longer valid/i)
    expect(w.find('a[href^="/play/shared/"]').exists()).toBe(false)
    await w.find('[data-remove-shared]').trigger('click')
    expect(shared.remove).toHaveBeenCalledWith('sid')
  })
})
