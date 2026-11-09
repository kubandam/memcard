// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PART_SIZE, uploadObject, type UploadState } from '../../app/utils/cloudUpload'
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
    await expect(uploadObject(flaky, new Blob([plain]), kGame, key, { ...noState, saveState: async (s) => void (state = structuredClone(s)) })).rejects.toThrow('network')
    expect(state!.parts.map((p) => p.partNumber)).toEqual([1])
    resumed.calls.uploadPart.length = 0
    await uploadObject(resumed.api, new Blob([plain]), kGame, key, { ...noState, resume: state })
    expect(resumed.calls.uploadPart).toEqual([2, 3])
    expect(await sha(resumed.objects.get(key)!)).toBe(await sha(fresh.objects.get(key)!))
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
