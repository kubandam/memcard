// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../../server/utils/libraryStore'
import { createLibraryService, ServiceError, MAX_ACTIVE_SHARES } from '../../server/utils/libraryService'
import { createFakeR2 } from './fakeR2'

const MiB = 1024 * 1024
const K1 = 'abcdefghjkmnpqrstvwxyz0'
const K2 = 'abcdefghjkmnpqrstvwxyz1'
const S = (n: number) => `share${String(n).padStart(21, '0')}`
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof ServiceError ? e.status : `throw:${e}`))

async function setup() {
  let t = 1_000
  const store = createMemoryStore(() => t++)
  const r2 = createFakeR2()
  const svc = createLibraryService({ store, r2: r2.bucket as never, hardLimit: 100 * MiB, now: () => t })
  for (const lib of ['liba', 'libb']) {
    await store.createLibrary(lib, 'v')
    await svc.putManifest(lib, null, new Uint8Array([1]))
    for (const k of [K1, K2]) {
      const { uploadId } = await svc.createUpload(lib, k)
      const p = await svc.uploadPart(lib, k, uploadId, 1, new Uint8Array([9, 9]))
      await svc.completeUpload(lib, k, uploadId, [{ partNumber: 1, etag: p.etag }])
    }
  }
  return { store, svc }
}

describe('shares in the service', () => {
  it('library share reads the manifest and any object of its own library only', async () => {
    const { svc } = await setup()
    await svc.createShare('liba', { shareId: S(1), gameId: null, allowedKeys: [], wrapped: new Uint8Array([5]) })
    expect(await code(svc.authorizeShare(S(1), 'liba', { manifest: true }))).toBe('ok')
    expect(await code(svc.authorizeShare(S(1), 'liba', { key: K2 }))).toBe('ok')
    expect(await code(svc.authorizeShare(S(1), 'libb', { manifest: true }))).toBe(404)
    expect(await code(svc.authorizeShare(S(1), 'libb', { key: K1 }))).toBe(404)
  })

  it('game share reads only its own object keys and never the manifest', async () => {
    const { svc } = await setup()
    await svc.createShare('liba', { shareId: S(2), gameId: 'g1', allowedKeys: [K1], wrapped: new Uint8Array([5]) })
    expect(await code(svc.authorizeShare(S(2), 'liba', { key: K1 }))).toBe('ok')
    expect(await code(svc.authorizeShare(S(2), 'liba', { key: K2 }))).toBe(404)
    expect(await code(svc.authorizeShare(S(2), 'liba', { manifest: true }))).toBe(404)
  })

  it('lookup returns library, game and wrapped; revoked or unknown is 404 everywhere', async () => {
    const { svc } = await setup()
    await svc.createShare('liba', { shareId: S(3), gameId: 'g1', allowedKeys: [K1], wrapped: new Uint8Array([5, 6]) })
    const got = await svc.lookupShare(S(3))
    expect(got.libraryId).toBe('liba')
    expect(got.gameId).toBe('g1')
    expect([...got.wrapped]).toEqual([5, 6])
    expect(await code(svc.revokeShare('libb', S(3)))).toBe(404)
    await svc.revokeShare('liba', S(3))
    expect(await code(svc.lookupShare(S(3)))).toBe(404)
    expect(await code(svc.authorizeShare(S(3), 'liba', { key: K1 }))).toBe(404)
    expect(await code(svc.lookupShare(S(99)))).toBe(404)
  })

  it('caps active shares per library and refuses duplicates', async () => {
    const { svc } = await setup()
    for (let i = 0; i < MAX_ACTIVE_SHARES; i++) await svc.createShare('liba', { shareId: S(100 + i), gameId: null, allowedKeys: [], wrapped: new Uint8Array([1]) })
    expect(await code(svc.createShare('liba', { shareId: S(999), gameId: null, allowedKeys: [], wrapped: new Uint8Array([1]) }))).toBe(429)
    await svc.revokeShare('liba', S(100))
    expect(await code(svc.createShare('liba', { shareId: S(100), gameId: null, allowedKeys: [], wrapped: new Uint8Array([1]) }))).toBe(409)
  })

  it('lists active and revoked shares newest first, without wrapped', async () => {
    const { svc } = await setup()
    await svc.createShare('liba', { shareId: S(1), gameId: null, allowedKeys: [], wrapped: new Uint8Array([1]) })
    await svc.createShare('liba', { shareId: S(2), gameId: 'g', allowedKeys: [K1], wrapped: new Uint8Array([1]) })
    await svc.revokeShare('liba', S(1))
    const list = await svc.listShares('liba')
    expect(list.map((x) => [x.id, x.gameId, x.revokedAt !== null])).toEqual([[S(2), 'g', false], [S(1), null, true]])
    expect(list[0]).not.toHaveProperty('wrapped')
  })
})
