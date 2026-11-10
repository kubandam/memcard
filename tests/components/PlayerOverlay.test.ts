// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PlayerOverlay from '../../app/components/boot/PlayerOverlay.vue'

describe('PlayerOverlay', () => {
  it('starts hidden so the game starts clean, and comes up on a tap', async () => {
    const wrapper = await mountSuspended(PlayerOverlay, { props: {} })
    expect(wrapper.find('[data-player-overlay]').classes()).toContain('overlay--hidden')
    window.dispatchEvent(new Event('pointerdown'))
    await nextTick()
    expect(wrapper.find('[data-player-overlay]').classes()).not.toContain('overlay--hidden')
  })

  it('offers Fullscreen and the emulator menu where the browser supports it', async () => {
    const wrapper = await mountSuspended(PlayerOverlay, { props: {} })
    expect(wrapper.text()).toContain('Fullscreen')
    await wrapper.findAll('button').find((b) => b.text() === 'Menu')!.trigger('click')
    expect(wrapper.emitted('menu')).toHaveLength(1)
    expect(wrapper.find('[data-sound-blocked]').exists()).toBe(false)
  })

  it('hides Fullscreen on iPhone (no page fullscreen there)', async () => {
    const wrapper = await mountSuspended(PlayerOverlay, { props: { canFullscreen: false } })
    expect(wrapper.text()).not.toContain('Fullscreen')
    expect(wrapper.text()).toContain('Controls')
  })

  it('shows only "Tap for sound" while Safari holds the sound back', async () => {
    const wrapper = await mountSuspended(PlayerOverlay, { props: { soundBlocked: true } })
    const btn = wrapper.find('[data-sound-blocked]')
    expect(btn.text()).toBe('Tap for sound')
    expect(wrapper.find('[data-player-overlay]').classes()).toContain('overlay--hidden')
    await btn.trigger('click')
    expect(wrapper.emitted('sound')).toHaveLength(1)
  })

  it('shows save messages on their own', async () => {
    const wrapper = await mountSuspended(PlayerOverlay, { props: { saveNotice: 'Continue loaded' } })
    expect(wrapper.find('[role=status]').text()).toBe('Continue loaded')
  })
})
