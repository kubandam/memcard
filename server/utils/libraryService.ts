/// <reference types="@cloudflare/workers-types" />
import type { LibraryStore, ShareListRow } from './libraryStore'

/** Plain error the routes translate into an HTTP status (keeps this module free of h3). */
export class ServiceError extends Error {
  constructor(
    public status: number,
    public code?: string,
  ) {
    super(code ?? `status ${status}`)
  }
}

/** Largest encrypted part we accept: 16 MiB of plaintext (4 chunks) plus GCM tags, with headroom. */
export const MAX_PART_BYTES = 17 * 1024 * 1024
const PLAIN_PART = 16 * 1024 * 1024
/** Unfinished multipart uploads a library may hold at once. */
export const MAX_OPEN_UPLOADS = 8
/** Active (not revoked) share codes one library may have. */
export const MAX_ACTIVE_SHARES = 100
/** R2 aborts incomplete multipart uploads after 7 days; older reservations no longer count. */
export const MPU_TTL_MS = 7 * 24 * 3600 * 1000

const manifestPath = (libraryId: string, version: string) => `lib/${libraryId}/manifest/${version}`
export const objectPath = (libraryId: string, key: string) => `lib/${libraryId}/obj/${key}`
const savePath = (libraryId: string, saveKey: string) => `lib/${libraryId}/save/${saveKey}`
/** Largest encrypted memory card accepted (PS1 cards are 128 KiB). */
export const MAX_SAVE_BYTES = 1024 * 1024

