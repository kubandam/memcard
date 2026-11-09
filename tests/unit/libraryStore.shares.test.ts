// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../../server/utils/libraryStore'

const row = (id: string, libraryId = 'a', gameId: string | null = null) => ({ id, libraryId, gameId, allowedKeys: gameId ? ['k1', 'k2'] : [], wrapped: new Uint8Array([1, 2, 3]) })

describe('shares in the store', () => {
  it('creates once, returns the row with bytes', async () => {
    let t = 1
    const s = createMemoryStore(() => t++)
    expect(await s.createShare(row('s1'))).toBe('created')
    expect(await s.createShare(row('s1'))).toBe('exists')
    const got = await s.getShare('s1')
    expect(got).toMatchObject({ id: 's1', libraryId: 'a', gameId: null, allowedKeys: [], revokedAt: null })
    expect([...got!.wrapped]).toEqual([1, 2, 3])
    expect(await s.getShare('nope')).toBeNull()
  })
  it('lists newest first without wrapped; revoke only within the library; count ignores revoked', async () => {
    let t = 1
    const s = createMemoryStore(() => t++)
    await s.createShare(row('s1'))
    await s.createShare(row('s2', 'a', 'g1'))
    await s.createShare(row('s3', 'b'))
    const list = await s.listShares('a')
    expect(list.map((x) => x.id)).toEqual(['s2', 's1'])
    expect(list[0]).not.toHaveProperty('wrapped')
    expect(list[0]!.allowedKeys).toEqual(['k1', 'k2'])
    expect(await s.revokeShare('b', 's1')).toBe(false)
    expect(await s.revokeShare('a', 's1')).toBe(true)
    expect(await s.revokeShare('a', 's1')).toBe(false)
    expect((await s.getShare('s1'))!.revokedAt).not.toBeNull()
    expect(await s.countActiveShares('a')).toBe(1)
  })
})
