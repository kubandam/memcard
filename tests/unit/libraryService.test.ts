// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../../server/utils/libraryStore'
import { createLibraryService, ServiceError } from '../../server/utils/libraryService'
import { createFakeR2 } from './fakeR2'

const MiB = 1024 * 1024
const K1 = 'abcdefghjkmnpqrstvwxyz0'
const K2 = 'abcdefghjkmnpqrstvwxyz1'

async function setup(hardLimit = 100 * MiB) {
  const store = createMemoryStore()
  const r2 = createFakeR2()
  const svc = createLibraryService({ store, r2: r2.bucket as never, hardLimit })
  await store.createLibrary('liba', 'v')
  await store.createLibrary('libb', 'v')
  return { store, r2, svc }
}

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof ServiceError ? e.status : `throw:${e}`))

describe('manifest compare-and-swap', () => {
  it('first write needs no etag; later writes need the current one; a stale writer gets 412 and changes nothing', async () => {
    const { svc } = await setup()
    expect(await svc.getManifest('liba')).toBeNull()
    const e1 = await svc.putManifest('liba', null, new Uint8Array([1]))
    expect(await code(svc.putManifest('liba', null, new Uint8Array([9])))).toBe(412)
    const e2 = await svc.putManifest('liba', e1, new Uint8Array([2]))
    expect(await code(svc.putManifest('liba', e1, new Uint8Array([3])))).toBe(412)
    const m = await svc.getManifest('liba')
    expect([...m!.bytes]).toEqual([2])
    expect(m!.etag).toBe(e2)
  })

  it('two concurrent writers with the same etag: exactly one wins', async () => {
    const { svc } = await setup()
    const e1 = await svc.putManifest('liba', null, new Uint8Array([1]))
    const results = await Promise.all([code(svc.putManifest('liba', e1, new Uint8Array([2]))), code(svc.putManifest('liba', e1, new Uint8Array([3])))])
    expect(results.sort()).toEqual([412, 'ok'])
  })

  it('keeps only the current manifest version in R2', async () => {
    const { svc, r2 } = await setup()
    let e = await svc.putManifest('liba', null, new Uint8Array([1]))
    e = await svc.putManifest('liba', e, new Uint8Array([2]))
    await svc.putManifest('liba', e, new Uint8Array([3]))
    expect([...r2.objects.keys()].filter((k) => k.includes('/manifest'))).toHaveLength(1)
  })
})

describe('multipart objects', () => {
  it('an upload id from another library or key is refused', async () => {
    const { svc } = await setup()
    const { uploadId } = await svc.createUpload('liba', K1)
    expect(await code(svc.uploadPart('libb', K1, uploadId, 1, new Uint8Array(10)))).toBe(404)
    expect(await code(svc.uploadPart('liba', K2, uploadId, 1, new Uint8Array(10)))).toBe(404)
    expect(await code(svc.abortUpload('liba', K2, uploadId))).toBe(404)
  })

  it('quota is enforced on the real stored size, not the size the client claims', async () => {
    const { svc, store, r2 } = await setup(8 * MiB)
    const { uploadId } = await svc.createUpload('liba', K1)
    expect(await code(svc.uploadPart('liba', K1, uploadId, 1, new Uint8Array(10 * MiB)))).toBe(413)
    const p = await svc.uploadPart('liba', K1, uploadId, 1, new Uint8Array(6 * MiB))
    // Another library fills the space between our last part and complete.
    await store.addObject('libb', K2, 4 * MiB)
    expect(await code(svc.completeUpload('liba', K1, uploadId, [{ partNumber: 1, etag: p.etag }]))).toBe(413)
    expect(r2.objects.has('lib/liba/obj/' + K1)).toBe(false)
    expect((await store.getLibrary('liba'))!.bytesUsed).toBe(0)
  })

  it('bytes in unfinished uploads count toward the quota', async () => {
    const { svc } = await setup(12 * MiB)
    const a = await svc.createUpload('liba', K1)
    await svc.uploadPart('liba', K1, a.uploadId, 1, new Uint8Array(8 * MiB))
    const b = await svc.createUpload('liba', K2)
    expect(await code(svc.uploadPart('liba', K2, b.uploadId, 1, new Uint8Array(8 * MiB)))).toBe(413)
    // Aborting frees the reserved bytes.
    await svc.abortUpload('liba', K1, a.uploadId)
    expect(await code(svc.uploadPart('liba', K2, b.uploadId, 1, new Uint8Array(8 * MiB)))).toBe('ok')
  })

  it('limits how many uploads a library can have open at once', async () => {
    const { svc } = await setup()
    for (let i = 0; i < 8; i++) await svc.createUpload('liba', `abcdefghjkmnpqrstvwxy${String(i).padStart(2, '0')}`)
    expect(await code(svc.createUpload('liba', 'abcdefghjkmnpqrstvwxy99'))).toBe(429)
    expect(await code(svc.createUpload('libb', K1))).toBe('ok')
  })

  it('refuses part numbers that could never fit the quota', async () => {
    const { svc } = await setup(32 * MiB)
    const { uploadId } = await svc.createUpload('liba', K1)
    expect(await code(svc.uploadPart('liba', K1, uploadId, 3, new Uint8Array(10)))).toBe(413)
  })

  it('a part for an upload R2 no longer knows returns 404 (so the client can restart)', async () => {
    const { svc, r2 } = await setup()
    const { uploadId } = await svc.createUpload('liba', K1)
    r2.mpus.clear()
    expect(await code(svc.uploadPart('liba', K1, uploadId, 1, new Uint8Array(10)))).toBe(404)
  })

  it('completes, counts bytes, serves ranges, rejects bad ranges with 416, deletes', async () => {
    const { svc, store } = await setup()
    const { uploadId } = await svc.createUpload('liba', K1)
    const p = await svc.uploadPart('liba', K1, uploadId, 1, new Uint8Array([1, 2, 3, 4, 5]))
    expect(await svc.completeUpload('liba', K1, uploadId, [{ partNumber: 1, etag: p.etag }])).toEqual({ size: 5 })
    expect((await store.getLibrary('liba'))!.bytesUsed).toBe(5)
    const r = await svc.getObject('liba', K1, { start: 1, end: 3 })
    expect([...(r.body as Uint8Array)]).toEqual([2, 3, 4])
    expect(r.contentRange).toBe('bytes 1-3/5')
    expect(await code(svc.getObject('liba', K1, { start: 4, end: 2 }))).toBe(416)
    expect(await code(svc.getObject('liba', K1, { start: 9, end: 12 }))).toBe(416)
    expect(await svc.objectSize('liba', K1)).toBe(5)
    await svc.deleteObject('liba', K1)
    expect(await svc.objectSize('liba', K1)).toBeNull()
    expect((await store.getLibrary('liba'))!.bytesUsed).toBe(0)
  })
})
