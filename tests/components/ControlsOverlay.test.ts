// @vitest-environment nuxt
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ControlsOverlay from '../../app/components/boot/ControlsOverlay.vue'

const mapping = [{ button: 'Cross', key: 'x' }, { button: 'Start', key: 'enter' }]

afterEach(() => vi.unstubAllGlobals())

describe('ControlsOverlay', () => {
  it('keyboard tab: one row per binding; Escape closes', async () => {
    const wrapper = await mountSuspended(ControlsOverlay, { props: { open: true, mapping, rightStick: 'l2r2' } })
    await wrapper.find('[data-tab=keyboard]').trigger('click')
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('Cross')
    expect(rows[0]!.text()).toContain('x')
    await wrapper.find('[role=dialog]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('controller tab (default): layout, connected pad name, right-stick choice', async () => {
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [null, { id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)' }],
    })
    const wrapper = await mountSuspended(ControlsOverlay, { props: { open: true, mapping, rightStick: 'l2r2' } })
    expect(wrapper.find('[data-pad-status]').text()).toBe('DualSense Wireless Controller connected')
    expect(wrapper.text()).toContain('✕ Cross')
    expect(wrapper.find('[data-right-stick=l2r2]').attributes('aria-pressed')).toBe('true')
    await wrapper.find('[data-right-stick=l1r1]').trigger('click')
    expect(wrapper.emitted('update:rightStick')).toEqual([['l1r1']])
  })

  it('says when no controller is connected', async () => {
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [null, null] })
    const wrapper = await mountSuspended(ControlsOverlay, { props: { open: true, mapping, rightStick: 'off' } })
    expect(wrapper.find('[data-pad-status]').text()).toMatch(/No controller yet/)
  })

  it('renders nothing when closed', async () => {
    const wrapper = await mountSuspended(ControlsOverlay, { props: { open: false, mapping: [], rightStick: 'l2r2' } })
    expect(wrapper.find('[role=dialog]').exists()).toBe(false)
  })
})
