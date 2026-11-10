// @vitest-environment nuxt
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import ContinueHero from '../../app/components/shelf/ContinueHero.vue'

const cloud = vi.hoisted(() => ({} as Record<string, unknown>))
mockNuxtImport('useCloudLibrary', () => () => cloud)

const game = (id: string, title: string, lastPlayedAt: number | null) => ({ id, title, kind: 'single', primaryName: 'x.chd', files: [], sizeBytes: 1, createdAt: 1, lastPlayedAt, kGame: 'k', coverObjectKey: undefined })

describe('ContinueHero', () => {
  beforeEach(() => {
    Object.assign(cloud, {
      games: ref([game('a', 'Spider-Man', Date.now() - 86_400_000), game('b', 'Crash Bandicoot 3: Warped', Date.now() - 7_200_000), game('c', 'Never', null)]),
      coverUrl: vi.fn(async () => 'blob:cover'),
      snapshot: vi.fn(async () => null),
    })
  })

  it('shows the most recently played game with a Play link when there is no snapshot', async () => {
    const w = await mountSuspended(ContinueHero)
    await flushPromises()
    expect(w.find('h2').text()).toBe('Crash Bandicoot 3: Warped')
    expect(w.find('a[data-continue]').attributes('href')).toBe('/play/cloud/b')
    expect(w.text()).toMatch(/2 hours ago/)
    expect(w.find('[data-hero-bg]').attributes('style')).toContain('blob:cover')
  })

  it('with a snapshot: Continue resumes from it, Start over plays fresh, background is the snapshot', async () => {
    ;(cloud.snapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ url: 'blob:shot', updatedAt: Date.UTC(2026, 10, 10, 21, 41) })
    const w = await mountSuspended(ContinueHero)
    await flushPromises()
    expect(w.find('a[data-continue]').attributes('href')).toBe('/play/cloud/b?resume=1')
    expect(w.find('a[data-start-over]').attributes('href')).toBe('/play/cloud/b')
    expect(w.find('[data-hero-bg]').attributes('style')).toContain('blob:shot')
  })

  it('renders nothing when no game has been played', async () => {
    ;(cloud.games as { value: unknown[] }).value = [game('c', 'Never', null)]
    const w = await mountSuspended(ContinueHero)
    expect(w.find('section').exists()).toBe(false)
  })
})