export interface LibraryService {
  getManifest(libraryId: string): Promise<{ bytes: Uint8Array; etag: string } | null>
  putManifest(libraryId: string, ifMatch: string | null, body: Uint8Array): Promise<string>
  createUpload(libraryId: string, key: string): Promise<{ uploadId: string }>
  uploadPart(libraryId: string, key: string, uploadId: string, part: number, body: Uint8Array): Promise<{ etag: string }>
  completeUpload(libraryId: string, key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<{ size: number }>
  abortUpload(libraryId: string, key: string, uploadId: string): Promise<void>
  getObject(libraryId: string, key: string, range: { start: number; end: number } | null): Promise<{ body: ReadableStream | Uint8Array; size: number; contentRange?: string; length: number }>
  objectSize(libraryId: string, key: string): Promise<number | null>
  deleteObject(libraryId: string, key: string): Promise<void>
  createShare(libraryId: string, input: { shareId: string; gameId: string | null; allowedKeys: string[]; wrapped: Uint8Array }): Promise<void>
  listShares(libraryId: string): Promise<Omit<ShareListRow, 'libraryId' | 'allowedKeys'>[]>
  revokeShare(libraryId: string, shareId: string): Promise<void>
  /** Public: active share → what the recipient needs to unwrap it. 404 when unknown or revoked. */
  lookupShare(shareId: string): Promise<{ libraryId: string; gameId: string | null; wrapped: Uint8Array }>
  /** 404 unless the share is active, belongs to `libraryId`, and covers `what`. */
  authorizeShare(shareId: string, libraryId: string, what: { manifest: true } | { key: string }): Promise<void>
  getSave(libraryId: string, saveKey: string): Promise<Uint8Array>
  putSave(libraryId: string, saveKey: string, body: Uint8Array): Promise<void>
  deleteSave(libraryId: string, saveKey: string): Promise<void>
}

export function createLibraryService(deps: { store: LibraryStore; r2: R2Bucket; hardLimit: number; libraryLimit?: number; now?: () => number }): LibraryService {
  const { store, r2, hardLimit } = deps
  const libraryLimit = deps.libraryLimit ?? hardLimit
  const now = deps.now ?? Date.now
  const since = () => now() - MPU_TTL_MS

  async function requireUpload(libraryId: string, key: string, uploadId: string) {
    const up = await store.getUpload(uploadId)
    if (!up || up.libraryId !== libraryId || up.key !== key) throw new ServiceError(404)
    // Past the expiry window it no longer counts against the quota, so it must not take parts either.
    if (up.createdAt < since()) {
      await r2.resumeMultipartUpload(objectPath(libraryId, key), uploadId).abort().catch(() => undefined)
      await store.deleteUpload(uploadId)
      throw new ServiceError(404)
    }
    return up
  }

  return {
    async getManifest(libraryId) {
      const row = await store.getLibrary(libraryId)
      if (!row?.manifestEtag) return null
      const obj = await r2.get(manifestPath(libraryId, row.manifestEtag))
      if (!obj) throw new ServiceError(500, 'manifest-missing')
      return { bytes: new Uint8Array(await obj.arrayBuffer()), etag: row.manifestEtag }
    },

    /**
     * Writes a new manifest version, then moves the D1 pointer with a compare-and-swap. The pointer
     * is the single source of truth, so concurrent writers cannot both win and cannot wedge it.
     */
    async putManifest(libraryId, ifMatch, body) {
      const row = await store.getLibrary(libraryId)
      if (!row) throw new ServiceError(404)
      if ((row.manifestEtag ?? null) !== (ifMatch ?? null)) throw new ServiceError(412)
      const version = crypto.randomUUID()
      await r2.put(manifestPath(libraryId, version), body)
      if (!(await store.swapManifest(libraryId, ifMatch ?? null, version))) {
        await r2.delete(manifestPath(libraryId, version))
        throw new ServiceError(412)
      }
      if (ifMatch) await r2.delete(manifestPath(libraryId, ifMatch)).catch(() => undefined)
      return version
    },

    async createUpload(libraryId, key) {
      for (const stale of await store.deleteStaleUploads(since())) {
        await r2.resumeMultipartUpload(objectPath(stale.libraryId, stale.key), stale.id).abort().catch(() => undefined)
      }
      if ((await store.openUploads(libraryId, since())) >= MAX_OPEN_UPLOADS) throw new ServiceError(429, 'too-many-uploads')
      const mpu = await r2.createMultipartUpload(objectPath(libraryId, key))
      await store.putUpload(mpu.uploadId, libraryId, key, mpu.uploadId)
      return { uploadId: mpu.uploadId }
    },

    async uploadPart(libraryId, key, uploadId, part, body) {
      if (!Number.isInteger(part) || part < 1 || part > 10_000) throw new ServiceError(404)
      if ((part - 1) * PLAIN_PART >= hardLimit) throw new ServiceError(413, 'quota')
      if (body.length === 0 || body.length > MAX_PART_BYTES) throw new ServiceError(400)
      await requireUpload(libraryId, key, uploadId)
      // Unfinished uploads occupy R2 too, so they count against the limits; a re-sent part replaces its old size.
      const delta = body.length - (await store.partBytes(uploadId, part))
      const lib = await store.getLibrary(libraryId)
      if ((await store.totalBytes()) + (await store.pendingBytes(since())) + delta > hardLimit) throw new ServiceError(413, 'quota')
      if ((lib?.bytesUsed ?? 0) + (await store.pendingBytes(since(), libraryId)) + delta > libraryLimit) throw new ServiceError(413, 'quota')
      try {
        const uploaded = await r2.resumeMultipartUpload(objectPath(libraryId, key), uploadId).uploadPart(part, body)
        await store.setPartBytes(uploadId, part, body.length)
        return { etag: uploaded.etag }
      } catch {
        // R2 forgot the upload (aborted or expired): tell the client to start over.
        await store.deleteUpload(uploadId)
        throw new ServiceError(404)
      }
    },

    async completeUpload(libraryId, key, uploadId, parts) {
      if (!parts.length || parts.length > 10_000) throw new ServiceError(400)
      await requireUpload(libraryId, key, uploadId)
      let size: number
      try {
        size = (await r2.resumeMultipartUpload(objectPath(libraryId, key), uploadId).complete(parts)).size
      } catch {
        await store.deleteUpload(uploadId)
        throw new ServiceError(404)
      }
      await store.deleteUpload(uploadId)
      await store.addObject(libraryId, key, size)
      // Enforce the quota on what was actually stored, never on a size the client claims.
      if ((await store.totalBytes()) > hardLimit || ((await store.getLibrary(libraryId))?.bytesUsed ?? 0) > libraryLimit) {
        await r2.delete(objectPath(libraryId, key))
        await store.removeObject(libraryId, key)
        throw new ServiceError(413, 'quota')
      }
      return { size }
    },

    async abortUpload(libraryId, key, uploadId) {
      await requireUpload(libraryId, key, uploadId)
      await r2.resumeMultipartUpload(objectPath(libraryId, key), uploadId).abort().catch(() => undefined)
      await store.deleteUpload(uploadId)
    },

    async getObject(libraryId, key, range) {
      const head = await r2.head(objectPath(libraryId, key))
      if (!head) throw new ServiceError(404)
      if (range && (range.start > range.end || range.start >= head.size)) throw new ServiceError(416)
      if (!range) {
        const obj = await r2.get(objectPath(libraryId, key))
        if (!obj) throw new ServiceError(404)
        return { body: (obj as R2ObjectBody).body, size: head.size, length: head.size }
      }
      const end = Math.min(range.end, head.size - 1)
      const obj = await r2.get(objectPath(libraryId, key), { range: { offset: range.start, length: end - range.start + 1 } })
      if (!obj) throw new ServiceError(404)
      return { body: (obj as R2ObjectBody).body, size: head.size, length: end - range.start + 1, contentRange: `bytes ${range.start}-${end}/${head.size}` }
    },

    async objectSize(libraryId, key) {
      const head = await r2.head(objectPath(libraryId, key))
      return head ? head.size : null
    },

    async deleteObject(libraryId, key) {
      await r2.delete(objectPath(libraryId, key))
      await store.removeObject(libraryId, key)
    },

    async createShare(libraryId, input) {
      if ((await store.countActiveShares(libraryId)) >= MAX_ACTIVE_SHARES) throw new ServiceError(429, 'too-many-shares')
      const res = await store.createShare({ id: input.shareId, libraryId, gameId: input.gameId, allowedKeys: input.allowedKeys, wrapped: input.wrapped })
      if (res === 'exists') throw new ServiceError(409)
    },

    async listShares(libraryId) {
      return (await store.listShares(libraryId)).map(({ id, gameId, createdAt, revokedAt }) => ({ id, gameId, createdAt, revokedAt }))
    },

    async revokeShare(libraryId, shareId) {
      if (!(await store.revokeShare(libraryId, shareId))) throw new ServiceError(404)
    },

    async lookupShare(shareId) {
      const row = await store.getShare(shareId)
      if (!row || row.revokedAt !== null) throw new ServiceError(404)
      return { libraryId: row.libraryId, gameId: row.gameId, wrapped: row.wrapped }
    },

    async getSave(libraryId, saveKey) {
      const obj = await r2.get(savePath(libraryId, saveKey))
      if (!obj) throw new ServiceError(404)
      return new Uint8Array(await obj.arrayBuffer())
    },

    async putSave(libraryId, saveKey, body) {
      if (body.length === 0 || body.length > MAX_SAVE_BYTES) throw new ServiceError(400)
      const accountKey = `save:${saveKey}`
      const previous = (await store.listObjects(libraryId)).find((o) => o.key === accountKey)?.size ?? 0
      const delta = body.length - previous
      const lib = await store.getLibrary(libraryId)
      if ((await store.totalBytes()) + (await store.pendingBytes(since())) + delta > hardLimit) throw new ServiceError(413, 'quota')
      if ((lib?.bytesUsed ?? 0) + (await store.pendingBytes(since(), libraryId)) + delta > libraryLimit) throw new ServiceError(413, 'quota')
      await r2.put(savePath(libraryId, saveKey), body)
      await store.addObject(libraryId, accountKey, body.length)
    },

    async deleteSave(libraryId, saveKey) {
      await r2.delete(savePath(libraryId, saveKey))
      await store.removeObject(libraryId, `save:${saveKey}`)
    },

    async authorizeShare(shareId, libraryId, what) {
      const row = await store.getShare(shareId)
      if (!row || row.revokedAt !== null || row.libraryId !== libraryId) throw new ServiceError(404)
      if (row.gameId === null) return
      if ('manifest' in what || !row.allowedKeys.includes(what.key)) throw new ServiceError(404)
    },
  }
}
