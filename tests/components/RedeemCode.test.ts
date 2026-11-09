// @vitest-environment nuxt
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import RedeemCode from '../../app/components/shelf/RedeemCode.vue'

const shared = vi.hoisted(() => ({} as Record<string, unknown>))
mockNuxtImport('useSharedLibraries', () => () => shared)

const game = { id: 'g', title: 'Crash', kind: 'single', primaryName: 'c.chd', files: [], sizeBytes: 5e6, createdAt: 1, lastPlayedAt: null, kGame: 'k' }

describe('RedeemCode', () => {
  beforeEach(() => {
    Object.assign(shared, { progress: ref(null), redeem: vi.fn(), downloadToLocal: vi.fn(async () => ({ id: 'l' })) })
  })

  async function submit(w: Awaited<ReturnType<typeof mountSuspended>>, code: string) {
    await w.find('input[data-code]').setValue(code)
    await w.find('form[data-redeem]').trigger('submit')
    await flushPromises()
  }

  it('shows a format error for a malformed code', async () => {
    ;(shared.redeem as ReturnType<typeof vi.fn>).mockResolvedValue({ error: 'format' })
    const w = await mountSuspended(RedeemCode)
    await submit(w, 'MC-12')
    expect(w.find('[role=alert]').text()).toMatch(/look like a code/i)
  })

  it('shows "no longer valid" for a revoked code', async () => {
    ;(shared.redeem as ReturnType<typeof vi.fn>).mockResolvedValue({ error: 'invalid' })
    const w = await mountSuspended(RedeemCode)
    await submit(w, 'MC-AAAA-BBBB-CCCC-DDDD')
    expect(w.find('[role=alert]').text()).toMatch(/no longer valid|not valid/i)
  })

  it('game code: preview, then Download to My games', async () => {
    const res = { kind: 'game', game, code: 'MC-AAAA-BBBB-CCCC-DDDD', shareId: 's', libraryId: 'lib' }
    ;(shared.redeem as ReturnType<typeof vi.fn>).mockResolvedValue(res)
    const w = await mountSuspended(RedeemCode)
    await submit(w, 'MC-AAAA-BBBB-CCCC-DDDD')
    expect(w.text()).toContain('Crash')
    expect(w.text()).toContain('5 MB')
    await w.find('[data-download-shared]').trigger('click')
    await flushPromises()
    expect(shared.downloadToLocal).toHaveBeenCalledWith(res)
    expect(w.text()).toMatch(/added to my games/i)
    expect(w.emitted('downloaded')).toHaveLength(1)
  })

  it('library code: confirms it was added', async () => {
    ;(shared.redeem as ReturnType<typeof vi.fn>).mockResolvedValue({ kind: 'library', libraryId: 'lib', shareId: 's' })
    const w = await mountSuspended(RedeemCode)
    await submit(w, 'MC-AAAA-BBBB-CCCC-DDDD')
    expect(w.text()).toMatch(/shared library added/i)
  })
})
