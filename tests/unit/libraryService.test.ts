// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../../server/utils/libraryStore'
import { createLibraryService, MAX_SAVES, ServiceError } from '../../server/utils/libraryService'
import { createFakeR2 } from './fakeR2'

const MiB = 1024 * 1024
const K1 = 'abcdefghjkmnpqrstvwxyz0'
const K2 = 'abcdefghjkmnpqrstvwxyz1'

async function setup(hardLimit = 100 * MiB, libraryLimit = hardLimit, now = () => Date.now()) {
  const store = createMemoryStore(now)
  const r2 = createFakeR2()
  const svc = createLibraryService({ store, r2: r2.bucket as never, hardLimit, libraryLimit, now })
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

  it('re-sending the same part replaces its reservation instead of adding to it', async () => {
    const { svc } = await setup(20 * MiB)
    const { uploadId } = await svc.createUpload('liba', K1)
    for (let i = 0; i < 5; i++) await svc.uploadPart('liba', K1, uploadId, 1, new Uint8Array(8 * MiB))
    const b = await svc.createUpload('liba', K2)
    expect(await code(svc.uploadPart('liba', K2, b.uploadId, 1, new Uint8Array(8 * MiB)))).toBe('ok')
  })

  it('one library cannot use more than its own limit, leaving space for others', async () => {
    const { svc } = await setup(100 * MiB, 10 * MiB)
    const a = await svc.createUpload('liba', K1)
    await svc.uploadPart('liba', K1, a.uploadId, 1, new Uint8Array(8 * MiB))
    const a2 = await svc.createUpload('liba', K2)
    expect(await code(svc.uploadPart('liba', K2, a2.uploadId, 1, new Uint8Array(8 * MiB)))).toBe(413)
    const b = await svc.createUpload('libb', K1)
    expect(await code(svc.uploadPart('libb', K1, b.uploadId, 1, new Uint8Array(8 * MiB)))).toBe('ok')
  })

  it('uploads older than R2 multipart expiry stop counting and are cleaned up', async () => {
    let t = 1_000_000
    const { svc, store } = await setup(12 * MiB, 12 * MiB, () => t)
    for (let i = 0; i < 8; i++) {
      const key = `abcdefghjkmnpqrstvwxy${String(i).padStart(2, '0')}`
      const u = await svc.createUpload('liba', key)
      if (i === 0) await svc.uploadPart('liba', key, u.uploadId, 1, new Uint8Array(8 * MiB))
    }
    t += 8 * 24 * 3600 * 1000
    const fresh = await svc.createUpload('liba', K1)
    expect(await code(svc.uploadPart('liba', K1, fresh.uploadId, 1, new Uint8Array(8 * MiB)))).toBe('ok')
    expect(await store.openUploads('liba', t - 7 * 24 * 3600 * 1000)).toBe(1)
  })

  it('an upload past the expiry window is refused (and aborted) instead of taking uncounted parts', async () => {
    let t = 1_000_000
    const { svc, r2 } = await setup(100 * MiB, 100 * MiB, () => t)
    const { uploadId } = await svc.createUpload('liba', K1)
    t += 8 * 24 * 3600 * 1000
    expect(await code(svc.uploadPart('liba', K1, uploadId, 1, new Uint8Array(10)))).toBe(404)
    expect(r2.mpus.has(uploadId)).toBe(false)
    expect(await code(svc.completeUpload('liba', K1, uploadId, [{ partNumber: 1, etag: 'x' }]))).toBe(404)
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

describe('blob kinds (save / state / shot)', () => {
  const SK = 'abcdefghjkmnpqrstvwxyz8'
  it('stores kinds side by side with per-kind size limits', async () => {
    const { svc, store, r2 } = await setup(100 * MiB)
    await svc.putBlob('liba', 'state', SK, new Uint8Array(5 * MiB))
    await svc.putBlob('liba', 'shot', SK, new Uint8Array(10))
    await svc.putBlob('liba', 'save', SK, new Uint8Array(20))
    expect((await svc.getBlob('liba', 'state', SK)).length).toBe(5 * MiB)
    expect(r2.objects.has(`lib/liba/state/${SK}`)).toBe(true)
    expect(r2.objects.has(`lib/liba/save/${SK}`)).toBe(true)
    expect((await store.getLibrary('liba'))!.bytesUsed).toBe(5 * MiB + 30)
    expect(await code(svc.putBlob('liba', 'save', SK, new Uint8Array(MiB + 1)))).toBe(400)
    expect(await code(svc.putBlob('liba', 'state', SK, new Uint8Array(33 * MiB)))).toBe(400)
    await svc.deleteBlob('liba', 'state', SK)
    expect(await code(svc.getBlob('liba', 'state', SK))).toBe(404)
  })
})

describe('saves', () => {
  const SK = 'abcdefghjkmnpqrstvwxyz9'
  it('put/get/overwrite counts the size once; delete frees it; missing is 404', async () => {
    const { svc, store } = await setup()
    expect(await code(svc.getSave('liba', SK))).toBe(404)
    await svc.putSave('liba', SK, new Uint8Array(100))
    await svc.putSave('liba', SK, new Uint8Array(150))
    expect([...(await svc.getSave('liba', SK))].length).toBe(150)
    expect((await store.getLibrary('liba'))!.bytesUsed).toBe(150)
    expect(await code(svc.getSave('libb', SK))).toBe(404)
    await svc.deleteSave('liba', SK)
    expect(await code(svc.getSave('liba', SK))).toBe(404)
    expect((await store.getLibrary('liba'))!.bytesUsed).toBe(0)
  })
  it('re-checks the quota after writing (concurrent writers) and caps the number of saves', async () => {
    const { svc, store, r2 } = await setup(2 * MiB)
    // Simulate another writer filling the space between our check and our write.
    const realPut = r2.bucket.put.bind(r2.bucket)
    r2.bucket.put = async (k: string, b: Uint8Array) => { await store.addObject('libb', 'other', 2 * MiB); return realPut(k, b) }
    expect(await code(svc.putSave('liba', SK, new Uint8Array(100)))).toBe(413)
    expect([...r2.objects.keys()].some((k) => k.includes('/save/'))).toBe(false)
    expect((await store.getLibrary('liba'))!.bytesUsed).toBe(0)
  })

  it('caps how many saves one library holds', async () => {
    const { svc } = await setup()
    for (let i = 0; i < MAX_SAVES; i++) await svc.putSave('liba', `abcdefghjkmnpqrstv${String(i).padStart(5, '0')}`, new Uint8Array(1))
    expect(await code(svc.putSave('liba', 'abcdefghjkmnpqrstvzzzzz', new Uint8Array(1)))).toBe(429)
    expect(await code(svc.putSave('liba', 'abcdefghjkmnpqrstv00000', new Uint8Array(2)))).toBe('ok')
  }, 30_000)

  it('refuses empty or oversized saves and respects the quota', async () => {
    const { svc } = await setup(2 * MiB)
    expect(await code(svc.putSave('liba', SK, new Uint8Array(0)))).toBe(400)
    expect(await code(svc.putSave('liba', SK, new Uint8Array(MiB + 1)))).toBe(400)
    const { uploadId } = await svc.createUpload('liba', K1)
    const p = await svc.uploadPart('liba', K1, uploadId, 1, new Uint8Array(2 * MiB - 10))
    await svc.completeUpload('liba', K1, uploadId, [{ partNumber: 1, etag: p.etag }])
    expect(await code(svc.putSave('liba', SK, new Uint8Array(100)))).toBe(413)
  })
})
