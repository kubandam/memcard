// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ControlsOverlay from '../../app/components/boot/ControlsOverlay.vue'

describe('ControlsOverlay', () => {
  it('renders one row per binding and closes on Escape', async () => {
    const wrapper = await mountSuspended(ControlsOverlay, {
      props: { open: true, mapping: [{ button: 'Cross', key: 'x' }, { button: 'Start', key: 'enter' }] },
    })
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('Cross')
    expect(rows[0]!.text()).toContain('x')
    await wrapper.find('[role=dialog]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('renders nothing when closed', async () => {
    const wrapper = await mountSuspended(ControlsOverlay, { props: { open: false, mapping: [] } })
    expect(wrapper.find('[role=dialog]').exists()).toBe(false)
  })
})
