// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import GameTile from '../../app/components/shelf/GameTile.vue'

describe('GameTile', () => {
  it('renders title, size, last played and a plain link', async () => {
    const wrapper = await mountSuspended(GameTile, {
      props: {
        game: {
          id: 'g1',
          title: 'Magic Castle',
          source: 'local',
          kind: 'single',
          primaryName: 'Magic Castle.chd',
          files: [],
          sizeBytes: 1234567890,
          createdAt: 0,
          lastPlayedAt: null,
        },
        href: '/play/local/g1',
      },
    })
    expect(wrapper.text()).toContain('Magic Castle')
    expect(wrapper.text()).toContain('1.2 GB')
    expect(wrapper.text()).toContain('never')
    const link = wrapper.find('a')
    expect(link.attributes('href')).toBe('/play/local/g1')
  })
})
