// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../../server/utils/libraryStore'

describe('memory library store (contract shared with D1)', () => {
  it('creates once, then reports exists', async () => {
    const s = createMemoryStore()
    expect(await s.createLibrary('a', 'v')).toBe('created')
    expect(await s.createLibrary('a', 'v')).toBe('exists')
    expect((await s.getLibrary('a'))?.authVerifier).toBe('v')
    expect(await s.getLibrary('nope')).toBeNull()
  })
  it('tracks bytes per library and in total', async () => {
    const s = createMemoryStore()
    await s.createLibrary('a', 'v'); await s.createLibrary('b', 'v')
    await s.addObject('a', 'k1', 100); await s.addObject('b', 'k2', 50)
    expect((await s.getLibrary('a'))?.bytesUsed).toBe(100)
    expect(await s.totalBytes()).toBe(150)
    expect(await s.removeObject('a', 'k1')).toBe(100)
    expect(await s.removeObject('a', 'missing')).toBe(0)
    expect((await s.getLibrary('a'))?.bytesUsed).toBe(0)
    expect(await s.listObjects('b')).toEqual([{ key: 'k2', size: 50 }])
  })
  it('manifest etag and uploads', async () => {
    const s = createMemoryStore()
    await s.createLibrary('a', 'v')
    await s.setManifestEtag('a', 'e1')
    expect((await s.getLibrary('a'))?.manifestEtag).toBe('e1')
    await s.putUpload('u', 'a', 'k', 'up-1')
    expect(await s.getUpload('u')).toEqual({ libraryId: 'a', key: 'k', uploadId: 'up-1' })
    await s.deleteUpload('u')
    expect(await s.getUpload('u')).toBeNull()
  })
})
