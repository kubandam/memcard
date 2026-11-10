// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createStateSync } from '../../app/utils/stateSyncClient'
import { newGameKey } from '../../shared/utils/chunkCrypto'
import { createFakeCloudApi } from './fakeCloudApi'

const bytes = (n: number, len = 64) => new Uint8Array(len).fill(n)

describe('createStateSync', () => {
  it('saves state + screenshot encrypted and loads them back on another device', async () => {
    const f = createFakeCloudApi()
    const kGame = newGameKey()
    const a = createStateSync({ api: f.api, kGame, now: () => 500 })
    expect(await a.save({ state: bytes(1), screenshot: bytes(2, 8) })).toBe(true)
    expect([...f.blobs.keys()].map((k) => k.split(':')[0]).sort()).toEqual(['shot', 'state'])
    for (const v of f.blobs.values()) expect(Buffer.from(v).includes(Buffer.from(bytes(1)))).toBe(false)
    const b = createStateSync({ api: f.api, kGame })
    expect(await b.loadLatest()).toEqual(bytes(1))
    expect(await b.latestShot()).toEqual({ image: bytes(2, 8), updatedAt: 500 })
  })

  it('nothing saved yet: load gives null, shot gives null', async () => {
    const s = createStateSync({ api: createFakeCloudApi().api, kGame: newGameKey() })
    expect(await s.loadLatest()).toBeNull()
    expect(await s.latestShot()).toBeNull()
  })

  it('offline save reports false instead of throwing; a state for another game never loads', async () => {
    const f = createFakeCloudApi()
    const failing = { ...f.api, putBlob: vi.fn(async () => { throw new TypeError('Failed to fetch') }) }
    expect(await createStateSync({ api: failing, kGame: newGameKey() }).save({ state: bytes(1), screenshot: null })).toBe(false)
    const k1 = newGameKey()
    await createStateSync({ api: f.api, kGame: k1 }).save({ state: bytes(3), screenshot: null })
    // Copy game 1's state object under game 2's key: decryption must fail → null.
    const k2 = newGameKey()
    const { deriveStateKeys } = await import('../../shared/utils/saveSync')
    const s1 = await deriveStateKeys(k1)
    const s2 = await deriveStateKeys(k2)
    f.blobs.set(`state:${s2.stateKey}`, f.blobs.get(`state:${s1.stateKey}`)!)
    expect(await createStateSync({ api: f.api, kGame: k2 }).loadLatest()).toBeNull()
  })

  it('two quick saves: the second waits, latest wins, at most one upload at a time', async () => {
    const f = createFakeCloudApi()
    let inFlight = 0
    let maxInFlight = 0
    const slow = { ...f.api, putBlob: async (...a: Parameters<typeof f.api.putBlob>) => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 10)); await f.api.putBlob(...a); inFlight-- } }
    const kGame = newGameKey()
    const s = createStateSync({ api: slow, kGame })
    await Promise.all([s.save({ state: bytes(1), screenshot: null }), s.save({ state: bytes(2), screenshot: null })])
    expect(maxInFlight).toBe(1)
    expect(await createStateSync({ api: f.api, kGame }).loadLatest()).toEqual(bytes(2))
  })
})
