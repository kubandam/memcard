// @vitest-environment nuxt
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CloudPanel from '../../app/components/shelf/CloudPanel.vue'

const cloud = vi.hoisted(() => ({
  open: vi.fn(async () => true),
  create: vi.fn(async () => ({ recoveryKey: 'MCKEY-abc' })),
}))

mockNuxtImport('useCloudLibrary', () => () => ({
  status: ref('closed'),
  notice: ref(null),
  open: cloud.open,
  create: cloud.create,
}))

describe('CloudPanel', () => {
  beforeEach(() => {
    cloud.open.mockClear()
    cloud.create.mockClear()
  })

  it('opens a library with the typed secret', async () => {
    const w = await mountSuspended(CloudPanel)
    await w.find('input[data-secret]').setValue('otter-pencil-river-mango-tulip')
    await w.find('form[data-open]').trigger('submit')
    expect(cloud.open).toHaveBeenCalledWith('otter-pencil-river-mango-tulip', { remember: false })
  })

  it('Stay open on this PC is passed to open and create', async () => {
    const w = await mountSuspended(CloudPanel)
    await w.find('input[data-secret]').setValue('otter-pencil-river-mango-tulip')
    await w.find('input[data-remember]').setValue(true)
    await w.find('form[data-open]').trigger('submit')
    expect(cloud.open).toHaveBeenCalledWith('otter-pencil-river-mango-tulip', { remember: true })
    await w.find('[data-start-create]').trigger('click')
    const phrase = w.find('[data-passphrase]').text()
    await w.find('input[data-invite]').setValue('i')
    await w.find('input[data-wrote]').setValue(true)
    await w.find('[data-create]').trigger('click')
    await flushPromises()
    expect(cloud.create).toHaveBeenCalledWith(phrase, 'i', { remember: true })
  })

  it('create flow: generated 5-word passphrase, must confirm it was written down, needs an invite', async () => {
    const w = await mountSuspended(CloudPanel)
    await w.find('[data-start-create]').trigger('click')
    const phrase = w.find('[data-passphrase]').text()
    expect(phrase.split('-')).toHaveLength(5)
    const submit = w.find('[data-create]')
    expect(submit.attributes('disabled')).toBeDefined()
    await w.find('input[data-invite]').setValue('my-invite')
    expect(w.find('[data-create]').attributes('disabled')).toBeDefined()
    await w.find('input[data-wrote]').setValue(true)
    expect(w.find('[data-create]').attributes('disabled')).toBeUndefined()
    await w.find('[data-create]').trigger('click')
    await flushPromises()
    expect(cloud.create).toHaveBeenCalledWith(phrase, 'my-invite', { remember: false })
    expect(w.text()).toContain('MCKEY-abc')
  })

  it('rejects a weak custom password', async () => {
    const w = await mountSuspended(CloudPanel)
    await w.find('[data-start-create]').trigger('click')
    await w.find('[data-own-password]').trigger('click')
    await w.find('input[data-custom]').setValue('abc123')
    expect(w.find('[data-weak]').exists()).toBe(true)
    await w.find('input[data-invite]').setValue('i')
    await w.find('input[data-wrote]').setValue(true)
    expect(w.find('[data-create]').attributes('disabled')).toBeDefined()
  })
})
