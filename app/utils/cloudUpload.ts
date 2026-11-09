import { CHUNK_SIZE, chunkCount, deriveObjectKey, encryptChunk, encryptedSize } from '~~/shared/utils/chunkCrypto'
import { concatBytes } from '~~/shared/utils/bytes'
import type { CloudApi } from './cloudApi'

/** 16 MiB of plaintext = 4 chunks per multipart part (R2 parts must be ≥ 5 MiB except the last). */
export const PART_SIZE = 4 * CHUNK_SIZE

export interface UploadState {
  id: string
  libraryId: string
  objectKey: string
  uploadId: string
  parts: { partNumber: number; etag: string }[]
  fileName: string
  fileSize: number
  fileLastModified: number
}

export interface UploadOptions {
  libraryId: string
  resume?: UploadState
  onProgress?: (uploadedBytes: number, totalBytes: number) => void
  saveState: (s: UploadState) => Promise<void>
  clearState: (id: string) => Promise<void>
}

/**
 * Encrypts `blob` chunk by chunk (deterministic for a given K_game + objectKey, so a resumed upload
 * produces exactly the same ciphertext) and uploads it as a multipart object. Parts already listed
 * in `opts.resume` are skipped.
 */
export async function uploadObject(api: CloudApi, blob: Blob, kGame: Uint8Array, objectKey: string, opts: UploadOptions): Promise<{ objectKey: string; chunks: number; size: number }> {
  const size = blob.size
  const chunks = chunkCount(size)
  const totalParts = Math.max(1, Math.ceil(size / PART_SIZE))
  const key = await deriveObjectKey(kGame, objectKey)
  const file = blob as Partial<File>

  const state: UploadState = opts.resume ?? {
    id: crypto.randomUUID(),
    libraryId: opts.libraryId,
    objectKey,
    uploadId: await api.createUpload(objectKey),
    parts: [],
    fileName: file.name ?? '',
    fileSize: size,
    fileLastModified: file.lastModified ?? 0,
  }
  await opts.saveState(state)

  const done = new Set(state.parts.map((p) => p.partNumber))
  const report = () => opts.onProgress?.(Math.min(size, state.parts.length * PART_SIZE), size)
  report()

  for (let part = 1; part <= totalParts; part++) {
    if (done.has(part)) continue
    const start = (part - 1) * PART_SIZE
    const plain = new Uint8Array(await blob.slice(start, Math.min(size, start + PART_SIZE)).arrayBuffer())
    const encrypted: Uint8Array[] = []
    for (let off = 0; off < plain.length; off += CHUNK_SIZE) {
      const index = (start + off) / CHUNK_SIZE
      encrypted.push(await encryptChunk(key, objectKey, index, plain.subarray(off, off + CHUNK_SIZE)))
    }
    const etag = await api.uploadPart(objectKey, state.uploadId, part, concatBytes(...encrypted))
    state.parts.push({ partNumber: part, etag })
    state.parts.sort((a, b) => a.partNumber - b.partNumber)
    await opts.saveState(state)
    report()
  }

  await api.completeUpload(objectKey, state.uploadId, state.parts, encryptedSize(size))
  await opts.clearState(state.id)
  return { objectKey, chunks, size }
}
