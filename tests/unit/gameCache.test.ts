// @vitest-environment node
import { IDBFactory, IDBKeyRange as FakeKeyRange } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { uploadObject } from '../../app/utils/cloudUpload'
import { DecryptError, downloadObject, type ObjectCache } from '../../app/utils/cloudDownload'
import { clearGameCache, createGameCache, gameCacheUsage } from '../../app/utils/gameCache'
import { __resetDbForTests, openDb } from '../../app/utils/localDb'
import { newGameKey, newObjectKey } from '../../shared/utils/chunkCrypto'
import { createFakeCloudApi } from './fakeCloudApi'

const MiB = 1024 * 1024
const blobOf = (n: number, seed = 1) => { const b = new Uint8Array(n); for (let i = 0; i < n; i += 997) b[i] = (i * seed) % 251; return b }
const noState = { saveState: async () => {}, clearState: async () => {}, libraryId: 'lib' }

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  globalThis.IDBKeyRange = FakeKeyRange as unknown as typeof IDBKeyRange
  __resetDbForTests()
})

async function stored(size: number, seed = 1) {
  const fake = createFakeCloudApi()
  const kGame = newGameKey()
  const objectKey = newObjectKey()
  const plain = blobOf(size, seed)
  const res = await uploadObject(fake.api, new Blob([plain]), kGame, objectKey, noState)
  const ranges: Array<[number, number]> = []
  const api = { getRange: async (k: string, s: number, e: number) => { ranges.push([s, e]); return fake.api.getRange(k, s, e) } }
  return { fake, api, ranges, kGame, plain, ref: { name: 'g.chd', size: res.size, objectKey, chunks: res.chunks } }
}

describe('downloadObject in parallel', () => {
  it('fetches parts concurrently and still returns the exact bytes', async () => {
    const { api, kGame, plain, ref } = await stored(70 * MiB)
    let inFlight = 0
    let peak = 0
    const slow = { getRange: async (k: string, s: number, e: number) => {
      inFlight++; peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      try { return await api.getRange(k, s, e) } finally { inFlight-- }
    } }
    const seen: number[] = []
    const back = await downloadObject(slow, ref, kGame, { concurrency: 4, onProgress: (p) => seen.push(p.done) })
    expect(Buffer.compare(Buffer.from(back), Buffer.from(plain))).toBe(0)
    expect(peak).toBe(4)
    expect(seen.at(-1)).toBe(70 * MiB)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
  })

  it('stops on the first failure', async () => {
    const { api, kGame, ref } = await stored(70 * MiB)
    let calls = 0
    const flaky = { getRange: async (k: string, s: number, e: number) => { if (++calls === 2) throw new Error('network'); return api.getRange(k, s, e) } }
    await expect(downloadObject(flaky, ref, kGame, { concurrency: 2 })).rejects.toThrow('network')
    expect(calls).toBeLessThan(5)
  })
})

describe('game cache', () => {
  it('second play reads every part from this PC, not the network', async () => {
    const { api, ranges, kGame, plain, ref } = await stored(40 * MiB)
    const cache = createGameCache('lib1')
    await downloadObject(api, ref, kGame, { cache })
    expect(ranges).toHaveLength(10)
    ranges.length = 0
    let network = -1
    const back = await downloadObject(api, ref, kGame, { cache, onProgress: (p) => (network = p.network) })
    expect(ranges).toHaveLength(0)
    expect(network).toBe(0)
    expect(Buffer.compare(Buffer.from(back), Buffer.from(plain))).toBe(0)
    expect(await gameCacheUsage()).toBeGreaterThan(40 * MiB)
  })

  it('stores only ciphertext', async () => {
    const { api, kGame, plain, ref } = await stored(5 * MiB, 7)
    await downloadObject(api, ref, kGame, { cache: createGameCache('lib1') })
    const db = await openDb()
    const parts = await db.getAll('cacheParts')
    expect(parts).toHaveLength(2)
    expect(Buffer.from(parts[0]!).includes(Buffer.from(plain.subarray(0, 4096)))).toBe(false)
  })

  it('a tampered cached part is detected, dropped and refetched', async () => {
    const { api, ranges, kGame, plain, ref } = await stored(20 * MiB)
    const cache = createGameCache('lib1')
    await downloadObject(api, ref, kGame, { cache })
    const db = await openDb()
    const key = (await db.getAllKeys('cacheParts'))[0]!
    const bad = (await db.get('cacheParts', key))!.slice()
    bad[100] ^= 1
    await db.put('cacheParts', bad, key)
    ranges.length = 0
    const back = await downloadObject(api, ref, kGame, { cache })
    expect(ranges.length).toBeGreaterThan(0)
    expect(Buffer.compare(Buffer.from(back), Buffer.from(plain))).toBe(0)
  })

  it('a cached part of the wrong object never decrypts as this one', async () => {
    const a = await stored(5 * MiB, 3)
    const cache = createGameCache('lib1')
    await downloadObject(a.api, a.ref, a.kGame, { cache })
    // Same object key, different game key: the cached ciphertext must fail and be replaced.
    const wrongKey = newGameKey()
    await expect(downloadObject({ getRange: async () => new Uint8Array(0) }, a.ref, wrongKey, { cache })).rejects.toBeInstanceOf(DecryptError)
  })

  it('evicts the least recently used games above the limit, never the one being played', async () => {
    let t = 0
    const cache = createGameCache('lib1', { limitBytes: 25 * MiB, now: () => ++t })
    const g1 = await stored(10 * MiB, 1)
    const g2 = await stored(10 * MiB, 2)
    const g3 = await stored(10 * MiB, 3)
    await downloadObject(g1.api, g1.ref, g1.kGame, { cache })
    await downloadObject(g2.api, g2.ref, g2.kGame, { cache })
    await downloadObject(g1.api, g1.ref, g1.kGame, { cache }) // g1 used again → g2 is oldest
    await downloadObject(g3.api, g3.ref, g3.kGame, { cache })
    const db = await openDb()
    const ids = (await db.getAll('cacheIndex')).map((e) => e.id).sort()
    expect(ids).toEqual([`lib1/${g1.ref.objectKey}`, `lib1/${g3.ref.objectKey}`].sort())
  })

  it('failures to write the cache never fail the download', async () => {
    const { api, kGame, plain, ref } = await stored(5 * MiB)
    const broken: ObjectCache = {
      getPart: async () => { throw new Error('x') },
      putPart: async () => {},
      dropObject: async () => {},
      finish: async () => {},
    }
    const safe = createGameCache('lib1')
    globalThis.indexedDB = undefined as unknown as IDBFactory
    __resetDbForTests()
    const back = await downloadObject(api, ref, kGame, { cache: safe })
    expect(back.length).toBe(plain.length)
    // A cache that throws from getPart is a bug in the cache; downloadObject surfaces it.
    await expect(downloadObject(api, ref, kGame, { cache: broken })).rejects.toThrow('x')
  })

  it('clearGameCache empties it', async () => {
    const { api, kGame, ref } = await stored(5 * MiB)
    await downloadObject(api, ref, kGame, { cache: createGameCache('lib1') })
    await clearGameCache()
    expect(await gameCacheUsage()).toBe(0)
  })
})
