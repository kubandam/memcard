// @vitest-environment nuxt
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import SettingsPage from '../../app/pages/settings.vue'

const cloudClose = vi.hoisted(() => vi.fn())
mockNuxtImport('useCloudLibrary', () => () => ({ close: cloudClose }))

const db = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  putBlob: vi.fn(async () => 'blob-key-1'),
  clearAll: vi.fn(async () => {}),
  deleteBlob: vi.fn(async () => {}),
}))

vi.mock('../../app/utils/localDb', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../app/utils/localDb')>()
  return {
    ...mod,
    putBlob: db.putBlob,
    deleteBlob: db.deleteBlob,
    clearAll: db.clearAll,
    getSetting: vi.fn(async (k: string) => db.settings.get(k)),
    setSetting: vi.fn(async (k: string, v: unknown) => void db.settings.set(k, v)),
    deleteSetting: vi.fn(async (k: string) => void db.settings.delete(k)),
    estimateStorage: vi.fn(async () => ({ usage: 2e9, quota: 10e9 })),
  }
})

describe('settings page', () => {
  beforeEach(() => {
    db.settings.clear()
    db.putBlob.mockClear()
    db.clearAll.mockClear()
  })

  it('picture style: shows the saved one and stores a new choice', async () => {
    db.settings.set('display.picture', 'crt')
    const wrapper = await mountSuspended(SettingsPage)
    await flushPromises()
    expect(wrapper.find('[data-picture=crt]').attributes('aria-pressed')).toBe('true')
    await wrapper.find('[data-picture=smooth]').trigger('click')
    await flushPromises()
    expect(db.settings.get('display.picture')).toBe('smooth')
    expect(wrapper.find('[data-picture=smooth]').attributes('aria-pressed')).toBe('true')
  })

  it('stores a BIOS file and shows its name', async () => {
    const wrapper = await mountSuspended(SettingsPage)
    await flushPromises()
    const input = wrapper.find('input[type=file]')
    const file = new File([new Uint8Array(8)], 'scph1001.bin')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()
    expect(db.putBlob).toHaveBeenCalledWith(file)
    expect(db.settings.get('bios')).toBe('blob-key-1')
    expect(db.settings.get('biosName')).toBe('scph1001.bin')
    expect(wrapper.text()).toContain('scph1001.bin')
  })

  it('clears local data only after a second click', async () => {
    const wrapper = await mountSuspended(SettingsPage)
    await flushPromises()
    const button = wrapper.find('[data-clear]')
    await button.trigger('click')
    expect(db.clearAll).not.toHaveBeenCalled()
    await wrapper.find('[data-clear]').trigger('click')
    await flushPromises()
    expect(db.clearAll).toHaveBeenCalledTimes(1)
    // The open online library in this tab is closed too (its key is in sessionStorage).
    expect(cloudClose).toHaveBeenCalled()
  })

  it('shows storage usage and default key help', async () => {
    const wrapper = await mountSuspended(SettingsPage)
    await flushPromises()
    expect(wrapper.text()).toContain('2 GB used of 10 GB')
    expect(wrapper.text()).toContain('Cross')
  })
})
