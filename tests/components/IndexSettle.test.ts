// @vitest-environment nuxt
import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import IndexPage from '../../app/pages/index.vue'

const ctl = vi.hoisted(() => ({ release: () => {} }))

mockNuxtImport('useFreeGames', () => () => ({ games: [{ id: 'voxide', title: 'VoXide', file: 'voxide.chd', sizeBytes: 1, author: 'a', year: 2026, genre: 'g', licence: 'MIT', sourceUrl: 'https://x' }] }))
mockNuxtImport('useCloudLibrary', () => () => ({
  status: ref('closed'),
  games: ref([]),
  restore: () => new Promise<void>((r) => (ctl.release = r)),
  coverUrl: async () => undefined,
  snapshot: async () => null,
}))
mockNuxtImport('useSharedLibraries', () => () => ({ libraries: ref([]), restore: async () => {} }))

describe('index page while a remembered library is opening', () => {
  it('keeps the library spot and hides the free games until it is settled, so taps cannot land on them', async () => {
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()
    expect(wrapper.find('[data-library-loading]').exists()).toBe(true)
    const below = wrapper.find('.below')
    expect(below.classes()).toContain('below--waiting')
    expect(below.attributes('inert')).toBeDefined()

    ctl.release()
    await flushPromises()
    expect(wrapper.find('[data-library-loading]').exists()).toBe(false)
    expect(wrapper.find('.below').classes()).not.toContain('below--waiting')
    expect(wrapper.find('.below').attributes('inert')).toBeUndefined()
    expect(wrapper.find('a[href="/play/free/voxide"]').exists()).toBe(true)
  })
})
