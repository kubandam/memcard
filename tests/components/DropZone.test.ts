// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import DropZone from '../../app/components/shelf/DropZone.vue'

describe('DropZone', () => {
  it('emits the picked files from the input', async () => {
    const wrapper = await mountSuspended(DropZone)
    const input = wrapper.find('input[type=file]')
    expect(input.attributes('multiple')).toBeDefined()
    expect(input.attributes('accept')).toContain('.chd')
    const file = new File(['x'], 'g.chd')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    expect(wrapper.emitted('files')).toEqual([[[file]]])
  })

  it('emits dropped files', async () => {
    const wrapper = await mountSuspended(DropZone)
    const file = new File(['x'], 'g.chd')
    await wrapper.find('[data-dropzone]').trigger('drop', { dataTransfer: { files: [file], items: [] } })
    expect(wrapper.emitted('files')).toEqual([[[file]]])
  })
})
