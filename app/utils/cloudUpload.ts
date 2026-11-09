import { CHUNK_SIZE, chunkCount, deriveObjectKey, encryptChunk, encryptedSize } from '~~/shared/utils/chunkCrypto'
import { concatBytes } from '~~/shared/utils/bytes'
import { ApiError, type CloudApi } from './cloudApi'

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

/**
 * Thrown when a saved resume state does not belong to the given file. Continuing would encrypt
 * different plaintext under the same key and counter nonces, which breaks AES-GCM.
 */
export class ResumeMismatchError extends Error {
  constructor() {
    super('This file does not match the interrupted upload')
    this.name = 'ResumeMismatchError'
  }
}

/** Thrown when the caller cancelled (library closed) between parts. */
export class UploadCancelledError extends Error {
  constructor() {
    super('Upload cancelled')
    this.name = 'UploadCancelledError'
  }
}

export interface UploadOptions {
  libraryId: string
  resume?: UploadState
  onProgress?: (uploadedBytes: number, totalBytes: number) => void
  saveState: (s: UploadState) => Promise<void>
  clearState: (id: string) => Promise<void>
  /** Checked before every part; returning true stops the upload with UploadCancelledError. */
  isCancelled?: () => boolean
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

  if (opts.resume) {
    const r = opts.resume
    if (r.objectKey !== objectKey || r.fileSize !== size || r.fileLastModified !== (file.lastModified ?? 0) || (r.fileName && file.name !== undefined && r.fileName !== file.name)) {
      throw new ResumeMismatchError()
    }
  }

  const newState = async (): Promise<UploadState> => ({
    id: crypto.randomUUID(),
    libraryId: opts.libraryId,
    objectKey,
    uploadId: await api.createUpload(objectKey),
    parts: [],
    fileName: file.name ?? '',
    fileSize: size,
    fileLastModified: file.lastModified ?? 0,
  })
  const encSize = encryptedSize(size)
  const report = (st: UploadState) => opts.onProgress?.(Math.min(size, st.parts.length * PART_SIZE), size)
  const cancelled = () => {
    if (opts.isCancelled?.()) throw new UploadCancelledError()
  }

  async function run(state: UploadState) {
    await opts.saveState(state)
    const done = new Set(state.parts.map((p) => p.partNumber))
    report(state)
    for (let part = 1; part <= totalParts; part++) {
      if (done.has(part)) continue
      cancelled()
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
      report(state)
    }
    cancelled()
    await api.completeUpload(objectKey, state.uploadId, state.parts, encSize)
  }

  /** True when the object is already stored with exactly the expected encrypted length. */
  async function alreadyStored(): Promise<boolean> {
    try {
      return (await api.getRange(objectKey, encSize - 1, encSize - 1)).length === 1 && !(await probePastEnd())
    } catch {
      return false
    }
  }
  async function probePastEnd(): Promise<boolean> {
    try {
      await api.getRange(objectKey, encSize, encSize)
      return true
    } catch {
      return false
    }
  }

  let state = opts.resume ?? (await newState())
  try {
    await run(state)
  } catch (err) {
    // A resumed upload the server no longer knows: either it already completed (response lost)
    // or R2 dropped it. Same key + plaintext ⇒ same ciphertext, so restarting is safe.
    if (!(opts.resume && err instanceof ApiError && err.status === 404)) throw err
    if (!(await alreadyStored())) {
      await opts.clearState(state.id)
      state = await newState()
      await run(state)
    }
  }
  await opts.clearState(state.id)
  return { objectKey, chunks, size }
}
