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
export const CHUNKS_PER_REQUEST = 4
/** Parts fetched at once: one connection is slow (~1–2 MB/s through the Worker), several fill the line. */
export const DOWNLOAD_CONCURRENCY = 4
const ENC_CHUNK = CHUNK_SIZE + GCM_TAG

/**
 * Keeps downloaded ciphertext parts on this PC. It only ever sees encrypted bytes, and every part
 * is still verified by AES-GCM on read, so a damaged or tampered cache is detected and refetched.
 * Implementations must never throw: caching is best effort.
 */
export interface ObjectCache {
  getPart(objectKey: string, part: number): Promise<Uint8Array | undefined>
  putPart(objectKey: string, part: number, cipher: Uint8Array): Promise<void>
  dropObject(objectKey: string): Promise<void>
  /** The whole object was read; mark it used and make room under the limit. */
  finish(objectKey: string): Promise<void>
}

export interface DownloadProgress {
  /** Plain bytes ready so far. */
  done: number
  total: number
  /** Of `done`, bytes that came over the network (the rest came from the cache). */
  network: number
}

export interface DownloadOptions {
  cache?: ObjectCache
  concurrency?: number
  onProgress?: (p: DownloadProgress) => void
}

/** Downloads and decrypts one object, verifying every chunk and the total length. */
export async function downloadObject(
  api: Pick<CloudApi, 'getRange'>,
  ref: CloudFileRef,
  kGame: Uint8Array,
  onProgressOrOptions?: ((done: number, total: number) => void) | DownloadOptions,
): Promise<Uint8Array> {
  const opts: DownloadOptions = typeof onProgressOrOptions === 'function'
    ? { onProgress: (p) => onProgressOrOptions(p.done, p.total) }
    : (onProgressOrOptions ?? {})
  const { cache } = opts
  const key = await deriveObjectKey(kGame, ref.objectKey)
  const out = new Uint8Array(ref.size)
  const parts = Math.ceil(ref.chunks / CHUNKS_PER_REQUEST)
  let done = 0
  let network = 0

  async function decryptPart(first: number, last: number, cipher: Uint8Array) {
    for (let i = first, off = 0; i <= last; i++) {
      const len = plainSizeOfChunk(i, ref.size) + GCM_TAG
      try {
        out.set(await decryptChunk(key, ref.objectKey, i, cipher.subarray(off, off + len)), i * CHUNK_SIZE)
      } catch {
        throw new DecryptError(`Stored file is damaged or was tampered with: ${ref.name}`)
      }
      off += len
    }
  }

  async function loadPart(part: number) {
    const first = part * CHUNKS_PER_REQUEST
    const last = Math.min(ref.chunks, first + CHUNKS_PER_REQUEST) - 1
    const expected = (last - first) * ENC_CHUNK + plainSizeOfChunk(last, ref.size) + GCM_TAG
    const plain = expected - (last - first + 1) * GCM_TAG

    const cached = cache ? await cache.getPart(ref.objectKey, part) : undefined
    if (cached && cached.length === expected) {
      try {
        await decryptPart(first, last, cached)
        done += plain
        opts.onProgress?.({ done, total: ref.size, network })
        return
      } catch {
        // Damaged cache: forget this object and fall through to the network.
        await cache!.dropObject(ref.objectKey)
      }
    }

    const start = first * ENC_CHUNK
    const cipher = await api.getRange(ref.objectKey, start, start + expected - 1)
    if (cipher.length !== expected) throw new DecryptError(`Stored file is truncated: ${ref.name}`)
    await decryptPart(first, last, cipher)
    if (cache) await cache.putPart(ref.objectKey, part, cipher)
    done += plain
    network += plain
    opts.onProgress?.({ done, total: ref.size, network })
  }

  let next = 0
  let failed = false
  const worker = async () => {
    while (!failed && next < parts) {
      const part = next++
      try {
        await loadPart(part)
      } catch (err) {
        failed = true
        throw err
      }
    }
  }
  const lanes = Math.max(1, Math.min(parts, opts.concurrency ?? DOWNLOAD_CONCURRENCY))
  await Promise.all(Array.from({ length: lanes }, worker))
  if (cache) await cache.finish(ref.objectKey)
  return out
}
