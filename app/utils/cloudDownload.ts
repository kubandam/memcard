import type { CloudFileRef } from '~~/shared/types/library'
import { CHUNK_SIZE, GCM_TAG, decryptChunk, deriveObjectKey, plainSizeOfChunk } from '~~/shared/utils/chunkCrypto'
import type { CloudApi } from './cloudApi'

export class DecryptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecryptError'
  }
}

/** Encrypted chunks fetched per request (= one 16 MiB part). */
const CHUNKS_PER_REQUEST = 4
const ENC_CHUNK = CHUNK_SIZE + GCM_TAG

/** Downloads and decrypts one object, verifying every chunk and the total length. */
export async function downloadObject(api: Pick<CloudApi, 'getRange'>, ref: CloudFileRef, kGame: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const key = await deriveObjectKey(kGame, ref.objectKey)
  const out = new Uint8Array(ref.size)
  for (let first = 0; first < ref.chunks; first += CHUNKS_PER_REQUEST) {
    const last = Math.min(ref.chunks, first + CHUNKS_PER_REQUEST) - 1
    const expected = (last - first) * ENC_CHUNK + plainSizeOfChunk(last, ref.size) + GCM_TAG
    const start = first * ENC_CHUNK
    const cipher = await api.getRange(ref.objectKey, start, start + expected - 1)
    if (cipher.length !== expected) throw new DecryptError(`Stored file is truncated: ${ref.name}`)
    for (let i = first, off = 0; i <= last; i++) {
      const len = plainSizeOfChunk(i, ref.size) + GCM_TAG
      try {
        out.set(await decryptChunk(key, ref.objectKey, i, cipher.subarray(off, off + len)), i * CHUNK_SIZE)
      } catch {
        throw new DecryptError(`Stored file is damaged or was tampered with: ${ref.name}`)
      }
      off += len
    }
    onProgress?.(Math.min(ref.size, (last + 1) * CHUNK_SIZE), ref.size)
  }
  return out
}
