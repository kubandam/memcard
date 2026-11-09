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
    // The title sits under the cover as a real heading, not inside a tiny label.
    expect(wrapper.find('h3').text()).toBe('Magic Castle')
    // Each game gets its own accent colour.
    expect(wrapper.find('.tile').attributes('style')).toMatch(/--tile-accent:\s*hsl\(/)
  })

  it('shows the cover image when a URL is given', async () => {
    const wrapper = await mountSuspended(GameTile, {
      props: {
        game: { id: 'g1', title: 'X', source: 'local', kind: 'single', primaryName: 'x.chd', files: [], sizeBytes: 1, createdAt: 0, lastPlayedAt: null, coverBlobKey: 'c' },
        href: '/play/local/g1',
        coverUrl: 'blob:http://localhost/abc',
      },
    })
    expect(wrapper.find('img').attributes('src')).toBe('blob:http://localhost/abc')
  })
})
