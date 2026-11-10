// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PlayerOverlay from '../../app/components/boot/PlayerOverlay.vue'

describe('PlayerOverlay', () => {
  it('offers Fullscreen where the browser supports it', async () => {
    const wrapper = await mountSuspended(PlayerOverlay, { props: {} })
    expect(wrapper.text()).toContain('Fullscreen')
    expect(wrapper.find('[data-sound-blocked]').exists()).toBe(false)
  })

  it('hides Fullscreen on iPhone (no page fullscreen there)', async () => {
    const wrapper = await mountSuspended(PlayerOverlay, { props: { canFullscreen: false } })
    expect(wrapper.text()).not.toContain('Fullscreen')
    expect(wrapper.text()).toContain('Controls')
  })

  it('stays visible with "Tap for sound" while Safari holds the sound back', async () => {
    const wrapper = await mountSuspended(PlayerOverlay, { props: { soundBlocked: true } })
    const btn = wrapper.find('[data-sound-blocked]')
    expect(btn.text()).toBe('Tap for sound')
    expect(wrapper.find('.overlay').classes()).not.toContain('overlay--hidden')
    await btn.trigger('click')
    expect(wrapper.emitted('sound')).toHaveLength(1)
  })
})
