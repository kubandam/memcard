import type { CloudApi } from '../../app/utils/cloudApi'
import { ApiError } from '../../app/utils/cloudApi'
import { concatBytes } from '../../shared/utils/bytes'

/** In-memory CloudApi double that behaves like the server routes. */
export function createFakeCloudApi(opts: { quotaBytes?: number; libraryId?: string } = {}) {
  const objects = new Map<string, Uint8Array>()
  const uploads = new Map<string, { key: string; parts: Map<number, Uint8Array> }>()
  let manifest: { bytes: Uint8Array; etag: string } | null = null
  let etagN = 0
  const calls = { uploadPart: [] as number[], completes: 0, putManifest: 0 }
  let used = 0
  let failNextPutManifest = false
  const libraryId = opts.libraryId ?? 'lib'
  const shares = new Map<string, { gameId: string | null; allowedKeys: string[]; wrapped: Uint8Array; createdAt: number; revokedAt: number | null }>()
  let clock = 0
  const api: CloudApi = {
    async createLibrary() {},
    async usage() { return { bytesUsed: used, softLimit: 8 * 1024 ** 3, hardLimit: opts.quotaBytes ?? 9 * 1024 ** 3 } },
    async getManifest() { return manifest ? { bytes: manifest.bytes, etag: manifest.etag } : null },
    async putManifest(bytes, ifMatch) {
      calls.putManifest++
      if (failNextPutManifest) { failNextPutManifest = false; manifest = { bytes: manifest?.bytes ?? new Uint8Array(), etag: `e${++etagN}` }; throw new ApiError(412) }
      if ((manifest?.etag ?? null) !== ifMatch) throw new ApiError(412)
      manifest = { bytes, etag: `e${++etagN}` }
      return manifest.etag
    },
    async createUpload(key) { const id = `u${uploads.size + 1}`; uploads.set(id, { key, parts: new Map() }); return id },
    async uploadPart(_key, uploadId, part, body) { calls.uploadPart.push(part); const up = uploads.get(uploadId); if (!up) throw new ApiError(404); up.parts.set(part, body.slice()); return `p${part}` },
    async completeUpload(key, uploadId, parts, size) {
      calls.completes++
      if (opts.quotaBytes !== undefined && used + size > opts.quotaBytes) { uploads.delete(uploadId); throw new ApiError(413, 'quota') }
      const up = uploads.get(uploadId)
      if (!up) throw new ApiError(404)
      objects.set(key, concatBytes(...parts.map((p) => up.parts.get(p.partNumber)!)))
      used += size
      uploads.delete(uploadId)
    },
    async abortUpload(_key, uploadId) { uploads.delete(uploadId) },
    async getRange(key, start, end) {
      const o = objects.get(key)
      if (!o) throw new ApiError(404)
      if (start > end || start >= o.length) throw new ApiError(416)
      return o.slice(start, end + 1)
    },
    async deleteObject(key) { const o = objects.get(key); if (o) used -= o.length; objects.delete(key) },
    async createShare(input) {
      if (shares.has(input.shareId)) throw new ApiError(409)
      shares.set(input.shareId, { gameId: input.gameId, allowedKeys: [...input.allowedKeys], wrapped: input.wrapped.slice(), createdAt: ++clock, revokedAt: null })
    },
    async listShares() {
      return [...shares.entries()].sort((a, b) => b[1].createdAt - a[1].createdAt).map(([id, r]) => ({ id, gameId: r.gameId, createdAt: r.createdAt, revokedAt: r.revokedAt }))
    },
    async revokeShare(shareId) {
      const r = shares.get(shareId)
      if (!r || r.revokedAt !== null) throw new ApiError(404)
      r.revokedAt = ++clock
    },
  }
  /** Public lookup + share-scoped reader, enforcing the server's scope rules. */
  const shareTransport = {
    async lookup(shareId: string) {
      const r = shares.get(shareId)
      if (!r || r.revokedAt !== null) throw new ApiError(404)
      return { libraryId, gameId: r.gameId, wrapped: r.wrapped.slice() }
    },
    reader(shareId: string, lib: string) {
      const check = (what: { manifest: true } | { key: string }) => {
        const r = shares.get(shareId)
        if (!r || r.revokedAt !== null || lib !== libraryId) throw new ApiError(404)
        if (r.gameId !== null && ('manifest' in what || !r.allowedKeys.includes(what.key))) throw new ApiError(404)
      }
      return {
        async getManifest() { check({ manifest: true }); return api.getManifest() },
        async getRange(key: string, start: number, end: number) { check({ key }); return api.getRange(key, start, end) },
      }
    },
  }
  return { api, objects, uploads, calls, shares, shareTransport, failManifestOnce: () => { failNextPutManifest = true } }
}
