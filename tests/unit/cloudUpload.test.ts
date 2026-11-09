// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PART_SIZE, ResumeMismatchError, uploadObject, type UploadState } from '../../app/utils/cloudUpload'
import { DecryptError, downloadObject } from '../../app/utils/cloudDownload'
import { encryptedSize, newGameKey, newObjectKey } from '../../shared/utils/chunkCrypto'
import { createFakeCloudApi } from './fakeCloudApi'

const MiB = 1024 * 1024
const blobOf = (n: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i += 4096) b[i] = i % 251; return b }
const sha = async (b: Uint8Array) => Buffer.from(await crypto.subtle.digest('SHA-256', b)).toString('hex')
const noState = { saveState: async () => {}, clearState: async () => {}, libraryId: 'lib' }

describe('uploadObject / downloadObject', () => {
  it('uploads 9 MiB as one encrypted part and downloads the same bytes', async () => {
    const { api, objects, calls } = createFakeCloudApi()
    const kGame = newGameKey(); const key = newObjectKey()
    const plain = blobOf(9 * MiB)
    const states: UploadState[] = []
    const res = await uploadObject(api, new Blob([plain]), kGame, key, { ...noState, saveState: async (s) => void states.push(structuredClone(s)) })
    expect(res).toEqual({ objectKey: key, chunks: 3, size: 9 * MiB })
    expect(calls.uploadPart).toEqual([1])
    expect(objects.get(key)!.length).toBe(encryptedSize(9 * MiB))
    expect(states.at(-1)!.parts).toHaveLength(1)
    const back = await downloadObject(api, { name: 'x', size: 9 * MiB, objectKey: key, chunks: 3 }, kGame)
    expect(await sha(back)).toBe(await sha(plain))
  })

  it('resumes: skips parts already uploaded and yields identical ciphertext', async () => {
    const plain = blobOf(40 * MiB)
    const kGame = newGameKey(); const key = newObjectKey()
    const fresh = createFakeCloudApi()
    await uploadObject(fresh.api, new Blob([plain]), kGame, key, noState)

    const resumed = createFakeCloudApi()
    let state: UploadState | undefined
    // First attempt dies after part 1.
    let n = 0
    const flaky = { ...resumed.api, uploadPart: async (...a: Parameters<typeof resumed.api.uploadPart>) => { if (++n === 2) throw new Error('network'); return resumed.api.uploadPart(...a) } }
    await expect(uploadObject(flaky, new File([plain], 'p.bin', { lastModified: 7 }), kGame, key, { ...noState, saveState: async (s) => void (state = structuredClone(s)) })).rejects.toThrow('network')
    expect(state!.parts.map((p) => p.partNumber)).toEqual([1])
    resumed.calls.uploadPart.length = 0
    await uploadObject(resumed.api, new File([plain], 'p.bin', { lastModified: 7 }), kGame, key, { ...noState, resume: state })
    expect(resumed.calls.uploadPart).toEqual([2, 3])
    expect(await sha(resumed.objects.get(key)!)).toBe(await sha(fresh.objects.get(key)!))
  })

  it('refuses to resume with a different file (would reuse key + nonce on new plaintext)', async () => {
    const { api } = createFakeCloudApi()
    const kGame = newGameKey(); const key = newObjectKey()
    const original = new File([blobOf(20 * MiB)], 'a.bin', { lastModified: 1000 })
    const state: UploadState = { id: 's', libraryId: 'lib', objectKey: key, uploadId: 'u1', parts: [{ partNumber: 1, etag: 'p1' }], fileName: 'a.bin', fileSize: original.size, fileLastModified: 1000 }
    const otherSize = new File([blobOf(21 * MiB)], 'a.bin', { lastModified: 1000 })
    const otherTime = new File([blobOf(20 * MiB)], 'a.bin', { lastModified: 2000 })
    await expect(uploadObject(api, otherSize, kGame, key, { ...noState, resume: state })).rejects.toBeInstanceOf(ResumeMismatchError)
    await expect(uploadObject(api, otherTime, kGame, key, { ...noState, resume: state })).rejects.toBeInstanceOf(ResumeMismatchError)
    await expect(uploadObject(api, original, kGame, newObjectKey(), { ...noState, resume: state })).rejects.toBeInstanceOf(ResumeMismatchError)
  })

  it('resume whose multipart upload the server forgot restarts and yields the same ciphertext', async () => {
    const plain = blobOf(20 * MiB)
    const file = () => new File([plain], 'r.bin', { lastModified: 3 })
    const kGame = newGameKey(); const key = newObjectKey()
    const fresh = createFakeCloudApi()
    await uploadObject(fresh.api, file(), kGame, key, noState)
    const { api, objects } = createFakeCloudApi()
    const stale: UploadState = { id: 's', libraryId: 'lib', objectKey: key, uploadId: 'gone', parts: [{ partNumber: 1, etag: 'p1' }], fileName: 'r.bin', fileSize: plain.length, fileLastModified: 3 }
    const res = await uploadObject(api, file(), kGame, key, { ...noState, resume: stale })
    expect(res.size).toBe(plain.length)
    expect(await sha(objects.get(key)!)).toBe(await sha(fresh.objects.get(key)!))
  })

  it('resume after a completed upload whose response was lost treats the object as done', async () => {
    const plain = blobOf(5 * MiB)
    const file = () => new File([plain], 'd.bin', { lastModified: 4 })
    const kGame = newGameKey(); const key = newObjectKey()
    const { api, calls } = createFakeCloudApi()
    await uploadObject(api, file(), kGame, key, noState)
    const done: UploadState = { id: 's', libraryId: 'lib', objectKey: key, uploadId: 'u1', parts: [{ partNumber: 1, etag: 'p1' }], fileName: 'd.bin', fileSize: plain.length, fileLastModified: 4 }
    calls.uploadPart.length = 0
    const cleared: string[] = []
    const res = await uploadObject(api, file(), kGame, key, { ...noState, resume: done, clearState: async (id) => void cleared.push(id) })
    expect(res).toEqual({ objectKey: key, chunks: 2, size: plain.length })
    expect(calls.uploadPart).toEqual([])
    expect(cleared).toEqual(['s'])
  })

  it('part size is 4 chunks', () => {
    expect(PART_SIZE).toBe(16 * MiB)
  })

  it('download rejects a flipped byte and a truncated object', async () => {
    const { api, objects } = createFakeCloudApi()
    const kGame = newGameKey(); const key = newObjectKey()
    await uploadObject(api, new Blob([blobOf(5 * MiB)]), kGame, key, noState)
    const ref = { name: 'x', size: 5 * MiB, objectKey: key, chunks: 2 }
    const good = objects.get(key)!
    const bad = good.slice(); bad[100]! ^= 1
    objects.set(key, bad)
    await expect(downloadObject(api, ref, kGame)).rejects.toBeInstanceOf(DecryptError)
    objects.set(key, good.slice(0, good.length - 1000))
    await expect(downloadObject(api, ref, kGame)).rejects.toThrow(/truncat/i)
  })
})
