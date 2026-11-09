// @vitest-environment nuxt
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import IssuedShares from '../../app/components/shelf/IssuedShares.vue'

const cloud = vi.hoisted(() => ({} as Record<string, unknown>))
mockNuxtImport('useCloudLibrary', () => () => cloud)

describe('IssuedShares', () => {
  it('lists codes with labels and revokes only after a second click', async () => {
    Object.assign(cloud, {
      issuedShares: ref([
        { id: 's1', kind: 'game', label: 'Crash', gameId: 'g', createdAt: Date.UTC(2026, 10, 9) },
        { id: 's2', kind: 'library', label: 'Whole library', gameId: null, createdAt: Date.UTC(2026, 10, 8) },
      ]),
      loadIssuedShares: vi.fn(async () => {}),
      revokeShare: vi.fn(async () => {}),
    })
    const w = await mountSuspended(IssuedShares)
    await flushPromises()
    expect(cloud.loadIssuedShares).toHaveBeenCalled()
    const rows = w.findAll('[data-share-row]')
    expect(rows.map((r) => r.text())).toEqual([expect.stringContaining('Crash'), expect.stringContaining('Whole library')])
    await rows[0]!.find('[data-revoke]').trigger('click')
    expect(cloud.revokeShare).not.toHaveBeenCalled()
    await w.findAll('[data-share-row]')[0]!.find('[data-revoke]').trigger('click')
    expect(cloud.revokeShare).toHaveBeenCalledWith('s1')
  })

  it('shows an empty state', async () => {
    Object.assign(cloud, { issuedShares: ref([]), loadIssuedShares: vi.fn(async () => {}), revokeShare: vi.fn() })
    const w = await mountSuspended(IssuedShares)
    expect(w.text()).toMatch(/no active codes/i)
  })
})
