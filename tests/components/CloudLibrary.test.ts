// @vitest-environment nuxt
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CloudLibrary from '../../app/components/shelf/CloudLibrary.vue'

const cloud = vi.hoisted(() => ({ recoveryKey: null as unknown, games: null as unknown, close: () => {} }))

mockNuxtImport('useCloudLibrary', () => () => cloud)

describe('CloudLibrary', () => {
  it('shows the recovery key right after creation until dismissed', async () => {
    cloud.recoveryKey = ref('MCKEY-xyz')
    cloud.games = ref([])
    const w = await mountSuspended(CloudLibrary)
    expect(w.text()).toContain('MCKEY-xyz')
    await w.find('[data-recovery-done]').trigger('click')
    expect((cloud.recoveryKey as { value: unknown }).value).toBeNull()
    expect(w.text()).not.toContain('MCKEY-xyz')
  })
})
