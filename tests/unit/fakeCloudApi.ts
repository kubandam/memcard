import type { CloudApi } from '../../app/utils/cloudApi'
import { ApiError } from '../../app/utils/cloudApi'
import { concatBytes } from '../../shared/utils/bytes'

/** In-memory CloudApi double that behaves like the server routes. */
export function createFakeCloudApi(opts: { quotaBytes?: number } = {}) {
  const objects = new Map<string, Uint8Array>()
  const uploads = new Map<string, { key: string; parts: Map<number, Uint8Array> }>()
  let manifest: { bytes: Uint8Array; etag: string } | null = null
  let etagN = 0
  const calls = { uploadPart: [] as number[], completes: 0, putManifest: 0 }
  let used = 0
  let failNextPutManifest = false
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
    async uploadPart(_key, uploadId, part, body) { calls.uploadPart.push(part); uploads.get(uploadId)!.parts.set(part, body.slice()); return `p${part}` },
    async completeUpload(key, uploadId, parts, size) {
      calls.completes++
      if (opts.quotaBytes !== undefined && used + size > opts.quotaBytes) { uploads.delete(uploadId); throw new ApiError(413, 'quota') }
      const up = uploads.get(uploadId)!
      objects.set(key, concatBytes(...parts.map((p) => up.parts.get(p.partNumber)!)))
      used += size
      uploads.delete(uploadId)
    },
    async abortUpload(_key, uploadId) { uploads.delete(uploadId) },
    async getRange(key, start, end) {
      const o = objects.get(key)
      if (!o) throw new ApiError(404)
      return o.slice(start, end + 1)
    },
    async deleteObject(key) { const o = objects.get(key); if (o) used -= o.length; objects.delete(key) },
  }
  return { api, objects, uploads, calls, failManifestOnce: () => { failNextPutManifest = true } }
}
